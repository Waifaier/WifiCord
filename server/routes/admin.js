const express=require('express');
const crypto=require('crypto');
const db=require('../database/db');
const User=require('../models/User');
const {requireAuth}=require('./auth');
const router=express.Router();

function admin(req,res,next){
  const u=User.findById(req.session.userId);
  if(u?.role!=='admin') return res.status(403).json({error:'Acesso administrativo negado.'});
  next();
}
router.use(requireAuth,admin);

function logAction(adminId,targetId,action,payload={}){
  db.prepare('INSERT INTO admin_actions(admin_id,target_user_id,action,payload_json) VALUES (?,?,?,?)').run(adminId,targetId||null,action,JSON.stringify(payload));
}
function emitToUser(req,userId,event,payload={}){req.app.get('io')?.to('user:'+Number(userId)).emit(event,payload);}
function emitGlobal(req,event,payload={}){req.app.get('io')?.emit(event,payload);}
function publicAdminUser(u){return {...User.toPublic(u), bannedUntil:u.banned_until??null,chatMutedUntil:u.chat_muted_until??null,voiceMutedUntil:u.voice_muted_until??null,punishedUntil:u.punished_until??null,punishmentReason:u.punishment_reason||'',rainbowUntil:u.rainbow_until??null};}
function untilValue(body,key){
  if(body?.permanent===true) return -1;
  const minutes=Math.max(1,Math.min(Number(body?.minutes||0),525600));
  if(!Number.isFinite(minutes)||minutes<=0) throw new Error('Informe uma duração válida.');
  return Date.now()+minutes*60000;
}

router.get('/status',(req,res)=>res.json({configured:true,setupAvailable:!db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()}));
router.get('/users',(req,res)=>{
  const q=String(req.query.q||'').trim();
  const rows=q?db.prepare("SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY id DESC LIMIT 100").all('%'+q+'%','%'+q+'%'):db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 100').all();
  res.json({users:rows.map(publicAdminUser)});
});
router.get('/logs',(req,res)=>res.json({logs:db.prepare('SELECT a.*,u.username admin_username,t.username target_username FROM admin_actions a LEFT JOIN users u ON u.id=a.admin_id LEFT JOIN users t ON t.id=a.target_user_id ORDER BY a.id DESC LIMIT 100').all()}));

router.post('/users/:id/points',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});const delta=Number(req.body.delta);if(!Number.isFinite(delta)||Math.abs(delta)>1000000)return res.status(400).json({error:'Quantidade inválida.'});const updated=User.addPoints(id,Math.trunc(delta),'admin:'+req.session.userId);logAction(req.session.userId,id,'points',{delta});emitToUser(req,id,'profile:update',{user:User.toPublic(updated)});res.json({user:User.toPublic(updated)});});
router.post('/users/:id/set-points',(req,res)=>{const id=Number(req.params.id),u=User.findById(id),points=Number(req.body.points);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});if(!Number.isFinite(points)||points<0||points>100000000)return res.status(400).json({error:'Quantidade de pontos inválida.'});const before=Number(u.points||0),updated=User.setPoints(id,Math.trunc(points));db.prepare('INSERT INTO point_events(user_id,amount,reason) VALUES (?,?,?)').run(id,Math.trunc(points)-before,'admin:set-points:'+req.session.userId);logAction(req.session.userId,id,'set_points',{points:Math.trunc(points)});emitToUser(req,id,'profile:update',{user:User.toPublic(updated)});res.json({user:User.toPublic(updated)});});
router.post('/users/:id/status',(req,res)=>{const id=Number(req.params.id),u=User.findById(id),status=String(req.body.status||'');if(!u)return res.status(404).json({error:'Usuário não encontrado.'});if(!['online','away','offline'].includes(status))return res.status(400).json({error:'Status inválido.'});User.setStatus(id,status);logAction(req.session.userId,id,'status',{status});emitGlobal(req,'presence:update',{userId:id,status});res.json({ok:true,status});});
router.post('/users/:id/clear-messages',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});const result=db.prepare('DELETE FROM messages WHERE from_user_id=?').run(id);logAction(req.session.userId,id,'clear_messages',{count:result.changes});emitToUser(req,id,'admin:clear-messages',{count:result.changes});res.json({ok:true,count:result.changes});});
router.post('/users/:id/wfna',(req,res)=>{const id=Number(req.params.id),u=User.setWFNA(id,!!req.body.enabled);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});logAction(req.session.userId,id,'wfna',{enabled:!!req.body.enabled});emitToUser(req,id,'profile:update',{user:User.toPublic(u)});res.json({user:User.toPublic(u)});});
router.post('/users/:id/role',(req,res)=>{const id=Number(req.params.id);if(id===Number(req.session.userId)&&req.body.role!=='admin')return res.status(400).json({error:'Você não pode remover sua própria administração por esta tela.'});const role=['user','admin'].includes(req.body.role)?req.body.role:null;if(!role)return res.status(400).json({error:'Papel inválido.'});if(role==='user' && User.findById(id)?.role==='admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n<=1)return res.status(400).json({error:'Mantenha pelo menos um administrador.'});const u=User.setRole(id,role);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});logAction(req.session.userId,id,'role',{role});emitToUser(req,id,'profile:update',{user:User.toPublic(u)});res.json({user:User.toPublic(u)});});
router.post('/users/:id/chat-mute',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});try{const until=untilValue(req.body,'minutes');const updated=User.setModeration(id,'chatMutedUntil',until);logAction(req.session.userId,id,'chat_mute',{until});emitToUser(req,id,'admin:chat-mute',{until});res.json({user:publicAdminUser(updated)});}catch(e){res.status(400).json({error:e.message});}});
router.post('/users/:id/voice-mute',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});try{const until=untilValue(req.body,'minutes');const updated=User.setModeration(id,'voiceMutedUntil',until);logAction(req.session.userId,id,'voice_mute',{until});emitToUser(req,id,'admin:voice-mute',{until});res.json({user:publicAdminUser(updated)});}catch(e){res.status(400).json({error:e.message});}});
router.post('/users/:id/punish',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});try{const until=untilValue(req.body,'minutes'),reason=String(req.body.reason||'Castigo administrativo').slice(0,200);const updated=User.setModeration(id,'punishedUntil',until);User.setModeration(id,'punishmentReason',reason);logAction(req.session.userId,id,'punish',{until,reason});emitToUser(req,id,'admin:punish',{until,reason});res.json({user:publicAdminUser(updated)});}catch(e){res.status(400).json({error:e.message});}});
router.post('/users/:id/ban',(req,res)=>{const id=Number(req.params.id);if(id===Number(req.session.userId))return res.status(400).json({error:'Você não pode banir a si mesmo.'});const u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});try{const until=untilValue(req.body,'minutes');const updated=User.setModeration(id,'bannedUntil',until);User.setStatus(id,'offline');logAction(req.session.userId,id,'ban',{until});emitToUser(req,id,'admin:ban',{until});emitGlobal(req,'presence:update',{userId:id,status:'offline'});res.json({user:publicAdminUser(updated)});}catch(e){res.status(400).json({error:e.message});}});
router.post('/users/:id/unban',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});const updated=User.setModeration(id,'bannedUntil',null);logAction(req.session.userId,id,'unban');emitToUser(req,id,'admin:unban');res.json({user:publicAdminUser(updated)});});
router.post('/users/:id/rainbow',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});const enabled=req.body.enabled!==false;const until=enabled?(Date.now()+Math.min(Math.max(Number(req.body.seconds||30),1),3600)*1000):null;User.setModeration(id,'rainbowUntil',until);logAction(req.session.userId,id,'rainbow',{enabled,until});emitToUser(req,id,'admin:rainbow',{enabled,until});res.json({ok:true,until});});
router.post('/users/:id/effect',(req,res)=>{
  const id=Number(req.params.id),u=User.findById(id); if(!u)return res.status(404).json({error:'Usuário não encontrado.'});
  const allowed=['rainbow','lightning','rocket','confetti','shake','invert','matrix','fireworks','snow','party','glitch','flash','freeze','sparkles','hearts','disco','meteor','pixel','siren','boom','bubbles','tornado','blackout','portal','stars','wave','fire','ice','vortex','emoji-rain'];
  const effect=String(req.body.effect||''); if(!allowed.includes(effect))return res.status(400).json({error:'Efeito inválido.'});
  const duration=Math.min(Math.max(Number(req.body.duration||3),1),15);
  logAction(req.session.userId,id,'effect',{effect,duration}); emitToUser(req,id,'admin:effect',{effect,duration,nonce:crypto.randomUUID()}); res.json({ok:true,effect,duration});
});
router.post('/users/:id/scare',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});logAction(req.session.userId,id,'scare',{duration:3});emitToUser(req,id,'admin:scare',{duration:3,nonce:crypto.randomUUID()});res.json({ok:true});});
router.post('/users/:id/disconnect-call',(req,res)=>{const id=Number(req.params.id);if(!User.findById(id))return res.status(404).json({error:'Usuário não encontrado.'});logAction(req.session.userId,id,'disconnect_call');emitToUser(req,id,'admin:disconnect-call');res.json({ok:true});});
router.post('/users/:id/clear',(req,res)=>{const id=Number(req.params.id),u=User.findById(id);if(!u)return res.status(404).json({error:'Usuário não encontrado.'});const updated=User.clearModeration(id);logAction(req.session.userId,id,'clear_moderation');emitToUser(req,id,'admin:clear');res.json({user:publicAdminUser(updated)});});

// Primeiro administrador: exige chave definida fora do navegador e só funciona enquanto não existe nenhum admin.
router.post('/setup/claim', (req,res)=>res.status(403).json({error:'Use o comando local de ativação do administrador. A ativação por navegador está desabilitada.'}));

module.exports=router;
