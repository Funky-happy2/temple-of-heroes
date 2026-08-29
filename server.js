/* ============================================================
   TEMPLE OF HEROES — API + static host
   ============================================================ */
'use strict';

const path    = require('path');
const crypto  = require('crypto');
const http    = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');

const app  = express();
const live = new Map();                    // ws -> live player record
const PORT = process.env.PORT || 3000;

/* ---------- database ---------- */
const RAW_URL = process.env.DATABASE_URL || '';
let pool = null;

if (RAW_URL) {
  // strip libpq-only query params and set TLS explicitly (Neon requires TLS)
  const clean = RAW_URL.split('?')[0];
  pool = new Pool({
    connectionString: clean,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', e => console.error('[pg] idle client error:', e.message));
} else {
  console.warn('[boot] DATABASE_URL is not set — running in OFFLINE mode (no cloud saves).');
}

const q = (text, params) => pool.query(text, params);

/* ---------- helpers ---------- */
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const NAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

function badName(name) { return typeof name !== 'string' || !NAME_RE.test(name); }

/* ---------- passwords (scrypt, no native dependency) ---------- */
function hashPassword(pw, salt){
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), s, 64).toString('hex');
  return { hash: h, salt: s };
}
function passwordMatches(pw, hash, salt){
  if(!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(pw), salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if(candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}
const newToken = () => crypto.randomBytes(32).toString('hex');

async function createSession(playerId){
  const token = newToken();
  await q('insert into sessions (token_hash, player_id) values ($1,$2)', [sha(token), playerId]);
  // keep at most 10 devices per account
  await q(`delete from sessions where token_hash in (
             select token_hash from sessions where player_id = $1
             order by last_used desc offset 10)`, [playerId]);
  return token;
}

/* very small in-memory rate limiter: N requests per window per IP */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || 'anon';
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now > rec.reset) { rec = { n: 0, reset: now + windowMs }; hits.set(ip, rec); }
    if (++rec.n > max) return res.status(429).json({ error: 'Slow down.' });
    next();
  };
}
setInterval(() => {                       // keep the limiter map from growing forever
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.reset) hits.delete(ip);
}, 60000).unref();

function requireDb(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'offline', offline: true });
  next();
}

/* authenticate by session token (falls back to the legacy per-browser token) */
async function auth(name, token) {
  if (badName(name) || typeof token !== 'string' || token.length < 16) return null;
  const { rows } = await q(
    `select p.* from sessions s join players p on p.id = s.player_id
      where s.token_hash = $1 and p.name_lower = $2`, [sha(token), name.toLowerCase()]);
  if (rows[0]) {
    q('update sessions set last_used = now() where token_hash = $1', [sha(token)]).catch(()=>{});
    return rows[0];
  }
  // legacy guest saves created before accounts existed
  const g = await q('select * from players where name_lower = $1 and token_hash = $2',
                    [name.toLowerCase(), sha(token)]);
  return g.rows[0] || null;
}

async function addFeed(kind, actor, target, amount, detail) {
  try {
    await q('insert into feed (kind, actor, target, amount, detail) values ($1,$2,$3,$4,$5)',
            [kind, actor, target || null, amount || 0, detail || null]);
  } catch (e) { console.error('[feed]', e.message); }
}

/* the public snapshot every client polls for */
async function worldSnapshot(me) {
  const [bounties, board, feed] = await Promise.all([
    q(`select name, hero, hero_name, hero_tier, bounty, look, kills
         from players where bounty > 0 and name_lower <> $1
        order by bounty desc limit 12`, [(me || '').toLowerCase()]),
    q(`select name, hero_name, hero_tier, kills, deaths, best_streak, cash, bounty
         from players order by kills desc, cash desc limit 15`),
    q(`select kind, actor, target, amount, detail, created_at
         from feed order by created_at desc limit 12`)
  ]);
  return { bounties: bounties.rows, leaderboard: board.rows, feed: feed.rows, ts: Date.now() };
}

/* ---------- middleware ---------- */
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
// no-store on the HTML shell, revalidate assets: a deploy must reach players immediately
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true, lastModified: true, maxAge: 0,
  setHeaders(res, filePath){
    res.setHeader('Cache-Control', filePath.endsWith('.html') ? 'no-store' : 'no-cache');
  }
}));

/* ---------- routes ---------- */
app.get('/api/health', async (req, res) => {
  if (!pool) return res.json({ ok: true, db: false, mode: 'offline' });
  try {
    const { rows } = await q('select count(*)::int as players from players');
    res.json({ ok: true, db: true, players: rows[0].players, uptime: Math.round(process.uptime()) });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

/* ---------- accounts ---------- */
const PW_MIN = 6;

app.post('/api/signup', requireDb, rateLimit(12, 60000), async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (badName(name))
      return res.status(400).json({ error: 'Name must be 3-16 characters: letters, numbers, _ or -.' });
    if (typeof password !== 'string' || password.length < PW_MIN)
      return res.status(400).json({ error: 'Password must be at least ' + PW_MIN + ' characters.' });

    const exists = await q('select id from players where name_lower = $1', [name.toLowerCase()]);
    if (exists.rows[0]) return res.status(409).json({ error: 'That name is already taken.' });

    const { hash, salt } = hashPassword(password);
    const ins = await q(
      `insert into players (name, name_lower, token_hash, password_hash, password_salt)
       values ($1,$2,$3,$4,$5) returning *`,
      [name, name.toLowerCase(), sha(newToken()), hash, salt]);
    const p = ins.rows[0];
    const token = await createSession(p.id);
    await addFeed('joined', p.name, null, 0, 'created an account');
    res.json({ ok: true, name: p.name, token,
               player: { name: p.name, cash: Number(p.cash), cores: p.cores, bounty: 0 },
               state: null, world: await worldSnapshot(p.name) });
  } catch (e) {
    console.error('[signup]', e.message);
    res.status(500).json({ error: 'Could not create that account.' });
  }
});

app.post('/api/login', requireDb, rateLimit(20, 60000), async (req, res) => {
  try {
    const { name, password } = req.body || {};
    if (badName(name) || typeof password !== 'string')
      return res.status(400).json({ error: 'Enter a name and password.' });
    const { rows } = await q('select * from players where name_lower = $1', [name.toLowerCase()]);
    const p = rows[0];
    // same message either way, so this cannot be used to enumerate names
    if (!p || !p.password_hash || !passwordMatches(password, p.password_hash, p.password_salt))
      return res.status(401).json({ error: 'Wrong name or password.' });

    const token = await createSession(p.id);
    await q('update players set last_seen = now() where id = $1', [p.id]);
    res.json({ ok: true, name: p.name, token,
               player: { name: p.name, cash: Number(p.cash), cores: p.cores, bounty: Number(p.bounty) },
               state: p.state && Object.keys(p.state).length ? p.state : null,
               world: await worldSnapshot(p.name) });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Sign in failed.' });
  }
});

/* resume an existing session token (no password needed) */
app.post('/api/resume', requireDb, rateLimit(60, 60000), async (req, res) => {
  try {
    const { name, token } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Session expired.' });
    await q('update players set last_seen = now() where id = $1', [p.id]);
    res.json({ ok: true, name: p.name,
               player: { name: p.name, cash: Number(p.cash), cores: p.cores, bounty: Number(p.bounty) },
               state: p.state && Object.keys(p.state).length ? p.state : null,
               world: await worldSnapshot(p.name) });
  } catch (e) { res.status(500).json({ error: 'Resume failed.' }); }
});

app.post('/api/logout', requireDb, rateLimit(30, 60000), async (req, res) => {
  try {
    const { token } = req.body || {};
    if (typeof token === 'string' && token.length >= 16)
      await q('delete from sessions where token_hash = $1', [sha(token)]);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: true }); }
});

/* set a password on a legacy guest save, turning it into a real account */
app.post('/api/claim-account', requireDb, rateLimit(10, 60000), async (req, res) => {
  try {
    const { name, token, password } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Not your save.' });
    if (p.password_hash) return res.status(400).json({ error: 'This account already has a password.' });
    if (typeof password !== 'string' || password.length < PW_MIN)
      return res.status(400).json({ error: 'Password must be at least ' + PW_MIN + ' characters.' });
    const { hash, salt } = hashPassword(password);
    await q('update players set password_hash = $2, password_salt = $3 where id = $1', [p.id, hash, salt]);
    const fresh = await createSession(p.id);
    res.json({ ok: true, token: fresh });
  } catch (e) { res.status(500).json({ error: 'Could not set a password.' }); }
});

/* create or resume a save */
app.post('/api/session', requireDb, rateLimit(30, 60000), async (req, res) => {
  try {
    const { name, token } = req.body || {};
    if (badName(name)) return res.status(400).json({ error: 'Name must be 3-16 letters, numbers, _ or -.' });
    if (typeof token !== 'string' || token.length < 16) return res.status(400).json({ error: 'Bad token.' });

    const { rows } = await q('select * from players where name_lower = $1', [name.toLowerCase()]);
    let p = rows[0];

    if (!p) {
      const ins = await q(
        `insert into players (name, name_lower, token_hash) values ($1,$2,$3) returning *`,
        [name, name.toLowerCase(), sha(token)]);
      p = ins.rows[0];
      await addFeed('joined', p.name, null, 0, 'entered the plaza');
    } else if (p.token_hash !== sha(token)) {
      return res.status(409).json({ error: 'That name is taken by another player on this server.', taken: true });
    } else {
      await q('update players set last_seen = now() where id = $1', [p.id]);
    }

    res.json({
      ok: true,
      player: { name: p.name, cash: Number(p.cash), cores: p.cores, bounty: Number(p.bounty) },
      state: p.state && Object.keys(p.state).length ? p.state : null,
      world: await worldSnapshot(p.name)
    });
  } catch (e) {
    console.error('[session]', e.message);
    res.status(500).json({ error: 'Session failed.' });
  }
});

/* push a save, pull the world */
app.post('/api/sync', requireDb, rateLimit(120, 60000), async (req, res) => {
  try {
    const { name, token, state, heatDelta, heatWipe } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Not your save.' });
    if (!state || typeof state !== 'object') return res.status(400).json({ error: 'No state.' });

    const st = state;
    // heat (your own bounty) is server-owned so a hunter's claim can't be undone by your next save
    const delta = clampInt(heatDelta, 0, 5e8);
    if (heatWipe === true) await q('update players set bounty = 0 where id = $1', [p.id]);
    else if (delta > 0)    await q('update players set bounty = greatest(0, bounty + $2) where id = $1', [p.id, delta]);
    const fusions  = Array.isArray(st.fused) ? st.fused.length : 0;
    const heroes   = st.heroes && typeof st.heroes === 'object' ? Object.values(st.heroes) : [];
    const bestTier = heroes.reduce((m, h) => Math.max(m, (h && h.tier | 0) + 1), 0);
    await q(
      `update players set
         hero = $2, hero_name = $3, hero_tier = $4,
         cash = $5, cores = $6, kills = $7, deaths = $8, best_streak = $9,
         look = $10, state = $11, fusions = $12, playtime = $13,
         top_tier = greatest(top_tier, $14),
         updated_at = now(), last_seen = now()
       where id = $1`,
      [p.id,
       String(st.hero || ''), String(st.heroName || ''), clampInt(st.heroTier, 0, 7),
       clampInt(st.cash, 0, 9e14), clampInt(st.cores, 0, 1e6),
       clampInt(st.kills, 0, 1e9), clampInt(st.deaths, 0, 1e9), clampInt(st.bestStreak, 0, 1e7),
       st.look || {}, st, clampInt(fusions, 0, 9999), clampInt(st.playtime, 0, 1e9),
       clampInt(bestTier, 0, 8)]);

    // the player's own bounty (heat) is server-owned; report it back
    const { rows } = await q('select bounty, cash from players where id = $1', [p.id]);
    res.json({ ok: true, bounty: Number(rows[0].bounty), world: await worldSnapshot(p.name) });
  } catch (e) {
    console.error('[sync]', e.message);
    res.status(500).json({ error: 'Sync failed.' });
  }
});

/* ---------- leaderboards ---------- */
const BOARDS = {
  kills:   { col: 'kills',         label: 'Kills',            fmt: 'int'  },
  cash:    { col: 'cash',          label: 'Credits',          fmt: 'cash' },
  tier:    { col: 'top_tier',      label: 'Highest Tier',     fmt: 'tier' },
  streak:  { col: 'best_streak',   label: 'Best Killstreak',  fmt: 'int'  },
  bounty:  { col: 'bounty_earned', label: 'Bounties Claimed', fmt: 'cash' },
  wanted:  { col: 'bounty',        label: 'Biggest Bounty',   fmt: 'cash' },
  fusions: { col: 'fusions',       label: 'Fusions Forged',   fmt: 'int'  },
  time:    { col: 'playtime',      label: 'Hours Played',     fmt: 'hours'}
};

app.get('/api/leaderboard', requireDb, rateLimit(90, 60000), async (req, res) => {
  try {
    const key = BOARDS[req.query.board] ? req.query.board : 'kills';
    const col = BOARDS[key].col;
    const me  = String(req.query.me || '').toLowerCase();

    const top = await q(
      `select name, hero_name, hero_tier, kills, deaths, best_streak, cash, bounty,
              bounty_earned, fusions, top_tier, playtime,
              rank() over (order by ${col} desc, kills desc) as rank
         from players
        where ${col} > 0
        order by ${col} desc, kills desc
        limit 25`);

    let mine = null;
    if (me) {
      const r = await q(
        `select * from (
           select name, name_lower, hero_name, hero_tier, kills, deaths, best_streak, cash,
                  bounty, bounty_earned, fusions, top_tier, playtime,
                  rank() over (order by ${col} desc, kills desc) as rank
             from players) t
         where t.name_lower = $1`, [me]);
      mine = r.rows[0] || null;
    }
    res.json({ board: key, label: BOARDS[key].label, fmt: BOARDS[key].fmt,
               rows: top.rows, me: mine, boards: Object.keys(BOARDS).map(k => ({ k, label: BOARDS[k].label })) });
  } catch (e) {
    console.error('[leaderboard]', e.message);
    res.status(500).json({ error: 'Leaderboard unavailable.' });
  }
});

/* public world view (no auth) */
app.get('/api/world', requireDb, rateLimit(120, 60000), async (req, res) => {
  try { res.json(await worldSnapshot(req.query.me)); }
  catch (e) { res.status(500).json({ error: 'World unavailable.' }); }
});

/* fund a bounty on another real player */
app.post('/api/bounty/place', requireDb, rateLimit(30, 60000), async (req, res) => {
  const client = pool && await pool.connect();
  try {
    const { name, token, target, amount } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Not your save.' });
    if (badName(target)) return res.status(400).json({ error: 'Bad target.' });
    if (target.toLowerCase() === name.toLowerCase())
      return res.status(400).json({ error: 'You cannot put a bounty on yourself.' });
    const amt = clampInt(amount, 100, 1e9);

    await client.query('begin');
    const me = (await client.query('select id, cash from players where id = $1 for update', [p.id])).rows[0];
    if (Number(me.cash) < amt) { await client.query('rollback'); return res.status(400).json({ error: 'Not enough credits.' }); }

    const tg = (await client.query('select id, name from players where name_lower = $1 for update',
                                   [target.toLowerCase()])).rows[0];
    if (!tg) { await client.query('rollback'); return res.status(404).json({ error: 'No such player.' }); }

    await client.query('update players set cash = cash - $2 where id = $1', [me.id, amt]);
    await client.query('update players set bounty = bounty + $2 where id = $1', [tg.id, amt]);
    await client.query(`insert into bounty_ledger (target, placed_by, amount) values ($1,$2,$3)`,
                       [tg.name, p.name, amt]);
    await client.query('commit');

    await addFeed('bounty_placed', p.name, tg.name, amt, null);
    const cash = Number((await q('select cash from players where id=$1', [me.id])).rows[0].cash);
    res.json({ ok: true, cash, world: await worldSnapshot(p.name) });
  } catch (e) {
    if (client) { try { await client.query('rollback'); } catch (_) {} }
    console.error('[bounty/place]', e.message);
    res.status(500).json({ error: 'Could not place bounty.' });
  } finally { if (client) client.release(); }
});

/* collect the bounty on a player you took down */
app.post('/api/bounty/claim', requireDb, rateLimit(60, 60000), async (req, res) => {
  const client = pool && await pool.connect();
  try {
    const { name, token, target } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Not your save.' });
    if (badName(target) || target.toLowerCase() === name.toLowerCase())
      return res.status(400).json({ error: 'Bad target.' });

    await client.query('begin');
    const tg = (await client.query('select id, name, bounty from players where name_lower = $1 for update',
                                   [target.toLowerCase()])).rows[0];
    if (!tg) { await client.query('rollback'); return res.status(404).json({ error: 'No such player.' }); }

    const prize = Number(tg.bounty);
    if (prize <= 0) { await client.query('rollback'); return res.json({ ok: true, prize: 0, note: 'Already claimed.' }); }

    // the prize pays out, the target is cleared, and the hunter inherits some heat
    const heat = Math.round(prize * 0.35);
    await client.query('update players set bounty = 0, deaths = deaths + 1 where id = $1', [tg.id]);
    await client.query(`update players set cash = cash + $2, bounty = bounty + $3,
                          kills = kills + 1, bounty_earned = bounty_earned + $2 where id = $1`,
                       [p.id, prize, heat]);
    await client.query(`update bounty_ledger set active = false, claimed_by = $1, claimed_at = now()
                         where target = $2 and active`, [p.name, tg.name]);
    await client.query('commit');

    await addFeed('bounty_claimed', p.name, tg.name, prize, null);
    const row = (await q('select cash, bounty from players where id = $1', [p.id])).rows[0];
    res.json({ ok: true, prize, cash: Number(row.cash), bounty: Number(row.bounty), world: await worldSnapshot(p.name) });
  } catch (e) {
    if (client) { try { await client.query('rollback'); } catch (_) {} }
    console.error('[bounty/claim]', e.message);
    res.status(500).json({ error: 'Could not claim bounty.' });
  } finally { if (client) client.release(); }
});

/* announce a fusion / max upgrade to the global feed */
app.post('/api/announce', requireDb, rateLimit(30, 60000), async (req, res) => {
  try {
    const { name, token, kind, detail } = req.body || {};
    const p = await auth(name, token);
    if (!p) return res.status(401).json({ error: 'Not your save.' });
    if (!['fusion', 'upgrade'].includes(kind)) return res.status(400).json({ error: 'Bad kind.' });
    await addFeed(kind, p.name, null, 0, String(detail || '').slice(0, 80));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Announce failed.' }); }
});

app.get('/api/live', (req, res) =>
  res.json({ online: live.size, names: [...live.values()].map(p => p.name) }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ============================================================
   LIVE MULTIPLAYER  (WebSocket)
   Players broadcast their position; hits are relayed to the victim,
   who is authoritative for its own health and death.
   ============================================================ */
const SAFE = { x: 900, y: 700, x2: 2300, y2: 1700 };          // the plaza sanctuary
const inSafe = (x, y) => x > SAFE.x && x < SAFE.x2 && y > SAFE.y && y < SAFE.y2;

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live', maxPayload: 8 * 1024 });

function sendTo(ws, type, data){
  if(ws.readyState === 1){ try { ws.send(JSON.stringify({ type, ...data })); } catch(e){} }
}
function broadcast(type, data, except){
  const msg = JSON.stringify({ type, ...data });
  for(const ws of live.keys()){
    if(ws === except || ws.readyState !== 1) continue;
    try { ws.send(msg); } catch(e){}
  }
}
function byName(name){
  const k = String(name || '').toLowerCase();
  for(const [ws, p] of live) if(p.name.toLowerCase() === k) return [ws, p];
  return [null, null];
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch(e){ return; }
    const me = live.get(ws);

    if(m.type === 'hello'){
      if(me) return;
      if(!pool) return sendTo(ws, 'denied', { reason: 'Server has no database.' });
      const p = await auth(m.name, m.token).catch(() => null);
      if(!p) return sendTo(ws, 'denied', { reason: 'Could not verify that save.' });
      // one connection per player
      const [oldWs] = byName(p.name);
      if(oldWs){ try { oldWs.close(); } catch(e){} live.delete(oldWs); }
      live.set(ws, {
        name: p.name, x: 1600, y: 1320, walk: 0, moving: false, aimx: 1,
        hero: p.hero || '', tier: p.hero_tier || 0, hp: 100, max: 100,
        bounty: Number(p.bounty) || 0, look: p.look || {}, hits: 0, hitWindow: Date.now()
      });
      sendTo(ws, 'welcome', { name: p.name, count: live.size });
      broadcast('joined', { name: p.name }, ws);
      return;
    }

    if(!me) return;                                            // everything else needs a hello

    if(m.type === 'state'){
      me.x = +m.x || 0; me.y = +m.y || 0;
      me.walk = +m.w || 0; me.moving = !!m.m; me.aimx = +m.a || 0;
      me.hero = String(m.h || '').slice(0, 40); me.tier = Math.max(0, Math.min(7, m.t | 0));
      me.hp = +m.hp || 0; me.max = +m.mx || 1;
      me.bounty = Math.max(0, +m.b || 0);
      if(m.lk && typeof m.lk === 'object') me.look = m.lk;
      return;
    }

    if(m.type === 'hit'){
      const now = Date.now();
      if(now - me.hitWindow > 1000){ me.hitWindow = now; me.hits = 0; }
      if(++me.hits > 25) return;                               // flood guard
      const [tws, target] = byName(m.target);
      if(!tws || target === me) return;
      if(inSafe(me.x, me.y) || inSafe(target.x, target.y)) return;   // no PvP in the sanctuary
      const dist = Math.hypot(me.x - target.x, me.y - target.y);
      if(dist > 900) return;                                   // must plausibly be in range
      const dmg = Math.max(0, Math.min(+m.dmg || 0, target.max * 0.35, 4000));
      if(dmg <= 0) return;
      sendTo(tws, 'hurt', { from: me.name, dmg });
      return;
    }

    if(m.type === 'died'){
      const killer = String(m.killer || '').slice(0, 16);
      broadcast('kill', { killer, victim: me.name });
      me.bounty = 0;
      return;
    }
  });

  ws.on('close', () => {
    const me = live.get(ws);
    live.delete(ws);
    if(me) broadcast('bye', { name: me.name });
  });
  ws.on('error', () => { live.delete(ws); });
});

/* position snapshots at 12Hz */
setInterval(() => {
  if(!live.size) return;
  const players = [];
  for(const p of live.values())
    players.push({ n: p.name, x: Math.round(p.x), y: Math.round(p.y),
                   w: +p.walk.toFixed(2), m: p.moving ? 1 : 0, a: p.aimx,
                   h: p.hero, t: p.tier, hp: Math.round(p.hp), mx: Math.round(p.max),
                   b: p.bounty, lk: p.look });
  broadcast('snapshot', { players });
}, 84);

/* drop dead sockets */
setInterval(() => {
  for(const ws of live.keys()){
    if(!ws.isAlive){ try { ws.terminate(); } catch(e){} live.delete(ws); continue; }
    ws.isAlive = false; try { ws.ping(); } catch(e){}
  }
}, 30000);


server.listen(PORT, () => {
  console.log(`[boot] Temple of Heroes listening on :${PORT}  (db: ${pool ? 'on' : 'off'}, live: on)`);
});
