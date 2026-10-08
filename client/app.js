const SERVER_URL = window.CHAT_SERVER_URL;
const socket = io(SERVER_URL, { autoConnect:false, transports:["websocket","polling"] });

const $ = id => document.getElementById(id);
const joinView=$('joinView'), chatView=$('chatView'), joinForm=$('joinForm'), joinError=$('joinError');
const messages=$('messages'), users=$('users'), onlineCount=$('onlineCount'), mobileOnlineCount=$('mobileOnlineCount'), roomTitle=$('roomTitle');
const messageForm=$('messageForm'), messageInput=$('messageInput'), typingIndicator=$('typingIndicator');
const replyBar=$('replyBar'), replyText=$('replyText'), emojiPicker=$('emojiPicker');
const imageBtn=$('imageBtn'), imageInput=$('imageInput'), imageViewer=$('imageViewer'), viewerImage=$('viewerImage');
let myName='', replyTo=null, typingTimer, token='';
const sidebar=$('sidebar'), usersToggle=$('usersToggle'), sidebarOverlay=$('sidebarOverlay');
let peer=null, localStream=null, callPeerId=null, callKind='video', incomingOffer=null;
const pendingIce=[], typingUsers=new Set();
const emojis=['😀','😂','🤣','😊','😍','😘','😎','🤔','😢','😭','😡','👍','👎','👏','🙏','❤️','🔥','🎉','💯','😴','🤝','👌','🥳','😇','🙌'];
const MAX_IMAGE_DATA=700000;

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function timeText(v){return new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function scrollBottom(){messages.scrollTop=messages.scrollHeight;}
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

socket.on('connect_error',e=>console.error(e.message));
socket.on('message:new',addMessage);
socket.on('system:message',addSystem);
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
