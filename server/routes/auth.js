const express = require('express');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { normalizeEmail, isNonEmptyString } = require('../utils/validate');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Não autenticado.' });
  const user=User.findById(req.session.userId);
  if(!user) return res.status(401).json({ error:'Não autenticado.' });
  if(User.isBanned(user)) return res.status(403).json({error:user.banned_until===-1?'Sua conta está banida permanentemente.':'Sua conta está banida temporariamente.'});
  next();
}

router.post('/register', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || username).trim();

  if (!isNonEmptyString(username, 32) || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Nome de usuário inválido (3-32 caracteres, letras/números/_).' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  }

  if (User.findByEmail(email)) {
    return res.status(409).json({ error: 'Email já cadastrado.' });
  }
  if (User.findByUsername(username)) {
    return res.status(409).json({ error: 'Nome de usuário já em uso.' });
  }

  const user = User.create({ username, email, password, displayName });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erro ao criar sessão.' });
    req.session.userId = user.id;
    res.json({ user: User.toPublic(user) });
  });
});

router.post('/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  const user = User.findByEmail(email);
  if (!user || !User.verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Email ou senha inválidos.' });
  }

  if (User.isBanned(user)) {
    return res.status(403).json({ error: user.banned_until === -1 ? 'Sua conta está banida permanentemente.' : 'Sua conta está banida temporariamente.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erro ao criar sessão.' });
    req.session.userId = user.id;
    User.setStatus(user.id, 'online');
    res.json({ user: User.toPublic(user) });
  });
});

router.post('/logout', (req, res) => {
  const userId = req.session && req.session.userId;
  if (userId) User.setStatus(userId, 'offline');
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  const user = User.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ user: User.toPublic(user) });
});


router.post('/avatar', requireAuth, (req, res) => {
  const avatar = typeof req.body.avatar === 'string' ? req.body.avatar : '';
  const match = avatar.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG, GIF ou WebP.' });

  const mime = match[1].toLowerCase();
  const normalized = match[2].replace(/\s/g, '');
  let bytes;
  try {
    bytes = Buffer.from(normalized, 'base64');
  } catch (_) {
    return res.status(400).json({ error: 'Imagem inválida.' });
  }

  if (!bytes.length || bytes.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'A imagem deve ter no máximo 2 MB.' });
  }

  // Checagem simples de assinatura para evitar salvar dados que não são imagem.
  const signatures = {
    'image/png': bytes.slice(0, 8).toString('hex') === '89504e470d0a1a0a',
    'image/jpeg': bytes.slice(0, 3).toString('hex') === 'ffd8ff',
    'image/jpg': bytes.slice(0, 3).toString('hex') === 'ffd8ff',
    'image/gif': bytes.slice(0, 3).toString('ascii') === 'GIF',
    'image/webp': bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP',
  };
  if (!signatures[mime]) return res.status(400).json({ error: 'O arquivo não parece ser uma imagem válida.' });

  const owner=User.findById(req.session.userId); if(mime==='image/gif' && !owner?.wfna) return res.status(403).json({error:'Avatar animado exige WFNA.'});
  const dataUrl = `data:${mime === 'image/jpg' ? 'image/jpeg' : mime};base64,${normalized}`;
  const user = User.findById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });

  User.setAvatar(req.session.userId, dataUrl);
  const publicUser = User.toPublic(User.findById(req.session.userId));

  const io = req.app.get('io');
  if (io) {
    io.to('user:' + req.session.userId).emit('profile:update', { user: publicUser });
    Friendship.listFriends(req.session.userId).forEach(friend => {
      io.to('user:' + friend.id).emit('profile:update', { user: publicUser });
    });
  }

  res.json({ user: publicUser });
});


router.put('/profile', requireAuth, (req, res) => {
  const current = User.findById(req.session.userId);
  const displayName = String(req.body.displayName || current.display_name || '').trim().slice(0,64) || current.display_name;
  const bio = String(req.body.bio || '').trim().slice(0,190);
  function image(v) {
    if (!v) return null;
    if (typeof v !== 'string' || !/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(v) || v.length > 2800000) throw new Error('Imagem inválida ou muito grande.');
    return v;
  }
  try {
    const avatarUrl = image(req.body.avatarUrl !== undefined ? req.body.avatarUrl : current.avatar_url); if(avatarUrl && /^data:image\/gif;base64,/i.test(avatarUrl) && !current.wfna) throw new Error('Avatar animado exige WFNA.');
    const bannerUrl = image(req.body.bannerUrl !== undefined ? req.body.bannerUrl : current.banner_url);
    const user = User.updateProfile(req.session.userId, { displayName, avatarUrl, bannerUrl, bio });
    const publicUser = User.toPublic(user);
    const io=req.app.get('io');
    if (io) { io.to('user:'+user.id).emit('profile:update',{user:publicUser}); Friendship.listFriends(user.id).forEach(f=>io.to('user:'+f.id).emit('profile:update',{user:publicUser})); }
    res.json({user:publicUser});
  } catch (err) { res.status(400).json({error:err.message}); }
});

router.put('/status', requireAuth, (req,res)=>{
 const status=['online','away','offline'].includes(req.body.status)?req.body.status:'online';
 const text=String(req.body.text||'').slice(0,128); const emoji=String(req.body.emoji||'').slice(0,16);
 const user=User.setCustomStatus(req.session.userId,status,text,emoji); const publicUser=User.toPublic(user); const io=req.app.get('io'); if(io){io.emit('presence:update',{userId:user.id,status});io.to('user:'+user.id).emit('profile:update',{user:publicUser});}
 res.json({user:publicUser});
});

router.put('/settings', requireAuth, (req,res)=>{
  const allowed=['accent','compact','reduceMotion','notifications','sound','messageSound','privacy','theme','fontSize','chatDensity','showTimestamps','showMemberList','animations','autoplayMedia','showEmbeds','desktopNotifications','mentionNotifications','friendRequests','voiceInputSensitivity','echoCancellation','noiseSuppression','autoGainControl','inputVolume','outputVolume','overlayEffects','stickerAnimations','superEmojiEffects','localNicknames','language','profileEffect','profileEffectSpeed','profileEffectEnabled','profileColor','profileLayout','profileGlow','profileBadge','animatedProfile','inlineMedia','autoDownload','mediaQuality'];
  const incoming=req.body && typeof req.body==='object'?req.body:{};
  const clean={};
  for(const key of allowed) if(Object.prototype.hasOwnProperty.call(incoming,key)) clean[key]=incoming[key];
  const user=User.updateSettings(req.session.userId,clean);
  res.json({user:User.toPublic(user)});
});

router.get('/profile/:id', requireAuth, (req,res)=>{
  const id=Number(req.params.id);
  const user=User.findById(id);
  if(!user) return res.status(404).json({error:'Usuário não encontrado.'});
  res.json({user:User.toPublic(user)});
});

module.exports = { router, requireAuth };
