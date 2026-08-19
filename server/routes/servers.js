const express = require('express');
const ServerModel = require('../models/Server');
const Channel = require('../models/Channel');
const db = require('../database/db');
const { parsePositiveInt, isNonEmptyString } = require('../utils/validate');
const { requireAuth } = require('./auth');
const router = express.Router();

router.post('/', requireAuth, (req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!isNonEmptyString(name,64))return res.status(400).json({error:'Nome do servidor inválido.'});
  const server=ServerModel.create(req.session.userId,name);
  res.json({server:ServerModel.toPublic(server)});
});
router.get('/',requireAuth,(req,res)=>res.json({servers:ServerModel.listForUser(req.session.userId).map(ServerModel.toPublic)}));
router.post('/join',requireAuth,(req,res)=>{
  const inviteCode=String(req.body.inviteCode||'').trim(); if(!inviteCode)return res.status(400).json({error:'Código de convite inválido.'});
  const server=ServerModel.findByInviteCode(inviteCode); if(!server)return res.status(404).json({error:'Servidor não encontrado.'});
  ServerModel.addMember(server.id,req.session.userId); res.json({server:ServerModel.toPublic(server)});
});
router.get('/:serverId/members',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId)return res.status(400).json({error:'ID inválido.'});
  if(!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  const server=ServerModel.findById(serverId);
  const members=ServerModel.listMembers(serverId).map(m=>({id:m.id,username:m.username,displayName:m.display_name,avatarUrl:m.avatar_url,frame:m.frame||null,decoration:m.decoration||null,status:m.status,ownerId:m.owner_id,serverNickname:m.server_nickname||null,roles:m.roles||[],profileSettings:m.profileSettings||{}}));
  const roles=ServerModel.listRoles(serverId).map(r=>({id:r.id,name:r.name,color:r.color,position:r.position,isDefault:!!r.is_default,permissions:JSON.parse(r.permissions_json||'{}')}));
  const localNicknames={};
  for(const m of members) localNicknames[m.id]=ServerModel.getLocalNickname(req.session.userId,m.id);
  res.json({members,roles,ownerId:server.owner_id,localNicknames});
});
router.put('/:serverId/members/:userId/nickname',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),targetId=parsePositiveInt(req.params.userId);
  if(!serverId||!targetId||!ServerModel.isMember(serverId,req.session.userId)||!ServerModel.isMember(serverId,targetId))return res.status(403).json({error:'Não autorizado.'});
  const isSelf=targetId===Number(req.session.userId); if(!isSelf&&!ServerModel.canManage(serverId,req.session.userId))return res.status(403).json({error:'Somente você ou um administrador do servidor pode alterar esse apelido.'});
  const nickname=String(req.body.nickname||'').trim().slice(0,32); ServerModel.setServerNickname(serverId,targetId,nickname);
  req.app.get('io')?.to('server:'+serverId).emit('server:members:update',{serverId}); res.json({ok:true,nickname:nickname||null});
});
router.put('/:serverId/members/:userId/local-nickname',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),targetId=parsePositiveInt(req.params.userId);
  if(!serverId||!targetId||!ServerModel.isMember(serverId,req.session.userId)||!ServerModel.isMember(serverId,targetId))return res.status(403).json({error:'Não autorizado.'});
  const nickname=ServerModel.setLocalNickname(req.session.userId,targetId,req.body.nickname||''); res.json({ok:true,nickname:nickname||null});
});
router.post('/:serverId/roles',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId||!ServerModel.canManage(serverId,req.session.userId))return res.status(403).json({error:'Somente administradores do servidor podem gerenciar cargos.'});
  const name=String(req.body.name||'').trim().slice(0,32), color=/^#[0-9a-f]{6}$/i.test(String(req.body.color||''))?String(req.body.color):'#99aab5';
  if(!name)return res.status(400).json({error:'Nome do cargo inválido.'});
  res.json({role:ServerModel.createRole(serverId,name,color,Number(req.body.position)||20,req.body.permissions||{})});
});
router.put('/:serverId/roles/:roleId/members/:userId',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),roleId=parsePositiveInt(req.params.roleId),targetId=parsePositiveInt(req.params.userId);
  if(!serverId||!roleId||!targetId||!ServerModel.canManage(serverId,req.session.userId)||!ServerModel.isMember(serverId,targetId))return res.status(403).json({error:'Não autorizado.'});
  const role=db.prepare('SELECT * FROM server_roles WHERE id=? AND server_id=?').get(roleId,serverId); if(!role)return res.status(404).json({error:'Cargo não encontrado.'});
  if(req.body.enabled===false)ServerModel.removeRole(serverId,targetId,roleId); else ServerModel.assignRole(serverId,targetId,roleId);
  req.app.get('io')?.to('server:'+serverId).emit('server:members:update',{serverId}); res.json({ok:true});
});
router.put('/:serverId/profile',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId||!ServerModel.canManage(serverId,req.session.userId)) return res.status(403).json({error:'Somente administradores podem personalizar o servidor.'});
  const server=ServerModel.findById(serverId); if(!server) return res.status(404).json({error:'Servidor não encontrado.'});
  function image(v){ if(v===null||v==='') return null; if(typeof v!=='string'||!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(v)||v.length>4200000) throw new Error('Imagem inválida ou muito grande.'); return v; }
  try{
    const name=String(req.body.name??server.name).trim().slice(0,64)||server.name;
    const icon=image(req.body.iconUrl===undefined?server.icon_url:req.body.iconUrl);
    const banner=image(req.body.bannerUrl===undefined?server.banner_url:req.body.bannerUrl);
    db.prepare('UPDATE servers SET name=?,icon_url=?,banner_url=? WHERE id=?').run(name,icon,banner,serverId);
    const updated=ServerModel.findById(serverId); const pub=ServerModel.toPublic(updated); req.app.get('io')?.to('server:'+serverId).emit('server:profile:update',{server:pub}); res.json({server:pub});
  }catch(e){res.status(400).json({error:e.message});}
});

router.get('/:serverId/settings',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId)return res.status(400).json({error:'ID inválido.'});
  if(!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  res.json({settings:ServerModel.getSettings(serverId),canManage:ServerModel.canManage(serverId,req.session.userId)});
});
router.put('/:serverId/settings',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId)return res.status(400).json({error:'ID inválido.'});
  if(!ServerModel.canManage(serverId,req.session.userId))return res.status(403).json({error:'Somente administradores do servidor podem alterar estas configurações.'});
  const settings=ServerModel.updateSettings(serverId,req.body||{});
  req.app.get('io')?.to('server:'+serverId).emit('server:settings:update',{serverId,settings});
  res.json({settings});
});

router.get('/:serverId/roles',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId||!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  res.json({roles:ServerModel.listRoles(serverId).map(r=>({id:r.id,name:r.name,color:r.color,position:r.position,isDefault:!!r.is_default,permissions:JSON.parse(r.permissions_json||'{}')}))});
});

router.get('/:serverId/media',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId||!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  const rows=db.prepare(`SELECT DISTINCT mf.* FROM media_files mf JOIN messages m ON (m.content LIKE '%__MEDIA__:%' || mf.id || '%') JOIN channels c ON c.id=m.channel_id WHERE c.server_id=? ORDER BY mf.id DESC LIMIT 200`).all(serverId);
  res.json({media:rows.map(r=>({id:r.id,name:r.original_name,mime:r.mime_type,size:Number(r.size_bytes),url:r.url,createdAt:r.created_at,ownerId:r.user_id}))});
});


router.put('/:serverId/channels/:channelId',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),channelId=parsePositiveInt(req.params.channelId);
  if(!serverId||!channelId||!ServerModel.canManage(serverId,req.session.userId)) return res.status(403).json({error:'Somente administradores podem editar canais.'});
  const channel=Channel.findById(channelId);
  if(!channel||Number(channel.server_id)!==Number(serverId)) return res.status(404).json({error:'Canal não encontrado.'});
  const updated=Channel.update(channelId,req.body||{});
  req.app.get('io')?.to('server:'+serverId).emit('server:channels:update',{serverId});
  res.json({channel:Channel.toPublic(updated)});
});

router.delete('/:serverId/channels/:channelId',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),channelId=parsePositiveInt(req.params.channelId);
  if(!serverId||!channelId||!ServerModel.canManage(serverId,req.session.userId)) return res.status(403).json({error:'Somente administradores podem excluir canais.'});
  const channel=Channel.findById(channelId); if(!channel||Number(channel.server_id)!==Number(serverId)) return res.status(404).json({error:'Canal não encontrado.'});
  const count=db.prepare('SELECT COUNT(*) AS c FROM channels WHERE server_id=?').get(serverId).c; if(Number(count)<=1)return res.status(400).json({error:'O servidor precisa ter pelo menos um canal.'});
  db.prepare('DELETE FROM channels WHERE id=?').run(channelId);
  req.app.get('io')?.to('server:'+serverId).emit('server:channels:update',{serverId});
  res.json({ok:true});
});

router.put('/:serverId/roles/:roleId',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId),roleId=parsePositiveInt(req.params.roleId);
  if(!serverId||!roleId||!ServerModel.canManage(serverId,req.session.userId))return res.status(403).json({error:'Sem permissão para editar cargos.'});
  const role=db.prepare('SELECT * FROM server_roles WHERE id=? AND server_id=?').get(roleId,serverId); if(!role)return res.status(404).json({error:'Cargo não encontrado.'});
  const name=String(req.body.name??role.name).trim().slice(0,32)||role.name; const color=/^#[0-9a-f]{6}$/i.test(String(req.body.color||''))?String(req.body.color):role.color; const position=Number.isFinite(Number(req.body.position))?Math.max(0,Math.min(1000,Number(req.body.position))):role.position; const permissions=req.body.permissions&&typeof req.body.permissions==='object'?req.body.permissions:JSON.parse(role.permissions_json||'{}');
  db.prepare('UPDATE server_roles SET name=?,color=?,position=?,permissions_json=? WHERE id=? AND server_id=?').run(name,color,position,JSON.stringify(permissions),roleId,serverId);
  req.app.get('io')?.to('server:'+serverId).emit('server:members:update',{serverId});
  res.json({role:db.prepare('SELECT * FROM server_roles WHERE id=?').get(roleId)});
});

router.get('/:serverId/channels',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId)return res.status(400).json({error:'ID inválido.'});
  if(!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  res.json({channels:Channel.listForUser(serverId,req.session.userId).map(Channel.toPublic)});
});
router.post('/:serverId/channels',requireAuth,(req,res)=>{
  const serverId=parsePositiveInt(req.params.serverId); if(!serverId)return res.status(400).json({error:'ID inválido.'});
  if(!ServerModel.isMember(serverId,req.session.userId))return res.status(403).json({error:'Não autorizado.'});
  const name=String(req.body.name||'').trim(); if(!isNonEmptyString(name,64))return res.status(400).json({error:'Nome do canal inválido.'});
  const isPrivate=!!req.body.isPrivate;
  const allowedUserIds=Array.isArray(req.body.allowedUserIds)?req.body.allowedUserIds.map(Number).filter(Number.isInteger):[];
  const allowedRoleIds=Array.isArray(req.body.allowedRoleIds)?req.body.allowedRoleIds.map(Number).filter(Number.isInteger):[];
  if(isPrivate && !ServerModel.canManage(serverId,req.session.userId)) return res.status(403).json({error:'Somente administradores podem criar canais privados.'});
  if(isPrivate && !allowedUserIds.includes(Number(req.session.userId))) allowedUserIds.push(Number(req.session.userId));
  res.json({channel:Channel.toPublic(Channel.create(serverId,name,{type:req.body.type,isPrivate,allowedUserIds,allowedRoleIds,topic:req.body.topic,slowmodeSeconds:req.body.slowmodeSeconds}))});
});
module.exports=router;
