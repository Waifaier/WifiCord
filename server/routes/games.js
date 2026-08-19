const express=require('express');
const crypto=require('crypto');
const db=require('../database/db');
const User=require('../models/User');
const {requireAuth}=require('./auth');
const router=express.Router();
const COOLDOWN=0;
const MAX_REWARD=500;
const active=new Map();

function ensureTable(){
  db.exec(`CREATE TABLE IF NOT EXISTS minigame_sessions (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,game TEXT NOT NULL,started_at INTEGER NOT NULL,finished_at INTEGER,reward INTEGER NOT NULL DEFAULT 0,score INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_minigame_sessions_user ON minigame_sessions(user_id,started_at DESC)');
}
ensureTable();

router.get('/status',requireAuth,(req,res)=>{
  const uid=req.session.userId;
  const last=db.prepare("SELECT started_at,finished_at,score,reward FROM minigame_sessions WHERE user_id=? AND game='flappy-cubes' ORDER BY started_at DESC LIMIT 1").get(uid);
  const available=true; const next=0;
  res.json({game:'flappy-cubes',available,nextAvailableAt:available?null:next,last:last||null,user:User.toPublic(User.findById(uid))});
});

router.post('/flappy-cubes/start',requireAuth,(req,res)=>{
  const uid=req.session.userId, now=Date.now();
  const id=crypto.randomUUID();
  db.prepare("INSERT INTO minigame_sessions(id,user_id,game,started_at) VALUES(?,?,?,?)").run(id,uid,'flappy-cubes',now);
  active.set(id,{userId:uid,startedAt:now});
  res.json({ok:true,sessionId:id,startedAt:now,nextAvailableAt:null});
});

router.post('/flappy-cubes/finish',requireAuth,(req,res)=>{
  const uid=req.session.userId, id=String(req.body.sessionId||''), score=Math.max(0,Math.min(500,Math.floor(Number(req.body.score)||0)));
  const session=active.get(id) || db.prepare("SELECT * FROM minigame_sessions WHERE id=? AND user_id=? AND game='flappy-cubes'").get(id,uid);
  if(!session || Number(session.userId)!==Number(uid)) return res.status(400).json({error:'Partida inválida.'});
  const row=db.prepare('SELECT * FROM minigame_sessions WHERE id=?').get(id);
  if(row?.finished_at) return res.status(409).json({error:'Esta partida já foi encerrada.'});
  const reward=Math.min(MAX_REWARD,score*10);
  const tx=db.transaction(()=>{
    db.prepare('UPDATE minigame_sessions SET finished_at=?,score=?,reward=? WHERE id=?').run(Date.now(),score,reward,id);
    if(reward>0){
      db.prepare('UPDATE users SET points=points+? WHERE id=?').run(reward,uid);
      db.prepare('INSERT INTO point_events(user_id,amount,reason) VALUES(?,?,?)').run(uid,reward,'minigame:flappy-cubes');
    }
  });
  tx(); active.delete(id);
  res.json({ok:true,score,reward,user:User.toPublic(User.findById(uid)),nextAvailableAt:null});
});

module.exports=router;
