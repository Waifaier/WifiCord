// WifiCord — chamadas WebRTC reais: áudio, vídeo, troca de dispositivos, tela,
// indicadores de voz, participantes e tela cheia.
(function(){
'use strict';
const RTC_CONFIG={iceServers:[
 {urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},
 {urls:'stun:stun.cloudflare.com:3478'}
]};
const state={pc:null,localStream:null,screenStream:null,screenSender:null,targetUserId:null,callType:'video',
 micEnabled:true,camEnabled:false,inCall:false,pendingOffer:null,pendingCandidates:[],makingOffer:false,
 localAudioCtx:null,remoteAudioCtx:null,speakingTimer:null,remoteSpeakingTimer:null,fullscreen:false,adminVoiceMutedUntil:0,shareResolution:720,shareType:'screen',shareSystemAudio:false,headphonesOff:false,groupMode:false,groupServerId:null,groupChannelId:null,groupType:'audio',groupPeers:new Map()};
const el={}; const $=id=>document.getElementById(id);
function cache(){Object.assign(el,{callBar:$('call-bar'),localVideo:$('local-video'),remoteVideo:$('remote-video'),
 remoteAudio:$('remote-audio'),remoteLabel:$('call-remote-label'),toggleMicBtn:$('call-toggle-mic'),toggleCamBtn:$('call-toggle-cam'),
 toggleScreenBtn:$('call-toggle-screen'),hangupBtn:$('call-hangup'),micMenuBtn:$('call-mic-menu'),camMenuBtn:$('call-cam-menu'),
 micDevices:$('call-mic-devices'),camDevices:$('call-cam-devices'),startVoiceBtn:$('start-voice-call-btn'),
 startVideoBtn:$('start-video-call-btn'),incomingModal:$('modal-incoming-call'),incomingText:$('incoming-call-text'),
 acceptBtn:$('incoming-call-accept'),rejectBtn:$('incoming-call-reject'),callFullscreen:$('call-fullscreen'),
 localAvatar:$('call-local-avatar'),remoteAvatar:$('call-remote-avatar'),localSpeaking:$('call-local-speaking'),
 remoteSpeaking:$('call-remote-speaking'),screenStage:$('call-screen-stage'),miniDock:$('mini-call-dock'),miniMic:$('mini-call-mic'),miniCam:$('mini-call-cam'),miniScreen:$('mini-call-screen'),miniHeadphones:$('mini-call-headphones'),miniHangup:$('mini-call-hangup'),serverVoiceBtn:$('start-server-voice-call-btn'),serverVideoBtn:$('start-server-video-call-btn'),serverCallGrid:$('server-call-grid'),shareModal:$('modal-share-screen'),shareConfirm:$('share-screen-confirm'),shareSystemAudio:$('share-system-audio')});}
function user(id){const s=window.App?.getState?.(); if(!s)return null; if(String(id)===String(s.currentUser?.id))return s.currentUser; return s.friends?.find(x=>String(x.id)===String(id))||null;}
function friendName(id){const u=user(id);return u?.displayName||u?.username||'Usuário';}
function avatarMarkup(u){if(!u)return '<div class="call-avatar-fallback">?</div>';return u.avatarUrl?`<img src="${esc(u.avatarUrl)}" alt="">`:`<div class="call-avatar-fallback">${esc((u.displayName||u.username||'?')[0].toUpperCase())}</div>`;}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function refreshParticipants(){
 const me=window.App?.getState?.()?.currentUser, other=user(state.targetUserId);
 if(el.localAvatar){el.localAvatar.innerHTML=avatarMarkup(me);el.localAvatar.classList.toggle('speaking',!!state._localSpeaking);}
 if(el.remoteAvatar){el.remoteAvatar.innerHTML=avatarMarkup(other);el.remoteAvatar.classList.toggle('speaking',!!state._remoteSpeaking);}
 if(el.remoteLabel)el.remoteLabel.textContent=friendName(state.targetUserId);
}
function updateButtons(){
 const s=window.App?.getState?.(), enabled=!!s?.activeDMUserId&&!state.inCall, serverEnabled=!!s?.activeServerId&&!!s?.activeChannelId&&!state.inCall;
 if(el.startVoiceBtn){el.startVoiceBtn.disabled=false;el.startVoiceBtn.classList.toggle('call-unavailable',!enabled);}
 if(el.startVideoBtn){el.startVideoBtn.disabled=false;el.startVideoBtn.classList.toggle('call-unavailable',!enabled);}
 
 el.toggleMicBtn?.classList.toggle('call-btn-off',!state.micEnabled);
 el.toggleCamBtn?.classList.toggle('call-btn-off',!state.camEnabled);
 el.toggleScreenBtn?.classList.toggle('call-btn-active',!!state.screenStream);
}
function closeModals(){document.getElementById('modal-overlay')?.classList.add('hidden');document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));}
function openBar(){el.callBar?.classList.remove('hidden');el.callBar?.classList.remove('sharing');if(document.getElementById('call-live-label'))document.getElementById('call-live-label').classList.add('hidden');if(el.screenStage)el.screenStage.classList.add('hidden');refreshParticipants();updateButtons();}
function syncContext(){const s=window.App?.getState?.();const inTarget=!!state.inCall&&!state.groupMode&&!!s?.activeDMUserId&&String(s.activeDMUserId)===String(state.targetUserId);const inGroup=!!state.inCall&&state.groupMode&&String(s?.activeServerId)===String(state.groupServerId)&&String(s?.activeChannelId)===String(state.groupChannelId);if(el.callBar)el.callBar.classList.toggle('hidden',!(inTarget||inGroup));if(el.miniDock)el.miniDock.classList.toggle('hidden',!state.inCall||(inTarget||inGroup));updateButtons();if(inTarget)refreshParticipants();if(inGroup)renderGroupTiles();}
function makeMediaConstraints(video){
 const settings=window.Settings?.getMediaSettings?.()||{};
 return {audio:settings.audioDeviceId?{deviceId:{exact:settings.audioDeviceId},echoCancellation:true,noiseSuppression:true,autoGainControl:true}:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
 video:video?(settings.videoDeviceId?{deviceId:{exact:settings.videoDeviceId},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}):false};
}
async function getLocalStream(video){
 if(!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não disponibilizou o microfone. Use Chrome, Edge ou Opera em uma página segura/localhost.');
 const constraints=makeMediaConstraints(video);
 try{
  const stream=await requestStream(constraints);
  const audio=stream.getAudioTracks()[0];
  if(!audio) throw new Error('O navegador não entregou uma faixa de áudio. Verifique o microfone selecionado.');
  audio.enabled=true;
  return stream;}
 catch(e){
  // A saved microphone deviceId that no longer exists throws OverconstrainedError;
  // retry once with the default microphone instead of failing the whole call.
  if(e.name==='OverconstrainedError'&&constraints.audio&&typeof constraints.audio==='object'&&constraints.audio.deviceId){
   try{
    const fallbackConstraints={audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:constraints.video};
    const stream=await requestStream(fallbackConstraints);
    const audio=stream.getAudioTracks()[0];
    if(!audio) throw new Error('O navegador não entregou uma faixa de áudio. Verifique o microfone selecionado.');
    audio.enabled=true;
    return stream;
   }catch(e2){ e=e2; }
  }
  if(e.name==='NotAllowedError')throw new Error('Permita o microfone/câmera nas permissões do navegador.');
  if(e.name==='NotFoundError')throw new Error(video?'Microfone ou câmera não encontrados.':'Microfone não encontrado.');
  if(e.name==='NotReadableError')throw new Error('O dispositivo está sendo usado por outro aplicativo.');
  throw e;
 }}
function requestStream(constraints){return navigator.mediaDevices.getUserMedia(constraints);}
function attachScreenPreview(stream,remote=false){const v=remote?el.remoteVideo:el.localVideo;if(!v)return;v.srcObject=stream;v.muted=!remote;v.autoplay=true;v.playsInline=true;v.style.display='block';v.classList.toggle('is-screen-preview',!remote);v.play?.().catch(()=>{});requestAnimationFrame(()=>v.play?.().catch(()=>{}));}
function pcCreate(){
 const pc=new RTCPeerConnection(RTC_CONFIG);
 // Keep a negotiated video transceiver even for voice calls so screen sharing
 // can replace its track reliably without creating a late m-line.
 try { pc.addTransceiver('video',{direction:'sendrecv'}); } catch (_) {}
 pc.onicecandidate=e=>{if(e.candidate&&state.targetUserId)window.ChatSocket.sendCallIceCandidate({toUserId:state.targetUserId,candidate:e.candidate});};
 pc.ontrack=e=>{
  const track=e.track;
  if(track.kind==='video'){
    el.callBar?.classList.remove('audio-call');
    el.callBar?.classList.add('has-remote-video');
    track.onended=()=>{ if(!state.screenStream && state.callType==='audio'){ el.callBar?.classList.add('audio-call'); el.callBar?.classList.remove('has-remote-video'); } };
    let stream=el.remoteVideo.srcObject;
    if(!(stream instanceof MediaStream))stream=new MediaStream();
    if(!stream.getTracks().some(t=>t.id===track.id))stream.addTrack(track);
    attachScreenPreview(stream,true);
  } else if(track.kind==='audio'){
    let stream=el.remoteAudio.srcObject;
    if(!(stream instanceof MediaStream))stream=new MediaStream();
    if(!stream.getTracks().some(t=>t.id===track.id))stream.addTrack(track);
    el.remoteAudio.srcObject=stream;
    el.remoteAudio.volume=Math.max(0,Math.min(1,Number(window.App?.getState?.()?.currentUser?.settings?.outputVolume ?? 100)/100));
    el.remoteAudio.muted=state.headphonesOff;
    el.remoteAudio.autoplay=true;
    const playRemote=()=>el.remoteAudio.play?.().catch(()=>{}); playRemote(); setTimeout(playRemote,100); setTimeout(playRemote,500);
    window.Settings?.applyOutput?.(el.remoteAudio);
    startRemoteSpeaking(stream);
  }
  el.callBar?.classList.add('has-remote');refreshParticipants();
 };
 pc.onconnectionstatechange=()=>{
  if(pc.connectionState==='connected'){window.Sounds?.stopLoop();window.Sounds?.play('call-join');state._iceRestarted=false;}
  if(pc.connectionState==='disconnected'){
   setTimeout(()=>{if(state.pc===pc&&pc.connectionState==='disconnected'&&!state._iceRestarted){state._iceRestarted=true;negotiate(true);}},1500);
  }
  if(pc.connectionState==='failed'){
   if(!state._iceRestarted){state._iceRestarted=true;negotiate(true);}
   setTimeout(()=>{if(state.pc===pc&&['failed','disconnected'].includes(pc.connectionState))endCall(true);},4000);
  }
 };
 return pc;
}
async function flushCandidates(){if(!state.pc?.remoteDescription)return;for(const c of state.pendingCandidates.splice(0)){try{await state.pc.addIceCandidate(c);}catch(_){}}}
async function negotiate(restart){
 if(!state.pc||!state.inCall||!state.targetUserId||state.pc.signalingState!=='stable'||state.makingOffer)return;
 state.makingOffer=true;try{const offer=await state.pc.createOffer(restart?{iceRestart:true}:undefined);await state.pc.setLocalDescription(offer);
 window.ChatSocket.sendCallOffer({toUserId:state.targetUserId,sdp:state.pc.localDescription,callType:state.callType,renegotiation:true});}
 catch(e){console.error(e)}finally{state.makingOffer=false;}
}
async function prepare(target,type){
 state.targetUserId=target;state.callType=type;state.localStream=await getLocalStream(type==='video');
 state.inCall=true;state.micEnabled=true;state.camEnabled=type==='video';state._iceRestarted=false;el.callBar?.classList.toggle('audio-call',type==='audio');
 state.pc=pcCreate();state.localStream.getTracks().forEach(t=>{if(t.kind==='audio')t.enabled=true;const sender=t.kind==='video'?state.pc.getTransceivers().find(x=>x.receiver?.track?.kind==='video')?.sender:null;if(sender) sender.replaceTrack(t); else state.pc.addTrack(t,state.localStream);});
 el.localVideo.srcObject=state.localStream;el.localVideo.muted=true;el.localVideo.play?.().catch(()=>{});
 openBar();startLocalSpeaking(); try{await state.localAudioCtx?.resume?.();}catch(_){}window.Settings?.refreshDevices?.();window.Sounds?.play('call-join');
}
async function startCall(target,type){
 if(!target)return window.App?.toast('Selecione um amigo para ligar.','error');
 if(state.inCall||state.pendingOffer)return;
 try{await prepare(target,type);const offer=await state.pc.createOffer();await state.pc.setLocalDescription(offer);
 window.ChatSocket.sendCallOffer({toUserId:target,sdp:state.pc.localDescription,callType:type,renegotiation:false});window.Sounds?.startLoop('ringback');}
 catch(e){window.Sounds?.stopLoop();window.App?.toast(e.message||'Não foi possível iniciar a chamada.','error');endCall(false);}
}
function handleOffer(data){
 if(!data?.fromUserId||!data.sdp)return;
 if(state.inCall&&state.targetUserId&&String(state.targetUserId)===String(data.fromUserId)&&data.renegotiation){handleRenegotiate(data);return;}
 if(state.inCall||state.pendingOffer){window.ChatSocket.sendCallHangup({toUserId:data.fromUserId});return;}
 state.pendingOffer=data;window.Sounds?.startLoop('incoming');
 if(el.incomingText)el.incomingText.textContent=`${friendName(data.fromUserId)} está te ligando (${data.callType==='audio'?'voz':'vídeo'}).`;
 document.getElementById('modal-overlay')?.classList.remove('hidden');el.incomingModal?.classList.remove('hidden');
}
async function handleRenegotiate(data){
 if(!state.pc)return;
 try{await state.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));await flushCandidates();const a=await state.pc.createAnswer();await state.pc.setLocalDescription(a);
 window.ChatSocket.sendCallAnswer({toUserId:data.fromUserId,sdp:state.pc.localDescription,renegotiation:true});}catch(e){console.error(e);}
}
async function accept(){
 const d=state.pendingOffer;if(!d)return;window.Sounds?.stopLoop();closeModals();
 try{await prepare(d.fromUserId,d.callType||'video');await state.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));await flushCandidates();
 const a=await state.pc.createAnswer();await state.pc.setLocalDescription(a);window.ChatSocket.sendCallAnswer({toUserId:d.fromUserId,sdp:state.pc.localDescription,renegotiation:false});state.pendingOffer=null;}
 catch(e){window.App?.toast(e.message||'Não foi possível atender.','error');state.pendingOffer=null;endCall(true);}
}
function reject(){window.Sounds?.stopLoop();if(state.pendingOffer)window.ChatSocket.sendCallHangup({toUserId:state.pendingOffer.fromUserId});state.pendingOffer=null;closeModals();window.Sounds?.play('call-leave');}
async function answer(data){if(!state.pc||!data?.sdp)return;try{await state.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));await flushCandidates();}catch(e){console.error(e);}}
async function ice(data){if(!data?.candidate)return;const expected=state.targetUserId||state.pendingOffer?.fromUserId;if(!expected||String(data.fromUserId)!==String(expected))return;
 if(!state.pc||!state.pc.remoteDescription){state.pendingCandidates.push(data.candidate);return;}try{await state.pc.addIceCandidate(data.candidate);}catch(_){}}
function handleHangup(data){window.Sounds?.stopLoop();if(state.pendingOffer&&(!data||String(data.fromUserId)===String(state.pendingOffer.fromUserId))){state.pendingOffer=null;closeModals();}if(state.inCall&&(!data||String(data.fromUserId)===String(state.targetUserId)))endCall(false);}
function endCall(notify){
 window.Sounds?.stopLoop();
 if(state.groupMode){window.ChatSocket.leaveServerCall({serverId:state.groupServerId,channelId:state.groupChannelId});for(const id of [...state.groupPeers.keys()])removeGroupPeer(id);state.groupPeers.clear();state.groupMode=false;state.groupServerId=null;state.groupChannelId=null;}
 const target=state.targetUserId;if(notify&&target)window.ChatSocket.sendCallHangup({toUserId:target});
 try{state.pc?.close()}catch(_){}
 state.localStream?.getTracks().forEach(t=>t.stop());state.screenStream?.getTracks().forEach(t=>t.stop());
 if(state.localAudioCtx)state.localAudioCtx.close().catch(()=>{});if(state.remoteAudioCtx)state.remoteAudioCtx.close().catch(()=>{});
 clearInterval(state.speakingTimer);clearInterval(state.remoteSpeakingTimer);
 state.pc=null;state.localStream=null;state.screenStream=null;state.screenSender=null;state.pendingCandidates=[];state.targetUserId=null;state.pendingOffer=null;
 state.inCall=false;state.micEnabled=true;state.camEnabled=false;state.adminVoiceMutedUntil=0;state._localSpeaking=false;state._remoteSpeaking=false;state.headphonesOff=false;
 if(el.localVideo)el.localVideo.srcObject=null;if(el.remoteVideo)el.remoteVideo.srcObject=null;if(el.remoteAudio)el.remoteAudio.srcObject=null;if(el.callBar)el.callBar.classList.remove('audio-call','sharing');
 el.callBar?.classList.add('hidden');closeModals();updateButtons();window.Sounds?.play('call-leave');
}
function toggleMic(){if(!state.localStream)return;if(state.adminVoiceMutedUntil===-1||state.adminVoiceMutedUntil>Date.now()){window.App?.toast('Seu microfone está bloqueado pelo administrador.','error');return;}state.micEnabled=!state.micEnabled;state.localStream.getAudioTracks().forEach(t=>{t.enabled=state.micEnabled;}); if(state.micEnabled){const a=state.localStream.getAudioTracks()[0];if(a)a.enabled=true;} updateButtons();}
async function toggleCam(){
 if(!state.inCall)return;
 if(state.groupMode){try{if(!state.localStream.getVideoTracks().length){const fresh=await navigator.mediaDevices.getUserMedia({video:makeMediaConstraints(true).video,audio:false});const track=fresh.getVideoTracks()[0];state.localStream.addTrack(track);for(const p of state.groupPeers.values()){const sender=p.pc.getSenders().find(x=>x.track?.kind==='video');if(sender)await sender.replaceTrack(track);else p.pc.addTrack(track,state.localStream);}state.camEnabled=true;}else{state.camEnabled=!state.camEnabled;state.localStream.getVideoTracks().forEach(t=>t.enabled=state.camEnabled);}updateButtons();}catch(e){window.App?.toast('Não foi possível ligar a câmera.','error')}return;}
 if(!state.localStream.getVideoTracks().length){
  try{const fresh=await navigator.mediaDevices.getUserMedia({video:makeMediaConstraints(true).video,audio:false});const track=fresh.getVideoTracks()[0];
   state.localStream.addTrack(track);const sender=state.pc.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(track);else state.pc.addTrack(track,state.localStream);
   state.camEnabled=true;el.localVideo.srcObject=state.localStream;await negotiate();
  }catch(e){window.App?.toast('Não foi possível ligar a câmera.','error');}updateButtons();return;
 }
 state.camEnabled=!state.camEnabled;state.localStream.getVideoTracks().forEach(t=>t.enabled=state.camEnabled);updateButtons();
}
async function switchDevice(kind,id){
 if(!state.inCall||!state.localStream)return;
 const isAudio=kind==='audioinput';const c=isAudio?{audio:{deviceId:{exact:id},echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}:{audio:false,video:{deviceId:{exact:id},width:{ideal:1280},height:{ideal:720}}};
 const fresh=await navigator.mediaDevices.getUserMedia(c);const track=isAudio?fresh.getAudioTracks()[0]:fresh.getVideoTracks()[0];const old=isAudio?state.localStream.getAudioTracks()[0]:state.localStream.getVideoTracks()[0];
 let addedNewSender=false;
 if(state.groupMode){for(const p of state.groupPeers.values()){const sender=p.pc.getSenders().find(x=>x.track?.kind===track.kind);if(sender)await sender.replaceTrack(track);else{p.pc.addTrack(track,state.localStream);addedNewSender=true;}}} else {const sender=state.pc.getSenders().find(x=>x.track?.kind===track.kind);if(sender)await sender.replaceTrack(track);else{state.pc.addTrack(track,state.localStream);addedNewSender=true;}}
 if(old)old.stop();state.localStream.removeTrack(old);state.localStream.addTrack(track);track.enabled=isAudio?state.micEnabled:state.camEnabled;
 if(!isAudio&&!state.screenStream)el.localVideo.srcObject=state.localStream;
 if(addedNewSender&&!state.groupMode)await negotiate();
 const settings=window.Settings?.getMediaSettings?.()||{};if(isAudio)settings.audioDeviceId=id;else settings.videoDeviceId=id;
 localStorage.setItem('wificord-media-settings',JSON.stringify(settings));window.App?.toast('Dispositivo alterado.','success');
}
async function deviceMenu(kind){
 const box=kind==='audioinput'?el.micDevices:el.camDevices,other=kind==='audioinput'?el.camDevices:el.micDevices;if(!box)return;
 other?.classList.add('hidden');box.innerHTML='<button disabled>Carregando…</button>';box.classList.remove('hidden');
 try{const ds=await navigator.mediaDevices.enumerateDevices();box.innerHTML='';ds.filter(d=>d.kind===kind).forEach((d,i)=>{const b=document.createElement('button');b.textContent=d.label||`${kind==='audioinput'?'Microfone':'Câmera'} ${i+1}`;b.onclick=async()=>{try{await switchDevice(kind,d.deviceId)}catch(e){window.App?.toast('Não foi possível trocar o dispositivo.','error')}box.classList.add('hidden')};box.appendChild(b);});}catch(_){box.classList.add('hidden');}
}
async function screenShare(){
 if(!state.inCall)return;
 if(state.screenStream){return stopScreen();}
 const modal=el.shareModal;
 if(!modal)return startScreenShareWithQuality(720,'screen',false);
 document.getElementById('modal-overlay')?.classList.remove('hidden'); modal.classList.remove('hidden');
 let selected=state.shareResolution || (window.App?.getState?.()?.currentUser?.wfna?1080:720); if(!window.App?.getState?.()?.currentUser?.wfna) selected=720;
 modal.querySelectorAll('[data-resolution]').forEach(b=>{const q=Number(b.dataset.resolution),locked=q>720&&!window.App?.getState?.()?.currentUser?.wfna;b.classList.toggle('locked',locked);b.classList.toggle('active',q===selected);b.onclick=()=>{if(locked){window.App?.toast('1080p, 1440p e 4K exigem WFNA.','error');return;}selected=q;modal.querySelectorAll('[data-resolution]').forEach(x=>x.classList.toggle('active',Number(x.dataset.resolution)===q));};});
 modal.querySelectorAll('[data-share-tab]').forEach(b=>b.onclick=()=>{modal.querySelectorAll('[data-share-tab]').forEach(x=>x.classList.toggle('active',x===b));modal.querySelectorAll('[data-share-pane]').forEach(x=>x.classList.toggle('active',x.dataset.sharePane===b.dataset.shareTab));state.shareType=b.dataset.shareTab;});
 el.shareConfirm.onclick=async()=>{const type=state.shareType||'screen';const audio=!!el.shareSystemAudio?.checked;closeShareModal();await startScreenShareWithQuality(selected,type,audio);};
}
function closeShareModal(){el.shareModal?.classList.add('hidden');document.getElementById('modal-overlay')?.classList.add('hidden');}
async function startScreenShareWithQuality(resolution,type,systemAudio){
 try{
  const wfna=!!window.App?.getState?.()?.currentUser?.wfna; if(!wfna)resolution=Math.min(720,Number(resolution)||720); else resolution=Number(resolution)||1080; state.shareResolution=resolution;
  const height=resolution,width=Math.round(height*16/9);
  const video={frameRate:{ideal:30,max:60},cursor:'motion',width:{ideal:width,max:width},height:{ideal:height,max:height},displaySurface:type};
  if(!navigator.mediaDevices.getDisplayMedia){const e=new Error('getDisplayMedia indisponível neste ambiente (comum em apps Electron sem handler de captura de tela configurado no processo principal).');e.name='NotSupportedError';throw e;}
  const ss=await navigator.mediaDevices.getDisplayMedia({video,audio:systemAudio}); const track=ss.getVideoTracks()[0]; if(track)track.contentHint='detail';
  state.screenStream=ss;
  if(state.groupMode){for(const p of state.groupPeers.values()){let sender=p.pc.getSenders().find(s=>s.track?.kind==='video') || p.pc.getTransceivers().find(t=>t.receiver?.track?.kind==='video')?.sender;if(!sender)sender=p.pc.addTrack(track,ss);else await sender.replaceTrack(track);}state.screenSender=null;}
  else {let sender=state.pc.getSenders().find(s=>s.track?.kind==='video') || state.pc.getTransceivers().find(t=>t.receiver?.track?.kind==='video')?.sender;if(!sender){sender=state.pc.addTrack(track,ss);}state.screenSender=sender;await sender.replaceTrack(track);await new Promise(r=>setTimeout(r,80));await negotiate();}
  el.callBar?.classList.remove('audio-call'); el.callBar?.classList.add('sharing'); attachScreenPreview(ss,false); if(document.getElementById('call-live-label'))document.getElementById('call-live-label').classList.remove('hidden'); if(el.screenStage)el.screenStage.classList.remove('hidden');el.localVideo.muted=true;el.localVideo.play?.().catch(()=>{});el.callBar?.classList.add('sharing');updateButtons();window.Sounds?.play('screen-start');track.onended=stopScreen;
 }catch(e){if(!['AbortError','NotAllowedError'].includes(e.name))window.App?.toast('Não foi possível compartilhar a tela: '+(e.message||'erro desconhecido'),'error');}
}
async function stopScreen(){
 const ss=state.screenStream;if(!ss)return;ss.getTracks().forEach(t=>t.stop());state.screenStream=null;
 const cam=state.localStream?.getVideoTracks()?.[0]||null;
 if(state.groupMode){for(const p of state.groupPeers.values()){const sender=p.pc.getSenders().find(s=>s.track?.kind==='video');if(sender){if(cam)await sender.replaceTrack(cam);else await sender.replaceTrack(null);}}}
 else if(state.screenSender){await state.screenSender.replaceTrack(cam||null);await negotiate();state.screenSender=null;}
 el.localVideo.classList.remove('is-screen-preview');el.localVideo.srcObject=state.localStream;el.localVideo.muted=true;el.localVideo.play?.().catch(()=>{});
 el.callBar?.classList.remove('sharing'); if(state.callType==='audio'&&!el.callBar?.classList.contains('has-remote-video')) el.callBar?.classList.add('audio-call'); updateButtons();window.Sounds?.play('screen-stop');
}
async function fullscreen(){const target=el.callBar;if(!target)return;try{if(!document.fullscreenElement){await target.requestFullscreen();state.fullscreen=true;}else await document.exitFullscreen();}catch(_){window.App?.toast('Tela cheia não disponível neste navegador.','error');}}
function startLocalSpeaking(){
 clearInterval(state.speakingTimer);if(!state.localStream)return;try{
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const ctx=new AC(),src=ctx.createMediaStreamSource(state.localStream),an=ctx.createAnalyser();an.fftSize=256;src.connect(an);const data=new Uint8Array(an.frequencyBinCount);let last=false;
 state.localAudioCtx=ctx;ctx.resume?.().catch?.(()=>{});state.speakingTimer=setInterval(()=>{if(!state.micEnabled)return;an.getByteTimeDomainData(data);let sum=0;for(const x of data){const n=(x-128)/128;sum+=n*n;}const speaking=Math.sqrt(sum/data.length)>.045;
 if(speaking!==last){last=speaking;state._localSpeaking=speaking;refreshParticipants();window.ChatSocket.socket?.emit('call:speaking',{toUserId:state.targetUserId,speaking});}},120);
 }catch(_){}
}
function startRemoteSpeaking(stream){
 clearInterval(state.remoteSpeakingTimer);try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;const ctx=new AC(),src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=256;src.connect(an);const data=new Uint8Array(an.frequencyBinCount);state.remoteAudioCtx=ctx;ctx.resume?.().catch?.(()=>{});
 state.remoteSpeakingTimer=setInterval(()=>{an.getByteTimeDomainData(data);let sum=0;for(const x of data){const n=(x-128)/128;sum+=n*n;}const speaking=Math.sqrt(sum/data.length)>.045;if(speaking!==state._remoteSpeaking){state._remoteSpeaking=speaking;refreshParticipants();}},120);
 }catch(_){}
}
function remoteSpeaking(data){if(String(data?.fromUserId)!==String(state.targetUserId))return;state._remoteSpeaking=!!data.speaking;refreshParticipants();}
function applyAdminVoiceMute(data){state.adminVoiceMutedUntil=Number(data?.until||0);if(state.localStream){state.micEnabled=false;state.localStream.getAudioTracks().forEach(t=>t.enabled=false);}updateButtons();window.App?.toast('Seu microfone foi bloqueado pelo administrador.','error');if(state.adminVoiceMutedUntil>0&&state.adminVoiceMutedUntil!==-1)setTimeout(()=>{if(state.adminVoiceMutedUntil===Number(data.until)){state.adminVoiceMutedUntil=0;updateButtons();window.App?.toast('O bloqueio do microfone terminou.','success');}},Math.max(0,state.adminVoiceMutedUntil-Date.now()));}
function endFromAdmin(){endCall(false);window.App?.toast('A chamada foi encerrada por um administrador.','error');}

function groupUser(id){const st=window.App?.getState?.();if(String(id)===String(st?.currentUser?.id))return st.currentUser;return (st?.serverMembers||[]).find(x=>String(x.id)===String(id))||null;}
function renderGroupTiles(){if(!el.serverCallGrid)return;el.serverCallGrid.classList.toggle('hidden',!state.groupMode);if(!state.groupMode)return;el.serverCallGrid.innerHTML='';for(const [id,p] of state.groupPeers){const u=groupUser(id)||{};const tile=document.createElement('div');tile.className='server-call-tile';tile.dataset.userId=id;tile.innerHTML='<div class="server-call-tile-head"><b>'+esc(u.displayName||u.username||'Usuário')+'</b></div><video autoplay playsinline></video><div class="server-call-tile-avatar">'+avatarMarkup(u)+'</div>';if(p.video){tile.querySelector('video').srcObject=p.video;tile.querySelector('video').classList.remove('hidden');}else tile.querySelector('video').classList.add('hidden');el.serverCallGrid.appendChild(tile);}}
function groupPeerPc(peerId){return state.groupPeers.get(String(peerId));}
function createGroupPeer(peerId,initiator){const id=String(peerId);if(groupPeerPc(id))return groupPeerPc(id);const pc=new RTCPeerConnection(RTC_CONFIG);
 try { pc.addTransceiver('video',{direction:'sendrecv'}); } catch (_) {}
 const peer={pc,video:null,audios:[]};state.groupPeers.set(id,peer);state.localStream?.getTracks().forEach(t=>{const sender=t.kind==='video'?pc.getTransceivers().find(x=>x.receiver?.track?.kind==='video')?.sender:null;if(sender)sender.replaceTrack(t);else pc.addTrack(t,state.localStream);});pc.onicecandidate=e=>{if(e.candidate)window.ChatSocket.sendServerCallIce({toUserId:Number(id),serverId:state.groupServerId,channelId:state.groupChannelId,candidate:e.candidate});};pc.ontrack=e=>{if(e.track.kind==='video'){if(!(peer.video instanceof MediaStream))peer.video=new MediaStream();if(!peer.video.getTracks().some(t=>t.id===e.track.id))peer.video.addTrack(e.track);renderGroupTiles();}else{const a=document.createElement('audio');a.autoplay=true;a.playsInline=true;a.srcObject=new MediaStream([e.track]);a.volume=1;document.body.appendChild(a);peer.audios.push(a);a.play?.().catch(()=>{});}};pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState))removeGroupPeer(id);};state.groupPeers.set(id,peer);if(initiator)pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>window.ChatSocket.sendServerCallOffer({toUserId:Number(id),serverId:state.groupServerId,channelId:state.groupChannelId,callType:state.groupType,sdp:pc.localDescription})).catch(()=>{});return peer;}
function removeGroupPeer(id){const p=state.groupPeers.get(String(id));if(!p)return;p.pc.close();p.audios?.forEach(a=>a.remove());state.groupPeers.delete(String(id));renderGroupTiles();}
async function startServerCall(serverId,channelId,type){if(state.inCall)return;try{state.groupMode=true;state.groupServerId=serverId;state.groupChannelId=channelId;state.groupType=type;state.localStream=await getLocalStream(type==='video');state.inCall=true;state.micEnabled=true;state.camEnabled=type==='video';state.pc=null;el.callBar?.classList.toggle('audio-call',type==='audio');openBar();renderGroupTiles();window.ChatSocket.joinServerCall({serverId,channelId,callType:type},r=>{if(r?.error){window.App?.toast(r.error,'error');endCall(false);return;}for(const id of (r?.peers||[]))createGroupPeer(id,true);});window.Sounds?.play('call-join');}catch(e){state.groupMode=false;window.App?.toast(e.message||'Não foi possível entrar na chamada.','error');endCall(false);}}
async function handleServerOffer(d){if(!state.groupMode||Number(d?.serverId)!==Number(state.groupServerId)||Number(d?.channelId)!==Number(state.groupChannelId))return;const p=createGroupPeer(d.fromUserId,false);try{await p.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));await flushGroupCandidates(p);const a=await p.pc.createAnswer();await p.pc.setLocalDescription(a);window.ChatSocket.sendServerCallAnswer({toUserId:Number(d.fromUserId),serverId:state.groupServerId,channelId:state.groupChannelId,sdp:p.pc.localDescription});}catch(e){console.error(e)}}
async function handleServerAnswer(d){const p=groupPeerPc(d?.fromUserId);if(!p)return;try{await p.pc.setRemoteDescription(new RTCSessionDescription(d.sdp));await flushGroupCandidates(p);}catch(_){} }
async function handleServerIce(d){if(!state.groupMode)return;const p=groupPeerPc(d?.fromUserId)||createGroupPeer(d.fromUserId,false);p._pending=p._pending||[];if(p.pc.remoteDescription)p.pc.addIceCandidate(d.candidate).catch(()=>{});else p._pending.push(d.candidate);}
async function flushGroupCandidates(p){for(const c of (p._pending||[])){try{await p.pc.addIceCandidate(c)}catch(_){}}p._pending=[];}
function handleServerUserJoined(d){if(!state.groupMode||Number(d.serverId)!==Number(state.groupServerId)||Number(d.channelId)!==Number(state.groupChannelId))return;renderGroupTiles();}
function handleServerUserLeft(d){if(Number(d?.serverId)!==Number(state.groupServerId)||Number(d?.channelId)!==Number(state.groupChannelId))return;removeGroupPeer(d.userId);}
function bind(){
 el.startVoiceBtn?.addEventListener('click',()=>{const s=window.App?.getState();startCall(s?.activeDMUserId,'audio');});
 el.startVideoBtn?.addEventListener('click',()=>{const s=window.App?.getState();startCall(s?.activeDMUserId,'video');});
 el.hangupBtn?.addEventListener('click',()=>endCall(true));el.toggleMicBtn?.addEventListener('click',toggleMic);el.toggleCamBtn?.addEventListener('click',toggleCam);el.toggleScreenBtn?.addEventListener('click',screenShare);
 el.micMenuBtn?.addEventListener('click',()=>deviceMenu('audioinput'));el.camMenuBtn?.addEventListener('click',()=>deviceMenu('videoinput'));
 el.acceptBtn?.addEventListener('click',accept);el.rejectBtn?.addEventListener('click',reject);el.callFullscreen?.addEventListener('click',fullscreen); el.miniMic?.addEventListener('click',toggleMic); el.miniCam?.addEventListener('click',toggleCam); el.miniScreen?.addEventListener('click',screenShare); el.miniHangup?.addEventListener('click',()=>endCall(true)); el.miniHeadphones?.addEventListener('click',()=>{state.headphonesOff=!state.headphonesOff; if(el.remoteAudio)el.remoteAudio.muted=state.headphonesOff; if(el.remoteVideo)el.remoteVideo.muted=state.headphonesOff; el.miniHeadphones.textContent=state.headphonesOff?'🔇':'🎧';});
 document.addEventListener('fullscreenchange',()=>{state.fullscreen=!!document.fullscreenElement;});
}
function init(){cache();bind();updateButtons();}
window.Call={init,handleOffer,handleAnswer:answer,handleIceCandidate:ice,handleHangup,handleSpeaking:remoteSpeaking,updateCallButtonsState:updateButtons,getState:()=>state,applyAdminVoiceMute,endFromAdmin,syncContext,startServerCall,handleServerOffer,handleServerAnswer,handleServerIce,handleServerUserJoined,handleServerUserLeft};
})();
