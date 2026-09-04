const db = require('../database/db');
const crypto = require('crypto');

function generateInviteCode() { return crypto.randomBytes(4).toString('hex'); }
function defaultRoles(serverId) {
  const exists = db.prepare('SELECT 1 FROM server_roles WHERE server_id=? LIMIT 1').get(serverId);
  if (exists) return db.prepare('SELECT * FROM server_roles WHERE server_id=? ORDER BY position DESC,id ASC').all(serverId);
  db.prepare("INSERT INTO server_roles(server_id,name,color,position,is_default,permissions_json) VALUES (?,?,?,?,?,?)").run(serverId,'Admin','#f0b232',100,0,JSON.stringify({manageServer:true,manageRoles:true,manageMembers:true,manageChannels:true}));
  db.prepare("INSERT INTO server_roles(server_id,name,color,position,is_default,permissions_json) VALUES (?,?,?,?,?,?)").run(serverId,'Moderador','#58a6ff',50,0,JSON.stringify({manageMembers:true,manageMessages:true,manageVoice:true}));
  db.prepare("INSERT INTO server_roles(server_id,name,color,position,is_default,permissions_json) VALUES (?,?,?,?,?,?)").run(serverId,'Membro','#99aab5',10,1,JSON.stringify({sendMessages:true,connectVoice:true}));
  return db.prepare('SELECT * FROM server_roles WHERE server_id=? ORDER BY position DESC,id ASC').all(serverId);
}
const ServerModel = {
  create(ownerId, name) {
    const inviteCode = generateInviteCode();
    const info = db.prepare('INSERT INTO servers (name, owner_id, invite_code) VALUES (?, ?, ?)').run(name, ownerId, inviteCode);
    const serverId = info.lastInsertRowid;
    ServerModel.addMember(serverId, ownerId);
    db.prepare(`INSERT INTO channels (server_id, name) VALUES (?, 'geral')`).run(serverId);
    const roles = defaultRoles(serverId);
    const adminRole = roles.find(r => r.name === 'Admin');
    const defaultRole = roles.find(r => r.is_default);
    if (defaultRole) db.prepare('DELETE FROM server_member_roles WHERE server_id=? AND user_id=? AND role_id=?').run(serverId,ownerId,defaultRole.id);
    if (adminRole) db.prepare('INSERT OR IGNORE INTO server_member_roles(server_id,user_id,role_id) VALUES (?,?,?)').run(serverId, ownerId, adminRole.id);
    return ServerModel.findById(serverId);
  },
  findById(id) { return db.prepare('SELECT * FROM servers WHERE id = ?').get(id); },
  findByInviteCode(code) { return db.prepare('SELECT * FROM servers WHERE invite_code = ?').get(code); },
  addMember(serverId, userId) {
    db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)').run(serverId, userId);
    const roles = defaultRoles(serverId);
    const memberRole = roles.find(r => r.is_default) || roles[roles.length-1];
    if (memberRole) db.prepare('INSERT OR IGNORE INTO server_member_roles(server_id,user_id,role_id) VALUES (?,?,?)').run(serverId,userId,memberRole.id);
  },
  isMember(serverId, userId) { return !!db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId); },
  isOwner(serverId, userId) { return !!db.prepare('SELECT 1 FROM servers WHERE id=? AND owner_id=?').get(serverId,userId); },
  canManage(serverId, userId) {
    if (ServerModel.isOwner(serverId,userId)) return true;
    const row=db.prepare(`SELECT 1 FROM server_member_roles smr JOIN server_roles r ON r.id=smr.role_id WHERE smr.server_id=? AND smr.user_id=? AND (json_extract(r.permissions_json,'$.manageServer')=1 OR json_extract(r.permissions_json,'$.manageMembers')=1) LIMIT 1`).get(serverId,userId);
    return !!row;
  },
  listForUser(userId) { return db.prepare(`SELECT s.* FROM servers s JOIN server_members sm ON sm.server_id=s.id WHERE sm.user_id=? ORDER BY s.created_at ASC`).all(userId); },
  ensureRoles(serverId) { return defaultRoles(serverId); },
  listRoles(serverId) { return defaultRoles(serverId); },
  listMembers(serverId) {
    defaultRoles(serverId);
    return db.prepare(`SELECT u.id,u.username,u.display_name,u.avatar_url,u.frame,u.decoration,u.status,u.banner_url,u.settings_json,s.owner_id,
      sn.nickname AS server_nickname,
      COALESCE((SELECT json_group_array(json_object('id',r.id,'name',r.name,'color',r.color,'position',r.position)) FROM server_member_roles smr2 JOIN server_roles r ON r.id=smr2.role_id WHERE smr2.server_id=? AND smr2.user_id=u.id),'[]') AS roles_json
      FROM server_members sm JOIN users u ON u.id=sm.user_id JOIN servers s ON s.id=sm.server_id
      LEFT JOIN server_nicknames sn ON sn.server_id=sm.server_id AND sn.user_id=u.id
      WHERE sm.server_id=? ORDER BY CASE WHEN u.id=s.owner_id THEN 0 ELSE 1 END, u.status='offline', u.display_name COLLATE NOCASE`).all(serverId,serverId).map(r=>({...r,roles:JSON.parse(r.roles_json||'[]'),profileSettings:(()=>{try{return r.settings_json?JSON.parse(r.settings_json):{}}catch(_){return {}}})()}));
  },
  setServerNickname(serverId,userId,nickname){
    const clean=String(nickname||'').trim().slice(0,32);
    if(!clean) db.prepare('DELETE FROM server_nicknames WHERE server_id=? AND user_id=?').run(serverId,userId);
    else db.prepare(`INSERT INTO server_nicknames(server_id,user_id,nickname) VALUES(?,?,?) ON CONFLICT(server_id,user_id) DO UPDATE SET nickname=excluded.nickname,updated_at=datetime('now')`).run(serverId,userId,clean);
    return ServerModel.listMembers(serverId);
  },
  setLocalNickname(ownerId,targetId,nickname){
    const clean=String(nickname||'').trim().slice(0,32);
    if(!clean) db.prepare('DELETE FROM user_local_nicknames WHERE owner_user_id=? AND target_user_id=?').run(ownerId,targetId);
    else db.prepare(`INSERT INTO user_local_nicknames(owner_user_id,target_user_id,nickname) VALUES(?,?,?) ON CONFLICT(owner_user_id,target_user_id) DO UPDATE SET nickname=excluded.nickname,updated_at=datetime('now')`).run(ownerId,targetId,clean);
    return clean;
  },
  getLocalNickname(ownerId,targetId){ return db.prepare('SELECT nickname FROM user_local_nicknames WHERE owner_user_id=? AND target_user_id=?').get(ownerId,targetId)?.nickname || null; },
  createRole(serverId,name,color,position,permissions={}){ const info=db.prepare('INSERT INTO server_roles(server_id,name,color,position,is_default,permissions_json) VALUES(?,?,?,?,0,?)').run(serverId,String(name).trim().slice(0,32),String(color||'#99aab5'),Number(position)||0,JSON.stringify(permissions)); return db.prepare('SELECT * FROM server_roles WHERE id=?').get(info.lastInsertRowid); },
  assignRole(serverId,userId,roleId){ db.prepare('INSERT OR IGNORE INTO server_member_roles(server_id,user_id,role_id) VALUES(?,?,?)').run(serverId,userId,roleId); },
  removeRole(serverId,userId,roleId){ db.prepare('DELETE FROM server_member_roles WHERE server_id=? AND user_id=? AND role_id=?').run(serverId,userId,roleId); },
  getSettings(serverId) {
    const row = db.prepare('SELECT settings_json FROM server_settings WHERE server_id=?').get(serverId);
    let settings={}; try{settings=row?.settings_json?JSON.parse(row.settings_json):{}}catch(_){settings={};}
    return Object.assign({verification:'none',defaultNotifications:'all',explicitContent:'standard',allowExternalEmbeds:true,allowMedia:true,allowStickers:true,allowSuperEmojis:true,slowmodeSeconds:0,maxFileSizeMB:4096,community:true,animatedServerIcon:false,showMediaChannel:true,threads:true,reactions:true,superEffects:true,retention:'forever',mentionsEveryone:true,require2FA:false,requireVerifiedAccount:false,linkFilter:false,raidProtection:true,timeoutSeconds:300,onboardingMessage:'',onboardingChannelId:null,onboardingRules:false,onboardingScreening:false,rulesUrl:''},settings);
  },
  updateSettings(serverId, patch) {
    const current=ServerModel.getSettings(serverId);
    const allowed=['verification','defaultNotifications','explicitContent','allowExternalEmbeds','allowMedia','allowStickers','allowSuperEmojis','slowmodeSeconds','maxFileSizeMB','community','animatedServerIcon','showMediaChannel','welcomeMessage','systemMessages','autoMod','discoverable','inviteSplash','threads','reactions','superEffects','retention','mentionsEveryone','require2FA','requireVerifiedAccount','linkFilter','raidProtection','timeoutSeconds','onboardingMessage','onboardingChannelId','onboardingRules','onboardingScreening','rulesUrl'];
    const clean={...current}; for(const k of allowed) if(Object.prototype.hasOwnProperty.call(patch||{},k)) clean[k]=patch[k];
    db.prepare(`INSERT INTO server_settings(server_id,settings_json) VALUES(?,?) ON CONFLICT(server_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=datetime('now')`).run(serverId,JSON.stringify(clean));
    return clean;
  },
  updateProfile(serverId, { name, iconUrl, bannerUrl }) {
    db.prepare('UPDATE servers SET name=?, icon_url=?, banner_url=? WHERE id=?')
      .run(name, iconUrl ?? null, bannerUrl ?? null, serverId);
    return ServerModel.findById(serverId);
  },
  toPublic(server) { return {id:server.id,name:server.name,ownerId:server.owner_id,inviteCode:server.invite_code,createdAt:server.created_at,iconUrl:server.icon_url||null,bannerUrl:server.banner_url||null}; },
};
module.exports = ServerModel;
