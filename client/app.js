const SERVER_URL = window.CHAT_SERVER_URL;
const socket = io(SERVER_URL, { autoConnect:false, transports:["websocket","polling"] });

const $ = id => document.getElementById(id);
const joinView=$('joinView'), chatView=$('chatView'), joinForm=$('joinForm'), joinError=$('joinError');
const messages=$('messages'), users=$('users'), onlineCount=$('onlineCount'), mobileOnlineCount=$('mobileOnlineCount'), roomTitle=$('roomTitle');
const messageForm=$('messageForm'), messageInput=$('messageInput'), typingIndicator=$('typingIndicator');
const replyBar=$('replyBar'), replyText=$('replyText'), emojiPicker=$('emojiPicker');
const imageBtn=$('imageBtn'), imageInput=$('imageInput'), imageViewer=$('imageViewer'), viewerImage=$('viewerImage');
let myName='', replyTo=null, typingTimer, token='';
let notificationsEnabled=false;
const sidebar=$('sidebar'), usersToggle=$('usersToggle'), sidebarOverlay=$('sidebarOverlay');
let peer=null, localStream=null, callPeerId=null, callKind='video', incomingOffer=null;
const pendingIce=[], typingUsers=new Set();
const emojis=['😀','😂','🤣','😊','😍','😘','😎','🤔','😢','😭','😡','👍','👎','👏','🙏','❤️','🔥','🎉','💯','😴','🤝','👌','🥳','😇','🙌'];
const MAX_IMAGE_DATA=700000;

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function timeText(v){return new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function scrollBottom(){messages.scrollTop=messages.scrollHeight;}
function showToast(name, text){
  const box=$('toastContainer'); if(!box)return;
  const t=document.createElement('div'); t.className='toast';
  const b=document.createElement('b'); b.textContent=`💬 ${name}`;
  const s=document.createElement('span'); s.textContent=text;
  t.append(b,s); box.appendChild(t);
  setTimeout(()=>t.remove(),4500);
}
function requestNotifications(){
  if(!('Notification' in window)) return;
  if(Notification.permission==='granted'){notificationsEnabled=true;return;}
  if(Notification.permission==='default'){
    Notification.requestPermission().then(p=>{notificationsEnabled=p==='granted';}).catch(()=>{});
  }
}
function notifyIncoming(item){
  if(item.name===myName)return;
  const preview=item.type==='image'?'📷 Sent an image':(item.text||'New message');
  showToast(item.name,preview);
  if(document.hidden && notificationsEnabled){
    try{
      const n=new Notification(item.name,{body:preview,icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%231687f4"/><text x="32" y="43" font-size="34" text-anchor="middle">💬</text></svg>'});
      n.onclick=()=>{window.focus();n.close();};
    }catch{}
  }
}

function replyPreview(i){
  if(!i.replyTo)return '';
  const text=i.replyTo.type==='image'?'📷 Image':i.replyTo.text;
  return `<div class="reply-preview"><b>${escapeHtml(i.replyTo.name)}</b><br>${escapeHtml(text)}</div>`;
}

function openImage(src){
  if(!src)return;
  viewerImage.src=src;
  imageViewer.classList.remove('hidden');
  document.body.classList.add('viewer-open');
}
function closeImage(){
  imageViewer.classList.add('hidden');
  viewerImage.removeAttribute('src');
  document.body.classList.remove('viewer-open');
}
$('closeImageViewer').onclick=closeImage;
imageViewer.addEventListener('click',e=>{if(e.target===imageViewer)closeImage();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeImage();});

function addMessage(item){
  const mine=item.name===myName, el=document.createElement('div');
  el.className=`msg ${mine?'mine':''}`; el.dataset.id=item.id;
  const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`${item.name} · ${timeText(item.time)}`;
  const wrap=document.createElement('div'); wrap.className='bubble-wrap';
  const bubble=document.createElement('div'); bubble.className=`bubble ${item.deleted?'deleted':''}`;
  if(item.replyTo){
    const rp=document.createElement('div'); rp.className='reply-preview';
    const name=document.createElement('b'); name.textContent=item.replyTo.name;
    const br=document.createElement('br');
    const txt=document.createElement('span'); txt.textContent=item.replyTo.type==='image'?'📷 Image':item.replyTo.text;
    rp.append(name,br,txt); bubble.appendChild(rp);
  }
  const content=document.createElement('div'); content.className='message-content';
  if(item.deleted){
    content.className='message-text'; content.textContent='This message was deleted';
  }else if(item.type==='image'){
    const img=document.createElement('img'); img.className='chat-image'; img.src=item.text; img.alt='Shared image'; img.loading='lazy';
    img.addEventListener('click',()=>openImage(item.text));
    content.appendChild(img);
  }else{
    content.className='message-text'; content.textContent=item.text;
  }
  bubble.appendChild(content); wrap.appendChild(bubble);
  if(!item.deleted){
    const actions=document.createElement('div'); actions.className='message-actions';
    const reply=document.createElement('button'); reply.className='action reply-action'; reply.type='button'; reply.title='Reply'; reply.textContent='↩️';
    reply.onclick=()=>startReply(item); actions.appendChild(reply);
    if(mine){const del=document.createElement('button');del.className='action delete-action';del.type='button';del.title='Delete';del.textContent='🗑️';del.onclick=()=>deleteMessage(item.id);actions.appendChild(del);}
    wrap.appendChild(actions);
  }
  el.append(meta,wrap); messages.appendChild(el); scrollBottom();
}
function addSystem(t){const e=document.createElement('div');e.className='system';e.textContent=t;messages.appendChild(e);scrollBottom();}
function renderUsers(list){
  users.innerHTML=''; onlineCount.textContent=list.length; if(mobileOnlineCount) mobileOnlineCount.textContent=list.length;
  list.forEach(u=>{
    const e=document.createElement('div');e.className='user';
    const l=document.createElement('span');l.textContent=u.name+(u.name===myName?' (you)':'');e.appendChild(l);
    if(u.name!==myName){
      const a=document.createElement('div');a.className='user-actions';
      const v=document.createElement('button');v.textContent='🎥';v.title='Video call';v.onclick=()=>startCall(u.id,u.name,'video');
      const p=document.createElement('button');p.textContent='📞';p.title='Voice call';p.onclick=()=>startCall(u.id,u.name,'audio');
      a.append(v,p);e.appendChild(a);
    }
    users.appendChild(e);
  });
}
function startReply(i){replyTo=i;replyText.textContent=`${i.name}: ${i.type==='image'?'📷 Image':i.text}`;replyBar.classList.remove('hidden');messageInput.focus();}
function cancelReply(){replyTo=null;replyBar.classList.add('hidden');replyText.textContent='';}
function deleteMessage(id){if(confirm('Delete this message?'))socket.emit('message:delete',{id},r=>{if(!r?.ok)alert(r?.error||'Could not delete.');});}
function updateTyping(){const n=[...typingUsers];typingIndicator.textContent=n.length===0?'':n.length===1?`${n[0]} is typing...`:`${n.join(', ')} are typing...`;}
function renderEmojis(){emojiPicker.innerHTML='';emojis.forEach(e=>{const b=document.createElement('button');b.className='emoji';b.type='button';b.textContent=e;b.onclick=()=>{messageInput.value+=e;messageInput.focus();};emojiPicker.appendChild(b);});}

joinForm.addEventListener('submit',async e=>{
  e.preventDefault(); joinError.textContent='';
  const name=$('name').value.trim(), room=$('room').value.trim(), password=$('password').value;
  if(!SERVER_URL || SERVER_URL.includes('REPLACE-WITH')){joinError.textContent='Set your backend URL in config.js first.';return;}
  try{
    const r=await fetch(`${SERVER_URL}/api/join`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,room,password})});
    const data=await r.json(); if(!r.ok)throw new Error(data.error||'Could not join.');
    token=data.token;myName=data.user.name;roomTitle.textContent=data.room;messages.innerHTML='';
    requestNotifications();
    data.messages.forEach(addMessage);
    socket.auth={token};socket.connect();
    joinView.classList.add('hidden');chatView.classList.remove('hidden');messageInput.focus();
  }catch(err){joinError.textContent=err.message;}
});

messageForm.addEventListener('submit',e=>{
  e.preventDefault();
  const text=messageInput.value.trim(); if(!text||!socket.connected)return;
  const reply=replyTo?{id:replyTo.id,name:replyTo.name,text:replyTo.type==='image'?'[Image]':replyTo.text,type:replyTo.type||'text'}:null;
  socket.emit('message:send',{type:'text',text,replyTo:reply},r=>{if(!r?.ok)alert(r?.error||'Could not send.');});
  messageInput.value='';cancelReply();socket.emit('typing',{isTyping:false});
});
messageInput.addEventListener('input',()=>{socket.emit('typing',{isTyping:messageInput.value.length>0});clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('typing',{isTyping:false}),1200);});
$('emojiBtn').onclick=()=>emojiPicker.classList.toggle('hidden');
$('cancelReply').onclick=cancelReply;
$('leaveBtn').onclick=()=>location.reload();
function closeUsers(){sidebar?.classList.remove('open');sidebarOverlay?.classList.add('hidden');}
usersToggle?.addEventListener('click',()=>{sidebar.classList.toggle('open');sidebarOverlay.classList.toggle('hidden',!sidebar.classList.contains('open'));});
sidebarOverlay?.addEventListener('click',closeUsers);
document.addEventListener('click',e=>{if(!emojiPicker.contains(e.target)&&e.target.id!=='emojiBtn')emojiPicker.classList.add('hidden');});

async function prepareImage(file){
  if(!file?.type?.startsWith('image/'))throw new Error('Please select an image file.');
  if(file.size>8*1024*1024)throw new Error('Image is too large. Choose an image under 8 MB.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Could not read this image.'));i.src=url;});
    const maxSide=1280, scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    let quality=.82, data='';
    for(let i=0;i<4;i++){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=MAX_IMAGE_DATA)break;quality-=.12;}
    if(data.length>MAX_IMAGE_DATA)throw new Error('Image is still too large after compression. Try a smaller image.');
    return data;
  }finally{URL.revokeObjectURL(url);}
}
imageBtn.onclick=()=>imageInput.click();
imageInput.addEventListener('change',async()=>{
  const file=imageInput.files?.[0];imageInput.value='';if(!file)return;
  if(!socket.connected){alert('Join a room first.');return;}
  try{
    imageBtn.disabled=true;imageBtn.textContent='⏳';
    const data=await prepareImage(file);
    const reply=replyTo?{id:replyTo.id,name:replyTo.name,text:'[Image]',type:replyTo.type||'text'}:null;
    socket.emit('message:send',{type:'image',text:data,replyTo:reply},r=>{if(!r?.ok)alert(r?.error||'Could not send image.');});
    cancelReply();
  }catch(e){alert(e.message);}
  finally{imageBtn.disabled=false;imageBtn.textContent='📷';}
});

// Watch Together: shared YouTube/MP4 player with room-wide playback synchronization.
const watchModal=$('watchModal'), watchYoutubeForm=$('watchYoutubeForm'), watchYoutubeUrl=$('watchYoutubeUrl');
const watchFileInput=$('watchFileInput'), watchStatus=$('watchStatus'), watchEmpty=$('watchEmpty');
const watchYoutubeHost=$('watchYoutubeHost'), watchYoutubePlayerEl=$('watchYoutubePlayer'), watchMp4Player=$('watchMp4Player');
let watchState=null, ytPlayer=null, ytApiPromise=null, remoteWatchApply=false, mp4ObjectUrl=null;
let watchPoll=null, lastWatchTime=0, lastWatchPollAt=0, lastWatchSyncAt=0, lastWatchSignature='';
function openWatch(){
  // Re-open the existing player without re-applying the last server snapshot.
  // Re-applying stale state here seeks YouTube/MP4 back to the last synced time.
  watchModal.classList.remove('hidden');
  document.body.classList.add('watch-open');
  if(watchState){watchEmpty.classList.add('hidden');watchStatus.textContent=`Now sharing: ${watchState.title||'Video'} · controls are synchronized`;}
}
function closeWatch(){watchModal.classList.add('hidden');document.body.classList.remove('watch-open');}
$('watchOpenBtn').onclick=openWatch;
$('watchCloseBtn').onclick=closeWatch;
watchModal.addEventListener('click',e=>{if(e.target===watchModal)closeWatch();});
function extractYoutubeId(value){
  try{
    const u=new URL(value.trim());
    if(['youtu.be'].includes(u.hostname.toLowerCase())) return u.pathname.split('/').filter(Boolean)[0]||'';
    if(!/(^|\.)youtube\.com$/i.test(u.hostname)) return '';
    if(u.pathname==='/watch') return u.searchParams.get('v')||'';
    const m=u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);return m?m[1]:'';
  }catch{return '';}
}
function loadYoutubeApi(){
  if(window.YT?.Player)return Promise.resolve();
  if(ytApiPromise)return ytApiPromise;
  ytApiPromise=new Promise((resolve,reject)=>{
    const old=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{if(typeof old==='function')old();resolve();};
    let script=document.querySelector('script[data-youtube-iframe-api]');
    if(!script){script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.dataset.youtubeIframeApi='1';script.onerror=()=>reject(new Error('Could not load YouTube player. Check the network/ad blocker.'));document.head.appendChild(script);}
    setTimeout(()=>{if(!window.YT?.Player)reject(new Error('YouTube player took too long to load.'));},15000);
  });
  return ytApiPromise;
}
function watchSyncPayload(){
  if(!watchState)return null;
  let currentTime=0,isPlaying=false;
  if(watchState.type==='youtube'&&ytPlayer?.getCurrentTime){try{currentTime=ytPlayer.getCurrentTime()||0;isPlaying=ytPlayer.getPlayerState()===1;}catch{}}
  else if(watchState.type==='mp4'){currentTime=watchMp4Player.currentTime||0;isPlaying=!watchMp4Player.paused&&!watchMp4Player.ended;}
  return {currentTime,isPlaying};
}
function emitWatchSync(force=false){
  if(remoteWatchApply||!socket.connected||!watchState)return;
  const data=watchSyncPayload();if(!data)return;
  const signature=`${data.isPlaying}:${Math.floor(data.currentTime)}`;
  if(!force&&signature===lastWatchSignature)return;
  lastWatchSignature=signature;lastWatchSyncAt=Date.now();
  socket.emit('watch:sync',data);
}
function applyRemotePlayback(state){
  if(!state)return;
  remoteWatchApply=true;
  try{
    if(state.type==='youtube'&&ytPlayer?.getCurrentTime){
      const now=ytPlayer.getCurrentTime()||0;
      if(Math.abs(now-(state.currentTime||0))>2)ytPlayer.seekTo(Math.max(0,state.currentTime||0),true);
      const playing=ytPlayer.getPlayerState()===1;
      if(state.isPlaying&&!playing)ytPlayer.playVideo();else if(!state.isPlaying&&playing)ytPlayer.pauseVideo();
    }else if(state.type==='mp4'&&watchMp4Player.src){
      const v=watchMp4Player;
      if(Math.abs((v.currentTime||0)-(state.currentTime||0))>2){try{v.currentTime=Math.max(0,state.currentTime||0);}catch{}}
      if(state.isPlaying&&v.paused){const p=v.play();if(p?.catch)p.catch(()=>{watchStatus.textContent='Tap Play on this device to allow synchronized playback.';});}
      else if(!state.isPlaying&&!v.paused)v.pause();
    }
  }catch(err){console.warn('Could not apply remote playback state:',err);}
  setTimeout(()=>{remoteWatchApply=false;const d=watchSyncPayload();if(d){lastWatchTime=d.currentTime;lastWatchPollAt=Date.now();}},350);
}
async function applyWatchState(state){
  if(!state||!state.type)return;
  const signature=`${state.type}:${state.youtubeId||''}:${state.videoId||''}`;
  const changed=signature!==lastWatchSignatureForMedia;
  watchState=state;watchEmpty.classList.add('hidden');watchStatus.textContent=`Now sharing: ${state.title||'Video'} · controls are synchronized`;
  if(state.type==='youtube'){
    watchYoutubeHost.classList.remove('hidden');watchMp4Player.classList.add('hidden');
    if(changed||!ytPlayer){
      lastWatchSignatureForMedia=signature;
      try{
        await loadYoutubeApi();
        if(ytPlayer){try{ytPlayer.destroy();}catch{}ytPlayer=null;}
        watchYoutubePlayerEl.innerHTML='';
        ytPlayer=new YT.Player('watchYoutubePlayer',{width:'100%',height:'100%',videoId:state.youtubeId,playerVars:{playsinline:1,rel:0,enablejsapi:1},events:{
          onReady:e=>{try{if((state.currentTime||0)>0)e.target.seekTo(state.currentTime,true);if(state.isPlaying)e.target.playVideo();}catch{}lastWatchTime=state.currentTime||0;lastWatchPollAt=Date.now();},
          onStateChange:e=>{if(remoteWatchApply)return;if(e.data===YT.PlayerState.PLAYING||e.data===YT.PlayerState.PAUSED||e.data===YT.PlayerState.ENDED)emitWatchSync(true);}
        }});
      }catch(err){watchStatus.textContent=err.message||'Could not load YouTube video.';}
    }else applyRemotePlayback(state);
  }else if(state.type==='mp4'){
    watchYoutubeHost.classList.add('hidden');watchMp4Player.classList.remove('hidden');
    if(changed||!watchMp4Player.src){
      lastWatchSignatureForMedia=signature;
      if(mp4ObjectUrl){URL.revokeObjectURL(mp4ObjectUrl);mp4ObjectUrl=null;}
      watchMp4Player.pause();watchMp4Player.removeAttribute('src');watchMp4Player.load();
      try{
        watchStatus.textContent='Loading shared MP4…';
        const r=await fetch(`${SERVER_URL}/api/watch/video/${encodeURIComponent(state.videoId)}`,{headers:{Authorization:`Bearer ${token}`}});
        if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Could not load MP4.');}
        const blob=await r.blob();mp4ObjectUrl=URL.createObjectURL(blob);watchMp4Player.src=mp4ObjectUrl;watchMp4Player.load();
        watchMp4Player.onloadedmetadata=()=>{try{watchMp4Player.currentTime=Math.max(0,state.currentTime||0);}catch{}if(state.isPlaying)watchMp4Player.play().catch(()=>{watchStatus.textContent='Tap Play to allow video playback on this device.';});};
        watchStatus.textContent=`Now sharing: ${state.title||'MP4'} · controls are synchronized`;
      }catch(err){watchStatus.textContent=err.message||'Could not load MP4.';}
    }else applyRemotePlayback(state);
  }
  lastWatchTime=Number(state.currentTime)||0;lastWatchPollAt=Date.now();
}
let lastWatchSignatureForMedia='';
watchYoutubeForm.addEventListener('submit',e=>{
  e.preventDefault();const youtubeId=extractYoutubeId(watchYoutubeUrl.value);
  if(!youtubeId||youtubeId.length!==11){watchStatus.textContent='Please paste a valid YouTube video link.';return;}
  if(!socket.connected){watchStatus.textContent='Reconnect to the room before sharing a video.';return;}
  socket.emit('watch:set',{type:'youtube',youtubeId,title:'YouTube video'},r=>{if(!r?.ok)watchStatus.textContent=r?.error||'Could not share video.';else watchStatus.textContent='YouTube link shared with the room.';});
});
watchFileInput.addEventListener('change',async()=>{
  const file=watchFileInput.files?.[0];watchFileInput.value='';if(!file)return;
  if(!socket.connected){watchStatus.textContent='Reconnect to the room before uploading.';return;}
  if(!/\.mp4$/i.test(file.name)&&file.type!=='video/mp4'){watchStatus.textContent='Choose an MP4 file.';return;}
  if(file.size>20*1024*1024){watchStatus.textContent='MP4 must be 20 MB or smaller.';return;}
  try{
    watchStatus.textContent='Uploading MP4…';
    const r=await fetch(`${SERVER_URL}/api/watch/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'video/mp4','X-Video-Name':encodeURIComponent(file.name)},body:file});
    const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Upload failed.');
    socket.emit('watch:set',{type:'mp4',videoId:data.videoId,title:data.title},ack=>{if(!ack?.ok)watchStatus.textContent=ack?.error||'Could not share uploaded video.';});
  }catch(err){watchStatus.textContent=err.message||'MP4 upload failed.';}
});
$('watchStopBtn').onclick=()=>{if(!socket.connected)return;socket.emit('watch:stop');};
watchMp4Player.addEventListener('play',()=>emitWatchSync(true));
watchMp4Player.addEventListener('pause',()=>emitWatchSync(true));
watchMp4Player.addEventListener('seeked',()=>emitWatchSync(true));
watchMp4Player.addEventListener('loadedmetadata',()=>{lastWatchTime=watchMp4Player.currentTime||0;lastWatchPollAt=Date.now();});
watchPoll=setInterval(()=>{
  if(!watchState||document.hidden)return;
  const now=Date.now(), data=watchSyncPayload();if(!data)return;
  const elapsed=(now-lastWatchPollAt)/1000, expected=lastWatchTime+(data.isPlaying?elapsed:0);
  const jumped=Math.abs(data.currentTime-expected)>2.2;
  const periodic=data.isPlaying&&(now-lastWatchSyncAt)>5000;
  if(!remoteWatchApply&&(jumped||periodic))emitWatchSync(true);
  lastWatchTime=data.currentTime;lastWatchPollAt=now;
},1500);
socket.on('watch:state',state=>{applyWatchState(state);});
socket.on('watch:sync',state=>{if(watchState&&state.type===watchState.type&&(state.youtubeId||'')===(watchState.youtubeId||'')&&(state.videoId||'')===(watchState.videoId||''))applyRemotePlayback(state);});
socket.on('watch:cleared',()=>{
  watchState=null;lastWatchSignatureForMedia='';lastWatchSignature='';watchEmpty.classList.remove('hidden');watchYoutubeHost.classList.add('hidden');watchMp4Player.classList.add('hidden');watchStatus.textContent='Video stopped for everyone.';
  try{ytPlayer?.destroy();}catch{}ytPlayer=null;watchYoutubePlayerEl.innerHTML='';watchMp4Player.pause();watchMp4Player.removeAttribute('src');watchMp4Player.load();if(mp4ObjectUrl){URL.revokeObjectURL(mp4ObjectUrl);mp4ObjectUrl=null;}
});

socket.on('connect_error',e=>console.error(e.message));
socket.on('message:new',item=>{addMessage(item);notifyIncoming(item);});
socket.on('system:message',t=>{addSystem(t);if(document.hidden && notificationsEnabled){try{new Notification('ChatApp',{body:t});}catch{}}});
socket.on('users:update',renderUsers);
socket.on('message:deleted',({id})=>{
  const el=messages.querySelector(`[data-id="${CSS.escape(id)}"]`);if(!el)return;
  el.querySelector('.bubble')?.classList.add('deleted');
  const content=el.querySelector('.message-content');if(content){content.className='message-text';content.textContent='This message was deleted';}
  el.querySelector('.message-actions')?.remove();
});
socket.on('typing',({name,isTyping})=>{if(name===myName)return;isTyping?typingUsers.add(name):typingUsers.delete(name);updateTyping();});
renderEmojis();

/* Calls kept intact; media reliability can be improved later with TURN. */
const callPanel=$('callPanel'),callTitle=$('callTitle'),remoteVideo=$('remoteVideo'),localVideo=$('localVideo'),audioOnly=$('audioOnly'),incomingActions=$('incomingActions'),activeActions=$('activeActions');
function showCall(title,incoming=false){callTitle.textContent=title;callPanel.classList.remove('hidden');incomingActions.classList.toggle('hidden',!incoming);activeActions.classList.toggle('hidden',incoming);}
function closePanel(){if(callPeerId)socket.emit('call:end',{to:callPeerId});cleanup();}
async function getMedia(kind){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera/microphone unavailable. Use HTTPS.');return navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'});}
async function getIceServers(){try{const r=await fetch(`${SERVER_URL}/config`);return (await r.json()).iceServers;}catch{return [{urls:'stun:stun.l.google.com:19302'}];}}
async function makePeer(target){
  peer=new RTCPeerConnection({iceServers:await getIceServers()});
  peer.onicecandidate=e=>e.candidate&&socket.emit('call:ice',{to:target,candidate:e.candidate});
  peer.ontrack=e=>{remoteVideo.srcObject=e.streams[0];};
  peer.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(peer.connectionState))cleanup();};
  localStream?.getTracks().forEach(t=>peer.addTrack(t,localStream));return peer;
}
async function startCall(id,name,kind){
  closeUsers();if(peer){alert('Already on a call.');return;}callPeerId=id;callKind=kind;
  try{localStream=await getMedia(kind);localVideo.srcObject=localStream;localVideo.style.display=kind==='video'?'block':'none';remoteVideo.style.display=kind==='video'?'block':'none';audioOnly.style.display=kind==='audio'?'block':'none';showCall(`Calling ${name}...`);const pc=await makePeer(id),offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('call:offer',{to:id,offer:pc.localDescription});}catch(e){alert(e.message);cleanup();}
}
socket.on('call:offer',({from,name,offer})=>{if(peer){socket.emit('call:reject',{to:from});return;}callPeerId=from;incomingOffer={offer,name};callKind=(offer?.sdp||'').includes('m=video')?'video':'audio';audioOnly.style.display=callKind==='audio'?'block':'none';remoteVideo.style.display=callKind==='video'?'block':'none';localVideo.style.display=callKind==='video'?'block':'none';showCall(`Incoming ${callKind} call from ${name}`,true);});
$('acceptCall').onclick=async()=>{if(!incomingOffer)return;try{localStream=await getMedia(callKind);localVideo.srcObject=localStream;const pc=await makePeer(callPeerId);await pc.setRemoteDescription(incomingOffer.offer);for(const c of pendingIce.splice(0))await pc.addIceCandidate(c);const ans=await pc.createAnswer();await pc.setLocalDescription(ans);socket.emit('call:answer',{to:callPeerId,answer:pc.localDescription});incomingOffer=null;showCall('Connected');}catch(e){alert(e.message);socket.emit('call:reject',{to:callPeerId});cleanup();}};
$('rejectCall').onclick=()=>{if(callPeerId)socket.emit('call:reject',{to:callPeerId});cleanup();};
$('endCall').onclick=closePanel;$('closeCall').onclick=closePanel;
$('toggleMic').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('toggleMic').textContent=t.enabled?'🎤 Mute':'🔇 Unmute';}};
$('toggleCam').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('toggleCam').textContent=t.enabled?'📹 Camera':'🚫 Camera';}};
socket.on('call:answer',async({answer})=>{if(!peer)return;await peer.setRemoteDescription(answer);for(const c of pendingIce.splice(0))await peer.addIceCandidate(c);callTitle.textContent='Connected';});
socket.on('call:ice',async({candidate})=>{if(!candidate)return;const c=new RTCIceCandidate(candidate);if(peer?.remoteDescription?.type)await peer.addIceCandidate(c);else pendingIce.push(c);});
socket.on('call:reject',()=>{alert('Call rejected or unavailable.');cleanup();});
socket.on('call:end',cleanup);
function cleanup(){try{peer?.close();}catch{}peer=null;localStream?.getTracks().forEach(t=>t.stop());localStream=null;callPeerId=null;incomingOffer=null;pendingIce.length=0;remoteVideo.srcObject=null;localVideo.srcObject=null;callPanel.classList.add('hidden');}
