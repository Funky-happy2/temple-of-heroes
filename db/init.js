/* Creates/updates the schema. Run with:  DATABASE_URL='...' npm run init-db  */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

const pool = new Pool({ connectionString: url.split('?')[0], ssl: { rejectUnauthorized: false } });

(async () => {
  for (const f of ['schema.sql', 'migrate_auth.sql']) {
    await pool.query(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    console.log('applied', f);
  }
  const { rows } = await pool.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log('tables:', rows.map(r => r.table_name).join(', '));
  await pool.end();
})().catch(e => { console.error('init failed:', e.message); process.exit(1); });
