/* ============================================================
   TEMPLE OF HEROES — graphics layer
   Colour maths, cached gradients, baked textures, and every
   character / creature / prop drawing routine.
   ============================================================ */
'use strict';

/* ---------- colour ---------- */
function parseColor(c){
  if(!c) return [136,136,136];
  if(Array.isArray(c)) return c;
  c = String(c).trim();
  if(c[0] === '#'){
    if(c.length === 4) return [parseInt(c[1]+c[1],16), parseInt(c[2]+c[2],16), parseInt(c[3]+c[3],16)];
    return [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if(m){ const p = m[1].split(',').map(Number); return [p[0]|0, p[1]|0, p[2]|0]; }
  return [136,136,136];
}
const _cl = v => v < 0 ? 0 : v > 255 ? 255 : v|0;
function rgb(r,g2,b,a){ return a==null ? 'rgb('+_cl(r)+','+_cl(g2)+','+_cl(b)+')'
                                       : 'rgba('+_cl(r)+','+_cl(g2)+','+_cl(b)+','+a+')'; }
function lighten(c, amt){ const p = parseColor(c); return rgb(p[0]+amt, p[1]+amt, p[2]+amt); }
function darken(c, amt){  const p = parseColor(c); return rgb(p[0]-amt, p[1]-amt, p[2]-amt); }
function alpha(c, a){     const p = parseColor(c); return rgb(p[0], p[1], p[2], a); }
function mixCol(a, b, t){
  const x = parseColor(a), y = parseColor(b);
  return rgb(x[0]+(y[0]-x[0])*t, x[1]+(y[1]-x[1])*t, x[2]+(y[2]-x[2])*t);
}
/* perceived brightness 0..1 */
function lum(c){ const p = parseColor(c); return (0.299*p[0] + 0.587*p[1] + 0.114*p[2]) / 255; }
/* an outline that stays visible whether the fill is near-black or near-white */
function outlineFor(c){ return lum(c) < 0.30 ? alpha(lighten(c, 78), 0.85) : alpha(darken(c, 62), 0.85); }
/* never let a body colour sink into the background */
function readable(c, floor){
  const l = lum(c), f = floor == null ? 0.16 : floor;
  return l >= f ? c : mixCol(c, '#b9c4d8', (f - l) / Math.max(f, 0.001) * 0.62);
}

/* ---------- cached linear gradients (per canvas context) ---------- */
const _gradCache = new WeakMap();
function vGrad(ctx, key, y0, y1, stops){
  let m = _gradCache.get(ctx);
  if(!m){ m = new Map(); _gradCache.set(ctx, m); }
  const k = key + '|' + y0.toFixed(1) + '|' + y1.toFixed(1);
  let g2 = m.get(k);
  if(!g2){
    g2 = ctx.createLinearGradient(0, y0, 0, y1);
    for(const s of stops) g2.addColorStop(s[0], s[1]);
    m.set(k, g2);
    if(m.size > 600) m.clear();
  }
  return g2;
}

/* ---------- shapes ---------- */
function rr(ctx, x, y, w, h, r){
  const rad = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+rad, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rad);
  ctx.arcTo(x+w, y+h, x,   y+h, rad);
  ctx.arcTo(x,   y+h, x,   y,   rad);
  ctx.arcTo(x,   y,   x+w, y,   rad);
  ctx.closePath();
}

/* A body part: gradient fill, top sheen, contrast-aware outline.
   opts: {r, sheen, outline, light} */
function part(ctx, x, y, w, h, col, opts){
  const o = opts || {};
  const base = o.raw ? col : readable(col, o.floor);
  const r = o.r == null ? Math.min(w, h) * 0.30 : o.r;
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = vGrad(ctx, base, y, y + h, [
    [0,   lighten(base, o.light == null ? 26 : o.light)],
    [0.42, base],
    [1,   darken(base, 30)]
  ]);
  ctx.fill();

  if(o.sheen !== false){                       // light catches the upper-left
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    rr(ctx, x + w*0.06, y + h*0.04, w*0.36, h*0.52, r*0.7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.fillRect(x, y + h*0.74, w, h*0.26);
    ctx.restore();
  }
  if(o.outline !== false){
    rr(ctx, x, y, w, h, r);
    ctx.strokeStyle = outlineFor(base);
    ctx.lineWidth = o.lw == null ? 1.15 : o.lw;
    ctx.stroke();
  }
  return base;
}

/* soft contact shadow */
function groundShadow(ctx, x, y, rx, ry, a){
  const g2 = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g2.addColorStop(0,   'rgba(0,0,0,' + (a == null ? .40 : a) + ')');
  g2.addColorStop(0.6, 'rgba(0,0,0,' + (a == null ? .18 : a*0.45) + ')');
  g2.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.translate(-x, -y);
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, rx, 0, 7); ctx.fill();
  ctx.restore();
}

/* glow blob, drawn additively */
function glowDot(ctx, x, y, r, col, strength){
  const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
  g2.addColorStop(0,   alpha(col, (strength == null ? .95 : strength)));
  g2.addColorStop(0.35,alpha(col, (strength == null ? .45 : strength*0.5)));
  g2.addColorStop(1,   alpha(col, 0));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.restore();
}

/* ---------- deterministic noise ---------- */
function mulberry(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ============================================================
   BAKED GROUND TILES  — one 256px tile per biome, used as a pattern
   ============================================================ */
const _tiles = {};
function groundTile(id, base){
  if(_tiles[id]) return _tiles[id];
  const S = 384, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  const rnd = mulberry(id.length * 7919 + 13);

  x.fillStyle = base; x.fillRect(0, 0, S, S);

  // broad tonal blotches so large areas never read as flat colour
  for(let i = 0; i < 26; i++){
    const px = rnd()*S, py = rnd()*S, pr = 18 + rnd()*54;
    const up = rnd() > .5;
    const g2 = x.createRadialGradient(px, py, 0, px, py, pr);
    g2.addColorStop(0, up ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.075)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g2; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }
  // fine grain
  for(let i = 0; i < 1400; i++){
    x.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)';
    x.fillRect(rnd()*S, rnd()*S, 1.4, 1.4);
  }

  if(id === 'flats'){                                   // dry cracked earth
    x.strokeStyle = 'rgba(0,0,0,.30)'; x.lineWidth = 1.4;
    for(let i = 0; i < 16; i++){
      let px = rnd()*S, py = rnd()*S;
      x.beginPath(); x.moveTo(px, py);
      for(let k = 0; k < 4; k++){ px += (rnd()-.5)*44; py += (rnd()-.5)*44; x.lineTo(px, py); }
      x.stroke();
    }
    for(let i = 0; i < 40; i++){                        // pebbles
      const px = rnd()*S, py = rnd()*S, pr = 1.4 + rnd()*2.4;
      x.fillStyle = 'rgba(180,158,120,.20)'; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
      x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.arc(px, py+pr*.6, pr*.8, 0, 7); x.fill();
    }
  } else if(id === 'marsh'){                            // wet ground and pools
    for(let i = 0; i < 9; i++){
      const px = rnd()*S, py = rnd()*S, pw = 26+rnd()*56, ph = pw*(.42+rnd()*.3);
      x.fillStyle = 'rgba(24,58,50,.72)';
      x.beginPath(); x.ellipse(px, py, pw, ph, rnd()*3, 0, 7); x.fill();
      x.strokeStyle = 'rgba(120,220,180,.20)'; x.lineWidth = 1.6;
      x.beginPath(); x.ellipse(px, py, pw, ph, rnd()*3, 0, 7); x.stroke();
      x.fillStyle = 'rgba(150,240,205,.10)';
      x.beginPath(); x.ellipse(px-pw*.25, py-ph*.3, pw*.34, ph*.28, 0, 0, 7); x.fill();
    }
    for(let i = 0; i < 70; i++){                        // reeds
      const px = rnd()*S, py = rnd()*S, h = 5+rnd()*10;
      x.strokeStyle = 'rgba(110,170,120,.26)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px+(rnd()-.5)*6, py-h*.6, px+(rnd()-.5)*9, py-h); x.stroke();
    }
  } else if(id === 'scrap'){                            // riveted metal plates
    x.strokeStyle = 'rgba(0,0,0,.42)'; x.lineWidth = 2;
    for(let gx = 0; gx <= S; gx += 64){ x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, S); x.stroke(); }
    for(let gy = 0; gy <= S; gy += 64){ x.beginPath(); x.moveTo(0, gy); x.lineTo(S, gy); x.stroke(); }
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
    for(let gx = 2; gx <= S; gx += 64){ x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, S); x.stroke(); }
    for(let gy = 0; gy < S; gy += 64) for(let gx = 0; gx < S; gx += 64){
      for(const [dx, dy] of [[8,8],[56,8],[8,56],[56,56]]){
        x.fillStyle = 'rgba(255,255,255,.13)'; x.beginPath(); x.arc(gx+dx, gy+dy, 1.9, 0, 7); x.fill();
        x.fillStyle = 'rgba(0,0,0,.34)';       x.beginPath(); x.arc(gx+dx, gy+dy+.9, 1.5, 0, 7); x.fill();
      }
    }
    for(let i = 0; i < 22; i++){                        // rust
      const px = rnd()*S, py = rnd()*S, pr = 6+rnd()*20;
      const g2 = x.createRadialGradient(px, py, 0, px, py, pr);
      g2.addColorStop(0, 'rgba(150,70,30,.22)'); g2.addColorStop(1, 'rgba(150,70,30,0)');
      x.fillStyle = g2; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
    }
  } else if(id === 'rift'){                             // fractured void
    for(let i = 0; i < 11; i++){
      let px = rnd()*S, py = rnd()*S;
      const pts = [[px, py]];
      for(let k = 0; k < 5; k++){ px += (rnd()-.5)*60; py += (rnd()-.5)*60; pts.push([px, py]); }
      x.strokeStyle = 'rgba(190,120,255,.50)'; x.lineWidth = 2.4;
      x.shadowColor = '#b47bff'; x.shadowBlur = 10;
      x.beginPath(); pts.forEach((p, k) => k ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke();
      x.shadowBlur = 0;
      x.strokeStyle = 'rgba(255,225,255,.55)'; x.lineWidth = .9;
      x.beginPath(); pts.forEach((p, k) => k ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.stroke();
    }
    for(let i = 0; i < 60; i++){                        // motes
      const px = rnd()*S, py = rnd()*S;
      x.fillStyle = 'rgba(200,160,255,' + (.10 + rnd()*.22) + ')';
      x.beginPath(); x.arc(px, py, .8 + rnd()*1.7, 0, 7); x.fill();
    }
  } else if(id === 'plaza'){                            // cut stone with gold inlay
    const T = 64;
    x.strokeStyle = 'rgba(0,0,0,.34)'; x.lineWidth = 2.2;
    for(let gy = 0; gy < S; gy += T){
      const off = (gy / T) % 2 ? T/2 : 0;
      x.beginPath(); x.moveTo(0, gy); x.lineTo(S, gy); x.stroke();
      for(let gx = -T; gx < S; gx += T){
        x.beginPath(); x.moveTo(gx+off, gy); x.lineTo(gx+off, gy+T); x.stroke();
        x.fillStyle = 'rgba(255,255,255,.045)';
        rr(x, gx+off+3, gy+3, T-6, T-6, 4); x.fill();
        x.strokeStyle = 'rgba(255,203,69,.09)'; x.lineWidth = 1;
        rr(x, gx+off+7, gy+7, T-14, T-14, 3); x.stroke();
        x.strokeStyle = 'rgba(0,0,0,.34)'; x.lineWidth = 2.2;
      }
    }
  } else {                                              // road / wilds: packed dirt
    for(let i = 0; i < 46; i++){
      const px = rnd()*S, py = rnd()*S, pr = 1.2 + rnd()*2.6;
      x.fillStyle = 'rgba(255,255,255,.06)'; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,.03)'; x.lineWidth = 1;
    for(let i = 0; i < 12; i++){
      const py = rnd()*S; x.beginPath(); x.moveTo(0, py);
      x.bezierCurveTo(S*.3, py+(rnd()-.5)*18, S*.6, py+(rnd()-.5)*18, S, py); x.stroke();
    }
  }
  _tiles[id] = c;
  return c;
}
const _patterns = new WeakMap();
function groundPattern(ctx, id, base){
  let m = _patterns.get(ctx);
  if(!m){ m = new Map(); _patterns.set(ctx, m); }
  let p = m.get(id);
  if(!p){ p = ctx.createPattern(groundTile(id, base), 'repeat'); m.set(id, p); }
  return p;
}

/* ============================================================
   HUMANOID FIGURE
   Origin (x, y) sits at the feet. Light comes from the upper left.
   o = {scale, skin, shirt, pants, suit, accent, trim, glow, helmet,
        face, acc, moving, walk, aimx, dead, flash}
   ============================================================ */
function drawFigure(ctx, x, y, o){
  const s = o.scale || 1;
  const walk = o.walk || 0;
  const mv = o.moving ? 1 : 0;
  const sw = Math.sin(walk) * mv;                 // stride
  const bob = mv ? Math.abs(Math.sin(walk)) * 1.7 * s : Math.sin((o.walk||0) * .6) * .5 * s;
  const lean = Math.max(-1, Math.min(1, o.aimx || 0)) * 1.8 * s;

  const skin  = o.skin  || '#e0ac69';
  const suit  = o.suit || null;
  const body  = suit || o.shirt || '#c0392b';
  const limbC = suit ? (o.accent || darken(body, 26)) : (o.pants || '#2e5fa8');
  const armC  = suit ? (o.accent || body) : skin;
  const trim  = o.trim || lighten(body, 40);

  ctx.save();
  ctx.translate(x, y - bob);
  if(o.dead){ ctx.rotate(1.45); ctx.globalAlpha = .75; }

  groundShadow(ctx, 0, bob + 2.5*s, 17*s, 6*s, .42);

  /* ---- behind-body layer ---- */
  drawBackAccessory(ctx, o, s, sw, walk, trim);

  /* ---- legs (back leg first, dimmed for depth) ---- */
  const legW = 8*s, legTop = -17*s, legH = 17*s;
  for(const d of [-1, 1]){
    const back = d === -1;
    const off = sw * d * 3.6 * s;
    ctx.save();
    if(back) ctx.globalAlpha *= .82;
    const lx = d*4.8*s - legW/2;
    part(ctx, lx, legTop + Math.max(0, off)*.28, legW, legH - Math.abs(off)*.20,
         back ? darken(limbC, 16) : limbC, {r: 3.4*s, lw: 1.15*s});
    // boot
    part(ctx, lx - .9*s, -5.4*s + Math.max(0, off)*.2, legW + 1.8*s, 5.4*s,
         suit ? darken(limbC, 42) : darken(limbC, 30), {r: 2.2*s, lw: 1.05*s, sheen:false});
    ctx.restore();
  }

  /* ---- torso ---- */
  const tw = 21*s, th = 20*s, ty = -37*s;
  ctx.save();
  ctx.translate(lean * .25, 0);
  // shoulders slightly wider than waist
  ctx.beginPath();
  ctx.moveTo(-tw/2, ty + 3.5*s);
  ctx.quadraticCurveTo(-tw/2 - .5*s, ty, -tw/2 + 4*s, ty);
  ctx.lineTo(tw/2 - 4*s, ty);
  ctx.quadraticCurveTo(tw/2 + .5*s, ty, tw/2, ty + 3.5*s);
  ctx.lineTo(tw/2 - 1.6*s, ty + th);
  ctx.quadraticCurveTo(0, ty + th + 1.6*s, -tw/2 + 1.6*s, ty + th);
  ctx.closePath();
  const bodyR = readable(body);
  ctx.fillStyle = vGrad(ctx, bodyR + 'T', ty, ty + th, [
    [0, lighten(bodyR, 30)], [.45, bodyR], [1, darken(bodyR, 34)]
  ]);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.15)';                       // chest highlight
  ctx.beginPath(); ctx.ellipse(-tw*.20, ty + th*.30, tw*.24, th*.30, -.3, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.22)';                             // waist shade
  ctx.fillRect(-tw, ty + th*.72, tw*2, th*.3);
  if(suit){                                                      // armour panel seams
    ctx.strokeStyle = alpha(darken(bodyR, 45), .55); ctx.lineWidth = 1*s;
    ctx.beginPath(); ctx.moveTo(-tw*.30, ty); ctx.lineTo(-tw*.20, ty + th); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( tw*.30, ty); ctx.lineTo( tw*.20, ty + th); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = outlineFor(bodyR); ctx.lineWidth = 1.25*s; ctx.stroke();

  // collar
  part(ctx, -tw*.34, ty - 1.2*s, tw*.68, 4*s, suit ? trim : darken(bodyR, 22),
       {r: 1.6*s, sheen:false, lw: .9*s});
  // belt
  part(ctx, -tw/2 + 1.4*s, ty + th - 5*s, tw - 2.8*s, 4.4*s, suit ? darken(trim, 18) : '#3a3242',
       {r: 1.4*s, sheen:false, lw: .9*s});
  ctx.fillStyle = suit ? trim : '#c9a34a';
  rr(ctx, -2.4*s, ty + th - 4.4*s, 4.8*s, 3.2*s, 1*s); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = .8*s; ctx.stroke();

  // chest emblem
  if(suit && o.glow){
    ctx.fillStyle = '#0d1016';
    ctx.beginPath(); ctx.arc(0, ty + th*.34, 4.6*s, 0, 7); ctx.fill();
    ctx.strokeStyle = alpha(trim, .9); ctx.lineWidth = 1.2*s; ctx.stroke();
    ctx.fillStyle = o.glow;
    ctx.beginPath(); ctx.arc(0, ty + th*.34, 3.1*s, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath(); ctx.arc(-.8*s, ty + th*.34 - .8*s, 1.2*s, 0, 7); ctx.fill();
    glowDot(ctx, 0, ty + th*.34, 11*s, o.glow, .55);
  } else if(suit){
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(0, ty + th*.16); ctx.lineTo(3.6*s, ty + th*.40);
    ctx.lineTo(0, ty + th*.62); ctx.lineTo(-3.6*s, ty + th*.40);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = .9*s; ctx.stroke();
  }
  ctx.restore();

  /* ---- arms ---- */
  const aw = 7.4*s, ah = 19*s, ax = tw/2 + aw*.35;
  for(const d of [-1, 1]){
    const back = d === -1;
    const off = -sw * d * 3.8 * s;
    const reach = (d === (o.aimx > 0 ? 1 : -1)) ? -3.4*s : 0;
    ctx.save();
    if(back) ctx.globalAlpha *= .84;
    ctx.translate(d*ax + lean*.45, ty + 2*s + off*.30 + reach);
    ctx.rotate(d * off * .012);
    part(ctx, -aw/2, 0, aw, ah, back ? darken(armC, 14) : armC, {r: 3.2*s, lw: 1.1*s});
    if(suit){                                        // shoulder pauldron
      part(ctx, -aw/2 - 1.6*s, -2.2*s, aw + 3.2*s, 7*s, trim, {r: 3*s, lw: 1*s});
    } else {                                         // sleeve
      part(ctx, -aw/2, 0, aw, 6.5*s, darken(bodyR, 10), {r: 3*s, sheen:false, lw: .9*s});
    }
    // glove / hand
    part(ctx, -aw/2 - .5*s, ah - 5.6*s, aw + 1*s, 5.8*s,
         suit ? darken(trim, 26) : skin, {r: 2.6*s, lw: 1*s, sheen:false});
    ctx.restore();
  }

  /* ---- head ---- */
  const hw = 16.5*s, hh = 16*s, hy = -54*s, hx = lean*.62;
  // neck
  part(ctx, hx - 3*s, hy + hh - 2*s, 6*s, 5*s, darken(skin, 24), {r: 1.6*s, sheen:false, lw:.9*s});
  const headBase = readable(skin, .18);
  rr(ctx, hx - hw/2, hy, hw, hh, 4.6*s);
  ctx.fillStyle = vGrad(ctx, headBase + 'H', hy, hy + hh, [
    [0, lighten(headBase, 26)], [.5, headBase], [1, darken(headBase, 26)]
  ]);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.beginPath(); ctx.ellipse(hx - hw*.20, hy + hh*.26, hw*.26, hh*.24, -.3, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.fillRect(hx - hw, hy + hh*.80, hw*2, hh*.25);
  ctx.restore();
  ctx.strokeStyle = outlineFor(headBase); ctx.lineWidth = 1.25*s; ctx.stroke();

  const bare = !o.helmet || o.helmet === 'none';
  if(bare){                                         // ears + hair
    for(const d of [-1, 1])
      part(ctx, hx + d*(hw/2) - 1.4*s, hy + hh*.42, 2.8*s, 5*s, darken(skin, 12),
           {r: 1.3*s, sheen:false, lw:.8*s});
    if(o.hair !== false){
      const hairC = o.hair || '#2b2118';
      ctx.fillStyle = hairC;
      ctx.beginPath();
      ctx.moveTo(hx - hw/2 - .4*s, hy + hh*.30);
      ctx.quadraticCurveTo(hx - hw*.42, hy - hh*.16, hx + hw*.08, hy + .6*s);
      ctx.quadraticCurveTo(hx + hw*.48, hy - hh*.02, hx + hw/2 + .4*s, hy + hh*.34);
      ctx.lineTo(hx + hw/2 + .4*s, hy + hh*.16);
      ctx.quadraticCurveTo(hx, hy - hh*.22, hx - hw/2 - .4*s, hy + hh*.16);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = alpha(lighten(hairC, 40), .5); ctx.lineWidth = .8*s; ctx.stroke();
    }
  }

  drawHelmet(ctx, o.helmet, hx, hy, hw, hh, s, o);
  if(bare || o.helmet === 'crownlet' || o.helmet === 'goggles')
    drawFace(ctx, o.face || 'neutral', hx, hy + hh*.30, s, hw);

  drawTopAccessory(ctx, o, hx, hy, hw, s, walk, trim);

  if(o.flash){                                       // hit flash
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,120,120,' + (o.flash * .55) + ')';
    ctx.fillRect(-24*s, -60*s, 48*s, 64*s);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/* ============================================================
   FACES
   ============================================================ */
function drawFace(ctx, f, x, ey, s, hw){
  const my = ey + 5.2*s;                     // mouth line
  const ex = 3.6*s;                          // eye offset
  const ink = '#1a1c24';

  function eye(dx, w, h, opts){
    const o = opts || {};
    ctx.fillStyle = o.white === false ? ink : '#f6f8fc';
    if(o.white !== false){
      rr(ctx, x + dx - w/2, ey - h/2, w, h, w*.42); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.30)'; ctx.lineWidth = .7*s; ctx.stroke();
    }
    ctx.fillStyle = o.iris || ink;
    const px = x + dx + (o.look || 0)*s;
    ctx.beginPath(); ctx.arc(px, ey + (o.dy||0), (o.pupil || w*.30), 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';   // catchlight
    ctx.beginPath(); ctx.arc(px - w*.14, ey - h*.16 + (o.dy||0), w*.11, 0, 7); ctx.fill();
  }
  function brow(dx, tilt){
    ctx.save(); ctx.translate(x + dx, ey - 3.6*s); ctx.rotate(tilt);
    ctx.fillStyle = ink; rr(ctx, -2.4*s, -1*s, 4.8*s, 1.7*s, .8*s); ctx.fill(); ctx.restore();
  }
  function smile(curve, w){
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, my - curve, w || 3.2*s, .28, Math.PI - .28); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  switch(f){
    case 'cool': {
      ctx.fillStyle = '#0f1117';
      rr(ctx, x - 7.4*s, ey - 2.8*s, 14.8*s, 5.4*s, 1.6*s); ctx.fill();
      ctx.strokeStyle = '#3a4358'; ctx.lineWidth = 1*s; ctx.stroke();
      const gl = ctx.createLinearGradient(x - 7*s, ey - 3*s, x + 7*s, ey + 2*s);
      gl.addColorStop(0, 'rgba(255,255,255,.42)'); gl.addColorStop(.4, 'rgba(255,255,255,.05)');
      gl.addColorStop(1, 'rgba(120,200,255,.22)');
      ctx.fillStyle = gl; rr(ctx, x - 7*s, ey - 2.4*s, 14*s, 4.6*s, 1.4*s); ctx.fill();
      smile(1.2*s, 3*s); return;
    }
    case 'robot': {
      eye(-ex, 4.4*s, 3.4*s, {white:false, iris:'#63d5ff', pupil:1.7*s});
      eye( ex, 4.4*s, 3.4*s, {white:false, iris:'#63d5ff', pupil:1.7*s});
      glowDot(ctx, x - ex, ey, 5*s, '#63d5ff', .5); glowDot(ctx, x + ex, ey, 5*s, '#63d5ff', .5);
      ctx.fillStyle = ink;
      for(let i = 0; i < 5; i++) rr(ctx, x - 5*s + i*2.4*s, my - 1.3*s, 1.5*s, 3*s, .5*s), ctx.fill();
      return;
    }
    case 'glow': {
      ctx.fillStyle = '#ffe27a';
      rr(ctx, x - ex - 2.4*s, ey - 1.9*s, 4.8*s, 3.8*s, 1.4*s); ctx.fill();
      rr(ctx, x + ex - 2.4*s, ey - 1.9*s, 4.8*s, 3.8*s, 1.4*s); ctx.fill();
      glowDot(ctx, x - ex, ey, 8*s, '#ffe27a', .75); glowDot(ctx, x + ex, ey, 8*s, '#ffe27a', .75);
      ctx.fillStyle = ink; rr(ctx, x - 2.6*s, my - .6*s, 5.2*s, 1.5*s, .7*s); ctx.fill(); return;
    }
    case 'cat': {
      ctx.strokeStyle = ink; ctx.lineWidth = 1.6*s; ctx.lineCap = 'round';
      for(const d of [-1, 1]){                       // ^ ^ eyes
        ctx.beginPath();
        ctx.moveTo(x + d*ex - 2.2*s, ey + 1*s);
        ctx.lineTo(x + d*ex, ey - 1.6*s);
        ctx.lineTo(x + d*ex + 2.2*s, ey + 1*s); ctx.stroke();
      }
      ctx.beginPath();                                // w mouth
      ctx.moveTo(x - 3*s, my - .8*s); ctx.lineTo(x - 1.5*s, my + 1*s);
      ctx.lineTo(x, my - .4*s); ctx.lineTo(x + 1.5*s, my + 1*s); ctx.lineTo(x + 3*s, my - .8*s);
      ctx.stroke(); ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(26,28,36,.45)'; ctx.lineWidth = .9*s;   // whiskers
      for(const d of [-1, 1]) for(let k = -1; k <= 1; k++){
        ctx.beginPath(); ctx.moveTo(x + d*4.6*s, my + k*1.3*s);
        ctx.lineTo(x + d*8.6*s, my + k*2.2*s - .6*s); ctx.stroke();
      }
      return;
    }
    case 'angry': {
      brow(-ex, .46); brow(ex, -.46);
      eye(-ex, 4.2*s, 3.4*s, {dy: .5*s}); eye(ex, 4.2*s, 3.4*s, {dy: .5*s});
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5*s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, my + 2.6*s, 3*s, Math.PI*1.18, Math.PI*1.82); ctx.stroke();
      ctx.lineCap = 'butt'; return;
    }
    case 'grin': {
      eye(-ex, 4.4*s, 4*s); eye(ex, 4.4*s, 4*s);
      ctx.fillStyle = '#2a1013';
      rr(ctx, x - 4.4*s, my - 1.4*s, 8.8*s, 4.4*s, 1.6*s); ctx.fill();
      ctx.fillStyle = '#fff'; rr(ctx, x - 3.8*s, my - 1*s, 7.6*s, 1.9*s, .7*s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = .7*s;
      rr(ctx, x - 4.4*s, my - 1.4*s, 8.8*s, 4.4*s, 1.6*s); ctx.stroke(); return;
    }
    case 'shocked': {
      eye(-ex, 5*s, 5.2*s, {pupil: 1.1*s}); eye(ex, 5*s, 5.2*s, {pupil: 1.1*s});
      ctx.fillStyle = '#2a1013';
      ctx.beginPath(); ctx.ellipse(x, my + 1.4*s, 2.2*s, 2.9*s, 0, 0, 7); ctx.fill(); return;
    }
    case 'wink': {
      eye(-ex, 4.4*s, 4*s);
      ctx.strokeStyle = ink; ctx.lineWidth = 1.6*s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x + ex, ey + 1.4*s, 2.6*s, Math.PI*1.15, Math.PI*1.85); ctx.stroke();
      smile(1*s, 3.2*s); ctx.lineCap = 'butt'; return;
    }
    case 'determined': {
      brow(-ex, .30); brow(ex, -.30);
      eye(-ex, 4*s, 3*s); eye(ex, 4*s, 3*s);
      ctx.fillStyle = ink; rr(ctx, x - 3*s, my, 6*s, 1.6*s, .7*s); ctx.fill(); return;
    }
    case 'stone': {
      ctx.fillStyle = 'rgba(20,22,28,.55)';
      rr(ctx, x - ex - 2.4*s, ey - .9*s, 4.8*s, 1.9*s, .8*s); ctx.fill();
      rr(ctx, x + ex - 2.4*s, ey - .9*s, 4.8*s, 1.9*s, .8*s); ctx.fill();
      rr(ctx, x - 3.2*s, my, 6.4*s, 1.3*s, .6*s); ctx.fill(); return;
    }
    case 'smile': {
      eye(-ex, 4.4*s, 4*s); eye(ex, 4.4*s, 4*s); smile(.8*s, 3.4*s); return;
    }
    default: {
      eye(-ex, 4.4*s, 4*s); eye(ex, 4.4*s, 4*s);
      ctx.fillStyle = ink; rr(ctx, x - 2.2*s, my, 4.4*s, 1.5*s, .7*s); ctx.fill();
    }
  }
}

/* ============================================================
   HELMETS  — one per hero archetype
   ============================================================ */
function drawHelmet(ctx, t, x, y, hw, hh, s, o){
  if(!t || t === 'none') return;
  const suit = o.suit || '#8a8f9c', accent = o.accent || '#ccc',
        trim = o.trim || '#fff', glow = o.glow || '#9ff';

  switch(t){
    case 'faceplate': {                       // Iron Man
      rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh + 1.4*s, 4.4*s);
      const gm = vGrad(ctx, accent + 'F', y, y + hh, [
        [0, lighten(accent, 34)], [.5, accent], [1, darken(accent, 26)]]);
      ctx.fillStyle = gm; ctx.fill();
      ctx.strokeStyle = outlineFor(accent); ctx.lineWidth = 1.2*s; ctx.stroke();
      // red crown and cheeks
      ctx.save(); rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh + 1.4*s, 4.4*s); ctx.clip();
      ctx.fillStyle = suit;
      ctx.beginPath();
      ctx.moveTo(x - hw/2 - 1*s, y - 1*s); ctx.lineTo(x + hw/2 + 1*s, y - 1*s);
      ctx.lineTo(x + hw/2 + 1*s, y + hh*.30); ctx.lineTo(x + hw*.20, y + hh*.20);
      ctx.lineTo(x, y + hh*.34); ctx.lineTo(x - hw*.20, y + hh*.20);
      ctx.lineTo(x - hw/2 - 1*s, y + hh*.30); ctx.closePath(); ctx.fill();
      for(const d of [-1, 1]){
        ctx.beginPath();
        ctx.moveTo(x + d*hw*.52, y + hh*.42); ctx.lineTo(x + d*hw*.30, y + hh*.52);
        ctx.lineTo(x + d*hw*.34, y + hh*1.02); ctx.lineTo(x + d*hw*.52, y + hh*1.02);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,.30)'; ctx.lineWidth = .9*s;   // jaw seam
      ctx.beginPath(); ctx.moveTo(x - hw*.34, y + hh*.74); ctx.lineTo(x + hw*.34, y + hh*.74); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.beginPath(); ctx.ellipse(x - hw*.22, y + hh*.30, hw*.16, hh*.20, -.4, 0, 7); ctx.fill();
      ctx.restore();
      // eye slits
      ctx.fillStyle = glow;
      for(const d of [-1, 1]){
        ctx.beginPath();
        ctx.moveTo(x + d*1.8*s, y + hh*.42); ctx.lineTo(x + d*6.2*s, y + hh*.36);
        ctx.lineTo(x + d*6.0*s, y + hh*.56); ctx.lineTo(x + d*1.8*s, y + hh*.56);
        ctx.closePath(); ctx.fill();
      }
      glowDot(ctx, x - 4*s, y + hh*.46, 7*s, glow, .6);
      glowDot(ctx, x + 4*s, y + hh*.46, 7*s, glow, .6);
      return;
    }
    case 'cowl': {                            // Captain America
      ctx.save();
      rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh*.62, 4.2*s);
      ctx.fillStyle = vGrad(ctx, suit + 'C', y, y + hh*.6, [
        [0, lighten(suit, 30)], [1, darken(suit, 22)]]);
      ctx.fill();
      ctx.strokeStyle = outlineFor(suit); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.restore();
      // side wings
      ctx.fillStyle = '#eef2f8';
      for(const d of [-1, 1]){
        ctx.beginPath();
        ctx.moveTo(x + d*hw*.46, y + hh*.16);
        ctx.quadraticCurveTo(x + d*hw*.86, y + hh*.02, x + d*hw*.80, y + hh*.30);
        ctx.quadraticCurveTo(x + d*hw*.62, y + hh*.26, x + d*hw*.46, y + hh*.36);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = .8*s; ctx.stroke();
      }
      // letter A
      ctx.fillStyle = '#f2f5fa';
      ctx.beginPath();
      ctx.moveTo(x, y + 1.4*s); ctx.lineTo(x + 2.4*s, y + hh*.36);
      ctx.lineTo(x + 1.2*s, y + hh*.36); ctx.lineTo(x, y + hh*.18);
      ctx.lineTo(x - 1.2*s, y + hh*.36); ctx.lineTo(x - 2.4*s, y + hh*.36);
      ctx.closePath(); ctx.fill();
      drawFace(ctx, o.face, x, y + hh*.66, s*.94, hw); return;
    }
    case 'helm': {                            // Thor
      const g2 = vGrad(ctx, trim + 'H', y - 2*s, y + hh*.46, [
        [0, lighten(trim, 40)], [1, darken(trim, 24)]]);
      for(const d of [-1, 1]){                // wings
        ctx.beginPath();
        ctx.moveTo(x + d*hw*.42, y + hh*.10);
        ctx.quadraticCurveTo(x + d*hw*1.02, y - hh*.56, x + d*hw*.74, y - hh*.06);
        ctx.quadraticCurveTo(x + d*hw*.66, y + hh*.14, x + d*hw*.44, y + hh*.26);
        ctx.closePath();
        ctx.fillStyle = g2; ctx.fill();
        ctx.strokeStyle = outlineFor(trim); ctx.lineWidth = 1*s; ctx.stroke();
      }
      rr(ctx, x - hw/2 - .8*s, y - 2.4*s, hw + 1.6*s, hh*.44, 3.4*s);
      ctx.fillStyle = g2; ctx.fill();
      ctx.strokeStyle = outlineFor(trim); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.fillStyle = alpha(darken(trim, 34), .8);          // centre ridge
      rr(ctx, x - 1.2*s, y - 3.4*s, 2.4*s, hh*.46, 1*s); ctx.fill();
      drawFace(ctx, o.face, x, y + hh*.50, s*.96, hw); return;
    }
    case 'mask': {                            // Spider-Man / Panther
      rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh + 1.4*s, 5.2*s);
      const mg = vGrad(ctx, suit + 'M', y, y + hh, [
        [0, lighten(suit, 30)], [.55, suit], [1, darken(suit, 30)]]);
      ctx.fillStyle = mg; ctx.fill();
      ctx.strokeStyle = outlineFor(suit); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.save(); rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh + 1.4*s, 5.2*s); ctx.clip();
      ctx.strokeStyle = alpha(darken(suit, 55), .55); ctx.lineWidth = .6*s;
      for(let i = -3; i <= 3; i++){           // web strands
        ctx.beginPath(); ctx.moveTo(x, y + hh*.28); ctx.lineTo(x + i*4.2*s, y + hh*1.1); ctx.stroke();
      }
      for(let rr2 = 3; rr2 <= 9; rr2 += 3){
        ctx.beginPath(); ctx.arc(x, y + hh*.28, rr2*s, .18, Math.PI - .18); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.beginPath(); ctx.ellipse(x - hw*.22, y + hh*.24, hw*.18, hh*.18, -.4, 0, 7); ctx.fill();
      ctx.restore();
      for(const d of [-1, 1]){                // big lenses
        ctx.beginPath();
        ctx.moveTo(x + d*1.6*s, y + hh*.40);
        ctx.quadraticCurveTo(x + d*3.4*s, y + hh*.22, x + d*6.8*s, y + hh*.30);
        ctx.quadraticCurveTo(x + d*7.6*s, y + hh*.58, x + d*5.4*s, y + hh*.62);
        ctx.quadraticCurveTo(x + d*2.6*s, y + hh*.60, x + d*1.6*s, y + hh*.40);
        ctx.closePath();
        ctx.fillStyle = accent; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1*s; ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.ellipse(x + d*4.2*s, y + hh*.36, 1.5*s, .9*s, 0, 0, 7); ctx.fill();
      }
      return;
    }
    case 'goggles': {                         // Hawkeye
      rr(ctx, x - hw/2 - .4*s, y - 1.6*s, hw + .8*s, hh*.40, 3*s);
      ctx.fillStyle = vGrad(ctx, suit + 'G', y - 2*s, y + hh*.4, [
        [0, lighten(suit, 28)], [1, darken(suit, 20)]]); ctx.fill();
      ctx.strokeStyle = outlineFor(suit); ctx.lineWidth = 1.1*s; ctx.stroke();
      ctx.fillStyle = '#1a1d26';
      rr(ctx, x - hw/2 - 1*s, y + hh*.30, hw + 2*s, hh*.30, 2*s); ctx.fill();
      for(const d of [-1, 1]){
        ctx.fillStyle = glow;
        rr(ctx, x + d*1.4*s - (d < 0 ? 5.4*s : 0), y + hh*.36, 5.4*s, hh*.17, 1.2*s); ctx.fill();
      }
      glowDot(ctx, x, y + hh*.44, 10*s, glow, .35); return;
    }
    case 'stone': {                           // Vision
      rr(ctx, x - hw/2 - .6*s, y - .8*s, hw + 1.2*s, hh + 1.4*s, 4.6*s);
      ctx.fillStyle = vGrad(ctx, suit + 'V', y, y + hh, [
        [0, lighten(suit, 32)], [.5, suit], [1, darken(suit, 28)]]);
      ctx.fill();
      ctx.strokeStyle = outlineFor(suit); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.strokeStyle = alpha(trim, .85); ctx.lineWidth = 1.4*s;   // gold seams
      ctx.beginPath(); ctx.moveTo(x - hw*.42, y + hh*.22); ctx.lineTo(x + hw*.42, y + hh*.22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - hw*.34, y + hh*.86); ctx.lineTo(x + hw*.34, y + hh*.86); ctx.stroke();
      drawFace(ctx, o.face || 'stone', x, y + hh*.46, s*.92, hw);
      ctx.fillStyle = trim;                                        // gem setting
      ctx.beginPath();
      ctx.moveTo(x, y + hh*.02); ctx.lineTo(x + 3.4*s, y + hh*.16);
      ctx.lineTo(x, y + hh*.30); ctx.lineTo(x - 3.4*s, y + hh*.16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.moveTo(x, y + hh*.06); ctx.lineTo(x + 2.2*s, y + hh*.16);
      ctx.lineTo(x, y + hh*.26); ctx.lineTo(x - 2.2*s, y + hh*.16);
      ctx.closePath(); ctx.fill();
      glowDot(ctx, x, y + hh*.16, 10*s, glow, .8); return;
    }
    case 'crownlet': {                        // Scarlet Witch
      ctx.fillStyle = vGrad(ctx, accent + 'K', y - 8*s, y + 2*s, [
        [0, lighten(accent, 46)], [1, darken(accent, 16)]]);
      ctx.beginPath();
      ctx.moveTo(x - hw*.46, y + 1.4*s);
      for(let i = -2; i <= 2; i++){
        const px = x + i*hw*.22, h = (i === 0 ? 8.6 : Math.abs(i) === 1 ? 6 : 4)*s;
        ctx.lineTo(px - hw*.08, y - h*.35); ctx.lineTo(px, y - h); ctx.lineTo(px + hw*.08, y - h*.35);
      }
      ctx.lineTo(x + hw*.46, y + 1.4*s); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outlineFor(accent); ctx.lineWidth = 1*s; ctx.stroke();
      glowDot(ctx, x, y - 5*s, 12*s, o.glow || '#ff5d7a', .40); return;
    }
    case 'mohawkhelm': {                      // Captain Marvel
      rr(ctx, x - hw/2 - .6*s, y - 1.4*s, hw + 1.2*s, hh*.46, 3.6*s);
      ctx.fillStyle = vGrad(ctx, suit + 'X', y, y + hh*.5, [
        [0, lighten(suit, 30)], [1, darken(suit, 22)]]); ctx.fill();
      ctx.strokeStyle = outlineFor(suit); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.fillStyle = vGrad(ctx, trim + 'X', y - 9*s, y, [
        [0, lighten(trim, 40)], [1, darken(trim, 10)]]);
      ctx.beginPath();                        // crest
      ctx.moveTo(x - 4.4*s, y - 1*s);
      ctx.quadraticCurveTo(x, y - 10.5*s, x + 4.4*s, y - 1*s);
      ctx.quadraticCurveTo(x, y - 3.4*s, x - 4.4*s, y - 1*s);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outlineFor(trim); ctx.lineWidth = .9*s; ctx.stroke();
      drawFace(ctx, o.face, x, y + hh*.52, s*.94, hw); return;
    }
  }
}

/* ============================================================
   ACCESSORIES
   ============================================================ */
function drawBackAccessory(ctx, o, s, sw, walk, trim){
  const a = o.acc;
  if(a === 'cape'){
    const swing = sw * 2.4 * s, flap = Math.sin(walk * 1.3) * 1.6 * s;
    const c = o.suit ? trim : '#c0392b';
    ctx.beginPath();
    ctx.moveTo(-11.5*s, -38*s); ctx.lineTo(11.5*s, -38*s);
    ctx.quadraticCurveTo((18 + swing)*s, -20*s, (17 + swing*1.8)*s, 0 + flap);
    ctx.quadraticCurveTo(0, -5*s + flap*1.6, (-17 + swing*1.8)*s, 0 - flap);
    ctx.quadraticCurveTo((-18 + swing)*s, -20*s, -11.5*s, -38*s);
    ctx.closePath();
    ctx.fillStyle = vGrad(ctx, c + 'cape', -38*s, 0, [
      [0, lighten(c, 18)], [.6, c], [1, darken(c, 42)]]);
    ctx.fill();
    ctx.strokeStyle = outlineFor(c); ctx.lineWidth = 1.1*s; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.24)'; ctx.lineWidth = 1*s;   // folds
    for(const fx2 of [-7, 0, 7]){
      ctx.beginPath(); ctx.moveTo(fx2*s, -36*s);
      ctx.quadraticCurveTo((fx2*1.5 + swing)*s, -19*s, (fx2*2.0 + swing*1.5)*s, -2*s); ctx.stroke();
    }
    // shoulder clasps
    for(const d of [-1, 1]){
      ctx.fillStyle = lighten(c, 55);
      ctx.beginPath(); ctx.arc(d*10*s, -37*s, 2.4*s, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = .8*s; ctx.stroke();
    }
  } else if(a === 'wings'){
    for(const d of [-1, 1]){
      const sp = 1 + Math.sin(walk * 1.6) * .07;
      ctx.save(); ctx.translate(d*7*s, -34*s); ctx.scale(d*sp, sp);
      const wg = ctx.createLinearGradient(0, -14*s, 18*s, 16*s);
      wg.addColorStop(0, '#ffffff'); wg.addColorStop(.55, '#e8eef8'); wg.addColorStop(1, '#b9c6de');
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(16*s, -16*s, 24*s, -4*s);
      ctx.quadraticCurveTo(21*s, 4*s, 17*s, 3*s);
      ctx.quadraticCurveTo(19*s, 11*s, 12*s, 9*s);
      ctx.quadraticCurveTo(13*s, 15*s, 7*s, 12*s);
      ctx.quadraticCurveTo(4*s, 8*s, 0, 4*s);
      ctx.closePath(); ctx.fillStyle = wg; ctx.fill();
      ctx.strokeStyle = 'rgba(120,145,190,.75)'; ctx.lineWidth = 1*s; ctx.stroke();
      ctx.strokeStyle = 'rgba(150,170,210,.55)'; ctx.lineWidth = .8*s;
      for(let i = 1; i <= 3; i++){
        ctx.beginPath(); ctx.moveTo(2*s, 1*s);
        ctx.quadraticCurveTo(11*s, (-6 + i*4)*s, (20 - i*3)*s, (-2 + i*4.4)*s); ctx.stroke();
      }
      ctx.restore();
    }
  } else if(a === 'jetpack'){
    part(ctx, -9*s, -34*s, 18*s, 17*s, '#79808e', {r: 3*s, lw: 1.1*s});
    part(ctx, -9*s, -34*s, 18*s, 4.4*s, '#c0392b', {r: 2*s, sheen: false, lw: .9*s});
    for(const d of [-1, 1]){
      part(ctx, d*4.6*s - 2.6*s, -18*s, 5.2*s, 4*s, '#5b616d', {r: 1.4*s, sheen:false, lw:.8*s});
      const fl = 5 + Math.abs(Math.sin(walk*3 + d)) * 5;
      const fg = ctx.createLinearGradient(0, -14*s, 0, (-14 + fl)*s);
      fg.addColorStop(0, 'rgba(255,238,150,.95)'); fg.addColorStop(.5, 'rgba(255,150,40,.8)');
      fg.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(d*4.6*s - 2.2*s, -14*s); ctx.lineTo(d*4.6*s + 2.2*s, -14*s);
      ctx.lineTo(d*4.6*s, (-14 + fl)*s); ctx.closePath(); ctx.fill();
    }
  } else if(a === 'katana'){
    ctx.save(); ctx.rotate(-.44); ctx.translate(-2*s, -4*s);
    part(ctx, -1.9*s, -46*s, 3.8*s, 32*s, '#cfd6e2', {r: 1*s, lw: .8*s});
    ctx.fillStyle = '#f2f6fc'; ctx.fillRect(-.7*s, -45*s, 1*s, 30*s);
    part(ctx, -3.4*s, -15*s, 6.8*s, 2.4*s, '#c9a34a', {r: .8*s, sheen:false, lw:.7*s});
    part(ctx, -2.4*s, -13*s, 4.8*s, 10*s, '#23262e', {r: 1.4*s, sheen:false, lw:.8*s});
    ctx.strokeStyle = 'rgba(200,60,60,.8)'; ctx.lineWidth = .8*s;
    for(let i = 0; i < 4; i++){ ctx.beginPath(); ctx.moveTo(-2.4*s, (-12 + i*2.4)*s); ctx.lineTo(2.4*s, (-11 + i*2.4)*s); ctx.stroke(); }
    ctx.restore();
  }
}

function drawTopAccessory(ctx, o, x, y, hw, s, walk, trim){
  const a = o.acc;
  switch(a){
    case 'halo': {
      const hy2 = y - 7*s;
      glowDot(ctx, x, hy2, 15*s, '#ffe27a', .45);
      ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2.6*s;
      ctx.beginPath(); ctx.ellipse(x, hy2, 8.8*s, 2.9*s, 0, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1*s;
      ctx.beginPath(); ctx.ellipse(x, hy2 - .5*s, 8.8*s, 2.9*s, 0, Math.PI*1.05, Math.PI*1.95); ctx.stroke();
      break;
    }
    case 'horns': {
      for(const d of [-1, 1]){
        const g2 = vGrad(ctx, 'horn', y - 12*s, y + 2*s, [[0, '#e06a5a'], [1, '#8e1f18']]);
        ctx.beginPath();
        ctx.moveTo(x + d*hw*.30, y + 1.6*s);
        ctx.quadraticCurveTo(x + d*hw*.78, y - 6*s, x + d*hw*.46, y - 11.5*s);
        ctx.quadraticCurveTo(x + d*hw*.52, y - 5*s, x + d*hw*.16, y + 1.6*s);
        ctx.closePath(); ctx.fillStyle = g2; ctx.fill();
        ctx.strokeStyle = '#5e120d'; ctx.lineWidth = .9*s; ctx.stroke();
      }
      break;
    }
    case 'tophat': {
      part(ctx, x - 11*s, y - 3.4*s, 22*s, 3.2*s, '#191b22', {r: 1.4*s, lw: 1*s, sheen:false});
      part(ctx, x - 6.4*s, y - 15*s, 12.8*s, 12*s, '#20232c', {r: 1.6*s, lw: 1*s});
      part(ctx, x - 6.6*s, y - 7.4*s, 13.2*s, 3.2*s, '#a5202a', {r: .8*s, sheen:false, lw:.8*s});
      break;
    }
    case 'crown': {
      const g2 = vGrad(ctx, 'crown', y - 11*s, y + 1*s, [[0, '#ffe9a0'], [.5, '#f2c744'], [1, '#a8791a']]);
      ctx.beginPath();
      ctx.moveTo(x - 8*s, y + 1*s); ctx.lineTo(x - 8*s, y - 6*s);
      ctx.lineTo(x - 4*s, y - 2.6*s); ctx.lineTo(x, y - 10.5*s);
      ctx.lineTo(x + 4*s, y - 2.6*s); ctx.lineTo(x + 8*s, y - 6*s);
      ctx.lineTo(x + 8*s, y + 1*s); ctx.closePath();
      ctx.fillStyle = g2; ctx.fill();
      ctx.strokeStyle = '#7a5510'; ctx.lineWidth = 1*s; ctx.stroke();
      for(const [px, py, c] of [[0, -7.4, '#e8455f'], [-5, -3.6, '#5ac8ff'], [5, -3.6, '#57e08a']]){
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + px*s, y + py*s, 1.5*s, 0, 7); ctx.fill();
      }
      glowDot(ctx, x, y - 5*s, 14*s, '#ffcb45', .30);
      break;
    }
    case 'antenna': {
      const bx = x + Math.sin(walk * .5) * 2.4*s;
      ctx.strokeStyle = '#9aa4b0'; ctx.lineWidth = 1.7*s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y + 1*s);
      ctx.quadraticCurveTo(x, y - 6*s, bx, y - 10*s); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath(); ctx.arc(bx, y - 11.4*s, 2.4*s, 0, 7); ctx.fill();
      glowDot(ctx, bx, y - 11.4*s, 9*s, '#ff5a5a', .7);
      break;
    }
    case 'headphones': {
      ctx.strokeStyle = '#242833'; ctx.lineWidth = 3*s;
      ctx.beginPath(); ctx.arc(x, y + 4*s, hw*.62, Math.PI*1.06, Math.PI*1.94); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.20)'; ctx.lineWidth = 1*s;
      ctx.beginPath(); ctx.arc(x, y + 3*s, hw*.62, Math.PI*1.10, Math.PI*1.90); ctx.stroke();
      for(const d of [-1, 1]){
        part(ctx, x + d*hw*.66 - 2.2*s, y + 3*s, 4.4*s, 7*s, '#2b3040', {r: 1.6*s, lw:.9*s});
        ctx.fillStyle = '#5ac8ff';
        rr(ctx, x + d*hw*.66 - 1.2*s, y + 4.4*s, 2.4*s, 4*s, .8*s); ctx.fill();
        glowDot(ctx, x + d*hw*.66, y + 6.4*s, 6*s, '#5ac8ff', .5);
      }
      break;
    }
    case 'ears': {
      for(const d of [-1, 1]){
        ctx.save(); ctx.translate(x + d*4.4*s, y - 6*s); ctx.rotate(d*.20);
        ctx.fillStyle = '#f6f8fc';
        ctx.beginPath(); ctx.ellipse(0, 0, 2.8*s, 7.6*s, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = .8*s; ctx.stroke();
        ctx.fillStyle = '#f0a0c4';
        ctx.beginPath(); ctx.ellipse(0, .6*s, 1.3*s, 5*s, 0, 0, 7); ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'propeller': {
      part(ctx, x - hw*.5, y - 5.4*s, hw, 7*s, '#e8c34a', {r: hw*.34, lw: 1*s});
      ctx.fillStyle = '#c0392b'; rr(ctx, x - 1.1*s, y - 8.4*s, 2.2*s, 4*s, .8*s); ctx.fill();
      ctx.save(); ctx.translate(x, y - 9*s); ctx.rotate(walk * 2.6);
      for(let i = 0; i < 3; i++){
        ctx.rotate(Math.PI*2/3);
        ctx.fillStyle = i === 0 ? '#5ac8ff' : (i === 1 ? '#ff7b8a' : '#7ae08a');
        ctx.beginPath(); ctx.ellipse(5.5*s, 0, 5.5*s, 1.5*s, 0, 0, 7); ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'flames': {
      for(let i = 0; i < 9; i++){
        const p = ((walk * .9 + i * 1.7) % 6) / 6;
        const fx2 = x + Math.sin(i * 2.1 + walk * .6) * 5.2*s * (1 - p*.4);
        const fy = y - 1*s - p * 16*s;
        const r2 = (5.2 - p*3.6) * s;
        ctx.globalAlpha = .82 * (1 - p);
        ctx.fillStyle = p < .35 ? '#fff3b0' : p < .68 ? '#ff9d2f' : '#e8412a';
        ctx.beginPath();
        ctx.moveTo(fx2, fy - r2*1.5); ctx.quadraticCurveTo(fx2 + r2, fy, fx2, fy + r2*.7);
        ctx.quadraticCurveTo(fx2 - r2, fy, fx2, fy - r2*1.5); ctx.fill();
      }
      ctx.globalAlpha = 1;
      glowDot(ctx, x, y - 6*s, 20*s, '#ff8a2f', .35);
      break;
    }
    case 'visor': {
      part(ctx, x - hw*.60, y + 3.4*s, hw*1.2, 5.4*s, '#12151d', {r: 1.6*s, lw: 1*s, sheen:false});
      ctx.fillStyle = '#39ff6a';
      rr(ctx, x - hw*.50, y + 4.8*s, hw*1.0, 1.9*s, .8*s); ctx.fill();
      glowDot(ctx, x, y + 5.8*s, 13*s, '#39ff6a', .55);
      break;
    }
  }
}

/* ============================================================
   CREATURES  — each type gets its own silhouette
   ============================================================ */
function drawCreature(ctx, x, y, type, o){
  const s = o.scale || 1, walk = o.walk || 0, mv = o.moving ? 1 : 0;
  const sw = Math.sin(walk) * mv;
  const bob = mv ? Math.abs(Math.sin(walk)) * 1.6 * s : Math.sin(walk*.5) * .8 * s;
  const body = readable(o.col || '#7a5a3a', .20);
  const acc  = readable(o.acc || darken(body, 30), .14);
  const eye  = o.eye || '#ff6b5a';

  ctx.save();
  ctx.translate(x, y - (type === 'wraith' ? 6*s + Math.sin(walk*.8)*2.6*s : bob));
  groundShadow(ctx, 0, (type === 'wraith' ? 8*s + Math.sin(walk*.8)*2.6*s : bob) + 2*s,
               16*s, 5.4*s, type === 'wraith' ? .22 : .40);

  switch(type){
    /* ---- hunched insectoid ---- */
    case 'drone': {
      for(const d of [-1, 1]){                      // back spines
        ctx.fillStyle = darken(acc, 10);
        ctx.beginPath(); ctx.moveTo(d*4*s, -30*s); ctx.lineTo(d*13*s, -40*s);
        ctx.lineTo(d*7*s, -26*s); ctx.closePath(); ctx.fill();
      }
      for(const d of [-1, 1]){                      // thin legs
        const off = sw*d*3*s;
        ctx.strokeStyle = darken(body, 26); ctx.lineWidth = 2.6*s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(d*4*s, -14*s);
        ctx.lineTo(d*7*s + off, -8*s); ctx.lineTo(d*5*s + off, 0); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      part(ctx, -8*s, -32*s, 16*s, 19*s, body, {r: 6*s, lw: 1.1*s});   // thorax
      for(const d of [-1, 1]){                      // arms
        ctx.strokeStyle = darken(body, 16); ctx.lineWidth = 3*s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(d*7*s, -28*s);
        ctx.lineTo(d*13*s - sw*d*2*s, -22*s); ctx.lineTo(d*11*s, -14*s); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      part(ctx, -6.4*s, -43*s, 12.8*s, 12*s, acc, {r: 5*s, lw: 1.1*s});// head
      for(const [dx, dy, r2] of [[-3.2,-38.5,1.5],[3.2,-38.5,1.5],[-4.6,-35,1],[4.6,-35,1]]){
        ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(dx*s, dy*s, r2*s, 0, 7); ctx.fill();
        glowDot(ctx, dx*s, dy*s, 5*s, eye, .55);
      }
      break;
    }
    /* ---- bulky horned beast ---- */
    case 'beast': {
      part(ctx, -14*s, -34*s, 28*s, 24*s, body, {r: 9*s, lw: 1.3*s});      // torso
      for(const d of [-1, 1]){                       // stubby legs
        const off = sw*d*3*s;
        part(ctx, d*7*s - 4.4*s, -12*s + Math.max(0, off)*.3, 8.8*s, 12*s,
             darken(body, 18), {r: 3.4*s, lw: 1.1*s});
      }
      for(const d of [-1, 1])                        // arms
        part(ctx, d*15*s - 4.6*s, -33*s - sw*d*2*s, 9.2*s, 20*s, darken(body, 8), {r: 4*s, lw: 1.1*s});
      part(ctx, -10*s, -47*s, 20*s, 16*s, lighten(body, 10), {r: 6*s, lw: 1.2*s});  // head
      for(const d of [-1, 1]){                       // horns
        const hg = vGrad(ctx, 'bh', -58*s, -44*s, [[0, '#e9eef6'], [1, '#8fa3bb']]);
        ctx.beginPath();
        ctx.moveTo(d*7*s, -45*s);
        ctx.quadraticCurveTo(d*17*s, -56*s, d*11*s, -60*s);
        ctx.quadraticCurveTo(d*12*s, -51*s, d*4*s, -44*s);
        ctx.closePath(); ctx.fillStyle = hg; ctx.fill();
        ctx.strokeStyle = '#5f7085'; ctx.lineWidth = .9*s; ctx.stroke();
      }
      for(const d of [-1, 1]){
        ctx.fillStyle = eye;
        rr(ctx, d*4.4*s - 2.4*s, -42*s, 4.8*s, 2.4*s, 1*s); ctx.fill();
        glowDot(ctx, d*4.4*s, -41*s, 7*s, eye, .6);
      }
      ctx.fillStyle = '#f2f6fc';                     // tusks
      for(const d of [-1, 1]){
        ctx.beginPath(); ctx.moveTo(d*3.4*s, -34*s); ctx.lineTo(d*5*s, -30*s);
        ctx.lineTo(d*1.8*s, -33*s); ctx.closePath(); ctx.fill();
      }
      break;
    }
    /* ---- angular sentry robot ---- */
    case 'sentry': {
      for(const d of [-1, 1]){
        const off = sw*d*3.4*s;
        part(ctx, d*5*s - 3.4*s, -16*s + Math.max(0, off)*.3, 6.8*s, 16*s,
             darken(body, 22), {r: 2*s, lw: 1.1*s});
      }
      ctx.beginPath();                               // angular chest
      ctx.moveTo(-11*s, -36*s); ctx.lineTo(11*s, -36*s); ctx.lineTo(8*s, -15*s);
      ctx.lineTo(-8*s, -15*s); ctx.closePath();
      ctx.fillStyle = vGrad(ctx, body + 'S', -36*s, -15*s, [
        [0, lighten(body, 34)], [.5, body], [1, darken(body, 30)]]);
      ctx.fill();
      ctx.strokeStyle = outlineFor(body); ctx.lineWidth = 1.25*s; ctx.stroke();
      ctx.strokeStyle = alpha(darken(body, 45), .7); ctx.lineWidth = 1*s;
      ctx.beginPath(); ctx.moveTo(-7*s, -28*s); ctx.lineTo(7*s, -28*s); ctx.stroke();
      for(const d of [-1, 1])
        part(ctx, d*13*s - 3.6*s, -35*s - sw*d*2*s, 7.2*s, 19*s, darken(body, 12), {r: 2.4*s, lw: 1.1*s});
      ctx.beginPath();                               // head
      ctx.moveTo(-7*s, -50*s); ctx.lineTo(7*s, -50*s); ctx.lineTo(6*s, -37*s);
      ctx.lineTo(-6*s, -37*s); ctx.closePath();
      ctx.fillStyle = lighten(body, 12); ctx.fill();
      ctx.strokeStyle = outlineFor(body); ctx.lineWidth = 1.2*s; ctx.stroke();
      ctx.fillStyle = eye;                            // single visor
      rr(ctx, -5*s, -46*s, 10*s, 3*s, 1.2*s); ctx.fill();
      glowDot(ctx, 0, -44.5*s, 12*s, eye, .7);
      ctx.fillStyle = alpha(eye, .8);                 // core
      ctx.beginPath(); ctx.arc(0, -26*s, 2.6*s, 0, 7); ctx.fill();
      glowDot(ctx, 0, -26*s, 9*s, eye, .55);
      break;
    }
    /* ---- floating shrouded wraith ---- */
    case 'wraith': {
      const t2 = walk;
      ctx.beginPath();                                // tattered robe
      ctx.moveTo(-12*s, -34*s);
      ctx.quadraticCurveTo(-15*s, -14*s, -11*s, -2*s);
      for(let i = -2; i <= 2; i++){
        const px = i*5.2*s, py = -2*s + Math.sin(t2*2 + i)*3.4*s;
        ctx.lineTo(px, py); ctx.lineTo(px + 2.6*s, py - 5*s);
      }
      ctx.quadraticCurveTo(15*s, -14*s, 12*s, -34*s);
      ctx.closePath();
      ctx.fillStyle = vGrad(ctx, body + 'W', -40*s, 0, [
        [0, lighten(body, 30)], [.6, body], [1, alpha(darken(body, 20), .35)]]);
      ctx.fill();
      ctx.strokeStyle = outlineFor(body); ctx.lineWidth = 1.15*s; ctx.stroke();
      ctx.beginPath();                                // hood
      ctx.moveTo(-11*s, -34*s);
      ctx.quadraticCurveTo(0, -54*s, 11*s, -34*s);
      ctx.quadraticCurveTo(0, -30*s, -11*s, -34*s);
      ctx.closePath();
      ctx.fillStyle = darken(body, 20); ctx.fill();
      ctx.strokeStyle = outlineFor(body); ctx.lineWidth = 1.15*s; ctx.stroke();
      ctx.fillStyle = 'rgba(6,4,12,.92)';             // void inside the hood
      ctx.beginPath(); ctx.ellipse(0, -37*s, 7*s, 6*s, 0, 0, 7); ctx.fill();
      for(const d of [-1, 1]){
        ctx.fillStyle = eye;
        ctx.beginPath(); ctx.ellipse(d*3*s, -38*s, 1.7*s, 2.4*s, 0, 0, 7); ctx.fill();
        glowDot(ctx, d*3*s, -38*s, 8*s, eye, .8);
      }
      for(const d of [-1, 1]){                        // claw hands
        ctx.strokeStyle = lighten(body, 40); ctx.lineWidth = 1.6*s; ctx.lineCap = 'round';
        for(let k = -1; k <= 1; k++){
          ctx.beginPath(); ctx.moveTo(d*11*s, -24*s);
          ctx.lineTo(d*15*s + k*1.6*s, -17*s + Math.abs(k)*1.4*s); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      glowDot(ctx, 0, -20*s, 30*s, eye, .16);
      break;
    }
    /* ---- massive symbiote brute ---- */
    case 'brute': {
      for(let i = 0; i < 5; i++){                     // writhing tendrils
        const a = -2.2 + i*.55, len = (13 + Math.sin(walk*1.4 + i)*5) * s;
        ctx.strokeStyle = alpha(acc, .85); ctx.lineWidth = (3 - i%2) * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, -40*s);
        ctx.quadraticCurveTo(Math.cos(a)*len*1.3, -46*s + Math.sin(a)*len*.6,
                             Math.cos(a)*len*1.9, -52*s + Math.sin(a)*len);
        ctx.stroke(); ctx.lineCap = 'butt';
      }
      for(const d of [-1, 1]){
        const off = sw*d*3.4*s;
        part(ctx, d*8*s - 6*s, -18*s + Math.max(0, off)*.3, 12*s, 18*s, darken(body, 10), {r: 4.4*s, lw: 1.3*s});
      }
      part(ctx, -19*s, -46*s, 38*s, 30*s, body, {r: 11*s, lw: 1.4*s});   // huge torso
      ctx.save(); rr(ctx, -19*s, -46*s, 38*s, 30*s, 11*s); ctx.clip();
      ctx.strokeStyle = alpha(acc, .75); ctx.lineWidth = 1.6*s;          // veins
      for(let i = 0; i < 5; i++){
        ctx.beginPath(); ctx.moveTo(-16*s + i*8*s, -46*s);
        ctx.quadraticCurveTo(-12*s + i*8*s, -32*s, -17*s + i*8*s, -16*s); ctx.stroke();
      }
      ctx.restore();
      for(const d of [-1, 1]){                        // heavy arms
        part(ctx, d*22*s - 6.4*s, -44*s - sw*d*2.4*s, 12.8*s, 26*s, lighten(body, 6), {r: 5*s, lw: 1.3*s});
        part(ctx, d*22*s - 7.4*s, -46*s - sw*d*2.4*s, 14.8*s, 10*s, acc, {r: 5*s, lw: 1.2*s});
      }
      part(ctx, -12*s, -62*s, 24*s, 19*s, lighten(body, 8), {r: 8*s, lw: 1.3*s});  // head
      for(const d of [-1, 1]){                        // white eye patches
        ctx.fillStyle = '#f2f6fc';
        ctx.beginPath();
        ctx.moveTo(d*2.4*s, -55*s); ctx.quadraticCurveTo(d*6*s, -58*s, d*9.4*s, -54*s);
        ctx.quadraticCurveTo(d*6*s, -50*s, d*2.4*s, -52*s); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#f2f6fc';                      // grin
      ctx.beginPath(); ctx.moveTo(-8*s, -47*s);
      for(let i = 0; i < 7; i++) ctx.lineTo((-8 + i*2.7)*s, -47*s + (i%2 ? 3.4 : 0)*s);
      ctx.lineTo(8*s, -47*s); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = .8*s; ctx.stroke();
      glowDot(ctx, 0, -40*s, 40*s, acc, .18);
      break;
    }
    /* ---- bandits & raiders: scruffy humans ---- */
    default: {
      drawFigure(ctx, 0, 0, {
        scale: s, skin: lighten(body, 26), shirt: body, pants: acc,
        face: 'angry', acc: 'none', helmet: 'none',
        hair: type === 'raider' ? '#1d1a16' : '#3a2a1c',
        moving: o.moving, walk: walk, aimx: o.aimx
      });
      // bandana over the mouth
      ctx.save(); ctx.translate(0, -bob);
      const bx = (o.aimx || 0) * 1.1 * s;
      part(ctx, bx - 8*s, -44*s, 16*s, 6.4*s, type === 'raider' ? '#8e2b2b' : '#4a5a3a',
           {r: 1.8*s, sheen:false, lw: .9*s});
      ctx.restore();
      break;
    }
  }
  if(o.flash){
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,140,140,' + (o.flash*.5) + ')';
    ctx.fillRect(-30*s, -66*s, 60*s, 70*s);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

/* ============================================================
   BAKED PROP SPRITES — drawn once, blitted thereafter
   ============================================================ */
const _props = {};
function propSprite(kind, size){
  const key = kind + '|' + size;
  if(_props[key]) return _props[key];
  const W = Math.ceil(size * 3.2), H = Math.ceil(size * 3.6);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const cx = W/2, by = H - size*0.35, s = size/10;   // baseline
  const rnd = mulberry(kind.length * 977 + size * 31);

  const shadow = () => groundShadow(x, cx, by, size*.95, size*.34, .34);

  switch(kind){
    case 'rock': {
      shadow();
      const g2 = x.createLinearGradient(cx - size, by - size*1.4, cx + size, by);
      g2.addColorStop(0, '#5b6478'); g2.addColorStop(.5, '#414a5c'); g2.addColorStop(1, '#2a3040');
      x.beginPath();
      x.moveTo(cx - size, by);
      x.lineTo(cx - size*.72, by - size*.92);
      x.lineTo(cx - size*.12, by - size*1.28);
      x.lineTo(cx + size*.66, by - size*1.02);
      x.lineTo(cx + size, by - size*.24);
      x.closePath(); x.fillStyle = g2; x.fill();
      x.strokeStyle = '#20263340'; x.lineWidth = 1.4; x.stroke();
      x.fillStyle = 'rgba(255,255,255,.16)';
      x.beginPath();
      x.moveTo(cx - size*.66, by - size*.88); x.lineTo(cx - size*.10, by - size*1.20);
      x.lineTo(cx + size*.10, by - size*.80); x.lineTo(cx - size*.44, by - size*.62);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.30)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx - size*.2, by - size*.9); x.lineTo(cx + size*.3, by - size*.3); x.stroke();
      break;
    }
    case 'crystal': {
      shadow();
      for(const [ox, h, w, col] of [[-.5, 1.5, .34, '#7f5ce0'], [.42, 2.2, .40, '#a07cff'], [.06, 1.1, .28, '#6b4ac2']]){
        const px = cx + ox*size;
        const g2 = x.createLinearGradient(px - w*size, by - h*size, px + w*size, by);
        g2.addColorStop(0, lighten(col, 60)); g2.addColorStop(.5, col); g2.addColorStop(1, darken(col, 40));
        x.beginPath();
        x.moveTo(px, by - h*size);
        x.lineTo(px + w*size, by - h*size*.42);
        x.lineTo(px + w*size*.6, by); x.lineTo(px - w*size*.6, by);
        x.lineTo(px - w*size, by - h*size*.42);
        x.closePath(); x.fillStyle = g2; x.fill();
        x.strokeStyle = 'rgba(220,200,255,.55)'; x.lineWidth = 1; x.stroke();
        x.fillStyle = 'rgba(255,255,255,.35)';
        x.beginPath(); x.moveTo(px, by - h*size); x.lineTo(px + w*size*.34, by - h*size*.5);
        x.lineTo(px, by - h*size*.2); x.closePath(); x.fill();
      }
      break;
    }
    case 'tree': {
      shadow();
      const tg = x.createLinearGradient(cx - size*.3, 0, cx + size*.3, 0);
      tg.addColorStop(0, '#4a3a2a'); tg.addColorStop(.5, '#3a2c20'); tg.addColorStop(1, '#241a12');
      x.fillStyle = tg;
      x.beginPath();
      x.moveTo(cx - size*.26, by); x.lineTo(cx - size*.16, by - size*1.5);
      x.lineTo(cx + size*.16, by - size*1.5); x.lineTo(cx + size*.26, by);
      x.closePath(); x.fill();
      for(const d of [-1, 1]){
        x.strokeStyle = '#3a2c20'; x.lineWidth = size*.16; x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx, by - size*1.1);
        x.quadraticCurveTo(cx + d*size*.5, by - size*1.5, cx + d*size*.72, by - size*1.9); x.stroke();
      }
      x.lineCap = 'butt';
      for(let i = 0; i < 5; i++){                   // canopy blobs
        const px = cx + (rnd()-.5)*size*1.5, py = by - size*(1.9 + rnd()*.7), pr = size*(.55 + rnd()*.4);
        const g2 = x.createRadialGradient(px - pr*.3, py - pr*.3, pr*.1, px, py, pr);
        g2.addColorStop(0, '#5d8a52'); g2.addColorStop(.6, '#3f6b3c'); g2.addColorStop(1, '#27452a');
        x.fillStyle = g2; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
      }
      break;
    }
    case 'deadtree': {
      shadow();
      x.strokeStyle = '#4a4437'; x.lineCap = 'round';
      x.lineWidth = size*.30;
      x.beginPath(); x.moveTo(cx, by); x.lineTo(cx - size*.1, by - size*1.9); x.stroke();
      x.lineWidth = size*.17;
      for(const [dx, dy, ex, ey] of [[-.08,-1.1,-.85,-1.75],[-.08,-1.4,.7,-2.05],[-.1,-1.75,-.5,-2.35]]){
        x.beginPath(); x.moveTo(cx + dx*size, by + dy*size);
        x.quadraticCurveTo(cx + ex*size*.6, by + dy*size - size*.2, cx + ex*size, by + ey*size);
        x.stroke();
      }
      x.lineWidth = size*.09;
      for(const [sx, sy, ex, ey] of [[-.85,-1.75,-1.2,-2.1],[.7,-2.05,1.05,-2.4]]){
        x.beginPath(); x.moveTo(cx + sx*size, by + sy*size); x.lineTo(cx + ex*size, by + ey*size); x.stroke();
      }
      x.lineCap = 'butt';
      break;
    }
    case 'crate': {
      shadow();
      const w = size*1.5, h = size*1.2;
      const g3 = x.createLinearGradient(cx - w/2, by - h, cx + w/2, by);
      g3.addColorStop(0, '#8a6a3e'); g3.addColorStop(.5, '#6b5130'); g3.addColorStop(1, '#46351f');
      x.fillStyle = g3; rr(x, cx - w/2, by - h, w, h, 2); x.fill();
      x.strokeStyle = '#2a1f11'; x.lineWidth = 1.6; x.stroke();
      x.strokeStyle = 'rgba(255,225,180,.22)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx - w/2, by - h); x.lineTo(cx + w/2, by); x.stroke();
      x.beginPath(); x.moveTo(cx + w/2, by - h); x.lineTo(cx - w/2, by); x.stroke();
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2.4;
      x.beginPath(); x.moveTo(cx - w/2, by - h*.30); x.lineTo(cx + w/2, by - h*.30); x.stroke();
      break;
    }
    case 'barrel': {
      shadow();
      const w = size*1.1, h = size*1.5;
      const g2 = x.createLinearGradient(cx - w/2, 0, cx + w/2, 0);
      g2.addColorStop(0, '#5a6470'); g2.addColorStop(.35, '#79838f'); g2.addColorStop(1, '#39414c');
      x.fillStyle = g2; rr(x, cx - w/2, by - h, w, h, w*.22); x.fill();
      x.strokeStyle = '#232a33'; x.lineWidth = 1.4; x.stroke();
      x.fillStyle = '#8d97a4'; x.beginPath(); x.ellipse(cx, by - h, w/2, w*.16, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 2;
      for(const fy of [.30, .70]){ x.beginPath(); x.moveTo(cx - w/2, by - h*fy); x.lineTo(cx + w/2, by - h*fy); x.stroke(); }
      x.fillStyle = 'rgba(90,220,110,.55)';
      x.beginPath(); x.arc(cx - w*.1, by - h*.52, w*.16, 0, 7); x.fill();
      break;
    }
    case 'scrap': {
      shadow();
      for(let i = 0; i < 5; i++){
        const px = cx + (rnd()-.5)*size*1.8, py = by - rnd()*size*.9;
        x.save(); x.translate(px, py); x.rotate((rnd()-.5)*2);
        const w = size*(.4 + rnd()*.7), h = size*(.2 + rnd()*.3);
        x.fillStyle = ['#6b7280','#7d5a3a','#4a5560','#8a6a4a'][i % 4];
        rr(x, -w/2, -h/2, w, h, 2); x.fill();
        x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 1.2; x.stroke();
        x.fillStyle = 'rgba(255,255,255,.18)'; rr(x, -w/2, -h/2, w, h*.35, 2); x.fill();
        x.restore();
      }
      break;
    }
    case 'bones': {
      shadow();
      x.strokeStyle = '#d8d3c4'; x.lineWidth = size*.16; x.lineCap = 'round';
      for(let i = 0; i < 3; i++){
        const px = cx + (rnd()-.5)*size*1.4, py = by - rnd()*size*.3, a = rnd()*3;
        x.save(); x.translate(px, py); x.rotate(a);
        x.beginPath(); x.moveTo(-size*.4, 0); x.lineTo(size*.4, 0); x.stroke();
        x.fillStyle = '#e8e3d4';
        x.beginPath(); x.arc(-size*.44, -size*.06, size*.11, 0, 7); x.fill();
        x.beginPath(); x.arc(-size*.44, size*.06, size*.11, 0, 7); x.fill();
        x.beginPath(); x.arc(size*.44, -size*.06, size*.11, 0, 7); x.fill();
        x.beginPath(); x.arc(size*.44, size*.06, size*.11, 0, 7); x.fill();
        x.restore();
      }
      x.lineCap = 'butt';
      break;
    }
    case 'mushroom': {
      shadow();
      x.fillStyle = '#d9d2c0';
      rr(x, cx - size*.16, by - size*.9, size*.32, size*.9, size*.12); x.fill();
      const g2 = x.createRadialGradient(cx - size*.2, by - size*1.1, size*.05, cx, by - size*.9, size*.8);
      g2.addColorStop(0, '#7ce0b0'); g2.addColorStop(1, '#2f8a63');
      x.fillStyle = g2;
      x.beginPath(); x.ellipse(cx, by - size*.92, size*.72, size*.46, 0, Math.PI, 0); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.1; x.stroke();
      x.fillStyle = 'rgba(255,255,255,.45)';
      for(let i = 0; i < 4; i++)
        x.beginPath(), x.arc(cx + (rnd()-.5)*size*1.0, by - size*(1.0 + rnd()*.2), size*.07, 0, 7), x.fill();
      break;
    }
    case 'shard': {                                  // void rift shard
      shadow();
      const g2 = x.createLinearGradient(cx, by - size*2, cx, by);
      g2.addColorStop(0, '#e9d6ff'); g2.addColorStop(.5, '#8b5cf6'); g2.addColorStop(1, '#2a1450');
      x.beginPath();
      x.moveTo(cx, by - size*2.1); x.lineTo(cx + size*.42, by - size*.7);
      x.lineTo(cx + size*.18, by); x.lineTo(cx - size*.3, by);
      x.lineTo(cx - size*.44, by - size*.8);
      x.closePath(); x.fillStyle = g2; x.fill();
      x.strokeStyle = 'rgba(230,210,255,.7)'; x.lineWidth = 1.1; x.stroke();
      break;
    }
    case 'ice': {
      shadow();
      const g2 = x.createLinearGradient(cx, by - size*1.4, cx, by);
      g2.addColorStop(0, '#e8f8ff'); g2.addColorStop(.5, '#8fd6f5'); g2.addColorStop(1, '#3d7ea0');
      x.beginPath();
      x.moveTo(cx - size*.8, by); x.lineTo(cx - size*.4, by - size*1.3);
      x.lineTo(cx + size*.2, by - size*1.05); x.lineTo(cx + size*.75, by);
      x.closePath(); x.fillStyle = g2; x.fill();
      x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = 1; x.stroke();
      break;
    }
    default: {                                       // grass tuft
      x.strokeStyle = 'rgba(130,170,120,.55)'; x.lineWidth = 1.8; x.lineCap = 'round';
      for(let i = 0; i < 5; i++){
        const px = cx + (i - 2) * size*.24;
        x.beginPath(); x.moveTo(px, by);
        x.quadraticCurveTo(px + (rnd()-.5)*size*.4, by - size*.5, px + (rnd()-.5)*size*.9, by - size*.9);
        x.stroke();
      }
      x.lineCap = 'butt';
    }
  }
  _props[key] = c;
  return c;
}
const PROP_GLOW = { crystal:['#a07cff',.42], shard:['#b47bff',.46], mushroom:['#7ce0b0',.30] };
function drawProp(ctx, kind, x, y, size, t){
  const gl = PROP_GLOW[kind];
  if(gl){
    const pulse = .82 + .18*Math.sin((t||0)*1.6 + x*0.03);
    glowDot(ctx, x, y - size*1.05, size*2.6, gl[0], gl[1]*pulse);
  }
  const spr = propSprite(kind, size);
  ctx.drawImage(spr, x - spr.width/2, y - (spr.height - size*0.35));
}
