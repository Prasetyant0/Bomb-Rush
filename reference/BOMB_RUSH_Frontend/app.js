(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const NAMES = ['NOVA', 'ECHO', 'JINX'];
  const COLORS = ['#bda3ff', '#9ef2d2', '#ffc48d', '#ffa6c7'];
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const state = { screen: 'landing', nick: 'RUSHER', count: 4, credits: 100, visibility: 'public', code: 'RUSH42', ready: false, startedAt: null, lobbyDeadline: 0, previewMode: true, game: null, toastTimer: 0, gameToastTimer: 0 };
  const keys = new Set();
  const pointers = { joystick: null, camera: null, run: null };
  const joyVec = {x:0, z:0};
  let prevFrame = performance.now(), heroFrame = 0, zoom = 9;
  const canvases = ['heroCanvas', 'roomCanvas', 'gameCanvas'].map($);

  function readName(inputId) { return ($(inputId).value || '').trim().replace(/\s+/g, ' ').slice(0,16); }
  function toast(msg, isGame = false) {
    const el = $(isGame ? 'gameToast' : 'toast');
    el.textContent = msg; el.classList.add(isGame ? 'show' : 'visible');
    const key = isGame ? 'gameToastTimer' : 'toastTimer';
    clearTimeout(state[key]); state[key] = setTimeout(() => el.classList.remove(isGame ? 'show' : 'visible'), 2300);
  }
  function updateHeader() { $('siteHeader').style.display = state.screen === 'game' ? 'none' : ''; }
  function navigate(next) {
    state.screen = next;
    ['Landing','Create','Join','Lobby','Game','Result'].forEach(s => $('screen'+s).classList.toggle('active', s.toLowerCase() === next));
    document.body.classList.toggle('playing', next === 'game');
    updateHeader(); $('helpModal').classList.add('hidden');
    keys.clear(); window.scrollTo({top:0,behavior:'instant'});
    if (next === 'create') updateCreateUI();
    if (next === 'lobby') renderLobby();
    if (next === 'game') resizeCanvas($('gameCanvas'));
    if (next === 'result') renderResult();
    const route = {landing:'/',create:'/rooms/create',join:'/rooms/join',lobby:'/room/'+state.code,game:'/match/preview',result:'/results/preview'}[next];
    try { if (location.protocol === 'http:' || location.protocol === 'https:') history.replaceState({screen:next},'', route); } catch (_) { /* Standalone preview can run without History API. */ }
  }
  function updateCreateUI() {
    [3,4].forEach(n => $('players'+n).classList.toggle('selected', state.count === n));
    document.querySelectorAll('[data-credits]').forEach(b => b.classList.toggle('selected', +b.dataset.credits === state.credits));
    ['public','private'].forEach(type => $(type+'Room').classList.toggle('selected', state.visibility === type));
    $('asidePlayers').textContent = state.count + ' SURVIVORS';
    $('asideTime').textContent = ((state.count-1)*10) + ' SECONDS';
    $('asideCredits').textContent = state.credits + ' VIRTUAL DEMO CREDITS';
    $('createError').textContent = '';
  }
  function randomCode(){ return Array.from({length:6},()=>ALPHABET[Math.floor(Math.random()*ALPHABET.length)]).join(''); }
  function validCredit(val) { return Number.isInteger(val) && val >= 1 && val <= 1000; }
  function initializeLobby() {
    state.ready = false; state.lobbyDeadline = 0;
    renderLobby(); navigate('lobby');
  }
  function renderLobby() {
    $('lobbyCode').textContent = state.code;
    $('lobbyMaxPlayers').textContent = `0${state.count} PLAYERS`;
    $('lobbyEntry').textContent = `${state.credits} VIRTUAL DEMO CREDITS`;
    $('lobbyPool').textContent = `${state.credits * state.count} VIRTUAL DEMO CREDITS`;
    $('lobbyDuration').textContent = `${10*(state.count-1)} SEC GAMEPLAY`;
    $('lobbyOccupancy').textContent = `0${state.count} / 0${state.count}`;
    const list = $('seatList'); list.innerHTML = '';
    for (let i=0;i<state.count;i++) {
      const name = i === 0 ? state.nick : NAMES[i-1];
      const seat = document.createElement('div'); seat.className = 'seat' + (i === 0 ? ' you' : '');
      seat.innerHTML = `<span class="seat-avatar" style="--seat-color:${COLORS[i]}">${escapeHTML(name[0])}</span><div class="seat-content"><strong>${escapeHTML(name)} ${i===0?'(YOU)':''}</strong><span>${i===0?'HOST / LOCAL PLAYER':'ILLUSTRATIVE PREVIEW SEAT'}</span></div><span class="seat-state ${i===0 && !state.ready ? 'waiting':'ready'}">${i===0 && !state.ready ? 'NOT READY':'✓ READY'}</span>`;
      list.appendChild(seat);
    }
    $('readyButton').innerHTML = state.ready ? '✓ READY! <span>↗</span>' : 'I\'M READY <span>↗</span>';
    $('readyButton').classList.toggle('btn-primary', !state.ready);
    $('readyButton').classList.toggle('btn-outline', state.ready);
    if (!state.ready) { $('lobbyStatusTitle').textContent = 'AWAITING READY-UP'; $('countdownValue').textContent = '--'; $('lobbyStatusHint').textContent = 'Hit ready when you\'re good to go.'; }
  }
  function escapeHTML(x){ return String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function startLobbyCountdown(){ state.ready=true; state.lobbyDeadline = Date.now()+15000; renderLobby(); toast('Squad ready. Match starting in 15 seconds!'); }
  function prepareGame() {
    state.lobbyDeadline = 0; state.ready = false;
    const arr=[];
    for(let i=0;i<state.count;i++) {
      const theta=(i/state.count)*TAU + 1.2;
      arr.push({id:i,name:i===0?state.nick:NAMES[i-1],color:COLORS[i],x:Math.cos(theta)*4.2,z:Math.sin(theta)*4.2,alive:true,heading:theta,from:-1,passAt:0});
    }
    state.game = {players:arr, round:1, expiresAt:Date.now()+10000, holder:0, stamina:5, lastSprintAt:Date.now()-1800, sprinting:false, mobileRun:false, cameraYaw:.34, pitch:.80, cameraDist:zoom, cameraPitch:.80, cueUntil:Date.now()+1350, cueText:'GET READY', cueSub:'TEN SECONDS PER BOMB', startedAt:Date.now(), ended:false, passLockUntil:0, lastHolder: -1, aiPassAt:Date.now()+4000, spectator:false, resultAt:0, demo:true};
    $('playerHandle').textContent = state.nick;
    $('gameSettings').classList.add('hidden');$('scoreboard').classList.add('hidden');
    navigate('game'); updateHUD();
  }
  function endGame() { if(!state.game || state.game.ended) return; state.game.ended = true; state.game.resultAt = Date.now(); setTimeout(()=>{if(state.game?.ended && state.screen==='game') navigate('result');},900); }
  function processExplosion(){
    const g=state.game; if(!g || g.ended) return;
    const held=g.players[g.holder]; if(held && held.alive) held.alive=false;
    if(held?.id === 0){g.spectator=true;toast('You were eliminated! Spectating survivors.',true);}
    else toast(`${held?.name || 'A player'} was eliminated!`,true);
    const alive=g.players.filter(p=>p.alive);
    if(alive.length<=1){endGame();return;}
    g.round++; g.holder=alive[(g.round-1)%alive.length].id;
    g.expiresAt=Date.now()+10000;
    g.passLockUntil=Date.now()+450;
    g.aiPassAt=Date.now()+3500;
    g.cueUntil=Date.now()+1200;
    g.cueText='ROUND '+String(g.round).padStart(2,'0');g.cueSub='KEEP MOVING';
  }
  function choosePassTarget(g, from) {
    const source=g.players[from], now=Date.now();
    if(!source || !source.alive) return null;
    return g.players.filter(p=>p.alive && p.id!==from && !(p.id===source.from && now < source.passAt+1000) && Math.hypot(p.x-source.x,p.z-source.z)<=1.8).sort((a,b)=> Math.hypot(a.x-source.x,a.z-source.z)-Math.hypot(b.x-source.x,b.z-source.z) || a.id-b.id)[0] || null;
  }
  function doPass(from, silent=false) {
    const g=state.game; if(!g || g.ended || g.holder!==from || !g.players[from]?.alive) return false;
    if(Date.now()<g.passLockUntil) {if(!silent) toast('Pass cooling down.',true);return false;}
    if(Date.now()>=g.expiresAt) return false;
    const target=choosePassTarget(g,from);
    if(!target){if(!silent) toast('Get within 1.8 units of another player to pass!',true);return false;}
    g.lastHolder=from;g.holder=target.id;g.passLockUntil=Date.now()+700;
    target.from=from;target.passAt=Date.now();
    if(!silent) toast(`BOMB PASSED TO ${target.name}!`,true);
    else if(target.id===0) toast('YOU HAVE THE BOMB! PASS IT!',true);
    return true;
  }
  function resetInput(){keys.clear();joyVec.x=0;joyVec.z=0;pointers.joystick=null;pointers.camera=null;pointers.run=null;$('joystickKnob').style.left='50%';$('joystickKnob').style.top='50%';if(state.game){state.game.mobileRun=false;state.game.sprinting=false;}$('touchRun').classList.remove('active');}
  function updateGame(dt){
    const g=state.game;if(!g || g.ended)return;
    const now=Date.now(); if(now>=g.expiresAt){processExplosion();if(g.ended)return;}
    const me=g.players[0];
    let vx=(keys.has('d')?1:0)-(keys.has('a')?1:0)+joyVec.x;
    let vz=(keys.has('w')?1:0)-(keys.has('s')?1:0)-joyVec.z;
    const len=Math.hypot(vx,vz);
    if(len>0.02 && me.alive){
      vx/=Math.max(1,len);vz/=Math.max(1,len);
      const yaw=g.cameraYaw;
      const wx = Math.cos(yaw)*vx + Math.sin(yaw)*vz;
      const wz = -Math.sin(yaw)*vx + Math.cos(yaw)*vz;
      const wantsSprint=(keys.has('shift')||g.mobileRun) && g.stamina>0.5;
      g.sprinting=wantsSprint;
      if(wantsSprint){g.stamina=Math.max(0,g.stamina-dt);g.lastSprintAt=now;if(g.stamina<=0){g.mobileRun=false;$('touchRun').classList.remove('active');}}
      const speed=wantsSprint?7:4.5;
      me.x+=wx*speed*dt;me.z-=wz*speed*dt;
      me.heading=Math.atan2(-wx,wz);
      const r=Math.hypot(me.x,me.z);if(r>6.6){me.x*=6.6/r;me.z*=6.6/r;}
    } else {g.sprinting=false;}
    if(!g.sprinting && now-g.lastSprintAt>1500)g.stamina=Math.min(5,g.stamina+dt);
    g.players.forEach((p,i)=>{
      if(i===0||!p.alive)return;
      // Local illustrative animation, not multiplayer AI or real network state.
      const phase=(now-g.startedAt)*.00055+i*2.3;
      const angle=phase+i*TAU/g.players.length;
      const destX=Math.cos(angle)*3.3, destZ=Math.sin(angle)*3.3;
      const dx=destX-p.x,dz=destZ-p.z,length=Math.hypot(dx,dz);
      if(length>.08){p.x+=dx/length*Math.min(length,dt*1.7);p.z+=dz/length*Math.min(length,dt*1.7);p.heading=Math.atan2(-dx,dz);}
      const r=Math.hypot(p.x,p.z);if(r>6.6){p.x*=6.6/r;p.z*=6.6/r;}
    });
    if(g.holder!==0 && now>g.aiPassAt){
      const succeeded=doPass(g.holder,true);
      g.aiPassAt=now+(succeeded?2500:1200);
    }
    updateHUD();
  }
  function updateHUD(){
    const g=state.game;if(!g || state.screen!=='game')return;
    const alive=g.players.filter(p=>p.alive);
    const t=Math.max(0,(g.expiresAt-Date.now())/1000);
    $('aliveCount').textContent=alive.length+' / '+g.players.length;
    $('gameTimer').textContent=t.toFixed(2).padStart(5,'0');
    $('timerHud').classList.toggle('danger',t<=3);
    $('roundLabel').textContent=`ROUND ${String(g.round).padStart(2,'0')} / ${String(g.players.length-1).padStart(2,'0')}`;
    $('bombOwner').textContent='BOMB HOLDER: '+(g.players[g.holder]?.name || '—');
    $('bombAlert').classList.toggle('visible',g.holder===0 && g.players[0].alive && Date.now()>g.cueUntil);
    $('staminaNumber').textContent=g.stamina.toFixed(1)+' / 5';
    [...$('staminaBars').children].forEach((el,i)=>{el.classList.toggle('empty',g.stamina<=i+.01);el.style.opacity= g.stamina>=i+1?'1':g.stamina>i? String(.35+.65*(g.stamina-i)) : '1';});
    $('gameCue').classList.toggle('visible',Date.now()<g.cueUntil);
    if(Date.now()<g.cueUntil){$('gameCue').querySelector('strong').textContent=g.cueText;$('gameCue').querySelector('span').textContent=g.cueSub;}
    const board=$('scoreList');board.innerHTML=g.players.map(p=>`<div class="score-item ${p.alive?'':'eliminated'}"><span style="color:${p.color}">${escapeHTML(p.name)}${p.id===0?' (YOU)':''}</span><small>${!p.alive?'ELIMINATED':p.id===g.holder?'● BOMB':'ALIVE'}</small></div>`).join('');
  }
  function renderResult(){
    const g=state.game;if(!g)return;
    const winner=g.players.find(p=>p.alive) || g.players[0];
    const isMe=winner.id===0;
    $('resultHeadline').innerHTML=isMe?'YOU <span>SURVIVED.</span>':'LAST ONE <span>STANDING.</span>';
    $('resultSubtitle').textContent=isMe?'You dodged every explosion. Your squad never stood a chance.':'The arena chose its survivor. Ready for revenge?';
    $('winnerAvatar').textContent=winner.name[0];$('winnerAvatar').style.background=winner.color;
    $('winnerName').textContent=winner.name;
    $('winnerDescription').textContent=isMe?'YOU SURVIVED THE CHAOS':'WINNER OF THIS LOCAL PREVIEW';
    $('resultMode').textContent=g.players.length+'-PLAYER SURVIVAL';
    $('resultCredits').textContent=(state.credits*g.players.length).toLocaleString('en-US');
  }
  function showModal(){ $('helpModal').classList.remove('hidden'); }
  function processAction(action){
    switch(action){
      case 'home': resetInput();state.lobbyDeadline=0;navigate('landing');break;
      case 'how':showModal();break;case 'controls':showModal();break;case 'close-modal':$('helpModal').classList.add('hidden');break;
      case 'create':navigate('create');break;case 'join':navigate('join');break;
      case 'fill-demo-code':$('joinCode').value='RUSH42';break;
      case 'confirm-create':{
        const nick=readName('createName'),cr= Number($('customCredits').value || state.credits);
        if(nick.length<2){$('createError').textContent='Please enter a nickname at least 2 characters long.';break;}
        if(!validCredit(cr)){$('createError').textContent='Credits must be an integer between 1 and 1000.';break;}
        state.nick=nick;state.credits=cr;state.code=randomCode(); initializeLobby();break;
      }
      case 'confirm-join':{
        const nick=readName('joinName');const code=$('joinCode').value.trim().toUpperCase();
        if(nick.length<2){$('joinError').textContent='Please enter a nickname at least 2 characters long.';break;}
        if(!/^[A-Z2-9]{6}$/.test(code) || /[IO01]/.test(code)){$('joinError').textContent='Enter a six-character room code (without 0, O, 1 or I).';break;}
        if(code!=='RUSH42'){$('joinError').textContent='Frontend preview: use demo code RUSH42. Joining real rooms requires a backend.';break;}
        if(NAMES.includes(nick.toUpperCase())){$('joinError').textContent='Please use a different name than the example players.';break;}
        state.nick=nick;state.code=code;state.count=4;state.credits=100;initializeLobby();break;
      }
      case 'leave':state.lobbyDeadline=0;state.ready=false;navigate('landing');break;
      case 'copy-code':{const val=state.code;if(navigator.clipboard?.writeText){navigator.clipboard.writeText(val).then(()=>toast('Room code copied: '+val)).catch(()=>toast('Room code: '+val));}else toast('Room code: '+val);break;}
      case 'toggle-ready': if(state.ready){state.ready=false;state.lobbyDeadline=0;renderLobby();toast('Ready status cancelled.');}else startLobbyCountdown();break;
      case 'game-preview':prepareGame();break;
      case 'scoreboard':$('scoreboard').classList.toggle('hidden');$('gameSettings').classList.add('hidden');break;
      case 'game-settings':$('gameSettings').classList.toggle('hidden');$('scoreboard').classList.add('hidden');break;
      case 'leave-game':resetInput();navigate('lobby');break;
      case 'exit-rotate':resetInput();navigate('lobby');break;
      case 'rematch':resetInput();state.ready=false;state.lobbyDeadline=0;initializeLobby();break;
    }
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-action]'); if(button){e.preventDefault();processAction(button.dataset.action);return;}
    const players=e.target.closest('[data-players]');if(players){state.count=+players.dataset.players;updateCreateUI();return;}
    const credit=e.target.closest('[data-credits]');if(credit){state.credits=+credit.dataset.credits;$('customCredits').value='';updateCreateUI();return;}
    const vis=e.target.closest('[data-visibility]');if(vis){state.visibility=vis.dataset.visibility;updateCreateUI();}
  });
  $('customCredits').addEventListener('input', e=>{const n=+e.target.value;if(validCredit(n)){state.credits=n;updateCreateUI();}});
  $('joinCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6));
  $('joinCode').addEventListener('keydown',e=>{if(e.key==='Enter')processAction('confirm-join');});
  $('createName').addEventListener('keydown',e=>{if(e.key==='Enter')processAction('confirm-create');});
  $('cameraZoom').addEventListener('input',e=>{zoom=Number(e.target.value);$('zoomLabel').textContent=String(zoom);if(state.game)state.game.cameraDist=zoom;});
  window.addEventListener('keydown',e=>{
    if(state.screen!=='game' || e.target.closest('input,textarea'))return;
    const key=e.key.toLowerCase();
    if(['w','a','s','d','shift','e','tab','escape','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();
    if(key==='e' && !e.repeat)doPass(0);
    if(key==='tab')$('scoreboard').classList.remove('hidden');
    if(key==='escape'){$('scoreboard').classList.add('hidden');$('gameSettings').classList.add('hidden');}
    keys.add(key);
  });
  window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());if(e.key==='Tab')$('scoreboard').classList.add('hidden');});
  window.addEventListener('blur',resetInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)resetInput();});
  $('gameCanvas').addEventListener('wheel',e=>{if(state.screen!=='game')return;e.preventDefault();zoom=clamp(zoom+Math.sign(e.deltaY)*.4,7,11);if(state.game)state.game.cameraDist=zoom;$('cameraZoom').value=zoom;$('zoomLabel').textContent=zoom.toFixed(1);},{passive:false});
  let dragCamera = false, prevDragX=0, prevDragY=0;
  $('gameCanvas').addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;if(e.button!==0)return;dragCamera=true;prevDragX=e.clientX;prevDragY=e.clientY;$('gameCanvas').setPointerCapture(e.pointerId);});
  $('gameCanvas').addEventListener('pointermove',e=>{if(!dragCamera||!state.game)return;state.game.cameraYaw-=(e.clientX-prevDragX)*.006;state.game.pitch=clamp(state.game.pitch+(e.clientY-prevDragY)*.004,.35,1.12);prevDragX=e.clientX;prevDragY=e.clientY;});
  ['pointerup','pointercancel','lostpointercapture'].forEach(type=>$('gameCanvas').addEventListener(type,()=>dragCamera=false));
  function setupMobileInput(){
    const pad=$('touchJoystick'),zone=$('touchCameraZone'),run=$('touchRun'),pass=$('touchPass');
    pad.addEventListener('pointerdown',e=>{if(pointers.joystick!==null)return;e.preventDefault();pointers.joystick=e.pointerId;pad.setPointerCapture(e.pointerId);updateStick(e);});
    pad.addEventListener('pointermove',e=>{if(pointers.joystick===e.pointerId)updateStick(e);});
    ['pointerup','pointercancel'].forEach(ev=>pad.addEventListener(ev,e=>{if(pointers.joystick!==e.pointerId)return;pointers.joystick=null;joyVec.x=joyVec.z=0;$('joystickKnob').style.left='50%';$('joystickKnob').style.top='50%';if(state.game)state.game.mobileRun=false;run.classList.remove('active');}));
    function updateStick(e){const r=pad.querySelector('.joystick-base').getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;const dx=e.clientX-cx,dy=e.clientY-cy,l=Math.hypot(dx,dy),lim=32,f=Math.min(l,lim)/(l||1);const x=dx*f,y=dy*f; joyVec.x=x/lim;joyVec.z=y/lim;$('joystickKnob').style.left=`calc(50% + ${x}px)`;$('joystickKnob').style.top=`calc(50% + ${y}px)`;}
    let oldX=0,oldY=0;
    zone.addEventListener('pointerdown',e=>{if(pointers.camera!==null)return;pointers.camera=e.pointerId;oldX=e.clientX;oldY=e.clientY;zone.setPointerCapture(e.pointerId);});
    zone.addEventListener('pointermove',e=>{if(pointers.camera!==e.pointerId || !state.game)return;state.game.cameraYaw-=(e.clientX-oldX)*.007;state.game.pitch=clamp(state.game.pitch+(e.clientY-oldY)*.005,.35,1.12);oldX=e.clientX;oldY=e.clientY;});
    ['pointerup','pointercancel'].forEach(ev=>zone.addEventListener(ev,e=>{if(pointers.camera===e.pointerId)pointers.camera=null;}));
    run.addEventListener('pointerdown',e=>{e.preventDefault();if(!state.game||state.game.stamina<=.5)return;state.game.mobileRun=!state.game.mobileRun;run.classList.toggle('active',state.game.mobileRun);});
    pass.addEventListener('pointerdown',e=>{e.preventDefault();doPass(0);});
  }
  setupMobileInput();

  // ---------------------------------------------------------------------
  // Tiny dependency-free, perspective-projected arena CONCEPT RENDERER.
  // It is 2.5D illustrative Canvas, NOT the production WebGL/3D game.
  // ---------------------------------------------------------------------
  function resizeCanvas(c){if(!c)return;const r=c.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);if(r.width<5||r.height<5)return;const w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h;}const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:r.width,h:r.height};}
  function getCamera(yaw,pitch,dist,tx,tz,ty=.4){const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const pos={x:tx+sy*cp*dist,y:ty+sp*dist,z:tz+cy*cp*dist};
    const fx=(tx-pos.x)/dist,fy=(ty-pos.y)/dist,fz=(tz-pos.z)/dist;
    const right={x:-fz/Math.hypot(fz,fx),y:0,z:fx/Math.hypot(fz,fx)};
    const up={x:right.y*fz-right.z*fy,y:right.z*fx-right.x*fz,z:right.x*fy-right.y*fx};
    return {pos,fx,fy,fz,right,up};
  }
  function project(cam,x,y,z,w,h,scale=1){const dx=x-cam.pos.x,dy=y-cam.pos.y,dz=z-cam.pos.z;
    const depth=dx*cam.fx+dy*cam.fy+dz*cam.fz;
    if(depth<=.3)return null;
    const focal=Math.min(w*.93,h*1.49)*scale;
    return {x:w*.5+(dx*cam.right.x+dz*cam.right.z)*focal/depth,y:h*.545-(dx*cam.up.x+dy*cam.up.y+dz*cam.up.z)*focal/depth,depth,scale:focal/depth};
  }
  function pathCircle(ctx,cam,w,h,r,y=0){let started=false;ctx.beginPath();for(let j=0;j<=120;j++){const ang=(j/120)*TAU,p=project(cam,r*Math.cos(ang),y,r*Math.sin(ang),w,h);if(!p)continue;if(!started){ctx.moveTo(p.x,p.y);started=true;}else ctx.lineTo(p.x,p.y);}ctx.closePath();return started;}
  function drawArena(ctx,w,h,cam,t,opts={}){
    ctx.save();
    const haze=ctx.createRadialGradient(w*.5,h*.65,3,w*.5,h*.65,Math.max(w,h)*.55);
    haze.addColorStop(0,'rgba(143,93,255,.13)');haze.addColorStop(.45,'rgba(75,56,105,.075)');haze.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=haze;ctx.fillRect(0,0,w,h);
    // Atmospheric sparks / distant energy fragments.
    for(let i=0;i<35;i++){const x=(Math.sin(i*176.33)*.5+.5)*w,y=(Math.cos(i*92.3)*.5+.5)*h;ctx.fillStyle=i%4===0?'#e09abf36':'#c0a6ff20';ctx.fillRect(x,y,(i%3)+1,(i%3)+1);}
    ctx.shadowColor='#9772fa55';ctx.shadowBlur=40;
    if(pathCircle(ctx,cam,w,h,7.17,-.26)){ctx.fillStyle='#251b36';ctx.fill();}
    ctx.shadowBlur=0;
    if(pathCircle(ctx,cam,w,h,7,0)){const fill=ctx.createLinearGradient(0,h*.25,0,h*.9);fill.addColorStop(0,'#302348');fill.addColorStop(.45,'#241d38');fill.addColorStop(1,'#17152a');ctx.fillStyle=fill;ctx.fill();}
    ctx.save();if(pathCircle(ctx,cam,w,h,6.95,.01))ctx.clip();
    // Fine gridded floor and radial modular markings.
    ctx.strokeStyle='#ad83ff0c';ctx.lineWidth=1;
    for(let v=-8;v<=8;v+=1){drawLine3d(ctx,cam,w,h,-7,0,v,7,0,v);drawLine3d(ctx,cam,w,h,v,0,-7,v,0,7);}
    for(let j=0;j<20;j++){const a=j/20*TAU;const r0=2.7,r1=6.6;ctx.strokeStyle=j%5===0?'#bb99ff32':'#b99dfb14';drawLine3d(ctx,cam,w,h,Math.cos(a)*r0,.04,Math.sin(a)*r0,Math.cos(a)*r1,.04,Math.sin(a)*r1);}
    ctx.restore();
    for(const [r,color,width,blur] of [[7.0,'#a67bfa',4,22],[6.8,'#9276c991',1,0],[5.2,'#8567ad55',1,0],[2.4,'#79609c66',1,0],[.75,'#aa8cd345',1,0]]){
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.shadowBlur=blur;ctx.shadowColor=color;if(pathCircle(ctx,cam,w,h,r,.05))ctx.stroke();ctx.restore();
    }
    // Around the rim, segmented beacons.
    for(let i=0;i<32;i++){const a=(i/32)*TAU;
      const p=project(cam,Math.cos(a)*7.04,.08,Math.sin(a)*7.04,w,h);if(!p)continue;
      const size=clamp(p.scale*.065,.7,4.7);
      ctx.fillStyle=i%4===0?'#ff9d749c':'#bf9cff7e';ctx.beginPath();ctx.arc(p.x,p.y,size,0,TAU);ctx.fill();
    }
    ctx.restore();
  }
  function drawLine3d(ctx,cam,w,h,x1,y1,z1,x2,y2,z2){const a=project(cam,x1,y1,z1,w,h),b=project(cam,x2,y2,z2,w,h);if(!a||!b)return;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
  function drawPlayer(ctx,w,h,cam,p,holder,t,opts={}){
    if(!p.alive)return;
    const ground=project(cam,p.x,.12,p.z,w,h),head=project(cam,p.x,1.37,p.z,w,h);
    if(!ground||!head)return;
    const unit=clamp(ground.scale,9,70),bodyH=(ground.y-head.y)*.68,headR=clamp(unit*.31,4,24),bodyW=clamp(unit*.54,7,34),bx=ground.x,by=ground.y;
    ctx.save();
    // Soft grounded blob / pass range cue.
    ctx.beginPath();ctx.ellipse(bx,by+2,unit*.60,unit*.25,0,0,TAU);ctx.fillStyle='#03020c7b';ctx.fill();
    ctx.beginPath();ctx.ellipse(bx,by,unit*.47,unit*.20,0,0,TAU);ctx.lineWidth=holder?3:1.6;ctx.strokeStyle=holder?'#ff7658':p.color+'92';ctx.shadowBlur=holder?25:9;ctx.shadowColor=holder?'#ff553b':p.color;ctx.stroke();ctx.shadowBlur=0;
    // Legs
    const torsoY=by-bodyH*.8,hipY=by-bodyH*.36;
    ctx.lineCap='round';ctx.strokeStyle='#1c1625';ctx.lineWidth=clamp(unit*.20,3,16);
    ctx.beginPath();ctx.moveTo(bx-bodyW*.18,hipY);ctx.lineTo(bx-bodyW*.22,by-unit*.06);ctx.moveTo(bx+bodyW*.18,hipY);ctx.lineTo(bx+bodyW*.22,by-unit*.06);ctx.stroke();
    // Arms
    ctx.strokeStyle=p.color;ctx.lineWidth=clamp(unit*.15,3,12);ctx.beginPath();ctx.moveTo(bx-bodyW*.37,torsoY+bodyH*.16);ctx.lineTo(bx-bodyW*.68,torsoY+bodyH*.50);ctx.moveTo(bx+bodyW*.37,torsoY+bodyH*.16);ctx.lineTo(bx+bodyW*.67,torsoY+bodyH*.49);ctx.stroke();
    // Padded torso
    const torsoGrad=ctx.createLinearGradient(bx-bodyW,torsoY,bx+bodyW,torsoY+bodyH);torsoGrad.addColorStop(0,'#fffa');torsoGrad.addColorStop(.08,p.color);torsoGrad.addColorStop(.8,p.color);torsoGrad.addColorStop(1,'#3b295d');
    roundedRect(ctx,bx-bodyW*.43,torsoY,bodyW*.86,bodyH*.5,Math.max(4,bodyW*.22));ctx.fillStyle=torsoGrad;ctx.fill();ctx.strokeStyle='#f4e6ff88';ctx.lineWidth=1;ctx.stroke();
    roundedRect(ctx,bx-bodyW*.25,torsoY+bodyH*.1,bodyW*.5,bodyH*.13,Math.max(2,unit*.06));ctx.fillStyle='#241934b9';ctx.fill();
    // Oversized futuristic helmet
    const hy=head.y+headR*.35;
    ctx.beginPath();ctx.arc(bx,hy,headR,0,TAU);ctx.fillStyle='#1d182a';ctx.fill();ctx.lineWidth=clamp(unit*.07,2,5);ctx.strokeStyle=p.color;ctx.stroke();
    roundedRect(ctx,bx-headR*.7,hy-headR*.2,headR*1.4,headR*.56,headR*.23);ctx.fillStyle='#a2eff0';ctx.shadowBlur=12;ctx.shadowColor=p.color;ctx.fill();ctx.shadowBlur=0;
    ctx.beginPath();ctx.arc(bx-headR*.26,hy,Math.max(1,headR*.14),0,TAU);ctx.fillStyle='#152a34';ctx.fill();
    if(holder){
      const bhy=hy-headR*2.7;const bob=Math.sin(t*6)*3;
      ctx.beginPath();ctx.arc(bx,bhy+bob,headR*.75,0,TAU);ctx.fillStyle='#ff7e52';ctx.shadowBlur=28;ctx.shadowColor='#ff684a';ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=2;ctx.strokeStyle='#ffe5c8';ctx.stroke();
      ctx.beginPath();ctx.moveTo(bx+headR*.18,bhy-headR*.74+bob);ctx.lineTo(bx+headR*.45,bhy-headR*1.18+bob);ctx.strokeStyle='#ffd5a2';ctx.lineWidth=3;ctx.stroke();
      for(let j=0;j<4;j++){const a=t*2+j*TAU/4;const x=bx+Math.cos(a)*headR*1.45,y=bhy+bob+Math.sin(a)*headR*1.35;ctx.fillStyle='#ff8c5299';ctx.fillRect(x,y,3,3);}
    }
    if(!opts.hideNames){
      const nameY=holder?head.y-headR*3.45:head.y-headR*1.7;
      ctx.font=`800 ${clamp(unit*.20,9,14)}px DM Sans, sans-serif`;
      const tw=ctx.measureText(p.name).width+17;
      ctx.fillStyle='#140e21ec';roundedRect(ctx,bx-tw/2,nameY-16,tw,23,5);ctx.fill();
      ctx.strokeStyle=holder?'#ff8a6b':p.color+'99';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#faf5ff';ctx.textAlign='center';ctx.fillText(p.name,bx,nameY);ctx.textAlign='left';
    }
    ctx.restore();
  }
  function roundedRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function paintPreview(c,now,kind){
    const obj=resizeCanvas(c);if(!obj)return;const{ctx,w,h}=obj;ctx.clearRect(0,0,w,h);
    const t=now/1000,scale=kind==='hero'?1:1;
    const cam=getCamera(-.3+Math.sin(t*.13)*.1, .98,kind==='hero'?17:19,0,0,.2);
    drawArena(ctx,w,h,cam,t,{preview:true});
    const count=4;
    const players=Array.from({length:count},(_,i)=>{const a=i*TAU/count + .38+Math.sin(t*.32+i)*.09,r=i===0?2.9:3.8;return {x:Math.cos(a)*r,z:Math.sin(a)*r,name:['YOU','NOVA','ECHO','JINX'][i],color:COLORS[i],alive:true,id:i};});
    players.sort((a,b)=>project(cam,b.x,0,b.z,w,h)?.depth-project(cam,a.x,0,a.z,w,h)?.depth||0);
    players.forEach(p=>drawPlayer(ctx,w,h,cam,p,p.id===2,t,{hideNames:kind==='room'}));
  }
  function paintGame(c,now){
    const g=state.game;if(!g)return;
    const obj=resizeCanvas(c);if(!obj)return;const{ctx,w,h}=obj;ctx.clearRect(0,0,w,h);
    const me=g.players[0];const tx=me.x*.7,tz=me.z*.7;
    const cam=getCamera(g.cameraYaw,g.pitch,g.cameraDist,tx,tz,.65);
    drawArena(ctx,w,h,cam,now/1000);
    const ps=g.players.filter(p=>p.alive).sort((a,b)=>{const aa=project(cam,a.x,0,a.z,w,h),bb=project(cam,b.x,0,b.z,w,h);return (bb?.depth||0)-(aa?.depth||0);});
    ps.forEach(p=>drawPlayer(ctx,w,h,cam,p,p.id===g.holder,now/1000));
    if(!me.alive){ctx.fillStyle='#0a051388';ctx.fillRect(0,0,w,h);ctx.fillStyle='#f2dbef';ctx.font='900 58px Barlow Condensed, Impact,sans-serif';ctx.textAlign='center';ctx.fillText('SPECTATING',w/2,h*.43);ctx.font='800 13px DM Sans,sans-serif';ctx.fillStyle='#bcb0d3';ctx.fillText('YOU ARE OUT · WATCH THE SURVIVORS',w/2,h*.47);ctx.textAlign='left';}
  }
  function loop(now){
    const dt=clamp((now-prevFrame)/1000,0,.055);prevFrame=now;
    if(state.screen==='landing')paintPreview($('heroCanvas'),now,'hero');
    if(state.screen==='create')paintPreview($('roomCanvas'),now,'room');
    if(state.screen==='lobby' && state.lobbyDeadline){
      const left=(state.lobbyDeadline-Date.now())/1000;
      $('lobbyStatusTitle').textContent='ARENA STARTING IN';
      $('countdownValue').textContent=String(Math.max(0,Math.ceil(left))).padStart(2,'0');
      $('lobbyStatusHint').textContent='All mock players ready · seats locked';
      if(left<=0)prepareGame();
    }
    if(state.screen==='game'){updateGame(dt);paintGame($('gameCanvas'),now);}
    requestAnimationFrame(loop);
  }
  // On mobile safari, orientation changes modify the canvas box; CSS sizing is read every frame.
  window.addEventListener('resize',()=>canvases.forEach(resizeCanvas));
  updateCreateUI();navigate('landing');requestAnimationFrame(loop);
})();
