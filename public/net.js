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
