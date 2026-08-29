/* ============================================================
   TEMPLE OF HEROES — engine
   ============================================================ */
'use strict';

const cv = document.getElementById('cv');
let g = cv.getContext('2d');
const mm = document.getElementById('minimap');
const mg = mm.getContext('2d');
/* temporarily redirect the figure renderer at another canvas (for UI previews) */
function withCtx(ctx, fn){ const old=g; g=ctx; try{ fn(); } finally { g=old; } }

const SAVE_KEY = 'templeofheroes_v1';
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const rnd=(a,b)=>a+Math.random()*(b-a);
const ri=(a,b)=>Math.floor(rnd(a,b+1));
const pick=a=>a[Math.floor(Math.random()*a.length)];
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const fmt=v=>{const n=Number(v)||0; return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e4?(n/1e3).toFixed(1)+'k':Math.floor(n).toLocaleString();};
const heroById=id=>HEROES.find(h=>h.id===id);

/* ============================================================
   STATE
   ============================================================ */
function freshState(){
  return {
    name:'Hero', cash:750, cores:1, heat:0, heatPending:0, heatWipe:false, playtime:0,
    hero:null,                       // 'ironman'  or  'fuse:<uid>'
    heroes:{},                       // id -> {tier}
    fused:[],                        // [{uid,name,a,at,b,bt,tier,suit,accent,trim,atk,ult,helmet}]
    look:{skin:'tan',shirt:'red',pants:'blue',acc:'none',trail:'none',face:'smile'},
    owned:{skins:['tan','light','olive','brown','deep','pale'],
           cloths:['red','blue','green','yellow','purple','black','white','orange'],
           acc:['none'], trail:['none'], face:['neutral','smile']},
    counters:{killBandit:0,killMonster:0,killBounty:0,killBoss:0,damage:0,ults:0,pickup:0,upgrades:0,anykill:0,zones:0,streak:0},
    zonesSeen:[], tasks:[],
    stats:{kills:0,deaths:0,best:0,streak:0,earned:0},
    tut:{temple:false}
  };
}
let S = freshState();

function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} }
function load(){
  try{
    const raw = localStorage.getItem(SAVE_KEY); if(!raw) return false;
    const d = JSON.parse(raw); const f = freshState();
    S = Object.assign(f, d);
    S.look = Object.assign(f.look, d.look||{});
    S.owned = Object.assign(f.owned, d.owned||{});
    S.counters = Object.assign(f.counters, d.counters||{});
    S.stats = Object.assign(f.stats, d.stats||{});
    return true;
  }catch(e){ return false; }
}

/* ---------- current hero resolution ---------- */
function fusedByUid(uid){ return S.fused.find(f=>f.uid===uid); }
function curHero(){
  if(!S.hero) return null;
  if(S.hero.startsWith('fuse:')) {
    const f = fusedByUid(S.hero.slice(5));
    return f ? fusedAsHero(f) : null;
  }
  const h = heroById(S.hero);
  if(!h || !S.heroes[h.id]) return null;
  return h;
}
function curTier(){
  if(!S.hero) return 0;
  if(S.hero.startsWith('fuse:')){ const f=fusedByUid(S.hero.slice(5)); return f?f.tier:0; }
  return S.heroes[S.hero] ? S.heroes[S.hero].tier : 0;
}
/* a fused record presented with the same shape as a HEROES entry (cached: called every frame) */
const _fuseCache = {};
function fusedAsHero(f){
  const sig = f.name+'|'+f.tier+'|'+f.atk+'|'+f.suit;
  const hit = _fuseCache[f.uid];
  if(hit && hit._sig===sig) return hit;
  const built = {
    id:'fuse:'+f.uid, name:f.name, temple:'Fusion Forge', tagline:f.tagline,
    suit:f.suit, accent:f.accent, trim:f.trim, glow:f.glow, helmet:f.helmet,
    hpM:f.hpM, dmgM:f.dmgM, spdM:f.spdM, atk:f.atk, ult:f.ult, fused:true,
    tiers:Array.from({length:TIERS_PER_HERO},(_,i)=>['Fusion Stage '+(i+1),'Fused matter, stage '+(i+1)+'.'])
  };
  built._sig = sig; _fuseCache[f.uid] = built;
  return built;
}
function heroTierName(h,t){ return h.tiers[clamp(t,0,h.tiers.length-1)][0]; }
function heroStats(h,t){ return tierStats(h,t); }

/* ============================================================
   CANVAS / CAMERA
   ============================================================ */
let VW=0, VH=0, DPR=1;
function resize(){
  DPR = Math.min(window.devicePixelRatio||1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = VW*DPR; cv.height = VH*DPR;
  g.setTransform(DPR,0,0,DPR,0,0);
}
addEventListener('resize', resize); resize();
const cam = {x:1600,y:1200};

/* ============================================================
   INPUT
   ============================================================ */
const keys = {};
const mouse = {x:0,y:0,wx:0,wy:0,down:false};
addEventListener('keydown',e=>{
  if(e.repeat) return;
  const k=e.key.toLowerCase(); keys[k]=true;
  if(k==='escape'){ closePanel(); }
  if(overlayOpen() || !running) return;
  if(k===' ') { e.preventDefault(); useUlt(); }
  if(k==='e') interact();
  const map={t:'temples',u:'upgrade',f:'fusion',j:'tasks',b:'bounty',p:'shop',c:'settings'};
  if(map[k] && running) openPanel(map[k]);
});
addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
cv.addEventListener('mousemove',e=>{ mouse.x=e.clientX; mouse.y=e.clientY; });
cv.addEventListener('mousedown',e=>{ if(e.button===0) mouse.down=true; });
addEventListener('mouseup',()=>{ mouse.down=false; });
addEventListener('blur',()=>{ mouse.down=false; for(const k in keys) keys[k]=false; });

/* ============================================================
   WORLD
   ============================================================ */
const CENTER = {x:WORLD.w/2, y:WORLD.h/2};
/* the sanctuary: hostiles cannot enter and no PvP damage lands inside */
const SAFE = (()=>{ const z=ZONES.find(v=>v.id==='plaza');
  return {x:z.x, y:z.y, w:z.w, h:z.h, x2:z.x+z.w, y2:z.y+z.h}; })();
function inSafe(x, y, pad){
  const p = pad||0;
  return x > SAFE.x-p && x < SAFE.x2+p && y > SAFE.y-p && y < SAFE.y2+p;
}
/* shove a hostile back out to the nearest edge of the sanctuary */
function keepOutOfSafe(e, pad){
  const p = pad||0;
  if(!inSafe(e.x, e.y, p)) return false;
  const dl = e.x-(SAFE.x-p), dr = (SAFE.x2+p)-e.x, dt2 = e.y-(SAFE.y-p), db = (SAFE.y2+p)-e.y;
  const m = Math.min(dl, dr, dt2, db);
  if(m===dl){ e.x = SAFE.x-p; if(e.vx>0) e.vx=-Math.abs(e.vx)*.4; }
  else if(m===dr){ e.x = SAFE.x2+p; if(e.vx<0) e.vx=Math.abs(e.vx)*.4; }
  else if(m===dt2){ e.y = SAFE.y-p; if(e.vy>0) e.vy=-Math.abs(e.vy)*.4; }
  else { e.y = SAFE.y2+p; if(e.vy<0) e.vy=Math.abs(e.vy)*.4; }
  return true;
}
const TEMPLES = HEROES.map((h,i)=>{
  const a = -Math.PI/2 + i/HEROES.length * Math.PI*2;
  return {heroId:h.id, x:CENTER.x + Math.cos(a)*560, y:CENTER.y + Math.sin(a)*380, a};
});
const FORGE = {x:CENTER.x, y:CENTER.y - 40};
const BOARD = {x:CENTER.x, y:CENTER.y + 250};

const props = [];
const PROP_KINDS = {
  flats: ['rock','rock','deadtree','crate','bones','grass','grass'],
  marsh: ['mushroom','tree','tree','rock','grass','grass','mushroom'],
  scrap: ['scrap','barrel','crate','rock','scrap','bones'],
  rift:  ['shard','crystal','rock','shard','crystal'],
  road:  ['grass','grass','rock','deadtree','grass']
};
(function buildProps(){
  let seed = 1337;
  const rr2 = ()=> (seed = (seed*1664525+1013904223)>>>0) / 4294967296;
  for(const z of ZONES){
    if(z.isBase || z.safe) continue;
    const kinds = PROP_KINDS[z.id] || PROP_KINDS.road;
    const n = z.id==='rift' ? 34 : 46;
    for(let i=0;i<n;i++){
      props.push({x:z.x+8+rr2()*(z.w-16), y:z.y+8+rr2()*(z.h-16),
                  s:8+rr2()*13, kind:kinds[Math.floor(rr2()*kinds.length)], zone:z.id});
    }
  }
  for(let i=0;i<90;i++){
    const x=rr2()*WORLD.w, y=rr2()*WORLD.h;
    // keep the plaza itself clear of scenery
    const pz = ZONES.find(z=>z.id==='plaza');
    if(x>pz.x-40 && x<pz.x+pz.w+40 && y>pz.y-40 && y<pz.y+pz.h+40) continue;
    props.push({x, y, s:7+rr2()*9, kind:PROP_KINDS.road[Math.floor(rr2()*PROP_KINDS.road.length)], zone:'road'});
  }
  props.sort((a,b)=>a.y-b.y);
})();

function zoneAt(x,y){
  for(const z of ZONES){
    if(z.isBase) continue;
    if(x>=z.x && x<=z.x+z.w && y>=z.y && y<=z.y+z.h) return z;
  }
  return ZONES.find(z=>z.isBase);
}

/* ============================================================
   ENTITIES
   ============================================================ */
let P = null;
let ents=[], shots=[], parts=[], drops=[], fx=[], pets=[];
let running=false, last=0, t=0, spawnT=0, saveT=0;

function makePlayer(){
  const h = curHero(), st = h ? heroStats(h, curTier()) : {hp:130,dmg:8,spd:2.0,cd:1};
  return {x:CENTER.x, y:CENTER.y+120, vx:0, vy:0, r:16, hp:st.hp, max:st.hp,
          walk:0, aimx:0, atkT:0, ultT:0, ultActive:0, buffT:0, invT:0,
          dashT:0, dvx:0, dvy:0, alive:true, moving:false, hitFlash:0};
}
function refreshPlayerStats(keepRatio){
  const h = curHero(), st = h ? heroStats(h, curTier()) : {hp:130,dmg:8,spd:2.0,cd:1};
  const ratio = keepRatio && P.max ? P.hp/P.max : 1;
  P.max = st.hp; P.hp = clamp(Math.round(st.hp*ratio),1,st.hp);
  hudSync();
}
function myStats(){
  const h = curHero();
  return h ? heroStats(h, curTier()) : {hp:130,dmg:8,spd:2.0,cd:1};
}
function myAtk(){
  const h = curHero();
  return ATK[h ? h.atk : 'melee'];
}

function spawnEnemy(type, x, y, zone){
  const d = ENEMIES[type];
  const lv = zone ? zone.lvl : 1;
  const pw = 1 + lv*0.42 + curTier()*0.30;
  const dm = 1 + lv*0.26 + curTier()*0.20;
  const e = {
    kind:'mob', type, name:d.n, x, y, vx:0, vy:0, r:d.r,
    hp:Math.round(d.hp*pw), max:Math.round(d.hp*pw), dmg:+(d.dmg*dm).toFixed(1),
    spd:d.spd, range:d.range, shoot:d.kind==='shot', col:d.col, acc:d.acc,
    cash:Math.round(d.cash*(1+lv*0.34)), boss:!!d.boss, walk:Math.random()*7,
    atkT:0, freeze:0, hitFlash:0, aimx:0, moving:false
  };
  ents.push(e); return e;
}
function spawnRealPlayer(rec, x, y, hunter){
  const h = heroById(rec.hero) || HEROES[0];
  const st = heroStats(h, rec.tier);
  const e = {
    kind:'npc', name:rec.name, rec, x, y, vx:0, vy:0, r:16,
    hp:Math.round(st.hp*0.85), max:Math.round(st.hp*0.85), dmg:+(st.dmg*1.25).toFixed(1),
    spd:st.spd*0.78, range:300, shoot:['beam','bolt','spread','arrow','homing','thrown'].includes(h.atk),
    hero:h, col:h.suit, acc:h.accent, bounty:rec.bounty, hunter:!!hunter,
    look:{skin:pick(SKIN_COLORS).c, face:pick(FACES).id, acc:pick(ACCESSORIES).id},
    cash:Math.round(180+rec.tier*140), walk:Math.random()*7, atkT:0, freeze:0, hitFlash:0, aimx:0, moving:false
  };
  ents.push(e); return e;
}

/* ============================================================
   COMBAT
   ============================================================ */
function shoot(owner, x, y, ang, opts){
  const a = opts.spec, dmg = opts.dmg;
  const n = a.count||1;
  for(let i=0;i<n;i++){
    const off = n>1 ? (i-(n-1)/2)*(a.spread||0) : 0;
    const an = ang + off + (opts.jitter||0)*(Math.random()-.5);
    shots.push({
      x, y, vx:Math.cos(an)*a.speed, vy:Math.sin(an)*a.speed,
      dmg, r:a.size, life:a.life, maxlife:a.life, owner, col:opts.col,
      pierce:a.pierce||0, hits:[], homing:!!a.homing, boomerang:!!a.boomerang,
      spin:0, trail:!!a.trail
    });
  }
}
/* live players you are allowed to fight: both of you outside the sanctuary */
function pvpTargets(){
  const out = [];
  if(NET.liveState !== 'live' || !P || inSafe(P.x, P.y)) return out;
  for(const [name, q] of NET.peers){
    // test the authoritative snapshot position too — the interpolated one can
    // lag outside the wall and invite shots the server will refuse anyway
    if(q.hp <= 0 || inSafe(q.x, q.y) || inSafe(q.tx, q.ty)) continue;
    out.push({ name, q });
  }
  return out;
}
/* report damage on a live player and show the feedback locally */
function hitPeer(name, q, dmg, ang){
  NET.sendHit(name, dmg);
  q.hp = Math.max(0, q.hp - dmg);          // optimistic, corrected by the next snapshot
  if(fx.length < 26)
    fx.push({t:'txt', x:q.x+rnd(-9,9), y:q.y-58, txt:Math.round(dmg), col:'#ff9d6b', life:.6, vy:-38});
  for(let i=0;i<3;i++)
    parts.push({x:q.x, y:q.y-24, vx:rnd(-2,2), vy:rnd(-3,1), life:.35, max:.35, col:'#ffb0b0', size:2.4});
}

function nearestEnemy(x,y,maxd){
  let b=null, bd=maxd||1e9;
  for(const e of ents){ const d=Math.hypot(e.x-x,e.y-y); if(d<bd){bd=d;b=e;} }
  return b;
}
function dmgEnemy(e, amount, kb, ang){
  e.hp -= amount; e.hitFlash = 0.12;
  S.counters.damage += amount;
  if(fx.length<26) fx.push({t:'txt', x:e.x+rnd(-9,9), y:e.y-58, txt:Math.round(amount), col:'#ffe27a', life:.6, vy:-38});
  if(kb){ e.vx += Math.cos(ang)*kb; e.vy += Math.sin(ang)*kb; }
  for(let i=0;i<3;i++) parts.push({x:e.x,y:e.y-20,vx:rnd(-2,2),vy:rnd(-3,1),life:.35,max:.35,col:'#ffb0b0',size:2.4});
  if(e.hp<=0) killEnemy(e, ang);
}
function killEnemy(e, ang){
  const i = ents.indexOf(e); if(i<0) return;
  ents.splice(i,1);
  for(let k=0;k<16;k++) parts.push({x:e.x,y:e.y-22,vx:rnd(-4,4),vy:rnd(-5,2),life:rnd(.4,.8),max:.8,
      col: k%2 ? (e.col||'#fff') : '#ffe27a', size:rnd(2,4.4)});
  fx.push({t:'ring', x:e.x, y:e.y-18, r:6, max:e.boss?90:44, col:'#ffe27a', life:.42});

  let cash = e.cash || 40;
  if(e.kind==='npc' && e.real){
    // a real player's bounty is settled server-side, so no local cash drops here
    const nm = e.name, shown = e.bounty||0;
    for(let k=0;k<22;k++) parts.push({x:e.x,y:e.y-24,vx:rnd(-4,4),vy:rnd(-6,1),life:rnd(.5,1),max:1,col:'#ffcb45',size:rnd(2,5)});
    fx.push({t:'ring',x:e.x,y:e.y-18,r:8,max:120,col:'#ffcb45',life:.6,thick:5});
    S.counters.killBounty++; S.stats.kills++; S.stats.streak++; S.counters.anykill++;
    toast('Claiming the bounty on '+nm+'…','info');
    NET.claim(nm).then(r=>{
      if(!r || !r.ok) return;
      if(r.prize>0){
        S.cash = Number(r.cash); S.heat = Number(r.bounty);
        toast('Bounty collected on '+nm+': +$'+fmt(r.prize),'good');
        feed('<b>You</b> collected <b>$'+fmt(r.prize)+'</b> from <b>'+nm+'</b>');
      } else {
        toast('Someone else got to '+nm+' first.','bad');
      }
      hudSync();
    }).catch(()=>toast('Could not reach the server to claim that bounty.','bad'));
    checkTasks(); hudSync();
    return;
  }
  if(e.kind==='npc'){
    cash += e.bounty||0;
    if(e.bounty>0){
      S.counters.killBounty++;
      addHeat(Math.round(e.bounty*0.35));
      toast('Bounty claimed on '+e.name+': +$'+fmt(e.bounty)+'  (your bounty rose)','good');
      feed('<b>You</b> claimed the bounty on <b>'+e.name+'</b>');
    } else {
      addHeat(120);
      toast('You robbed '+e.name+'. The game put a bounty on you.','bad');
      feed('<b>You</b> robbed <b>'+e.name+'</b>');
    }
    if(e.hunter){ S.heat = Math.max(0, Math.round(S.heat*0.72)); toast('Hunter down. Your bounty cooled.','info'); }
    const r = e.rec; if(r){ r.bounty = 0; r.alive=false; r.cool = t + rnd(25,60); }
  } else {
    if(e.type==='bandit'||e.type==='raider') S.counters.killBandit++;
    else S.counters.killMonster++;
    if(e.boss) S.counters.killBoss++;
  }
  // cash drops
  let left = cash, n = clamp(Math.round(cash/45),1,9);
  for(let k=0;k<n;k++){
    const amt = k===n-1 ? left : Math.round(cash/n);
    left -= amt;
    drops.push({x:e.x+rnd(-16,16), y:e.y+rnd(-10,10), vx:rnd(-1.6,1.6), vy:rnd(-2.4,-.4), amt, life:26, bob:Math.random()*7});
  }
  S.stats.kills++; S.stats.streak++; S.counters.anykill++;
  S.counters.streak = Math.max(S.counters.streak, S.stats.streak);
  if(S.stats.streak > S.stats.best) S.stats.best = S.stats.streak;
  checkTasks();
}

function playerAttack(){
  const h = curHero(), spec = myAtk(), st = myStats();
  const ang = Math.atan2(mouse.wy - (P.y-26), mouse.wx - P.x);
  const dmg = st.dmg;
  P.atkT = spec.rate/1000 * st.cd;

  if(spec.kind==='melee'){
    const reach = spec.reach, arc = spec.arc;
    fx.push({t:'swing', x:P.x, y:P.y-26, a:ang, reach, arc, life:.16, col:h?h.accent:'#ddd'});
    for(const e of ents.slice()){
      const d = Math.hypot(e.x-P.x, (e.y-P.y));
      if(d < reach + e.r){
        const ea = Math.atan2(e.y-P.y, e.x-P.x);
        let da = Math.abs(((ea-ang+Math.PI*3)%(Math.PI*2))-Math.PI);
        if(da < arc/2) dmgEnemy(e, dmg*spec.dmgMul*(P.buffT>0?1.6:1), spec.knock, ea);
      }
    }
    for(const {name, q} of pvpTargets()){
      const d = Math.hypot(q.x-P.x, q.y-P.y);
      if(d < reach + 16){
        const ea = Math.atan2(q.y-P.y, q.x-P.x);
        let da = Math.abs(((ea-ang+Math.PI*3)%(Math.PI*2))-Math.PI);
        if(da < arc/2) hitPeer(name, q, dmg*spec.dmgMul*(P.buffT>0?1.6:1), ea);
      }
    }
    parts.push({x:P.x+Math.cos(ang)*reach*.7, y:P.y-26+Math.sin(ang)*reach*.7, vx:0,vy:0,
      life:.16,max:.16,col:'#fff',size:5});
  } else {
    shoot('p', P.x + Math.cos(ang)*18, P.y-26 + Math.sin(ang)*18, ang, {
      spec, dmg: dmg*spec.dmgMul*(P.buffT>0?1.6:1), col: h?h.glow:'#ffe27a'
    });
  }
}

function useUlt(){
  const h = curHero(); if(!h || !P || !P.alive) return;
  if(P.ultT > 0){ toast('Ultimate on cooldown ('+P.ultT.toFixed(1)+'s)','bad'); return; }
  const st = myStats(), t2 = curTier();
  const cd = h.ult.cd * (1 - t2*0.028);
  P.ultT = cd; P.ultMax = cd;
  S.counters.ults++; checkTasks();
  const ang = Math.atan2(mouse.wy-(P.y-26), mouse.wx-P.x);
  toast(h.ult.name+'!','info');

  switch(h.ult.effect){
    case 'nova': {
      fx.push({t:'ring', x:P.x, y:P.y-20, r:10, max:280, col:h.glow, life:.55, thick:7});
      for(const e of ents.slice()){
        const d = Math.hypot(e.x-P.x,e.y-P.y);
        if(d<280) dmgEnemy(e, st.dmg*6.5, 22, Math.atan2(e.y-P.y,e.x-P.x));
      }
      for(const {name, q} of pvpTargets())
        if(Math.hypot(q.x-P.x,q.y-P.y)<280) hitPeer(name, q, st.dmg*6.5, 0);
      if(h.id==='marvel'||h.name.includes('Marvel')){ P.hp = P.max; toast('Binary: fully restored.','good'); }
      shake(14); break;
    }
    case 'rain': {
      const near = ents.filter(e=>Math.hypot(e.x-P.x,e.y-P.y)<440);
      for(let i=0;i<18;i++){
        let sx, sy;
        if(near.length && Math.random()<0.65){            // most bolts seek a real target
          const tg = pick(near); sx = tg.x+rnd(-26,26); sy = tg.y+rnd(-26,26);
        } else {
          const a=Math.random()*7, r=Math.random()*420;
          sx = P.x+Math.cos(a)*r; sy = P.y+Math.sin(a)*r;
        }
        fx.push({t:'strike', x:sx, y:sy, delay:i*0.07, life:.5,
                 col:h.glow, dmg:st.dmg*3.2, done:false});
      }
      shake(8); break;
    }
    case 'summon': {
      for(let i=0;i<4;i++) pets.push({x:P.x+rnd(-30,30), y:P.y+rnd(-30,30), a:i/4*7, life:13, shootT:0, col:h.glow});
      break;
    }
    case 'buff': {
      P.buffT = 4.2; P.invT = Math.max(P.invT, 4.2);
      fx.push({t:'ring', x:P.x, y:P.y-20, r:10, max:70, col:h.glow, life:.5, thick:5}); break;
    }
    case 'freeze': {
      for(const e of ents){ e.freeze = 4.5; }
      fx.push({t:'ring', x:P.x, y:P.y-20, r:10, max:520, col:'#8fe3ff', life:.8, thick:4});
      for(const e of ents) dmgEnemy(e, st.dmg*1.4, 0, 0);
      break;
    }
    case 'dash': {
      P.dashT = .34; P.dvx = Math.cos(ang)*26; P.dvy = Math.sin(ang)*26;
      P.invT = Math.max(P.invT,.5); P.dashHits = [];
      break;
    }
  }
}

/* ---------- damage to player ---------- */
function hurtPlayer(amount, from, pvp){
  if(!P.alive || P.invT>0) return;
  // Timestamped i-frames: a backgrounded tab throttles rAF, so a dt-based timer
  // would leave the player permanently invulnerable. Player damage gets its own
  // shorter window, otherwise a fast hero duels no better than a slow one.
  const now = performance.now();
  const key = pvp ? 'pvpLockUntil' : 'hurtLockUntil';
  if(now < (P[key]||0)) return;
  P[key] = now + (pvp ? 110 : 320);
  P.hp -= amount; P.hitFlash = .16; shake(4);
  fx.push({t:'txt', x:P.x+rnd(-10,10), y:P.y-52, txt:'-'+Math.round(amount), col:'#ff6b6b', life:.7, vy:-30});
  if(P.hp<=0) die(from);
}
function die(from){
  P.alive=false; P.hp=0;
  NET.sendDied(from || '');
  const lost = Math.round(S.cash*0.25);
  S.cash -= lost; S.stats.deaths++; S.stats.streak=0;
  const wasHeat = S.heat; S.heat = 0; S.heatPending = 0; S.heatWipe = true;
  document.getElementById('deathMsg').innerHTML =
    'Taken out by <b>'+(from||'the wilds')+'</b>. You dropped <b class="price">$'+fmt(lost)+'</b>'+
    (wasHeat>0 ? ' and your <b>$'+fmt(wasHeat)+'</b> bounty was collected.' : '.');
  document.getElementById('death').classList.remove('hidden');
  for(let k=0;k<26;k++) parts.push({x:P.x,y:P.y-22,vx:rnd(-5,5),vy:rnd(-6,2),life:rnd(.5,1),max:1,col:'#ff8f6b',size:rnd(2,5)});
  save();
}
function respawn(){
  P = makePlayer(); refreshPlayerStats(false);
  P.x=CENTER.x; P.y=CENTER.y+150;
  ents = ents.filter(e=>false); shots=[]; drops=drops.slice(0,0);
  document.getElementById('death').classList.add('hidden');
  hudSync();
}

/* ---------- bounty heat (mirrored to the server when online) ---------- */
function addHeat(n){
  n = Math.round(n);
  if(n<=0) return;
  S.heat += n; S.heatPending += n;
}

/* ---------- cloud sync ---------- */
let syncing=false;
function syncPayload(){
  const h = curHero();
  return Object.assign({}, S, {
    heroName: h ? h.name : '',
    heroTier: curTier(),
    kills: S.stats.kills, deaths: S.stats.deaths, bestStreak: S.stats.best,
    look: S.look
  });
}
async function cloudSync(){
  if(!NET.online || syncing || !NET.name) return;
  syncing = true;
  const sentHeat = S.heatPending, sentWipe = S.heatWipe;
  try{
    const d = await NET.req('POST','/api/sync',{
      name:NET.name, token:NET.token, state:syncPayload(),
      heatDelta:sentHeat, heatWipe:sentWipe
    });
    NET.online = true; NET.status = 'online';
    NET.applyWorld(d.world);
    S.heatPending = Math.max(0, S.heatPending - sentHeat);
    if(sentWipe) S.heatWipe = false;
    S.heat = Number(d.bounty)||0;               // server owns your bounty
    netBadge();
  }catch(e){ netBadge(); }
  finally{ syncing = false; }
}
let _badgeTxt='';
function netBadge(){
  const el=$('hudNet'); if(!el) return;
  el.className = 'net' + (NET.liveState==='live' || NET.online ? ' on' : (NET.status==='taken' ? ' bad' : ''));
  const n = NET.peers ? NET.peers.size : 0;
  const txt = NET.liveState==='live' ? ('live · '+(n+1))
            : NET.online ? 'online' : (NET.status==='taken' ? 'name taken' : 'local');
  if(txt !== _badgeTxt){ _badgeTxt = txt; el.innerHTML = '● <b>'+txt+'</b>'; }
  el.title = NET.online ? 'Connected — progress saves to the cloud and the bounty board is shared'
                        : 'Offline — playing from this browser only';
}

/* ---------- screen shake ---------- */
let shakeAmt=0;
function shake(a){ shakeAmt = Math.max(shakeAmt, a); }

/* ============================================================
   UPDATE
   ============================================================ */
function update(dt){
  t += dt;
  S.playtime += dt;

  /* ---- player ---- */
  if(P.alive){
    const st = myStats();
    let ax=0, ay=0;
    if(keys['w']||keys['arrowup'])   ay-=1;
    if(keys['s']||keys['arrowdown']) ay+=1;
    if(keys['a']||keys['arrowleft']) ax-=1;
    if(keys['d']||keys['arrowright'])ax+=1;
    const len=Math.hypot(ax,ay)||1; ax/=len; ay/=len;
    const sprint = (keys['shift']?1.45:1);
    const spd = st.spd * 62 * sprint;

    if(P.dashT>0){
      P.dashT-=dt;
      P.x += P.dvx * dt*60; P.y += P.dvy * dt*60;
      for(let i=0;i<2;i++) parts.push({x:P.x,y:P.y-22,vx:0,vy:0,life:.3,max:.3,col:'#b47bff',size:5});
      for(const e of ents.slice()){
        if(P.dashHits.includes(e)) continue;
        if(Math.hypot(e.x-P.x,e.y-P.y) < e.r+34){
          P.dashHits.push(e);
          dmgEnemy(e, st.dmg*4.5, 16, Math.atan2(e.y-P.y,e.x-P.x));
        }
      }
    } else {
      P.vx += (ax*spd - P.vx) * clamp(dt*12,0,1);
      P.vy += (ay*spd - P.vy) * clamp(dt*12,0,1);
      P.x += P.vx*dt; P.y += P.vy*dt;
    }
    P.moving = Math.hypot(P.vx,P.vy) > 18 || P.dashT>0;
    P.walk += dt * (P.moving ? 9 : 0);
    P.x = clamp(P.x, 20, WORLD.w-20); P.y = clamp(P.y, 30, WORLD.h-10);

    P.aimx = Math.sign(mouse.wx - P.x);
    P.atkT -= dt; P.ultT = Math.max(0, P.ultT - dt);
    P.buffT = Math.max(0,P.buffT-dt); P.invT = Math.max(0,P.invT-dt);
    P.hitFlash = Math.max(0,P.hitFlash-dt);
    if(mouse.down && P.atkT<=0 && !overlayOpen()) playerAttack();

    // trail particles
    const tr = TRAILS.find(x=>x.id===S.look.trail);
    if(tr && tr.id!=='none' && P.moving && Math.random()<0.65){
      let col = tr.c;
      if(col==='rainbow') col = 'hsl('+((t*220)%360)+',95%,62%)';
      parts.push({x:P.x+rnd(-7,7), y:P.y-rnd(0,14), vx:rnd(-.6,.6), vy:tr.id==='bubbles'?-1.4:rnd(-.8,.4),
        life:tr.id==='glitch'?.28:.7, max:.7, col, size:tr.id==='fire'?rnd(3,6):rnd(2,4.4), trail:tr.id});
    }
  }

  /* ---- pets ---- */
  for(let i=pets.length-1;i>=0;i--){
    const p=pets[i]; p.life-=dt; p.a += dt*2.2; p.shootT-=dt;
    const tx = P.x + Math.cos(p.a)*54, ty = P.y-30 + Math.sin(p.a)*34;
    p.x += (tx-p.x)*clamp(dt*6,0,1); p.y += (ty-p.y)*clamp(dt*6,0,1);
    if(p.shootT<=0){
      const e = nearestEnemy(p.x,p.y,460);
      if(e){ p.shootT=.42;
        shoot('p', p.x, p.y, Math.atan2(e.y-24-p.y, e.x-p.x), {spec:ATK.beam, dmg:myStats().dmg*0.55, col:p.col}); }
    }
    if(p.life<=0) pets.splice(i,1);
  }

  /* ---- enemies ---- */
  for(const e of ents){
    e.hitFlash = Math.max(0,e.hitFlash-dt);
    if(e.freeze>0){ e.freeze-=dt; e.moving=false; continue; }
    const dx=P.x-e.x, dy=P.y-e.y, d=Math.hypot(dx,dy)||1;
    const want = e.shoot ? e.range*0.72 : e.r+18;
    let mx=0,my=0;
    const playerSafe = inSafe(P.x, P.y);
    if(P.alive && !playerSafe){
      if(d > want){ mx=dx/d; my=dy/d; }
      else if(d < want*0.6){ mx=-dx/d; my=-dy/d; }
      else { mx=-dy/d*0.6; my=dx/d*0.6; }
    } else if(playerSafe){
      // prowl the perimeter instead of pressing against the wall
      mx = Math.cos(t*0.6 + e.walk)*0.45; my = Math.sin(t*0.5 + e.walk)*0.45;
    }
    e.vx += (mx*e.spd*60 - e.vx)*clamp(dt*6,0,1);
    e.vy += (my*e.spd*60 - e.vy)*clamp(dt*6,0,1);
    e.x += e.vx*dt; e.y += e.vy*dt;
    e.x = clamp(e.x,10,WORLD.w-10); e.y = clamp(e.y,20,WORLD.h-10);
    if(keepOutOfSafe(e, 6)) e.atWall = true; else e.atWall = false;
    e.moving = Math.hypot(e.vx,e.vy)>16;
    e.walk += dt*(e.moving?8:0);
    e.aimx = Math.sign(dx);
    e.atkT -= dt;

    // separation
    for(const o of ents){
      if(o===e) continue;
      const ox=o.x-e.x, oy=o.y-e.y, od=Math.hypot(ox,oy);
      if(od>0 && od < e.r+o.r){ const f=(e.r+o.r-od)/od*0.5; e.x-=ox*f*0.5; e.y-=oy*f*0.5; }
    }

    if(P.alive && !playerSafe && e.atkT<=0){
      if(e.shoot && d < e.range){
        e.atkT = e.kind==='npc' ? .55 : .95;
        const spec = e.kind==='npc' ? ATK[(e.hero&&ATK[e.hero.atk]&&ATK[e.hero.atk].kind==='shot')?e.hero.atk:'beam'] : ATK.beam;
        shoot('e', e.x, e.y-26, Math.atan2(P.y-26-(e.y-26), P.x-e.x), {
          spec:{...spec, speed:spec.speed*0.62, count:1, boomerang:false, pierce:0}, dmg:e.dmg, col:e.acc||'#ff7b6b', jitter:.16});
      } else if(!e.shoot && d < e.r+34){
        e.atkT = 1.0; hurtPlayer(e.dmg, e.name);
        fx.push({t:'swing', x:e.x, y:e.y-26, a:Math.atan2(dy,dx), reach:40, arc:1.4, life:.14, col:'#ff8f6b'});
      }
    }
  }

  /* ---- shots ---- */
  for(let i=shots.length-1;i>=0;i--){
    const s=shots[i]; s.life-=dt*60; s.spin+=dt*14;
    if(s.homing){
      const tgt = s.owner==='p' ? nearestEnemy(s.x,s.y,420) : (P.alive?P:null);
      if(tgt){
        const a=Math.atan2((tgt.y-(s.owner==='p'?24:26))-s.y, tgt.x-s.x);
        const sp=Math.hypot(s.vx,s.vy);
        s.vx += (Math.cos(a)*sp - s.vx)*clamp(dt*3.2,0,1);
        s.vy += (Math.sin(a)*sp - s.vy)*clamp(dt*3.2,0,1);
      }
    }
    if(s.boomerang && s.life < s.maxlife*0.55){
      const a=Math.atan2((P.y-26)-s.y, P.x-s.x), sp=Math.hypot(s.vx,s.vy);
      s.vx += (Math.cos(a)*sp - s.vx)*clamp(dt*4,0,1);
      s.vy += (Math.sin(a)*sp - s.vy)*clamp(dt*4,0,1);
      if(Math.hypot(P.x-s.x,(P.y-26)-s.y)<20){ shots.splice(i,1); continue; }
    }
    s.x += s.vx*dt*60; s.y += s.vy*dt*60;
    if(s.trail && Math.random()<.7)
      parts.push({x:s.x,y:s.y,vx:0,vy:0,life:.22,max:.22,col:s.col,size:s.r*0.7});
    if(s.life<=0 || s.x<0||s.y<0||s.x>WORLD.w||s.y>WORLD.h){ shots.splice(i,1); continue; }
    if(s.owner==='e' && inSafe(s.x, s.y)){        // nothing hostile crosses the wall
      for(let k=0;k<4;k++) parts.push({x:s.x,y:s.y,vx:rnd(-1,1),vy:rnd(-1,1),life:.3,max:.3,col:'#ffcb45',size:2});
      shots.splice(i,1); continue;
    }

    if(s.owner==='p'){
      let consumed = false;
      for(const {name, q} of pvpTargets()){
        if(s.hits.includes('@'+name)) continue;
        if(Math.hypot(q.x-s.x, (q.y-26)-s.y) < 17+s.r){
          s.hits.push('@'+name);
          hitPeer(name, q, s.dmg, Math.atan2(s.vy,s.vx));
          if(s.pierce<=0){ shots.splice(i,1); consumed = true; break; }
          s.pierce--;
        }
      }
      if(consumed) continue;
      for(const e of ents.slice()){
        if(s.hits.includes(e)) continue;
        if(Math.hypot(e.x-s.x, (e.y-26)-s.y) < e.r+s.r){
          s.hits.push(e);
          dmgEnemy(e, s.dmg, 5, Math.atan2(s.vy,s.vx));
          if(s.pierce<=0){ shots.splice(i,1); break; }
          s.pierce--;
        }
      }
    } else if(P.alive){
      if(Math.hypot(P.x-s.x,(P.y-26)-s.y) < 17+s.r){
        if(P.buffT>0){ s.owner='p'; s.vx*=-1; s.vy*=-1; s.hits=[]; s.col='#9dc4ff'; }
        else { hurtPlayer(s.dmg,'a ranged attack'); shots.splice(i,1); }
      }
    }
  }

  /* ---- drops ---- */
  for(let i=drops.length-1;i>=0;i--){
    const d=drops[i]; d.life-=dt; d.bob+=dt*6;
    d.x+=d.vx; d.y+=d.vy; d.vx*=0.9; d.vy=d.vy*0.9+0.06;
    const dd=Math.hypot(P.x-d.x,P.y-d.y);
    if(dd<110){ const a=Math.atan2(P.y-d.y,P.x-d.x); d.x+=Math.cos(a)*(160-dd)*dt*3.2; d.y+=Math.sin(a)*(160-dd)*dt*3.2; }
    if(dd<26 || d.life<=0){
      if(d.life>0){
        S.cash += d.amt; S.stats.earned += d.amt; S.counters.pickup += d.amt;
        fx.push({t:'txt',x:d.x,y:d.y-20,txt:'+$'+d.amt,col:'#ffcb45',life:.7,vy:-30,big:true});
        checkTasks();
      }
      drops.splice(i,1);
    }
  }

  /* ---- particles & fx ---- */
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i]; p.life-=dt;
    p.x+=p.vx; p.y+=p.vy; p.vy+= p.trail==='bubbles'? -0.02 : 0.06;
    if(p.life<=0) parts.splice(i,1);
  }
  for(let i=fx.length-1;i>=0;i--){
    const f=fx[i];
    if(f.t==='strike'){
      f.delay-=dt;
      if(f.delay<=0 && !f.done){
        f.done=true; f.life=.4;
        for(const e of ents.slice()) if(Math.hypot(e.x-f.x,e.y-f.y)<70) dmgEnemy(e, f.dmg, 8, Math.atan2(e.y-f.y,e.x-f.x));
        for(const {name, q} of pvpTargets()) if(Math.hypot(q.x-f.x,q.y-f.y)<70) hitPeer(name, q, f.dmg, 0);
        for(let k=0;k<8;k++) parts.push({x:f.x,y:f.y,vx:rnd(-3,3),vy:rnd(-4,0),life:.4,max:.4,col:f.col,size:3});
      }
      if(f.done){ f.life-=dt; if(f.life<=0) fx.splice(i,1); }
      continue;
    }
    f.life-=dt;
    if(f.t==='txt'){ f.y += (f.vy||-30)*dt; }
    if(f.t==='ring'){ f.r += (f.max-f.r)*clamp(dt*9,0,1); }
    if(f.life<=0) fx.splice(i,1);
  }
  shakeAmt *= 0.86;

  /* ---- spawning ---- */
  const z = zoneAt(P.x,P.y);
  spawnT -= dt;
  if(!z.safe && spawnT<=0){
    spawnT = 0.85;
    const cap = 4 + z.lvl*2;
    if(ents.length < cap){
      const table = z.spawn || ['bandit'];
      let sx,sy,tries=0;
      do{ sx = z.x + Math.random()*z.w; sy = z.y + Math.random()*z.h; tries++; }
      while((Math.hypot(sx-P.x,sy-P.y) < 340 || inSafe(sx, sy, 30)) && tries<24);
      if(inSafe(sx, sy, 30)) return;
      let type = pick(table);
      if(z.lvl>=3 && Math.random()<0.05) type='brute';
      spawnEnemy(type, sx, sy, z);
      const fxs = ents[ents.length-1];
      fx.push({t:'ring',x:fxs.x,y:fxs.y-16,r:4,max:30,col:'#ffffff55',life:.35});
    }
    // only real people carry bounties, and only they show up as hunt targets
    const npcs = ents.filter(e=>e.kind==='npc');
    if(NET.online && npcs.length < 2 && NET.world.bounties.length && Math.random()<0.5){
      const real = pick(NET.world.bounties);
      if(real && real.name !== NET.name && !NET.peers.has(real.name) && !ents.some(e=>e.name===real.name)){
        let sx2, sy2, tries2=0;
        do{ const a=Math.random()*7;
            sx2 = clamp(P.x+Math.cos(a)*430, z.x, z.x+z.w);
            sy2 = clamp(P.y+Math.sin(a)*430, z.y, z.y+z.h); tries2++;
        } while(inSafe(sx2, sy2, 30) && tries2<20);
        if(!inSafe(sx2, sy2, 30)){
          const e = spawnRealPlayer({name:real.name, hero:real.hero||pick(HEROES).id,
                              tier:clamp(real.hero_tier||0,0,7), bounty:Number(real.bounty)||0}, sx2, sy2);
          e.real = true;
          if(real.look){
            if(real.look.face) e.look.face = real.look.face;
            if(real.look.acc)  e.look.acc  = real.look.acc;
            const sk = SKIN_COLORS.find(c=>c.id===real.look.skin); if(sk) e.look.skin = sk.c;
          }
          toast('Bountied player nearby: '+real.name+'  ($'+fmt(e.bounty)+')','bad');
        }
      }
    }
  }
  if(z.safe && P.alive && P.hp < P.max){        // the plaza mends you; nothing is deleted
    P.hp = Math.min(P.max, P.hp + P.max*0.14*dt);
    if(Math.random() < dt*7)
      parts.push({x:P.x+rnd(-13,13), y:P.y-rnd(4,40), vx:0, vy:-.5, life:.7, max:.7,
                  col:'#8fffc0', size:2.6});
  }
  if(z.id!=='road' && !z.safe && !S.zonesSeen.includes(z.id)){
    S.zonesSeen.push(z.id); S.counters.zones = S.zonesSeen.length; checkTasks();
  }

  /* ---- camera ---- */
  cam.x += (P.x - cam.x) * clamp(dt*5,0,1);
  cam.y += (P.y - 40 - cam.y) * clamp(dt*5,0,1);
  cam.x = clamp(cam.x, VW/2, WORLD.w-VW/2); if(WORLD.w<VW) cam.x=WORLD.w/2;
  cam.y = clamp(cam.y, VH/2, WORLD.h-VH/2); if(WORLD.h<VH) cam.y=WORLD.h/2;

  mouse.wx = mouse.x + cam.x - VW/2;
  mouse.wy = mouse.y + cam.y - VH/2;

  document.getElementById('zoneName').textContent = z.n + (z.safe?'  ·  SAFE':'  ·  DANGER LV'+z.lvl);
  // interpolate peers toward their latest snapshot
  for(const q of NET.peers.values()){
    q.x += (q.tx - q.x) * clamp(dt*11, 0, 1);
    q.y += (q.ty - q.y) * clamp(dt*11, 0, 1);
  }
  saveT -= dt; if(saveT<=0){ saveT=8; save(); cloudSync(); }
  hudSync();
}

/* ============================================================
   RENDER
   ============================================================ */
function render(){
  g.setTransform(DPR,0,0,DPR,0,0);
  g.fillStyle='#080b12'; g.fillRect(0,0,VW,VH);
  const sx = (Math.random()-.5)*shakeAmt, sy=(Math.random()-.5)*shakeAmt;
  g.save();
  g.translate(VW/2 - cam.x + sx, VH/2 - cam.y + sy);

  const vx0=cam.x-VW/2-80, vy0=cam.y-VH/2-80, vx1=cam.x+VW/2+80, vy1=cam.y+VH/2+80;
  const vis=(x,y,pad)=> x>vx0-(pad||0)&&x<vx1+(pad||0)&&y>vy0-(pad||0)&&y<vy1+(pad||0);

  /* ground */
  const base = ZONES.find(z=>z.isBase);
  g.fillStyle = base.fill; g.fillRect(0,0,WORLD.w,WORLD.h);
  g.save();
  g.fillStyle = groundPattern(g, 'road', base.fill);
  g.fillRect(0,0,WORLD.w,WORLD.h);
  g.restore();

  /* zones */
  for(const z of ZONES){
    if(z.isBase) continue;
    g.save();
    roundRect(z.x,z.y,z.w,z.h,30); g.clip();
    g.fillStyle = z.fill; g.fillRect(z.x,z.y,z.w,z.h);
    g.fillStyle = groundPattern(g, z.id, z.fill); g.fillRect(z.x,z.y,z.w,z.h);
    // inner edge darkening so each zone reads as its own place
    const eg = g.createRadialGradient(z.x+z.w/2, z.y+z.h/2, Math.min(z.w,z.h)*0.28,
                                      z.x+z.w/2, z.y+z.h/2, Math.max(z.w,z.h)*0.62);
    eg.addColorStop(0,'rgba(0,0,0,0)'); eg.addColorStop(1,'rgba(0,0,0,.42)');
    g.fillStyle = eg; g.fillRect(z.x,z.y,z.w,z.h);
    g.restore();

    // border: glow + hazard dashes
    const col = z.safe ? '#ffcb45' : '#ff5a5a';
    g.save();
    g.strokeStyle = alpha(col,.20); g.lineWidth = 10;
    roundRect(z.x,z.y,z.w,z.h,30); g.stroke();
    g.strokeStyle = alpha(col,.72); g.lineWidth = 2.4;
    g.setLineDash(z.safe?[]:[16,11]); g.lineDashOffset = -t*22;
    roundRect(z.x,z.y,z.w,z.h,30); g.stroke();
    g.setLineDash([]);
    g.restore();

    // engraved title
    g.textAlign='center';
    g.font='bold 34px Verdana';
    g.fillStyle='rgba(0,0,0,.45)'; g.fillText(z.n.toUpperCase(), z.x+z.w/2, z.y+50);
    g.fillStyle = z.safe?'rgba(255,203,69,.20)':'rgba(255,255,255,.11)';
    g.fillText(z.n.toUpperCase(), z.x+z.w/2, z.y+48);
    if(!z.safe){
      g.font='bold 13px Verdana'; g.fillStyle='rgba(255,120,120,.34)';
      g.fillText('DANGER LEVEL '+z.lvl, z.x+z.w/2, z.y+70);
    }
  }

  /* props */
  for(const p of props){
    if(!vis(p.x,p.y,70)) continue;
    drawProp(g, p.kind, p.x, p.y, p.s, t);
  }

  /* plaza inlay */
  const plaza = ZONES.find(z=>z.id==='plaza');
  g.save();
  roundRect(plaza.x,plaza.y,plaza.w,plaza.h,30); g.clip();
  g.strokeStyle='rgba(255,203,69,.16)'; g.lineWidth=2.5;
  for(let r=130;r<640;r+=112){ g.beginPath(); g.ellipse(CENTER.x,CENTER.y,r*1.35,r*0.92,0,0,7); g.stroke(); }
  g.strokeStyle='rgba(255,203,69,.10)'; g.lineWidth=1.6;
  for(let i=0;i<12;i++){
    const a=i/12*Math.PI*2;
    g.beginPath(); g.moveTo(CENTER.x+Math.cos(a)*150*1.35, CENTER.y+Math.sin(a)*150*0.92);
    g.lineTo(CENTER.x+Math.cos(a)*600*1.35, CENTER.y+Math.sin(a)*600*0.92); g.stroke();
  }
  g.restore();

  /* temples */
  for(const tp of TEMPLES){
    if(!vis(tp.x,tp.y,140)) continue;
    drawTemple(tp);
  }
  drawForge();
  drawBoard();

  /* drops */
  for(const d of drops){
    if(!vis(d.x,d.y,30)) continue;
    const b = Math.sin(d.bob)*3;
    g.fillStyle='rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(d.x,d.y+4,7,3,0,0,7); g.fill();
    g.fillStyle='#ffcb45'; g.shadowColor='#ffcb45'; g.shadowBlur=10;
    g.beginPath(); g.arc(d.x,d.y-6+b,6,0,7); g.fill(); g.shadowBlur=0;
    g.fillStyle='#8a6a12'; g.font='bold 8px Verdana'; g.textAlign='center'; g.fillText('$',d.x,d.y-3+b);
  }

  /* particles (under entities) */
  g.save(); g.globalCompositeOperation='lighter';
  for(const p of parts){
    const a=clamp(p.life/p.max,0,1);
    if(!vis(p.x,p.y,24)) continue;
    g.globalAlpha=a*.9;
    if(p.trail==='glitch'){ g.fillStyle=p.col; g.fillRect(p.x-p.size,p.y-1,p.size*2,2.5); }
    else {
      const pg=g.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size*2.1+1);
      pg.addColorStop(0, alpha(p.col,.95)); pg.addColorStop(.4, alpha(p.col,.45));
      pg.addColorStop(1, alpha(p.col,0));
      g.fillStyle=pg; g.beginPath(); g.arc(p.x,p.y,p.size*2.1+1,0,7); g.fill();
    }
  }
  g.restore(); g.globalAlpha=1;

  /* entity sort by y */
  const drawList = ents.slice();
  if(P.alive) drawList.push(P);
  for(const [name, q] of NET.peers) drawList.push({peer:true, name, q, x:q.x, y:q.y});
  drawList.sort((a,b)=>a.y-b.y);

  for(const e of drawList){
    if(!vis(e.x,e.y,90)) continue;
    if(e===P) drawPlayer();
    else if(e.peer) drawPeer(e.name, e.q);
    else drawEnemy(e);
  }

  /* pets */
  for(const p of pets){
    g.fillStyle='#c0392b'; g.beginPath(); g.arc(p.x,p.y,7,0,7); g.fill();
    g.fillStyle=p.col; g.shadowColor=p.col; g.shadowBlur=9;
    g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); g.shadowBlur=0;
  }

  /* shots */
  for(const sh of shots){
    if(!vis(sh.x,sh.y,44)) continue;
    const ang = Math.atan2(sh.vy, sh.vx);
    g.save(); g.translate(sh.x, sh.y);
    if(sh.boomerang){
      g.rotate(sh.spin);
      g.fillStyle='#20242e'; g.beginPath(); g.arc(0,0,sh.r+1.6,0,7); g.fill();
      const rg=g.createRadialGradient(-sh.r*.3,-sh.r*.3,1,0,0,sh.r);
      rg.addColorStop(0,'#8fb8ff'); rg.addColorStop(.55,'#2e5fa8'); rg.addColorStop(1,'#16305a');
      g.fillStyle=rg; g.beginPath(); g.arc(0,0,sh.r,0,7); g.fill();
      g.fillStyle='#eef2f8'; g.beginPath(); g.arc(0,0,sh.r*.62,0,7); g.fill();
      g.fillStyle='#c0392b'; g.beginPath(); g.arc(0,0,sh.r*.34,0,7); g.fill();
      g.fillStyle='#eef2f8';
      g.beginPath();
      for(let i=0;i<5;i++){ const a=-Math.PI/2+i*Math.PI*2/5;
        g.lineTo(Math.cos(a)*sh.r*.30, Math.sin(a)*sh.r*.30);
        const b=a+Math.PI/5; g.lineTo(Math.cos(b)*sh.r*.13, Math.sin(b)*sh.r*.13); }
      g.closePath(); g.fill();
    } else {
      g.rotate(ang);
      g.globalCompositeOperation='lighter';       // comet tail
      const tg=g.createLinearGradient(-sh.r*7,0,sh.r*1.5,0);
      tg.addColorStop(0, alpha(sh.col,0)); tg.addColorStop(1, alpha(sh.col,.55));
      g.fillStyle=tg;
      g.beginPath(); g.moveTo(-sh.r*7,0); g.lineTo(0,-sh.r*.85); g.lineTo(0,sh.r*.85); g.closePath(); g.fill();
      const cg=g.createRadialGradient(0,0,0,0,0,sh.r*2.6);
      cg.addColorStop(0, alpha('#ffffff',.95)); cg.addColorStop(.30, alpha(sh.col,.9));
      cg.addColorStop(1, alpha(sh.col,0));
      g.fillStyle=cg; g.beginPath(); g.arc(0,0,sh.r*2.6,0,7); g.fill();
      g.globalCompositeOperation='source-over';
      g.fillStyle='#fff';
      g.beginPath(); g.ellipse(0,0,sh.r*1.15,sh.r*.72,0,0,7); g.fill();
    }
    g.restore();
  }

  /* fx */
  for(const f of fx){
    if(f.t==='ring'){
      const a=clamp(f.life*2,0,1);
      g.save(); g.globalCompositeOperation='lighter';
      g.strokeStyle=alpha(f.col,a*.85); g.lineWidth=(f.thick||3)*(0.4+a);
      g.beginPath(); g.arc(f.x,f.y,f.r,0,7); g.stroke();
      g.strokeStyle=alpha('#ffffff',a*.5); g.lineWidth=(f.thick||3)*0.35;
      g.beginPath(); g.arc(f.x,f.y,f.r*0.96,0,7); g.stroke();
      g.restore();
    } else if(f.t==='txt'){
      const a=clamp(f.life*1.6,0,1);
      g.globalAlpha=a; g.textAlign='center';
      g.font='bold '+(f.big?16:13)+'px Verdana';
      g.lineJoin='round'; g.strokeStyle='rgba(0,0,0,.85)'; g.lineWidth=3.5;
      g.strokeText(f.txt,f.x,f.y);
      const tg=g.createLinearGradient(0,f.y-12,0,f.y+3);
      tg.addColorStop(0,'#ffffff'); tg.addColorStop(1,f.col);
      g.fillStyle=tg; g.fillText(f.txt,f.x,f.y); g.globalAlpha=1;
    } else if(f.t==='swing'){
      const a=clamp(f.life*6,0,1);
      g.save(); g.translate(f.x,f.y); g.rotate(f.a);
      const sg=g.createLinearGradient(0,-f.reach,0,f.reach);
      sg.addColorStop(0, alpha(f.col||'#fff',0)); sg.addColorStop(.5, alpha('#ffffff',a*.9));
      sg.addColorStop(1, alpha(f.col||'#fff',0));
      g.strokeStyle=sg; g.lineWidth=9*a+2; g.lineCap='round';
      g.beginPath(); g.arc(0,0,f.reach*.82,-f.arc/2,f.arc/2); g.stroke();
      g.strokeStyle=alpha('#ffffff',a*.5); g.lineWidth=2;
      g.beginPath(); g.arc(0,0,f.reach*.62,-f.arc/2.3,f.arc/2.3); g.stroke();
      g.lineCap='butt'; g.restore();
    } else if(f.t==='strike'){
      if(!f.done){
        // a tight contracting reticle, not a fog of circles
        const w=clamp(1-f.delay/0.5,0,1), r0=52*(1-w*0.42);
        g.save();
        g.strokeStyle=alpha(f.col,.22+w*.42); g.lineWidth=1.6;
        g.setLineDash([5,5]); g.lineDashOffset=-t*30;
        g.beginPath(); g.arc(f.x,f.y,r0,0,7); g.stroke();
        g.setLineDash([]);
        g.strokeStyle=alpha(f.col,.30+w*.5); g.lineWidth=2;
        for(let k=0;k<4;k++){                      // corner ticks
          const a=k*Math.PI/2+Math.PI/4;
          g.beginPath();
          g.moveTo(f.x+Math.cos(a)*r0*.72, f.y+Math.sin(a)*r0*.72);
          g.lineTo(f.x+Math.cos(a)*r0, f.y+Math.sin(a)*r0); g.stroke();
        }
        g.restore();
      } else {
        const a=clamp(f.life*2.4,0,1);
        g.save(); g.globalCompositeOperation='lighter';
        // jagged bolt with a branch
        const seed=(f.x*13+f.y*7)|0;
        for(const [lw,col,al] of [[9,f.col,.30],[4,f.col,.75],[1.6,'#ffffff',.95]]){
          g.strokeStyle=alpha(col,a*al); g.lineWidth=lw; g.lineCap='round';
          g.beginPath(); g.moveTo(f.x,f.y-300);
          let px=f.x, py=f.y-300;
          for(let i=1;i<=8;i++){
            const tt=i/8;
            px = f.x + Math.sin(seed+i*2.1)*22*(1-tt);
            py = f.y-300 + 300*tt;
            g.lineTo(px,py);
          }
          g.stroke();
        }
        g.strokeStyle=alpha('#ffffff',a*.5); g.lineWidth=1.4;
        g.beginPath(); g.moveTo(f.x+4,f.y-150); g.lineTo(f.x+24,f.y-118); g.lineTo(f.x+16,f.y-92); g.stroke();
        g.lineCap='butt';
        glowDot(g,f.x,f.y,70*a,f.col,.5*a);
        g.restore();
      }
    }
  }

  /* ambient motes — a little life in the air */
  const zNow = zoneAt(P.x,P.y);
  g.save(); g.globalCompositeOperation='lighter';
  const moteCol = zNow.id==='rift' ? '#c9a6ff' : zNow.id==='marsh' ? '#9dffcf'
                : zNow.id==='scrap' ? '#ffb27a' : zNow.id==='plaza' ? '#ffe6b0' : '#cddcff';
  for(let i=0;i<34;i++){
    const ph = t*0.22 + i*1.7;
    const mx = cam.x - VW/2 + ((i*137.5 + Math.sin(ph)*40) % (VW+80)) - 40;
    const my = cam.y - VH/2 + ((i*79.3 + t*11 + Math.cos(ph*.7)*26) % (VH+80)) - 40;
    const a = .12 + .16*Math.abs(Math.sin(ph*1.3));
    g.fillStyle = alpha(moteCol, a);
    g.beginPath(); g.arc(mx, my, 1.1 + (i%3)*.6, 0, 7); g.fill();
  }
  g.restore();

  /* interact prompt */
  const near = nearestInteract();
  if(near && P.alive){
    const label = near.type==='temple' ? 'ENTER '+heroById(near.o.heroId).temple.toUpperCase()
                : near.type==='forge'  ? 'OPEN THE FUSION FORGE' : 'READ THE BOUNTY BOARD';
    g.font='bold 12px Verdana'; g.textAlign='center';
    const w = g.measureText(label).width + 62;
    const bx = near.o.x - w/2, by = near.o.y - 136, bob2 = Math.sin(t*3)*2.5;
    g.save(); g.translate(0, bob2);
    g.fillStyle='rgba(8,11,18,.92)'; roundRect(bx, by, w, 32, 9); g.fill();
    g.strokeStyle='#ffcb45'; g.lineWidth=2; roundRect(bx, by, w, 32, 9); g.stroke();
    glowDot(g, near.o.x, by+16, 60, '#ffcb45', .16);
    g.fillStyle='#ffcb45'; roundRect(bx+9, by+8, 17, 16, 4); g.fill();
    g.fillStyle='#12151d'; g.fillText('E', bx+17.5, by+20);
    g.fillStyle='#ffe6a8'; g.fillText(label, near.o.x + 13, by+20);
    g.restore();
  }

  /* soft vignette so the edges of the screen settle down */
  g.restore();

  const vg = g.createRadialGradient(VW/2, VH/2, Math.min(VW,VH)*0.34, VW/2, VH/2, Math.max(VW,VH)*0.78);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(3,5,10,.55)');
  g.fillStyle=vg; g.fillRect(0,0,VW,VH);

  drawMinimap();
}

function roundRect(x,y,w,h,r){
  g.beginPath();
  g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r);
  g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath();
}

function drawTemple(tp){
  const h = heroById(tp.heroId), owned = !!S.heroes[h.id], active = S.hero===h.id;
  const x=tp.x, y=tp.y;
  const stone = owned ? '#4a5470' : '#333c52';
  const lit   = owned ? h.suit : '#39435d';

  groundShadow(g, x, y+8, 74, 22, .40);

  // stepped platform
  for(let i=0;i<3;i++){
    const w = 132 - i*14, hh = 9;
    part(g, x-w/2, y-2-i*hh, w, hh, i===0?darken(stone,14):stone, {r:3, lw:1.3});
  }
  // back wall
  part(g, x-38, y-104, 76, 78, darken(stone,22), {r:4, lw:1.4});
  // banner
  const bw=46, bh=64;
  const bg2 = g.createLinearGradient(x-bw/2, y-100, x+bw/2, y-36);
  bg2.addColorStop(0, lighten(lit,26)); bg2.addColorStop(.55, lit); bg2.addColorStop(1, darken(lit,30));
  g.fillStyle = bg2;
  g.beginPath();
  g.moveTo(x-bw/2, y-100); g.lineTo(x+bw/2, y-100); g.lineTo(x+bw/2, y-44);
  g.lineTo(x, y-34); g.lineTo(x-bw/2, y-44); g.closePath(); g.fill();
  g.strokeStyle = outlineFor(lit); g.lineWidth=1.3; g.stroke();
  g.fillStyle='rgba(255,255,255,.12)';
  g.beginPath(); g.moveTo(x-bw/2,y-100); g.lineTo(x-bw/2+13,y-100); g.lineTo(x-bw/2+7,y-40); g.lineTo(x-bw/2,y-44); g.closePath(); g.fill();

  // emblem
  const em = owned ? (h.glow||'#fff') : '#5a6580';
  g.fillStyle='rgba(0,0,0,.34)'; g.beginPath(); g.arc(x,y-72,13,0,7); g.fill();
  g.fillStyle=em; g.beginPath(); g.arc(x,y-72,8.5,0,7); g.fill();
  g.fillStyle='rgba(255,255,255,.75)'; g.beginPath(); g.arc(x-2.4,y-74.4,3,0,7); g.fill();
  if(owned) glowDot(g, x, y-72, 30, em, .45);

  // fluted columns
  for(const d of [-1,1]){
    const cx2 = x + d*46;
    part(g, cx2-11, y-30, 22, 9, lighten(stone,10), {r:2, lw:1.2});     // base
    part(g, cx2-8,  y-100, 16, 72, stone, {r:2, lw:1.2});               // shaft
    g.strokeStyle='rgba(0,0,0,.28)'; g.lineWidth=1;
    for(let i=-1;i<=1;i++){ g.beginPath(); g.moveTo(cx2+i*4, y-98); g.lineTo(cx2+i*4, y-32); g.stroke(); }
    part(g, cx2-12, y-110, 24, 11, lighten(stone,16), {r:2.5, lw:1.2});  // capital
  }

  // pediment
  const rc = active ? '#ffcb45' : (owned ? lighten(lit,10) : '#4c5771');
  g.beginPath(); g.moveTo(x-70,y-108); g.lineTo(x,y-150); g.lineTo(x+70,y-108); g.closePath();
  g.fillStyle = vGrad(g, rc+'roof', -150, -108, [[0,lighten(rc,26)],[1,darken(rc,26)]]);
  g.fill();
  g.strokeStyle = outlineFor(rc); g.lineWidth=1.4; g.stroke();
  g.fillStyle='rgba(0,0,0,.26)';
  g.beginPath(); g.moveTo(x,y-150); g.lineTo(x+70,y-108); g.lineTo(x,y-108); g.closePath(); g.fill();
  g.fillStyle = active?'rgba(255,236,180,.9)':'rgba(255,255,255,.18)';
  g.beginPath(); g.arc(x, y-122, 5, 0, 7); g.fill();

  // braziers
  if(owned){
    for(const d of [-1,1]){
      const bx2 = x + d*62, by2 = y-26;
      part(g, bx2-6, by2-8, 12, 9, '#3a4256', {r:2, lw:1});
      const fl = 6 + Math.sin(t*6 + d)*2.4;
      g.globalAlpha=.9;
      const fg = g.createRadialGradient(bx2, by2-10-fl*.4, 1, bx2, by2-10, fl*1.6);
      fg.addColorStop(0,'#fff2b0'); fg.addColorStop(.45,'#ffa02f'); fg.addColorStop(1,'rgba(255,90,20,0)');
      g.fillStyle=fg; g.beginPath(); g.arc(bx2, by2-10-fl*.3, fl*1.6, 0, 7); g.fill();
      g.globalAlpha=1;
      glowDot(g, bx2, by2-12, 34, '#ffa02f', .28);
    }
  }

  // hero statue on a plinth
  part(g, x-16, y-30, 32, 8, lighten(stone,6), {r:2, lw:1.1});
  drawFigure(g, x, y-30, {
    scale:.66, skin: owned ? '#c9d2e0' : '#8c96ab',
    suit: owned?h.suit:'#414b64', accent: owned?h.accent:'#4f5a76',
    trim: owned?h.trim:'#5b6683', glow: owned?h.glow:null,
    helmet:h.helmet, face:'determined', acc:'none', moving:false, walk:0, aimx:0
  });

  // plate
  g.textAlign='center';
  g.font='bold 12px Verdana';
  g.fillStyle='rgba(0,0,0,.5)'; g.fillText(h.name.toUpperCase(), x, y+37);
  g.fillStyle = active?'#ffcb45':(owned?'#e8edf7':'#7f8aa3');
  g.fillText(h.name.toUpperCase(), x, y+36);
  g.font='10px Verdana'; g.fillStyle='#7d89a5';
  g.fillText(owned ? (active?'\u2605 EQUIPPED':heroTierName(h,S.heroes[h.id].tier)) : h.temple, x, y+50);
}

function drawForge(){
  const x=FORGE.x, y=FORGE.y;
  groundShadow(g, x, y+4, 76, 26, .42);
  for(let i=0;i<3;i++) part(g, x-(66-i*13)/2, y-6-i*8, 66-i*13, 8, i?'#3d4763':'#333c52', {r:3, lw:1.2});
  // obelisk
  const og = g.createLinearGradient(x-16, y-110, x+16, y-16);
  og.addColorStop(0,'#6a5aa8'); og.addColorStop(.5,'#453a72'); og.addColorStop(1,'#2a2450');
  g.beginPath();
  g.moveTo(x-15,y-24); g.lineTo(x-8,y-96); g.lineTo(x,y-114);
  g.lineTo(x+8,y-96); g.lineTo(x+15,y-24); g.closePath();
  g.fillStyle=og; g.fill();
  g.strokeStyle='rgba(190,160,255,.5)'; g.lineWidth=1.3; g.stroke();
  g.strokeStyle='rgba(255,255,255,.16)'; g.lineWidth=1;
  g.beginPath(); g.moveTo(x-4,y-104); g.lineTo(x-10,y-28); g.stroke();
  // core
  const pulse = 10 + Math.sin(t*3)*1.8;
  g.fillStyle='#e6d6ff'; g.beginPath(); g.arc(x, y-64, pulse*.5, 0, 7); g.fill();
  glowDot(g, x, y-64, 46, '#b47bff', .75);
  // orbiting rings
  g.strokeStyle='rgba(190,140,255,.75)'; g.lineWidth=2;
  for(let i=0;i<3;i++){
    const a=t*1.1+i*2.1;
    g.beginPath();
    g.ellipse(x, y-64, 30+i*10, (11+i*4)*Math.abs(Math.cos(a))+3, a*0.4, 0, 7);
    g.stroke();
  }
  for(let i=0;i<7;i++){                       // motes spiralling in
    const a=t*1.7+i*.9, r=26+Math.sin(t*1.3+i)*13;
    g.fillStyle='rgba(220,190,255,.8)';
    g.beginPath(); g.arc(x+Math.cos(a)*r, y-64+Math.sin(a*1.3)*r*.42, 1.8, 0, 7); g.fill();
  }
  g.textAlign='center'; g.font='bold 12px Verdana';
  g.fillStyle='rgba(0,0,0,.5)'; g.fillText('FUSION FORGE', x, y+37);
  g.fillStyle='#c9a6ff'; g.fillText('FUSION FORGE', x, y+36);
}

function drawBoard(){
  const x=BOARD.x, y=BOARD.y;
  groundShadow(g, x, y+4, 56, 16, .38);
  part(g, x-7, y-42, 6, 42, '#4a3a24', {r:1.5, lw:1});
  part(g, x+1, y-42, 6, 42, '#4a3a24', {r:1.5, lw:1});
  // board
  part(g, x-60, y-102, 120, 64, '#6b5433', {r:4, lw:1.5});
  g.save(); roundRect(x-60,y-102,120,64,4); g.clip();
  g.strokeStyle='rgba(0,0,0,.22)'; g.lineWidth=1.4;
  for(let i=0;i<7;i++){ g.beginPath(); g.moveTo(x-60,y-100+i*9.5); g.lineTo(x+60,y-100+i*9.5); g.stroke(); }
  g.restore();
  // posters
  const live=(NET.online ? NET.world.bounties : []).slice(0,3);
  live.forEach((n,i)=>{
    const px = x-46+i*35, py = y-95;
    g.save(); g.translate(px+15, py+22); g.rotate((i-1)*0.05); g.translate(-15,-22);
    part(g, 0, 0, 30, 46, '#e8dfc6', {r:1, sheen:false, lw:.9});
    g.fillStyle='#8a1f1f'; g.font='bold 7px Verdana'; g.textAlign='center';
    g.fillText('WANTED', 15, 9);
    part(g, 4, 12, 22, 20, '#5b4a33', {r:1, sheen:false, lw:.8});
    drawFigure(g, 15, 31, {scale:.30, skin:'#c9a882', shirt:'#4a4a5a', pants:'#33333f',
                           face:'angry', acc:'none', helmet:'none', moving:false, walk:0, aimx:0});
    g.fillStyle='#8a1f1f'; g.font='bold 7px Verdana';
    g.fillText('$'+fmt(n.bounty), 15, 41);
    g.restore();
  });
  // lantern
  const lx = x+52, ly = y-104;
  part(g, lx-5, ly, 10, 12, '#3a4256', {r:2, lw:1});
  g.fillStyle='rgba(255,190,90,.9)'; g.beginPath(); g.arc(lx, ly+6, 3.2, 0, 7); g.fill();
  glowDot(g, lx, ly+6, 40, '#ffb84d', .30);

  g.textAlign='center'; g.font='bold 12px Verdana';
  g.fillStyle='rgba(0,0,0,.5)'; g.fillText('BOUNTY BOARD', x, y+25);
  g.fillStyle='#ffcb45'; g.fillText('BOUNTY BOARD', x, y+24);
}

function drawPlayer(){
  const h = curHero();
  const skin = (SKIN_COLORS.find(c=>c.id===S.look.skin)||SKIN_COLORS[0]).c;
  const shirt= (CLOTH_COLORS.find(c=>c.id===S.look.shirt)||CLOTH_COLORS[0]).c;
  const pants= (CLOTH_COLORS.find(c=>c.id===S.look.pants)||CLOTH_COLORS[1]).c;
  if(P.invT>0) g.globalAlpha = .58 + Math.sin(t*22)*.22;
  drawFigure(g, P.x, P.y, {
    scale:1, skin, shirt, pants, face:S.look.face, acc:S.look.acc,
    suit: h?h.suit:null, accent: h?h.accent:null, trim: h?h.trim:null,
    glow: h?h.glow:null, helmet: h?h.helmet:'none',
    moving:P.moving, walk:P.walk, aimx:P.aimx, flash:P.hitFlash>0?P.hitFlash*4:0
  });
  g.globalAlpha=1;

  // name plate
  const tag = S.name + (S.heat>0 ? '  \u2620$'+fmt(S.heat) : '');
  g.font='bold 11px Verdana'; g.textAlign='center';
  const tw = g.measureText(tag).width + 14;
  g.fillStyle='rgba(8,11,18,.62)'; roundRect(P.x-tw/2, P.y-74, tw, 16, 5); g.fill();
  g.fillStyle = S.heat>0 ? '#ffb4b4' : '#e8edf7';
  g.fillText(tag, P.x, P.y-62);

  if(P.buffT>0){                                   // shield bubble
    const r=32+Math.sin(t*8)*2.5;
    const gg=g.createRadialGradient(P.x,P.y-26,r*.5,P.x,P.y-26,r);
    gg.addColorStop(0,'rgba(157,196,255,0)'); gg.addColorStop(.75,'rgba(157,196,255,.14)');
    gg.addColorStop(1,'rgba(157,196,255,.55)');
    g.fillStyle=gg; g.beginPath(); g.arc(P.x,P.y-26,r,0,7); g.fill();
    g.strokeStyle='rgba(200,225,255,.75)'; g.lineWidth=1.6;
    g.beginPath(); g.arc(P.x,P.y-26,r,0,7); g.stroke();
  }
}

/* another human, live in the world */
function drawPeer(name, q){
  const h = heroById(q.hero);
  const L = q.look || {};
  const skin = (SKIN_COLORS.find(c=>c.id===L.skin)||SKIN_COLORS[0]).c;
  const shirt= (CLOTH_COLORS.find(c=>c.id===L.shirt)||CLOTH_COLORS[0]).c;
  const pants= (CLOTH_COLORS.find(c=>c.id===L.pants)||CLOTH_COLORS[1]).c;
  const safe = inSafe(q.x, q.y);

  drawFigure(g, q.x, q.y, {
    scale:1, skin, shirt, pants, face:L.face||'smile', acc:L.acc||'none',
    suit:h?h.suit:null, accent:h?h.accent:null, trim:h?h.trim:null,
    glow:h?h.glow:null, helmet:h?h.helmet:'none',
    moving:q.moving, walk:q.walk, aimx:q.aimx
  });

  // health
  const w=46, hp=clamp(q.hp/(q.max||1),0,1), yy=q.y-64;
  g.fillStyle='rgba(6,9,15,.72)'; roundRect(q.x-w/2-1.5, yy-1.5, w+3, 8, 4); g.fill();
  const bg=g.createLinearGradient(q.x-w/2,0,q.x+w/2,0);
  bg.addColorStop(0,'#5ac8ff'); bg.addColorStop(1,'#57e08a');
  g.fillStyle=bg; roundRect(q.x-w/2, yy, Math.max(2,w*hp), 5, 2.5); g.fill();

  // name plate — live players are marked so they read apart from AI
  let label = name + (q.bounty>0 ? '  \u2620$'+fmt(q.bounty) : '');
  g.font='bold 10px Verdana'; g.textAlign='center';
  const tw=g.measureText(label).width+26;
  g.fillStyle='rgba(6,9,15,.66)'; roundRect(q.x-tw/2, yy-17, tw, 14, 4); g.fill();
  g.fillStyle = safe ? '#8fe3ff' : (q.bounty>0 ? '#ffcb45' : '#9dffc0');
  g.beginPath(); g.arc(q.x-tw/2+8, yy-10, 3, 0, 7); g.fill();
  g.fillStyle = safe ? '#cfefff' : (q.bounty>0 ? '#ffe6a8' : '#dff7e6');
  g.fillText(label, q.x+4, yy-6);
  if(safe){                                   // a shield mark while they are protected
    g.strokeStyle='rgba(143,227,255,.5)'; g.lineWidth=1.4;
    g.beginPath(); g.arc(q.x, q.y-28, 30, 0, 7); g.stroke();
  }
}

function drawEnemy(e){
  const flash = e.hitFlash>0 ? e.hitFlash*4 : 0;
  if(e.kind==='npc'){
    drawFigure(g, e.x, e.y, {
      scale:1, skin:e.look.skin, shirt:e.hero.suit, pants:e.hero.accent, face:e.look.face,
      acc:e.look.acc, suit:e.hero.suit, accent:e.hero.accent, trim:e.hero.trim, glow:e.hero.glow,
      helmet:e.hero.helmet, moving:e.moving, walk:e.walk, aimx:e.aimx, flash
    });
  } else {
    const d = ENEMIES[e.type] || {};
    drawCreature(g, e.x, e.y, e.type, {
      scale: e.boss?1.24:(e.r>18?1.08:.94), col:e.col, acc:e.acc, eye:d.eye||'#ff6b5a',
      moving:e.moving, walk:e.walk, aimx:e.aimx, flash
    });
  }
  if(e.freeze>0){                                  // frozen in ice
    const h = e.boss?86:60;
    const gg=g.createLinearGradient(0,e.y-h,0,e.y+4);
    gg.addColorStop(0,'rgba(200,244,255,.42)'); gg.addColorStop(1,'rgba(120,200,240,.26)');
    g.fillStyle=gg;
    g.beginPath();
    g.moveTo(e.x-16,e.y+2); g.lineTo(e.x-13,e.y-h*.7); g.lineTo(e.x-4,e.y-h);
    g.lineTo(e.x+8,e.y-h*.82); g.lineTo(e.x+16,e.y-h*.3); g.lineTo(e.x+13,e.y+2);
    g.closePath(); g.fill();
    g.strokeStyle='rgba(230,250,255,.8)'; g.lineWidth=1.4; g.stroke();
  }

  // health bar
  const w = (e.boss?78:46), hp = clamp(e.hp/e.max,0,1);
  const yy = e.y - (e.boss?94:64);
  g.fillStyle='rgba(6,9,15,.72)'; roundRect(e.x-w/2-1.5, yy-1.5, w+3, 8, 4); g.fill();
  const bg = g.createLinearGradient(e.x-w/2, 0, e.x+w/2, 0);
  if(e.kind==='npc' && e.bounty>0){ bg.addColorStop(0,'#ffcb45'); bg.addColorStop(1,'#ff8f2f'); }
  else if(e.boss){ bg.addColorStop(0,'#b47bff'); bg.addColorStop(1,'#ff5ac8'); }
  else { bg.addColorStop(0,'#ff5a5a'); bg.addColorStop(1,'#ff9d6b'); }
  g.fillStyle=bg; roundRect(e.x-w/2, yy, Math.max(2,w*hp), 5, 2.5); g.fill();

  const showName = e.kind==='npc' || e.boss || Math.hypot(e.x-P.x,e.y-P.y)<230;
  if(showName){
    let label = e.name;
    if(e.kind==='npc' && e.bounty>0) label += '  \u2620$'+fmt(e.bounty);
    g.font='bold 10px Verdana'; g.textAlign='center';
    const tw=g.measureText(label).width+12;
    g.fillStyle='rgba(6,9,15,.6)'; roundRect(e.x-tw/2, yy-16, tw, 13, 4); g.fill();
    g.fillStyle = e.kind==='npc' ? (e.hunter?'#ff8080':'#ffcb45') : (e.boss?'#d8b4ff':'#c9d2e0');
    g.fillText(label, e.x, yy-6);
  }
}

function drawMinimap(){
  const W=mm.width, H=mm.height, sx=W/WORLD.w, sy=H/WORLD.h;
  mg.clearRect(0,0,W,H);
  mg.fillStyle='#0b0f18'; mg.fillRect(0,0,W,H);
  for(const z of ZONES){
    if(z.isBase) continue;
    mg.fillStyle = z.safe ? 'rgba(255,203,69,.22)' : 'rgba(255,90,90,.16)';
    mg.fillRect(z.x*sx, z.y*sy, z.w*sx, z.h*sy);
  }
  for(const tp of TEMPLES){
    mg.fillStyle = S.hero===tp.heroId ? '#ffcb45' : (S.heroes[tp.heroId]?'#8fa0bd':'#4a5674');
    mg.fillRect(tp.x*sx-1.5, tp.y*sy-1.5, 3, 3);
  }
  for(const e of ents){
    mg.fillStyle = e.kind==='npc' ? (e.hunter?'#ff5a5a':'#ffcb45') : '#ff8f6b';
    mg.fillRect(e.x*sx-1.4, e.y*sy-1.4, 2.8, 2.8);
  }
  for(const q of NET.peers.values()){
    mg.fillStyle = q.bounty>0 ? '#ffcb45' : '#5ac8ff';
    mg.beginPath(); mg.arc(q.x*sx, q.y*sy, 2.4, 0, 7); mg.fill();
  }
  mg.fillStyle='#57e08a'; mg.beginPath(); mg.arc(P.x*sx, P.y*sy, 3, 0, 7); mg.fill();
  mg.strokeStyle='rgba(255,255,255,.18)'; mg.lineWidth=1;
  mg.strokeRect((cam.x-VW/2)*sx,(cam.y-VH/2)*sy, VW*sx, VH*sy);
}

/* ============================================================
   INTERACT
   ============================================================ */
function nearestInteract(){
  if(!P) return null;
  let best=null, bd=105;
  for(const tp of TEMPLES){ const d=Math.hypot(tp.x-P.x,tp.y-P.y); if(d<bd){bd=d;best={type:'temple',o:tp};} }
  let d=Math.hypot(FORGE.x-P.x,FORGE.y-P.y); if(d<bd){bd=d;best={type:'forge',o:FORGE};}
  d=Math.hypot(BOARD.x-P.x,BOARD.y-P.y);     if(d<bd){bd=d;best={type:'board',o:BOARD};}
  return best;
}
function interact(){
  const n = nearestInteract(); if(!n) return;
  if(n.type==='temple') openPanel('temple', n.o.heroId);
  else if(n.type==='forge') openPanel('fusion');
  else openPanel('bounty');
}

/* ============================================================
   HUD
   ============================================================ */
const $ = id=>document.getElementById(id);
function hudSync(){
  $('hudCash').textContent = fmt(S.cash);
  $('hudCores').textContent = S.cores;
  $('hudHeat').textContent = fmt(S.heat);
  const h = curHero();
  $('hudHeroName').textContent = h ? h.name : 'No Hero';
  $('hudTierName').textContent = h ? (heroTierName(h,curTier())+'  ·  Tier '+(curTier()+1)+'/'+TIERS_PER_HERO)
                                   : 'Visit a temple to claim one';
  netBadge();
  const hp = P?clamp(P.hp/P.max,0,1):1;
  $('hpFill').style.width = (hp*100)+'%';
  $('hpText').textContent = Math.max(0,Math.ceil(P?P.hp:0))+' / '+(P?P.max:0);
  const ur = P&&P.ultT>0 ? 1-P.ultT/(P.ultMax||1) : 1;
  $('ultFill').style.width = (clamp(ur,0,1)*100)+'%';
  $('ultText').textContent = h ? (P&&P.ultT>0 ? h.ult.name+'  '+P.ultT.toFixed(1)+'s' : h.ult.name+'  [SPACE]') : '—';
  // portrait
  const pc = $('hudPortrait');
  if(pc.dataset.k !== (h?h.id+curTier():'none')){
    pc.dataset.k = h?h.id+curTier():'none';
    pc.style.background = h ? 'radial-gradient(circle at 50% 35%,'+h.accent+'55,'+h.suit+')' : '#222b3f';
  }
}
let toastT=0;
function toast(msg, kind){
  const el=document.createElement('div'); el.className='toast '+(kind||'');
  el.textContent=msg; $('toasts').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .4s'; setTimeout(()=>el.remove(),400); }, 2600);
  while($('toasts').children.length>4) $('toasts').firstChild.remove();
}
function feed(html){
  const el=document.createElement('div'); el.className='kf'; el.innerHTML=html;
  $('killfeed').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .5s'; setTimeout(()=>el.remove(),500); },7000);
  while($('killfeed').children.length>5) $('killfeed').firstChild.remove();
}

/* ---------- live multiplayer callbacks ---------- */
NET.onLive = function(count){
  netBadge();
  toast(count>1 ? ('Live: '+count+' players in the world right now.') : 'Live — you are the only one here so far.','good');
};
NET.onPeerEvent = function(kind, m){
  if(kind==='joined') feed('<b>'+esc(m.name)+'</b> entered the world');
};
NET.onHurt = function(from, dmg){
  if(!P || !P.alive) return;
  if(inSafe(P.x, P.y)) return;                 // the sanctuary holds
  P.lastAttacker = from;
  hurtPlayer(dmg, from, true);
};
NET.onKill = function(killer, victim){
  const me = NET.name || S.name;
  if(victim === me) return;              // our own death is announced locally
  feed('<b>'+esc(killer)+'</b> took down <b>'+esc(victim)+'</b>');
  if(killer === me) claimFrom(victim);   // we landed the last hit — collect
};
function claimFrom(victim){
  NET.claim(victim).then(r=>{
    if(!r || !r.ok) return;
    if(r.prize > 0){
      S.cash = Number(r.cash); S.heat = Number(r.bounty);
      toast('Bounty collected on '+victim+': +$'+fmt(r.prize),'good');
    } else {
      toast('You took down '+victim+', but they carried no bounty.','info');
    }
    hudSync();
  }).catch(()=>{});
}

/* ---------- events happening to other real players ---------- */
NET.onFeed = function(f){
  const A='<b>'+esc(f.actor)+'</b>', T=f.target?'<b>'+esc(f.target)+'</b>':'';
  if(f.kind==='bounty_placed')  feed(A+' funded <span class="badge">$'+fmt(f.amount)+'</span> on '+T);
  else if(f.kind==='bounty_claimed') feed(A+' collected <span class="badge">$'+fmt(f.amount)+'</span> from '+T);
  else if(f.kind==='fusion')    feed(A+' fused '+esc(f.detail||'two heroes'));
  else if(f.kind==='upgrade')   feed(A+' reached '+esc(f.detail||'a new tier'));
  else if(f.kind==='joined')    feed(A+' entered the plaza');
};
function esc(t){ return String(t==null?'':t).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Position goes out on a timer rather than from the render loop: a
   background tab throttles rAF hard, and a player who stops broadcasting
   would freeze in place on everyone else's screen while still being hittable. */
setInterval(() => {
  if(!running || !P || !P.alive || NET.liveState !== 'live') return;
  const h = curHero();
  NET.sendState({ x:Math.round(P.x), y:Math.round(P.y), w:+P.walk.toFixed(2),
                  m:P.moving?1:0, a:P.aimx, h:h?h.id:'', t:curTier(),
                  hp:Math.round(P.hp), mx:Math.round(P.max), b:S.heat, lk:S.look });
}, 90);

/* ============================================================
   LOOP
   ============================================================ */
function frame(ts){
  requestAnimationFrame(frame);
  if(!running) return;
  const dt = Math.min(0.05, (ts-last)/1000 || 0); last=ts;
  if(!overlayOpen() && P.alive) update(dt);
  else { mouse.wx = mouse.x+cam.x-VW/2; mouse.wy = mouse.y+cam.y-VH/2; }
  render();
}
requestAnimationFrame(frame);

/* ============================================================
   TASKS
   ============================================================ */
function taskProgress(tk){
  if(tk.key==='streak') return S.stats.streak;
  return Math.max(0, (S.counters[tk.key]||0) - tk.start);
}
function makeTask(){
  const tpl = pick(TASK_POOL);
  const scale = 1 + curTier()*0.35 + (S.stats.kills/120);
  const need = Math.max(1, Math.round(tpl.base * scale * rnd(0.85,1.3)));
  return {
    tid:Math.random().toString(36).slice(2,9), id:tpl.id, n:tpl.n,
    d:tpl.d.replace('%n', need).replace(/\{s\}/g, need===1?'':'s').replace(/\{y\}/g, need===1?'y':'ies'), key:tpl.key, need,
    start:(tpl.key==='streak'?0:(S.counters[tpl.key]||0)),
    cash:Math.round(tpl.cash*scale), cores:tpl.cores + (curTier()>4?1:0)
  };
}
function ensureTasks(){
  if(!S.tasks) S.tasks=[];
  while(S.tasks.length<4) S.tasks.push(makeTask());
}
function checkTasks(){
  for(const tk of S.tasks){
    if(!tk.notified && taskProgress(tk)>=tk.need){
      tk.notified=true; toast('Task ready to claim: '+tk.n,'good');
    }
  }
  if(panelOpen==='tasks') renderPanel('tasks');
}
function rerollTask(tid){
  const i=S.tasks.findIndex(x=>x.tid===tid); if(i<0) return;
  const old=S.tasks[i];
  let t2, guard=0;
  do { t2 = makeTask(); } while(t2.id===old.id && ++guard<8);
  S.tasks[i]=t2;
  toast('Task swapped for: '+t2.n,'info');
  save(); renderPanel('tasks');
}
function claimTask(tid){
  const i=S.tasks.findIndex(x=>x.tid===tid); if(i<0) return;
  const tk=S.tasks[i];
  if(taskProgress(tk)<tk.need) return;
  S.cash += tk.cash; S.cores += tk.cores; S.stats.earned += tk.cash;
  toast('Task complete: +$'+fmt(tk.cash)+'  +'+tk.cores+' ◈','good');
  S.tasks.splice(i,1); S.tasks.push(makeTask());
  save(); renderPanel('tasks'); hudSync();
}

/* ============================================================
   ECONOMY ACTIONS
   ============================================================ */
function heroClaimCost(){
  const n = Object.keys(S.heroes).length;
  return n===0 ? 0 : Math.round(1500*Math.pow(1.55,n-1)/50)*50;
}
function claimHero(id){
  if(S.heroes[id]){ equipHero(id); return; }
  const c = heroClaimCost();
  if(S.cash < c){ toast('Not enough credits ($'+fmt(c)+' needed)','bad'); return; }
  S.cash -= c; S.heroes[id] = {tier:0};
  toast('You claimed '+heroById(id).name+'!','good');
  equipHero(id); save();
}
function equipHero(key){
  S.hero = key;
  refreshPlayerStats(false);
  const h=curHero();
  if(h) toast('Equipped '+h.name+' — '+heroTierName(h,curTier()),'info');
  save(); renderPanel(panelOpen, panelArg); hudSync();
}
function upgradeCostFor(key){
  let tier, isFuse = key.startsWith('fuse:');
  tier = isFuse ? (fusedByUid(key.slice(5))||{tier:0}).tier : (S.heroes[key]||{tier:0}).tier;
  const nt = tier+1;
  if(nt>=TIERS_PER_HERO) return null;
  return {nt, cash:Math.round(tierCost(nt)*(isFuse?1.35:1)), cores:tierCores(nt)+(isFuse?1:0)};
}
function upgradeHero(key){
  const c = upgradeCostFor(key);
  if(!c){ toast('Already at the final tier.','bad'); return; }
  if(S.cash < c.cash){ toast('Need $'+fmt(c.cash)+'.','bad'); return; }
  if(S.cores < c.cores){ toast('Need '+c.cores+' ◈ Upgrade Cores — do tasks to earn them.','bad'); return; }
  S.cash -= c.cash; S.cores -= c.cores;
  let h;
  if(key.startsWith('fuse:')){ const f=fusedByUid(key.slice(5)); f.tier=c.nt; h=fusedAsHero(f); }
  else { S.heroes[key].tier = c.nt; h=heroById(key); }
  S.counters.upgrades++; checkTasks();
  toast('UPGRADED → '+heroTierName(h,c.nt),'good');
  if(c.nt === TIERS_PER_HERO-1) NET.announce('upgrade', h.name+' — '+heroTierName(h,c.nt));
  fxUpgradeBurst();
  if(S.hero===key) refreshPlayerStats(true);
  save(); renderPanel(panelOpen, panelArg); hudSync();
}
function fxUpgradeBurst(){
  if(!P) return;
  fx.push({t:'ring',x:P.x,y:P.y-24,r:6,max:160,col:'#ffcb45',life:.7,thick:6});
  for(let i=0;i<26;i++) parts.push({x:P.x,y:P.y-24,vx:rnd(-4,4),vy:rnd(-6,1),life:rnd(.5,1),max:1,col:'#ffcb45',size:rnd(2,5)});
}

/* ---------- fusion ---------- */
let fuseA=null, fuseB=null;
function ownedKeys(){
  return Object.keys(S.heroes).concat(S.fused.map(f=>'fuse:'+f.uid));
}
function keyToHero(k){ return k.startsWith('fuse:') ? fusedAsHero(fusedByUid(k.slice(5))) : heroById(k); }
function keyTier(k){ return k.startsWith('fuse:') ? (fusedByUid(k.slice(5))||{tier:0}).tier : (S.heroes[k]||{tier:0}).tier; }
function fuseName(a,b){
  const A=a.name.replace('Doctor ','').replace('Captain ','Cap ').split(/[\s-]/);
  const B=b.name.replace('Doctor ','').replace('Captain ','Cap ').split(/[\s-]/);
  let n = A[0] + ' ' + B[B.length-1];
  if(A[0]===B[B.length-1]) n = A[0]+' Omega';
  return n;
}
function fusionCost(){
  const base = 4200 + S.fused.length*3000;
  const tiers = (fuseA?keyTier(fuseA):0)+(fuseB?keyTier(fuseB):0);
  return {cash: base + tiers*750, cores: 3 + S.fused.length};
}
function doFuse(){
  if(!fuseA||!fuseB||fuseA===fuseB) return;
  const c = fusionCost();
  if(S.cash<c.cash){ toast('Fusion needs $'+fmt(c.cash),'bad'); return; }
  if(S.cores<c.cores){ toast('Fusion needs '+c.cores+' ◈','bad'); return; }
  const a=keyToHero(fuseA), b=keyToHero(fuseB), at=keyTier(fuseA), bt=keyTier(fuseB);
  const nameInput = document.getElementById('fuseName');
  const nm = (nameInput && nameInput.value.trim()) || fuseName(a,b);
  S.cash-=c.cash; S.cores-=c.cores;
  const f = {
    uid: Math.random().toString(36).slice(2,9), name:nm.slice(0,22),
    tagline:'A fusion of '+a.name+' and '+b.name+'.',
    a:a.name, b:b.name, at, bt, tier: clamp(Math.floor((at+bt)/2),0,TIERS_PER_HERO-1),
    suit:a.suit, accent:b.accent, trim:a.trim, glow:b.glow, helmet:a.helmet,
    hpM:+(((a.hpM+b.hpM)/2)*1.14).toFixed(3),
    dmgM:+(((a.dmgM+b.dmgM)/2)*1.16).toFixed(3),
    spdM:+(((a.spdM+b.spdM)/2)*1.06).toFixed(3),
    atk:a.atk, ult:b.ult
  };
  S.fused.push(f);
  toast('FUSION COMPLETE — '+f.name+' is born!','good');
  feed('<b>'+S.name+'</b> fused <b>'+a.name+'</b> + <b>'+b.name+'</b>');
  NET.announce('fusion', a.name+' + '+b.name+' into '+f.name);
  fuseA=fuseB=null; fxUpgradeBurst();
  equipHero('fuse:'+f.uid);
  save(); renderPanel('fusion');
}

/* ---------- shop ---------- */
function buy(cat, id){
  const lists = {acc:ACCESSORIES, trail:TRAILS, face:FACES, skin:SKIN_COLORS, cloth:CLOTH_COLORS};
  const item = lists[cat].find(x=>x.id===id); if(!item) return;
  const bucket = cat==='skin' ? 'skins' : cat==='cloth' ? 'cloths' : cat;
  if(S.owned[bucket].includes(id)){ toast('Already owned.','info'); return; }
  if(S.cash < item.p){ toast('Not enough credits.','bad'); return; }
  S.cash -= item.p; S.owned[bucket].push(id);
  toast('Purchased '+item.n+'!','good');
  save(); renderPanel(panelOpen); hudSync();
}
function equipLook(field, id){
  const bucket = field==='skin' ? 'skins' : (field==='shirt'||field==='pants') ? 'cloths' : field;
  if(!S.owned[bucket].includes(id)){ toast('Locked — buy it in the Shop.','bad'); return; }
  S.look[field]=id; save(); renderPanel(panelOpen); 
}

/* ---------- bounty board ---------- */
async function placeRealBounty(target, amt){
  if(!NET.online){ toast('Server offline — real bounties need a connection.','bad'); return; }
  if(S.cash < amt){ toast('Not enough credits.','bad'); return; }
  toast('Wiring $'+fmt(amt)+' to the board…','info');
  await cloudSync();                       // make sure the server sees your current credits
  try{
    const r = await NET.place(target, amt);
    S.cash = Number(r.cash); NET.applyWorld(r.world);
    toast('Bounty of $'+fmt(amt)+' placed on '+target,'good');
    save(); renderPanel('bounty'); hudSync();
  }catch(e){ toast(e.message || 'Could not place that bounty.','bad'); }
}

function placeBounty(name, amt){
  if(S.cash<amt){ toast('Not enough credits.','bad'); return; }
  const n=npcByName(name); if(!n) return;
  S.cash-=amt; n.bounty += amt; n.by='PLAYER';
  toast('Bounty of $'+fmt(amt)+' placed on '+name,'good');
  feed('<b>'+S.name+'</b> placed <span class="badge">$'+fmt(amt)+'</span> on <b>'+name+'</b>');
  save(); renderPanel('bounty'); hudSync();
}

/* ============================================================
   PANELS
   ============================================================ */
let panelOpen=null, panelArg=null;
const overlay=$('overlay'), panelBody=$('panelBody'), panelTitle=$('panelTitle');
function overlayOpen(){ return !overlay.classList.contains('hidden'); }
function openPanel(which, arg){
  panelOpen=which; panelArg=arg;
  overlay.classList.remove('hidden');
  renderPanel(which, arg);
}
function closePanel(){
  overlay.classList.add('hidden'); panelOpen=null; panelArg=null; save();
}
$('panelClose').onclick=closePanel;
overlay.addEventListener('mousedown',e=>{ if(e.target===overlay) closePanel(); });
document.querySelectorAll('.menu-btns button').forEach(b=>{
  b.onclick=()=>openPanel(b.dataset.panel);
});

/* preview canvases inside panels */
function mountFigures(){
  panelBody.querySelectorAll('canvas[data-fig]').forEach(c=>{
    const o = JSON.parse(c.dataset.fig);
    const cx = c.getContext('2d');
    const d = Math.min(devicePixelRatio||1,2);
    c.width = c.clientWidth*d; c.height = c.clientHeight*d;
    cx.setTransform(d,0,0,d,0,0);
    cx.clearRect(0,0,c.clientWidth,c.clientHeight);
    drawFigure(cx, c.clientWidth/2, c.clientHeight-10, o);
  });
}
function look(){
  return {
    skin:(SKIN_COLORS.find(c=>c.id===S.look.skin)||SKIN_COLORS[0]).c,
    shirt:(CLOTH_COLORS.find(c=>c.id===S.look.shirt)||CLOTH_COLORS[0]).c,
    pants:(CLOTH_COLORS.find(c=>c.id===S.look.pants)||CLOTH_COLORS[1]).c,
    face:S.look.face, acc:S.look.acc
  };
}
function figFor(h, opts){
  const L=look();
  return JSON.stringify(Object.assign({
    scale:1.25, skin:L.skin, shirt:L.shirt, pants:L.pants, face:L.face, acc:L.acc,
    suit:h?h.suit:null, accent:h?h.accent:null, trim:h?h.trim:null, glow:h?h.glow:null,
    helmet:h?h.helmet:'none', moving:false, walk:0, aimx:1
  }, opts||{}));
}
function statBar(h,t){
  const s=heroStats(h,t);
  return '<div class="stats"><span>HP <b>'+s.hp+'</b></span><span>DMG <b>'+s.dmg+'</b></span>'+
         '<span>SPD <b>'+s.spd+'</b></span><span>RATE <b>'+(1/s.cd).toFixed(2)+'x</b></span></div>';
}
function tierLadder(h, cur){
  let out='';
  for(let i=0;i<TIERS_PER_HERO;i++){
    const cls = i<cur?'done':(i===cur?'now':'');
    const s=heroStats(h,i);
    out+='<div class="tierline '+cls+'"><div class="num">'+(i+1)+'</div>'+
      '<div class="nm">'+h.tiers[i][0]+'<div class="st">'+h.tiers[i][1]+'</div></div>'+
      '<div class="st" style="text-align:right">'+s.hp+' HP · '+s.dmg+' DMG'+
      (i>cur?'<br><span class="price">$'+fmt(tierCost(i))+'</span> <span class="price cores">'+tierCores(i)+'◈</span>':'')+
      '</div></div>';
  }
  return out;
}

function renderPanel(which, arg){
  if(!which) return;
  panelOpen=which; panelArg=arg;
  let html='';
  switch(which){

  /* ---------------- TEMPLES ---------------- */
  case 'temples': {
    panelTitle.textContent='TEMPLES OF THE TWELVE';
    const cost=heroClaimCost();
    html += '<div class="note">Every temple holds a hero you can become. Your first claim is free — after that each new hero costs credits. Claiming never removes a hero you already own, and every hero keeps its own upgrade progress.<br>Next claim price: <b class="price">'+(cost?'$'+fmt(cost):'FREE')+'</b></div>';
    html += '<div class="grid g3">';
    for(const h of HEROES){
      const owned=!!S.heroes[h.id], tier=owned?S.heroes[h.id].tier:0, active=S.hero===h.id;
      html += '<div class="card '+(active?'sel':'')+' '+(owned?'':'locked')+'">'+
        '<canvas class="avatarbox" data-fig=\''+figFor(h,{scale:1.15})+'\'></canvas>'+
        '<h3>'+h.name+'</h3><div class="sub">'+h.temple+'</div>'+
        '<div class="desc">'+h.tagline+'</div>'+
        (owned?'<div class="sub">Now: <b>'+heroTierName(h,tier)+'</b> (T'+(tier+1)+')</div>':'')+
        statBar(h,tier)+
        '<div class="sub">⚡ '+h.ult.name+' — '+h.ult.desc+'</div>'+
        (active? '<button class="act owned" disabled>★ EQUIPPED</button>'
               : owned ? '<button class="act" data-a="equip" data-k="'+h.id+'">EQUIP</button>'
                       : '<button class="act" data-a="claim" data-k="'+h.id+'">CLAIM · '+(cost?'$'+fmt(cost):'FREE')+'</button>')+
        '<button class="act" data-a="temple" data-k="'+h.id+'">VIEW TIERS</button>'+
      '</div>';
    }
    html+='</div>';
    if(S.fused.length){
      html += '<div class="section-title">YOUR FUSIONS</div><div class="grid g3">';
      for(const f of S.fused){
        const h=fusedAsHero(f), active=S.hero==='fuse:'+f.uid;
        html += '<div class="card '+(active?'sel':'')+'">'+
          '<canvas class="avatarbox" data-fig=\''+figFor(h,{scale:1.15})+'\'></canvas>'+
          '<h3>'+h.name+'</h3><div class="sub">'+f.a+' + '+f.b+'</div>'+
          statBar(h,f.tier)+
          (active?'<button class="act owned" disabled>★ EQUIPPED</button>'
                 :'<button class="act" data-a="equip" data-k="fuse:'+f.uid+'">EQUIP</button>')+
        '</div>';
      }
      html+='</div>';
    }
    break;
  }

  /* ---------------- SINGLE TEMPLE ---------------- */
  case 'temple': {
    const h=heroById(arg)||HEROES[0];
    const owned=!!S.heroes[h.id], tier=owned?S.heroes[h.id].tier:0, active=S.hero===h.id;
    panelTitle.textContent=h.temple.toUpperCase();
    const cost=heroClaimCost();
    html += '<div style="display:flex;gap:20px;flex-wrap:wrap">'+
      '<div style="flex:0 0 240px">'+
        '<canvas class="avatarbox" style="height:186px" data-fig=\''+figFor(h,{scale:1.8})+'\'></canvas>'+
        '<h3 style="font-size:20px">'+h.name+'</h3>'+
        '<div class="sub">'+h.tagline+'</div>'+
        statBar(h,tier)+
        '<div class="desc">⚡ <b>'+h.ult.name+'</b><br>'+h.ult.desc+'<br><br>Attack style: <b>'+h.atk+'</b></div>'+
        (active?'<button class="act owned" disabled>★ EQUIPPED</button>'
          : owned?'<button class="act" data-a="equip" data-k="'+h.id+'">EQUIP THIS HERO</button>'
                 :'<button class="act" data-a="claim" data-k="'+h.id+'">CLAIM · '+(cost?'$'+fmt(cost):'FREE')+'</button>')+
        (owned?upgradeButton(h.id):'')+
      '</div>'+
      '<div style="flex:1;min-width:320px">'+
        '<div class="section-title">SUIT / FORM PROGRESSION</div>'+ tierLadder(h,tier)+
      '</div></div>';
    break;
  }

  /* ---------------- UPGRADE ---------------- */
  case 'upgrade': {
    panelTitle.textContent='UPGRADE BAY';
    html += '<div class="note">Upgrades cost <b class="price">credits</b> plus <b class="price cores">◈ Upgrade Cores</b>. Credits come from kills, bounties and drops; Cores come only from completing tasks — so keep the task board turning. Progression runs past the films: Mark 85 is only the halfway mark.</div>';
    const keys = ownedKeys();
    if(!keys.length) html += '<div class="note">You have no heroes yet. Walk into a temple in the plaza and press <b>E</b>.</div>';
    html += '<div class="grid g2">';
    for(const k of keys){
      const h=keyToHero(k), tier=keyTier(k), active=S.hero===k;
      const c=upgradeCostFor(k);
      html += '<div class="card '+(active?'sel':'')+'">'+
        '<div style="display:flex;gap:12px">'+
          '<canvas data-fig=\''+figFor(h,{scale:1.1})+'\' style="width:96px;height:120px;flex:0 0 96px;background:radial-gradient(circle at 50% 40%,#26314a,#151b29);border-radius:8px"></canvas>'+
          '<div style="flex:1">'+
            '<h3>'+h.name+'</h3><div class="sub">'+heroTierName(h,tier)+' · Tier '+(tier+1)+'/'+TIERS_PER_HERO+'</div>'+
            statBar(h,tier)+
            (c? '<div class="sub">Next: <b>'+heroTierName(h,c.nt)+'</b></div>'+
                '<div class="stats"><span class="price">$'+fmt(c.cash)+'</span><span class="price cores">'+c.cores+' ◈</span></div>'
              : '<div class="sub" style="color:var(--gold)">MAX TIER REACHED</div>')+
          '</div>'+
        '</div>'+
        (c?'<button class="act" data-a="upg" data-k="'+k+'" '+((S.cash>=c.cash&&S.cores>=c.cores)?'':'disabled')+'>UPGRADE → '+heroTierName(h,c.nt)+'</button>':'')+
        (active?'':'<button class="act" data-a="equip" data-k="'+k+'">EQUIP</button>')+
        '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--dim)">Full tier ladder</summary>'+tierLadder(h,tier)+'</details>'+
      '</div>';
    }
    html+='</div>';
    break;
  }

  /* ---------------- FUSION ---------------- */
  case 'fusion': {
    panelTitle.textContent='FUSION FORGE';
    const keys=ownedKeys();
    const c=fusionCost();
    html += '<div class="note">Fusing binds two heroes you own into a brand-new hero with the <b>attack style of the first</b> and the <b>ultimate of the second</b>, plus blended stats and colours. <b>Both original heroes stay exactly as they are</b> — nothing is consumed but credits and cores. Fusions can be fused again.</div>';
    html += '<div class="fusebay">'+
      slotHTML('A',fuseA)+'<div class="fusesym">✚</div>'+slotHTML('B',fuseB)+
      '<div class="fusesym">➜</div>'+
      '<div class="fuseslot '+((fuseA&&fuseB&&fuseA!==fuseB)?'filled':'')+'">'+
        (fuseA&&fuseB&&fuseA!==fuseB
          ? '<canvas data-fig=\''+figFor({suit:keyToHero(fuseA).suit,accent:keyToHero(fuseB).accent,trim:keyToHero(fuseA).trim,glow:keyToHero(fuseB).glow,helmet:keyToHero(fuseA).helmet},{scale:1.05})+'\' style="width:100%;height:110px"></canvas>'+
            '<small>RESULT</small>'
          : '<small>PICK TWO</small>')+
      '</div></div>';
    if(fuseA&&fuseB&&fuseA!==fuseB){
      const a=keyToHero(fuseA), b=keyToHero(fuseB);
      html += '<div style="text-align:center;margin-bottom:14px">'+
        '<input id="fuseName" maxlength="22" placeholder="'+fuseName(a,b)+'" style="background:#0b1018;border:2px solid var(--line);border-radius:9px;color:var(--ink);padding:10px 14px;font:14px Verdana;text-align:center;width:280px">'+
        '<div class="sub" style="margin-top:8px">Attack: <b>'+a.atk+'</b> (from '+a.name+') &nbsp;·&nbsp; Ultimate: <b>'+b.ult.name+'</b> (from '+b.name+')</div>'+
        '<div class="stats" style="justify-content:center"><span class="price">$'+fmt(c.cash)+'</span><span class="price cores">'+c.cores+' ◈</span></div>'+
        '<button class="act" style="max-width:300px;margin:8px auto" data-a="fuse" '+((S.cash>=c.cash&&S.cores>=c.cores)?'':'disabled')+'>FUSE THEM</button>'+
      '</div>';
    }
    html += '<div class="section-title">CHOOSE FUSION MATERIAL</div><div class="grid g4">';
    for(const k of keys){
      const h=keyToHero(k), tier=keyTier(k);
      const sel = k===fuseA?'A':(k===fuseB?'B':'');
      html += '<div class="card '+(sel?'sel':'')+'" data-a="pickfuse" data-k="'+k+'" style="cursor:pointer">'+
        '<canvas data-fig=\''+figFor(h,{scale:.95})+'\' style="width:100%;height:96px" ></canvas>'+
        '<h3 style="font-size:12px">'+h.name+(sel?' ['+sel+']':'')+'</h3>'+
        '<div class="sub">T'+(tier+1)+' · '+heroTierName(h,tier)+'</div></div>';
    }
    html+='</div>';
    if(!keys.length) html+='<div class="note">Claim at least two heroes first.</div>';
    if(S.fused.length){
      html += '<div class="section-title">EXISTING FUSIONS</div><div class="grid g3">';
      for(const f of S.fused){
        const h=fusedAsHero(f), active=S.hero==='fuse:'+f.uid, c2=upgradeCostFor('fuse:'+f.uid);
        html += '<div class="card '+(active?'sel':'')+'">'+
          '<canvas class="avatarbox" data-fig=\''+figFor(h,{scale:1.15})+'\'></canvas>'+
          '<h3>'+h.name+'</h3><div class="sub">'+f.a+' + '+f.b+' · Tier '+(f.tier+1)+'</div>'+
          statBar(h,f.tier)+
          '<div class="sub">⚡ '+h.ult.name+'</div>'+
          (active?'<button class="act owned" disabled>★ EQUIPPED</button>'
                 :'<button class="act" data-a="equip" data-k="fuse:'+f.uid+'">EQUIP</button>')+
          (c2?'<button class="act" data-a="upg" data-k="fuse:'+f.uid+'" '+((S.cash>=c2.cash&&S.cores>=c2.cores)?'':'disabled')+'>UPGRADE · $'+fmt(c2.cash)+' + '+c2.cores+'◈</button>':'')+
        '</div>';
      }
      html+='</div>';
    }
    break;
  }

  /* ---------------- TASKS ---------------- */
  case 'tasks': {
    panelTitle.textContent='TASK BOARD';
    ensureTasks();
    html += '<div class="note">Tasks pay <b class="price">credits</b> and <b class="price cores">◈ Upgrade Cores</b> — cores are the only way to advance a suit tier. Finished tasks are replaced immediately, and any task you cannot finish right now can be swapped for another.</div>';
    for(const tk of S.tasks){
      const pr=taskProgress(tk), done=pr>=tk.need;
      html += '<div class="taskrow '+(done?'ready':'')+'">'+
        '<div class="ti"><div class="tn">'+tk.n+'</div><div class="td">'+tk.d+'</div>'+
        '<div class="pbar"><i style="width:'+clamp(pr/tk.need*100,0,100)+'%"></i></div>'+
        '<div class="td">'+Math.min(pr,tk.need)+' / '+tk.need+'</div></div>'+
        '<div class="rw"><div class="price">$'+fmt(tk.cash)+'</div><div class="price cores">'+tk.cores+' ◈</div>'+
        '<button class="act" data-a="claimtask" data-k="'+tk.tid+'" '+(done?'':'disabled')+'>'+(done?'CLAIM':'IN PROGRESS')+'</button>'+
        (done?'':'<button class="act" style="margin-top:4px;padding:5px;font-size:10px" data-a="reroll" data-k="'+tk.tid+'">SWAP TASK</button>')+
        '</div>'+
      '</div>';
    }
    html += '<div class="section-title">LIFETIME</div>'+
      '<div class="stats"><span>Kills <b>'+S.stats.kills+'</b></span><span>Deaths <b>'+S.stats.deaths+'</b></span>'+
      '<span>Best streak <b>'+S.stats.best+'</b></span><span>Earned <b>$'+fmt(S.stats.earned)+'</b></span>'+
      '<span>Upgrades <b>'+S.counters.upgrades+'</b></span><span>Ultimates <b>'+S.counters.ults+'</b></span></div>';
    break;
  }

  /* ---------------- BOUNTY ---------------- */
  case 'bounty': {
    panelTitle.textContent='BOUNTY BOARD';
    html += '<div class="note">Players who rob others get a price on their head. Kill a bountied player and you take their bounty — but robbing them puts a bounty on <b>you</b>, and hunters will come. Dying wipes your bounty and 25% of your credits. You can also fund a bounty yourself to send everyone after a name.</div>';
    html += '<div class="stats" style="margin-bottom:14px"><span>Your bounty <b style="color:var(--red)">$'+fmt(S.heat)+'</b></span>'+
            '<span>Bounties claimed <b>'+S.counters.killBounty+'</b></span>'+
            '<span>Credits <b class="price">$'+fmt(S.cash)+'</b></span></div>';
    /* ---- real players, straight from the shared database ---- */
    if(NET.online){
      const rb = NET.world.bounties || [];
      html += '<div class="section-title">LIVE BOUNTIES — REAL PLAYERS</div>';
      if(!rb.length){
        html += '<div class="note">Nobody else is carrying a bounty right now. Fund one below, or go rob someone and watch your own name appear on every other player\'s board.</div>';
      } else {
        html += '<table class="lb"><tr><th>PLAYER</th><th>HERO</th><th>KILLS</th><th>BOUNTY</th><th>FUND MORE</th></tr>';
        for(const r of rb){
          const h = heroById(r.hero);
          html += '<tr><td><b>'+esc(r.name)+'</b></td>'+
            '<td>'+esc(r.hero_name || (h?h.name:'—'))+' T'+((r.hero_tier|0)+1)+'</td>'+
            '<td>'+(r.kills|0)+'</td>'+
            '<td><span class="badge">$'+fmt(r.bounty)+'</span></td>'+
            '<td><button class="act" style="margin:0;padding:5px 8px;width:auto" data-a="rbounty" data-k="'+esc(r.name)+'" data-v="1000">+$1,000</button> '+
                '<button class="act" style="margin:0;padding:5px 8px;width:auto" data-a="rbounty" data-k="'+esc(r.name)+'" data-v="5000">+$5,000</button></td></tr>';
        }
        html += '</table>';
        html += '<div class="note">These are other people\'s characters. They spawn in the danger zones wearing their own suit and colours — take one down and the credits move from their board to your wallet.</div>';
      }
      const lb = NET.world.leaderboard || [];
      if(lb.length){
        html += '<div class="section-title">SERVER LEADERBOARD</div>';
        html += '<table class="lb"><tr><th>#</th><th>PLAYER</th><th>HERO</th><th>KILLS</th><th>DEATHS</th><th>BEST STREAK</th><th>CREDITS</th><th>FUND A BOUNTY</th></tr>';
        lb.forEach((r,i)=>{
          const me = r.name.toLowerCase()===(NET.name||'').toLowerCase();
          html += '<tr'+(me?' class="me"':'')+'><td>'+(i+1)+'</td><td><b>'+esc(r.name)+'</b>'+(me?' (you)':'')+'</td>'+
            '<td>'+esc(r.hero_name||'—')+' T'+((r.hero_tier|0)+1)+'</td><td>'+(r.kills|0)+'</td><td>'+(r.deaths|0)+'</td>'+
            '<td>'+(r.best_streak|0)+'</td><td class="price">$'+fmt(r.cash)+'</td>'+
            '<td>'+(me?'—':'<button class="act" style="margin:0;padding:5px 8px;width:auto" data-a="rbounty" data-k="'+esc(r.name)+'" data-v="1000">+$1,000</button>')+'</td></tr>';
        });
        html += '</table>';
      }
    } else {
      html += '<div class="note" style="border-left-color:var(--red)">Offline — you are playing this browser\'s local save, so the board below is simulated. Connect to the server to see real players, fund real bounties and appear on the leaderboard.</div>';
    }

    if(!NET.online){
      html += '<div class="note">Bounties are carried by real players only, so you need a connection to see them.</div>';
    }
    break;
  }

  /* ---------------- SHOP ---------------- */
  case 'shop': {
    panelTitle.textContent='THE SHOP';
    html += '<div class="note">Cosmetics bought here unlock in <b>Avatar</b> settings. They are pure style — they never change your stats.</div>';
    html += shopSection('ACCESSORIES', ACCESSORIES, 'acc');
    html += shopSection('TRAILS', TRAILS, 'trail');
    html += shopSection('EXPRESSIONS', FACES, 'face');
    html += shopSection('SKIN COLOURS', SKIN_COLORS, 'skin');
    html += shopSection('CLOTHING COLOURS', CLOTH_COLORS, 'cloth');
    break;
  }

  /* ---------------- SETTINGS / AVATAR ---------------- */
  case 'settings': {
    panelTitle.textContent='AVATAR SETTINGS';
    const h=curHero();
    html += '<div style="display:flex;gap:22px;flex-wrap:wrap">'+
      '<div style="flex:0 0 250px">'+
        '<canvas class="avatarbox" style="height:250px" data-fig=\''+figFor(h,{scale:2.2})+'\'></canvas>'+
        '<div class="sub" style="text-align:center">'+(h?h.name+' — '+heroTierName(h,curTier()):'No hero equipped')+'</div>'+
        '<div class="section-title">NAME</div>'+
        '<input id="nameInput" maxlength="16" value="'+S.name.replace(/"/g,'')+'" style="width:100%;background:#0b1018;border:2px solid var(--line);border-radius:9px;color:var(--ink);padding:9px;font:13px Verdana;text-align:center">'+
        '<button class="act" data-a="rename">SAVE NAME</button>'+
        '<div class="note" style="margin-top:12px">Your suit colours come from the hero you have equipped. Skin, expression, accessory and trail are always yours.</div>'+
      '</div>'+
      '<div style="flex:1;min-width:330px">'+
        lookSection('SKIN', SKIN_COLORS, 'skin')+
        lookSection('SHIRT / BASE COLOUR', CLOTH_COLORS, 'shirt')+
        lookSection('TROUSERS', CLOTH_COLORS, 'pants')+
        pickSection('ACCESSORY', ACCESSORIES, 'acc', 'acc')+
        pickSection('TRAIL', TRAILS, 'trail', 'trail')+
        pickSection('EXPRESSION', FACES, 'face', 'face')+
      '</div></div>';
    break;
  }
  }
  panelBody.innerHTML=html;
  mountFigures();
}

function upgradeButton(k){
  const c=upgradeCostFor(k); if(!c) return '<button class="act owned" disabled>MAX TIER</button>';
  const h=keyToHero(k);
  return '<button class="act" data-a="upg" data-k="'+k+'" '+((S.cash>=c.cash&&S.cores>=c.cores)?'':'disabled')+'>'+
    'UPGRADE → '+heroTierName(h,c.nt)+'<br><span class="price">$'+fmt(c.cash)+'</span> <span class="price cores">'+c.cores+'◈</span></button>';
}
function slotHTML(letter, k){
  if(!k) return '<div class="fuseslot" ><div class="fusesym">?</div><small>SLOT '+letter+'</small></div>';
  const h=keyToHero(k);
  return '<div class="fuseslot filled"><canvas data-fig=\''+figFor(h,{scale:1.05})+'\' style="width:100%;height:110px"></canvas>'+
         '<small>'+h.name.toUpperCase()+'</small></div>';
}
function shopSection(title, list, cat){
  const bucket = cat==='skin' ? 'skins' : cat==='cloth' ? 'cloths' : cat;
  let out='<div class="section-title">'+title+'</div><div class="grid g4">';
  for(const it of list){
    if(it.p===0) continue;
    const owned=S.owned[bucket].includes(it.id);
    const prev = (cat==='skin')  ? figFor(curHero(),{scale:1.0, skin:it.c}) :
                 (cat==='cloth') ? figFor(null,{scale:1.0, shirt:it.c, pants:it.c, suit:null, helmet:'none'}) :
                 (cat==='acc')   ? figFor(curHero(),{scale:1.0, acc:it.id}) :
                 (cat==='face')  ? figFor(null,{scale:1.0, face:it.id, helmet:'none'}) :
                                   figFor(curHero(),{scale:1.0});
    out += '<div class="card '+(owned?'':'')+'">'+
      '<canvas data-fig=\''+prev+'\' style="width:100%;height:104px"></canvas>'+
      '<h3 style="font-size:12px">'+it.n+'</h3>'+
      (cat==='trail'?'<div class="sub" style="color:'+(it.c==='rainbow'?'#ff7bd5':it.c)+'">●●● trail</div>':'<div class="sub"></div>')+
      (owned ? '<button class="act owned" disabled>OWNED</button>'
             : '<button class="act" data-a="buy" data-cat="'+cat+'" data-k="'+it.id+'" '+(S.cash>=it.p?'':'disabled')+'>$'+fmt(it.p)+'</button>')+
    '</div>';
  }
  return out+'</div>';
}
function lookSection(title, list, field){
  const bucket = field==='skin' ? 'skins' : 'cloths';
  let out='<div class="section-title">'+title+'</div><div class="swatches">';
  for(const c of list){
    const owned=S.owned[bucket].includes(c.id);
    out += '<div class="sw '+(S.look[field]===c.id?'sel':'')+' '+(owned?'':'lock')+'" '+
      'style="background:'+c.c+(c.shine?';box-shadow:inset 0 0 10px rgba(255,255,255,.6)':'')+'" '+
      'title="'+c.n+(owned?'':' — $'+fmt(c.p)+' in Shop')+'" '+
      'data-a="'+(owned?'look':'noown')+'" data-f="'+field+'" data-k="'+c.id+'"></div>';
  }
  return out+'</div>';
}
function pickSection(title, list, field, bucket){
  let out='<div class="section-title">'+title+'</div><div class="grid g4">';
  for(const it of list){
    const owned=S.owned[bucket].includes(it.id);
    const sel=S.look[field]===it.id;
    out += '<div class="card '+(sel?'sel':'')+' '+(owned?'':'locked')+'" style="padding:8px;cursor:pointer" '+
      'data-a="'+(owned?'look':'noown')+'" data-f="'+field+'" data-k="'+it.id+'">'+
      '<div style="font-size:11px;font-weight:bold">'+it.n+'</div>'+
      '<div class="sub" style="min-height:0">'+(owned?(sel?'equipped':'tap to wear'):'$'+fmt(it.p)+' in Shop')+'</div></div>';
  }
  return out+'</div>';
}

/* panel event delegation */
panelBody.addEventListener('click', e=>{
  const el = e.target.closest('[data-a]'); if(!el) return;
  const a=el.dataset.a, k=el.dataset.k;
  switch(a){
    case 'claim': claimHero(k); break;
    case 'equip': equipHero(k); break;
    case 'temple': openPanel('temple',k); break;
    case 'upg': upgradeHero(k); break;
    case 'buy': buy(el.dataset.cat,k); break;
    case 'look': equipLook(el.dataset.f,k); break;
    case 'noown': toast('Locked — buy it in the Shop.','bad'); break;
    case 'claimtask': claimTask(k); break;
    case 'reroll': rerollTask(k); break;
    case 'rbounty': placeRealBounty(k, +el.dataset.v); break;
    case 'pickfuse':
      if(fuseA===k) fuseA=null;
      else if(fuseB===k) fuseB=null;
      else if(!fuseA) fuseA=k;
      else if(!fuseB) fuseB=k;
      else { fuseA=fuseB; fuseB=k; }
      renderPanel('fusion'); break;
    case 'fuse': doFuse(); break;
    case 'rename': {
      const v=document.getElementById('nameInput').value.trim();
      if(v){ S.name=v.slice(0,16); toast('Name set to '+S.name,'good'); save(); }
      break;
    }
  }
});

/* ============================================================
   BOOT
   ============================================================ */
async function startGame(){
  const typed = (document.getElementById('playerName').value.trim() || S.name || 'Hero');
  S.name = typed.slice(0,16);
  ensureTasks();
  P = makePlayer(); refreshPlayerStats(false);
  cam.x=P.x; cam.y=P.y;
  document.getElementById('start').classList.add('hidden');
  running=true; last=performance.now();
  hudSync(); save(); netBadge();
  if(!S.hero) toast('Walk to a temple and press E to claim your first hero — it is free.','info');
  else toast('Welcome back, '+S.name+'.','info');

  // cloud session (the game is already playable; this just upgrades it)
  const netName = S.name.replace(/[^A-Za-z0-9_\-]/g,'_').slice(0,16).padEnd(3,'x');
  const d = await NET.session(netName);
  netBadge();
  if(!d){
    if(NET.status==='taken') toast('"'+netName+'" belongs to another player — playing locally. Pick a new name to go online.','bad');
    return;
  }
  if(d.state && Number(d.state.playtime||0) > Number(S.playtime||0) + 5){
    const f = freshState();
    S = Object.assign(f, d.state);
    S.look = Object.assign(f.look, d.state.look||{});
    S.owned = Object.assign(f.owned, d.state.owned||{});
    S.counters = Object.assign(f.counters, d.state.counters||{});
    S.stats = Object.assign(f.stats, d.state.stats||{});
    S.name = typed.slice(0,16);
    ensureTasks();
    P = makePlayer(); refreshPlayerStats(false);
    P.x=CENTER.x; P.y=CENTER.y+120; cam.x=P.x; cam.y=P.y;
    toast('Cloud save restored.','good');
  }
  S.heat = Number(d.player.bounty)||0; S.heatPending = 0;
  NET.connectLive();
  toast('Connected — the bounty board is shared with every other player.','good');
  hudSync(); save();
}
document.getElementById('btnPlay').onclick=startGame;
document.getElementById('playerName').addEventListener('keydown',e=>{ if(e.key==='Enter') startGame(); });
document.getElementById('btnRespawn').onclick=respawn;
document.getElementById('btnWipe').onclick=()=>{
  localStorage.removeItem(SAVE_KEY); S=freshState(); ensureTasks();
  document.getElementById('playerName').value='';
  alert('Save wiped.');
};
(function boot(){
  const had = load();
  ensureTasks();
  if(had) document.getElementById('playerName').value = S.name;
  P = makePlayer();
  hudSync();
})();
addEventListener('beforeunload', save);
