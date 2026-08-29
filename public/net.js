/* ============================================================
   TEMPLE OF HEROES — cloud saves + shared bounty board
   Degrades to pure local play whenever the server is unreachable.
   ============================================================ */
'use strict';

const NET = {
  online: false,
  tried: false,
  name: null,
  token: null,
  world: { bounties: [], leaderboard: [], feed: [] },
  seenFeed: new Set(),
  backoffUntil: 0,
  status: 'offline',

  /* a per-browser secret that proves this save is yours */
  getToken() {
    let t = null;
    try { t = localStorage.getItem('toh_token'); } catch (e) {}
    if (!t) {
      const a = new Uint8Array(24);
      (self.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256);
      t = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('toh_token', t); } catch (e) {}
    }
    this.token = t;
    return t;
  },

  async req(method, url, body) {
    if (Date.now() < this.backoffUntil) throw new Error('backoff');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || ('HTTP ' + res.status)); e.data = data; e.status = res.status; throw e; }
      return data;
    } catch (e) {
      if (e.name === 'AbortError' || e.message === 'Failed to fetch') {
        this.online = false; this.status = 'offline';
        this.backoffUntil = Date.now() + 20000;      // stop hammering a sleeping server
      }
      throw e;
    } finally { clearTimeout(timer); }
  },

  /* create or resume the cloud save for this name */
  async session(name) {
    this.tried = true;
    this.name = name;
    try {
      const d = await this.req('POST', '/api/session', { name, token: this.getToken() });
      this.online = true; this.status = 'online';
      this.applyWorld(d.world);
      return d;                                   // {player, state, world}
    } catch (e) {
      this.online = false;
      this.status = e.status === 409 ? 'taken' : 'offline';
      if (e.status === 409) this.takenMessage = e.data && e.data.error;
      return null;
    }
  },

  async sync(payload) {
    if (!this.name) return null;
    try {
      const d = await this.req('POST', '/api/sync', { name: this.name, token: this.token, state: payload });
      this.online = true; this.status = 'online';
      this.applyWorld(d.world);
      return d;                                   // {bounty, world}
    } catch (e) { return null; }
  },

  async place(target, amount) {
    return this.req('POST', '/api/bounty/place', { name: this.name, token: this.token, target, amount });
  },
  async claim(target) {
    return this.req('POST', '/api/bounty/claim', { name: this.name, token: this.token, target });
  },
  announce(kind, detail) {
    if (!this.online) return;
    this.req('POST', '/api/announce', { name: this.name, token: this.token, kind, detail }).catch(() => {});
  },

  applyWorld(w) {
    if (!w) return;
    this.world = { bounties: w.bounties || [], leaderboard: w.leaderboard || [], feed: w.feed || [] };
    if (typeof this.onFeed === 'function') {
      // surface only events we have not shown yet, oldest first
      const fresh = this.world.feed.filter(f => {
        const key = f.created_at + '|' + f.kind + '|' + f.actor + '|' + (f.target || '');
        if (this.seenFeed.has(key)) return false;
        this.seenFeed.add(key); return true;
      }).reverse();
      if (this.seenFeed.size > 400) this.seenFeed = new Set(Array.from(this.seenFeed).slice(-200));
      if (this.firstFeedDone) fresh.forEach(f => this.onFeed(f));
      this.firstFeedDone = true;
    }
  }
};

/* ============================================================
   LIVE MULTIPLAYER CLIENT
   Peers are interpolated between 12Hz snapshots. Each client is
   authoritative for its own health, so damage is relayed, not simulated.
   ============================================================ */
NET.peers = new Map();          // name -> {x,y,tx,ty,walk,moving,aimx,hero,tier,hp,max,bounty,look}
NET.ws = null;
NET.liveState = 'off';          // off | connecting | live
NET.lastSend = 0;

NET.connectLive = function(){
  if(!this.name || !this.token) return;
  if(this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
  let url;
  try {
    url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live';
  } catch(e){ return; }
  this.liveState = 'connecting';
  let ws;
  try { ws = new WebSocket(url); } catch(e){ this.liveState = 'off'; return; }
  this.ws = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type:'hello', name:this.name, token:this.token }));

  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
    switch(m.type){
      case 'welcome':
        this.liveState = 'live';
        if(typeof this.onLive === 'function') this.onLive(m.count);
        break;
      case 'denied':
        this.liveState = 'off';
        try { ws.close(); } catch(e){}
        break;
      case 'snapshot': {
        const seen = new Set();
        for(const p of m.players){
          if(p.n === this.name) continue;
          seen.add(p.n);
          let q = this.peers.get(p.n);
          if(!q){
            q = { x:p.x, y:p.y, tx:p.x, ty:p.y, walk:0, moving:false, aimx:1,
                  hero:p.h, tier:p.t, hp:p.hp, max:p.mx, bounty:p.b, look:p.lk||{} };
            this.peers.set(p.n, q);
          }
          q.tx = p.x; q.ty = p.y; q.walk = p.w; q.moving = !!p.m; q.aimx = p.a;
          q.hero = p.h; q.tier = p.t; q.hp = p.hp; q.max = p.mx;
          q.bounty = p.b; q.look = p.lk || q.look;
        }
        for(const n of [...this.peers.keys()]) if(!seen.has(n)) this.peers.delete(n);
        break;
      }
      case 'joined': if(typeof this.onPeerEvent === 'function') this.onPeerEvent('joined', m); break;
      case 'bye':    this.peers.delete(m.name);
                     if(typeof this.onPeerEvent === 'function') this.onPeerEvent('bye', m); break;
      case 'hurt':   if(typeof this.onHurt === 'function') this.onHurt(m.from, m.dmg); break;
      case 'kill':   if(typeof this.onKill === 'function') this.onKill(m.killer, m.victim); break;
    }
  };

  ws.onclose = () => {
    this.liveState = 'off'; this.peers.clear();
    // come back when the tab is still alive and the session is still ours
    if(this.name) setTimeout(() => this.connectLive(), 4000);
  };
  ws.onerror = () => { try { ws.close(); } catch(e){} };
};

NET.sendState = function(o){
  if(this.liveState !== 'live' || !this.ws || this.ws.readyState !== 1) return;
  const now = performance.now();
  if(now - this.lastSend < 80) return;           // ~12Hz
  this.lastSend = now;
  try { this.ws.send(JSON.stringify({ type:'state', ...o })); } catch(e){}
};
NET.sendHit = function(target, dmg){
  if(this.liveState !== 'live' || !this.ws || this.ws.readyState !== 1) return;
  try { this.ws.send(JSON.stringify({ type:'hit', target, dmg })); } catch(e){}
};
NET.sendDied = function(killer){
  if(this.liveState !== 'live' || !this.ws || this.ws.readyState !== 1) return;
  try { this.ws.send(JSON.stringify({ type:'died', killer })); } catch(e){}
};
NET.disconnectLive = function(){
  this.name = null;
  if(this.ws){ try { this.ws.close(); } catch(e){} this.ws = null; }
  this.peers.clear(); this.liveState = 'off';
};
