/* ============================================================
   TEMPLE OF HEROES — API + static host
   ============================================================ */
'use strict';

const path    = require('path');
const crypto  = require('crypto');
const express = require('express');
const { Pool } = require('pg');

const app  = express();
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

/* authenticate by name + token, returns the player row */
async function auth(name, token) {
  if (badName(name) || typeof token !== 'string' || token.length < 16) return null;
  const { rows } = await q('select * from players where name_lower = $1', [name.toLowerCase()]);
  const p = rows[0];
  if (!p || p.token_hash !== sha(token)) return null;
  return p;
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
    await q(
      `update players set
         hero = $2, hero_name = $3, hero_tier = $4,
         cash = $5, cores = $6, kills = $7, deaths = $8, best_streak = $9,
         look = $10, state = $11, updated_at = now(), last_seen = now()
       where id = $1`,
      [p.id,
       String(st.hero || ''), String(st.heroName || ''), clampInt(st.heroTier, 0, 7),
       clampInt(st.cash, 0, 9e14), clampInt(st.cores, 0, 1e6),
       clampInt(st.kills, 0, 1e9), clampInt(st.deaths, 0, 1e9), clampInt(st.bestStreak, 0, 1e7),
       st.look || {}, st]);

    // the player's own bounty (heat) is server-owned; report it back
    const { rows } = await q('select bounty, cash from players where id = $1', [p.id]);
    res.json({ ok: true, bounty: Number(rows[0].bounty), world: await worldSnapshot(p.name) });
  } catch (e) {
    console.error('[sync]', e.message);
    res.status(500).json({ error: 'Sync failed.' });
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
    await client.query('update players set cash = cash + $2, bounty = bounty + $3, kills = kills + 1 where id = $1',
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`[boot] Temple of Heroes listening on :${PORT}  (db: ${pool ? 'on' : 'off'})`);
});
