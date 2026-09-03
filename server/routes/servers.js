const express = require('express');
const ServerModel = require('../models/Server');
const Channel = require('../models/Channel');
const { parsePositiveInt, isNonEmptyString } = require('../utils/validate');
const { requireAuth } = require('./auth');

const router = express.Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();

    if (!isNonEmptyString(name, 64)) {
      return res.status(400).json({ error: 'Nome do servidor inválido.' });
    }

    const server = await ServerModel.create(req.session.userId, name);

    res.json({
      server: ServerModel.toPublic(server),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const servers = await ServerModel.listForUser(req.session.userId);

    res.json({
      servers: servers.map(ServerModel.toPublic),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/join', requireAuth, async (req, res, next) => {
  try {
    const inviteCode = String(req.body.inviteCode || '').trim();

    if (!inviteCode) {
      return res.status(400).json({
        error: 'Código de convite inválido.',
      });
    }

    const server = await ServerModel.findByInviteCode(inviteCode);

    if (!server) {
      return res.status(404).json({
        error: 'Servidor não encontrado.',
      });
    }

    await ServerModel.addMember(
      server.id,
      req.session.userId
    );

    res.json({
      server: ServerModel.toPublic(server),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:serverId/members', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (!serverId) {
      return res.status(400).json({
        error: 'ID inválido.',
      });
    }

    if (
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    const server = await ServerModel.findById(serverId);

    if (!server) {
      return res.status(404).json({
        error: 'Servidor não encontrado.',
      });
    }

    const members = (
      await ServerModel.listMembers(serverId)
    ).map(m => ({
      id: m.id,
      username: m.username,
      displayName: m.display_name,
      avatarUrl: m.avatar_url,
      frame: m.frame || null,
      decoration: m.decoration || null,
      status: m.status,
      ownerId: m.owner_id,
      serverNickname: m.server_nickname || null,
      roles: m.roles || [],
      profileSettings: m.profileSettings || {},
    }));

    const roles = (
      await ServerModel.listRoles(serverId)
    ).map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      isDefault: !!r.is_default,
      permissions:
        typeof r.permissions_json === 'string'
          ? JSON.parse(r.permissions_json || '{}')
          : (r.permissions_json || {}),
    }));

    const localNicknames = {};

    for (const m of members) {
      localNicknames[m.id] =
        await ServerModel.getLocalNickname(
          req.session.userId,
          m.id
        );
    }

    res.json({
      members,
      roles,
      ownerId: server.owner_id,
      localNicknames,
    });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:serverId/members/:userId/nickname',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const targetId = parsePositiveInt(req.params.userId);

      if (
        !serverId ||
        !targetId ||
        !(await ServerModel.isMember(
          serverId,
          req.session.userId
        )) ||
        !(await ServerModel.isMember(serverId, targetId))
      ) {
        return res.status(403).json({
          error: 'Não autorizado.',
        });
      }

      const isSelf =
        targetId === Number(req.session.userId);

      if (
        !isSelf &&
        !(await ServerModel.canManage(
          serverId,
          req.session.userId
        ))
      ) {
        return res.status(403).json({
          error:
            'Somente você ou um administrador do servidor pode alterar esse apelido.',
        });
      }

      const nickname = String(
        req.body.nickname || ''
      )
        .trim()
        .slice(0, 32);

      await ServerModel.setServerNickname(
        serverId,
        targetId,
        nickname
      );

      req.app
        .get('io')
        ?.to('server:' + serverId)
        .emit('server:members:update', { serverId });

      res.json({
        ok: true,
        nickname: nickname || null,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:serverId/members/:userId/local-nickname',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const targetId = parsePositiveInt(req.params.userId);

      if (
        !serverId ||
        !targetId ||
        !(await ServerModel.isMember(
          serverId,
          req.session.userId
        )) ||
        !(await ServerModel.isMember(
          serverId,
          targetId
        ))
      ) {
        return res.status(403).json({
          error: 'Não autorizado.',
        });
      }

      const nickname =
        await ServerModel.setLocalNickname(
          req.session.userId,
          targetId,
          req.body.nickname || ''
        );

      res.json({
        ok: true,
        nickname: nickname || null,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/:serverId/roles', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (
      !serverId ||
      !(await ServerModel.canManage(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error:
          'Somente administradores do servidor podem gerenciar cargos.',
      });
    }

    const name = String(req.body.name || '')
      .trim()
      .slice(0, 32);

    const color = /^#[0-9a-f]{6}$/i.test(
      String(req.body.color || '')
    )
      ? String(req.body.color)
      : '#99aab5';

    if (!name) {
      return res.status(400).json({
        error: 'Nome do cargo inválido.',
      });
    }

    const role = await ServerModel.createRole(
      serverId,
      name,
      color,
      Number(req.body.position) || 20,
      req.body.permissions || {}
    );

    res.json({ role });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:serverId/roles/:roleId/members/:userId',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const roleId = parsePositiveInt(req.params.roleId);
      const targetId = parsePositiveInt(req.params.userId);

      if (
        !serverId ||
        !roleId ||
        !targetId ||
        !(await ServerModel.canManage(
          serverId,
          req.session.userId
        )) ||
        !(await ServerModel.isMember(serverId, targetId))
      ) {
        return res.status(403).json({
          error: 'Não autorizado.',
        });
      }

      const role = await ServerModel.findRole(
        serverId,
        roleId
      );

      if (!role) {
        return res.status(404).json({
          error: 'Cargo não encontrado.',
        });
      }

      if (req.body.enabled === false) {
        await ServerModel.removeRole(
          serverId,
          targetId,
          roleId
        );
      } else {
        await ServerModel.assignRole(
          serverId,
          targetId,
          roleId
        );
      }

      req.app
        .get('io')
        ?.to('server:' + serverId)
        .emit('server:members:update', { serverId });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.put('/:serverId/profile', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (
      !serverId ||
      !(await ServerModel.canManage(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error:
          'Somente administradores podem personalizar o servidor.',
      });
    }

    const server = await ServerModel.findById(serverId);

    if (!server) {
      return res.status(404).json({
        error: 'Servidor não encontrado.',
      });
    }

    function image(v) {
      if (v === null || v === '') return null;

      if (
        typeof v !== 'string' ||
        !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(v) ||
        v.length > 4200000
      ) {
        const e = new Error(
          'Imagem inválida ou muito grande.'
        );
        e.status = 400;
        throw e;
      }

      return v;
    }

    const name =
      String(req.body.name ?? server.name)
        .trim()
        .slice(0, 64) || server.name;

    const icon = image(
      req.body.iconUrl === undefined
        ? server.icon_url
        : req.body.iconUrl
    );

    const banner = image(
      req.body.bannerUrl === undefined
        ? server.banner_url
        : req.body.bannerUrl
    );

    const updated = await ServerModel.updateProfile(
      serverId,
      {
        name,
        iconUrl: icon,
        bannerUrl: banner,
      }
    );

    const pub = ServerModel.toPublic(updated);

    req.app
      .get('io')
      ?.to('server:' + serverId)
      .emit('server:profile:update', {
        server: pub,
      });

    res.json({
      server: pub,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:serverId/settings', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (!serverId) {
      return res.status(400).json({
        error: 'ID inválido.',
      });
    }

    if (
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    res.json({
      settings: await ServerModel.getSettings(serverId),
      canManage: await ServerModel.canManage(
        serverId,
        req.session.userId
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.put('/:serverId/settings', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (!serverId) {
      return res.status(400).json({
        error: 'ID inválido.',
      });
    }

    if (
      !(await ServerModel.canManage(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error:
          'Somente administradores do servidor podem alterar estas configurações.',
      });
    }

    const settings =
      await ServerModel.updateSettings(
        serverId,
        req.body || {}
      );

    req.app
      .get('io')
      ?.to('server:' + serverId)
      .emit('server:settings:update', {
        serverId,
        settings,
      });

    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

router.get('/:serverId/roles', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (
      !serverId ||
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    const roles = await ServerModel.listRoles(serverId);

    res.json({
      roles: roles.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        isDefault: !!r.is_default,
        permissions:
          typeof r.permissions_json === 'string'
            ? JSON.parse(r.permissions_json || '{}')
            : (r.permissions_json || {}),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:serverId/media', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (
      !serverId ||
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    const rows =
      await ServerModel.listServerMedia(serverId);

    res.json({
      media: rows.map(r => ({
        id: r.id,
        name: r.original_name,
        mime: r.mime_type,
        size: Number(r.size_bytes),
        url: r.url,
        createdAt: r.created_at,
        ownerId: r.user_id,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:serverId/channels/:channelId',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const channelId = parsePositiveInt(req.params.channelId);

      if (
        !serverId ||
        !channelId ||
        !(await ServerModel.canManage(
          serverId,
          req.session.userId
        ))
      ) {
        return res.status(403).json({
          error:
            'Somente administradores podem editar canais.',
        });
      }

      const channel =
        await Channel.findById(channelId);

      if (
        !channel ||
        Number(channel.server_id) !== Number(serverId)
      ) {
        return res.status(404).json({
          error: 'Canal não encontrado.',
        });
      }

      const updated = await Channel.update(
        channelId,
        req.body || {}
      );

      req.app
        .get('io')
        ?.to('server:' + serverId)
        .emit('server:channels:update', {
          serverId,
        });

      res.json({
        channel: Channel.toPublic(updated),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:serverId/channels/:channelId',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const channelId = parsePositiveInt(req.params.channelId);

      if (
        !serverId ||
        !channelId ||
        !(await ServerModel.canManage(
          serverId,
          req.session.userId
        ))
      ) {
        return res.status(403).json({
          error:
            'Somente administradores podem excluir canais.',
        });
      }

      const channel =
        await Channel.findById(channelId);

      if (
        !channel ||
        Number(channel.server_id) !== Number(serverId)
      ) {
        return res.status(404).json({
          error: 'Canal não encontrado.',
        });
      }

      const count =
        await ServerModel.countChannels(serverId);

      if (Number(count) <= 1) {
        return res.status(400).json({
          error:
            'O servidor precisa ter pelo menos um canal.',
        });
      }

      await Channel.delete(channelId);

      req.app
        .get('io')
        ?.to('server:' + serverId)
        .emit('server:channels:update', {
          serverId,
        });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:serverId/roles/:roleId',
  requireAuth,
  async (req, res, next) => {
    try {
      const serverId = parsePositiveInt(req.params.serverId);
      const roleId = parsePositiveInt(req.params.roleId);

      if (
        !serverId ||
        !roleId ||
        !(await ServerModel.canManage(
          serverId,
          req.session.userId
        ))
      ) {
        return res.status(403).json({
          error: 'Sem permissão para editar cargos.',
        });
      }

      const role =
        await ServerModel.findRole(
          serverId,
          roleId
        );

      if (!role) {
        return res.status(404).json({
          error: 'Cargo não encontrado.',
        });
      }

      const name =
        String(req.body.name ?? role.name)
          .trim()
          .slice(0, 32) || role.name;

      const color =
        /^#[0-9a-f]{6}$/i.test(
          String(req.body.color || '')
        )
          ? String(req.body.color)
          : role.color;

      const position = Number.isFinite(
        Number(req.body.position)
      )
        ? Math.max(
            0,
            Math.min(1000, Number(req.body.position))
          )
        : role.position;

      const permissions =
        req.body.permissions &&
        typeof req.body.permissions === 'object'
          ? req.body.permissions
          : (
              typeof role.permissions_json === 'string'
                ? JSON.parse(
                    role.permissions_json || '{}'
                  )
                : (role.permissions_json || {})
            );

      const updated =
        await ServerModel.updateRole(
          serverId,
          roleId,
          {
            name,
            color,
            position,
            permissions,
          }
        );

      req.app
        .get('io')
        ?.to('server:' + serverId)
        .emit('server:members:update', {
          serverId,
        });

      res.json({
        role: updated,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/:serverId/channels', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (!serverId) {
      return res.status(400).json({
        error: 'ID inválido.',
      });
    }

    if (
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    const channels =
      await Channel.listForUser(
        serverId,
        req.session.userId
      );

    res.json({
      channels: channels.map(Channel.toPublic),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:serverId/channels', requireAuth, async (req, res, next) => {
  try {
    const serverId = parsePositiveInt(req.params.serverId);

    if (!serverId) {
      return res.status(400).json({
        error: 'ID inválido.',
      });
    }

    if (
      !(await ServerModel.isMember(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error: 'Não autorizado.',
      });
    }

    const name = String(req.body.name || '').trim();

    if (!isNonEmptyString(name, 64)) {
      return res.status(400).json({
        error: 'Nome do canal inválido.',
      });
    }

    const isPrivate = !!req.body.isPrivate;

    const allowedUserIds = Array.isArray(
      req.body.allowedUserIds
    )
      ? req.body.allowedUserIds
          .map(Number)
          .filter(Number.isInteger)
      : [];

    const allowedRoleIds = Array.isArray(
      req.body.allowedRoleIds
    )
      ? req.body.allowedRoleIds
          .map(Number)
          .filter(Number.isInteger)
      : [];

    if (
      isPrivate &&
      !(await ServerModel.canManage(
        serverId,
        req.session.userId
      ))
    ) {
      return res.status(403).json({
        error:
          'Somente administradores podem criar canais privados.',
      });
    }

    if (
      isPrivate &&
      !allowedUserIds.includes(
        Number(req.session.userId)
      )
    ) {
      allowedUserIds.push(
        Number(req.session.userId)
      );
    }

    const channel = await Channel.create(
      serverId,
      name,
      {
        type: req.body.type,
        isPrivate,
        allowedUserIds,
        allowedRoleIds,
        topic: req.body.topic,
        slowmodeSeconds:
          req.body.slowmodeSeconds,
      }
    );

    res.json({
      channel: Channel.toPublic(channel),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;