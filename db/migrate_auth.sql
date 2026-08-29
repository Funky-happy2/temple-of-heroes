-- accounts you can sign into from any device, plus leaderboard columns

alter table players add column if not exists password_hash text;
alter table players add column if not exists password_salt text;
alter table players add column if not exists fusions       int    not null default 0;
alter table players add column if not exists bounty_earned bigint not null default 0;
alter table players add column if not exists playtime      int    not null default 0;
alter table players add column if not exists top_tier      int    not null default 0;

-- one row per signed-in device, so signing in on a phone does not sign you out on a laptop
create table if not exists sessions (
  token_hash text primary key,
  player_id  bigint not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used  timestamptz not null default now()
);
create index if not exists sessions_player_idx on sessions (player_id);

-- leaderboard sort paths
create index if not exists players_cash_idx    on players ((cash) desc);
create index if not exists players_streak_idx  on players (best_streak desc);
create index if not exists players_earned_idx  on players (bounty_earned desc);
create index if not exists players_tier_idx    on players (top_tier desc);
