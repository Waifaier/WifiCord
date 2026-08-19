const express=require('express');
const {requireAuth}=require('./auth');
const router=express.Router();
function listUrls(value){return String(value||'').split(',').map(s=>s.trim()).filter(Boolean);}
router.get('/config',requireAuth,(req,res)=>{
  const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},{urls:'stun:stun.cloudflare.com:3478'}];
  const urls=listUrls(process.env.TURN_URLS);
  if(urls.length){const server={urls};if(process.env.TURN_USERNAME)server.username=process.env.TURN_USERNAME;if(process.env.TURN_CREDENTIAL)server.credential=process.env.TURN_CREDENTIAL;iceServers.push(server);}
  res.set('Cache-Control','no-store');res.json({iceServers,turnConfigured:urls.length>0});
});
module.exports=router;
