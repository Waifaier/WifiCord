const db = require('../database/db');

function parseOverwrites(channel) {
  try { return JSON.parse(channel?.permission_overwrites_json || '{}') || {}; } catch (_) { return {}; }
}

const Channel = {
  create(serverId, name, options = {}) {
    const type = ['text','voice','announcement','media'].includes(options.type) ? options.type : 'text';
    const isPrivate = options.isPrivate ? 1 : 0;
    const overwrites = {
      allowedUserIds: Array.isArray(options.allowedUserIds) ? options.allowedUserIds.map(Number).filter(Number.isInteger) : [],
      allowedRoleIds: Array.isArray(options.allowedRoleIds) ? options.allowedRoleIds.map(Number).filter(Number.isInteger) : [],
      everyone: options.everyone === false ? false : !isPrivate,
    };
    const stmt = db.prepare(`INSERT INTO channels
      (server_id,name,channel_type,is_private,permission_overwrites_json,topic,slowmode_seconds)
      VALUES (?,?,?,?,?,?,?)`);
    const info = stmt.run(serverId, name, type, isPrivate, JSON.stringify(overwrites), String(options.topic || '').slice(0,1024), Math.max(0, Math.min(21600, Number(options.slowmodeSeconds || 0))));
    return Channel.findById(info.lastInsertRowid);
  },

  findById(id) { return db.prepare('SELECT * FROM channels WHERE id = ?').get(id); },

  listForServer(serverId) { return db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY created_at ASC,id ASC').all(serverId); },

  canView(channel, userId) {
    if (!channel) return false;
    if (!channel.is_private) return true;
    const owner = db.prepare('SELECT owner_id FROM servers WHERE id=?').get(channel.server_id);
    if (Number(owner?.owner_id)===Number(userId)) return true;
    const ow = parseOverwrites(channel);
    if (Array.isArray(ow.allowedUserIds) && ow.allowedUserIds.includes(Number(userId))) return true;
    if (ow.everyone === true) return true;
    const roles = db.prepare(`SELECT role_id FROM server_member_roles WHERE server_id=? AND user_id=?`).all(channel.server_id, userId).map(r => Number(r.role_id));
    return Array.isArray(ow.allowedRoleIds) && roles.some(id => ow.allowedRoleIds.includes(id));
  },

  listForUser(serverId, userId) { return Channel.listForServer(serverId).filter(c => Channel.canView(c, userId)); },

  update(id, patch = {}) {
    const current = Channel.findById(id); if (!current) return null;
    const type = ['text','voice','announcement','media'].includes(patch.type) ? patch.type : current.channel_type;
    const isPrivate = patch.isPrivate == null ? !!current.is_private : !!patch.isPrivate;
    let ow = parseOverwrites(current);
    if (patch.permissionOverwrites) ow = {
      allowedUserIds: Array.isArray(patch.permissionOverwrites.allowedUserIds) ? patch.permissionOverwrites.allowedUserIds.map(Number).filter(Number.isInteger) : (ow.allowedUserIds || []),
      allowedRoleIds: Array.isArray(patch.permissionOverwrites.allowedRoleIds) ? patch.permissionOverwrites.allowedRoleIds.map(Number).filter(Number.isInteger) : (ow.allowedRoleIds || []),
      everyone: patch.permissionOverwrites.everyone !== false,
    };
    if (!isPrivate) ow = {allowedUserIds: [], allowedRoleIds: [], everyone: true};
    db.prepare(`UPDATE channels SET name=?,channel_type=?,is_private=?,permission_overwrites_json=?,topic=?,slowmode_seconds=? WHERE id=?`).run(
      String(patch.name ?? current.name).trim().slice(0,64) || current.name,
      type,
      isPrivate ? 1 : 0,
      JSON.stringify(ow),
      String(patch.topic ?? current.topic ?? '').slice(0,1024),
      Math.max(0, Math.min(21600, Number(patch.slowmodeSeconds ?? current.slowmode_seconds ?? 0))),
      id
    );
    return Channel.findById(id);
  },

  toPublic(channel) {
    const ow = parseOverwrites(channel);
    return {
      id: channel.id,
      serverId: channel.server_id,
      name: channel.name,
      type: channel.channel_type || 'text',
      isPrivate: !!channel.is_private,
      topic: channel.topic || '',
      slowmodeSeconds: Number(channel.slowmode_seconds || 0),
      permissionOverwrites: ow,
      createdAt: channel.created_at,
    };
  },
};

module.exports = Channel;
