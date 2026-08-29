-- Temple of Heroes — schema

create table if not exists players (
  id           bigserial primary key,
  name         text unique not null,
  name_lower   text unique not null,
  token_hash   text not null,
  hero         text,
  hero_name    text,
  hero_tier    int    not null default 0,
  cash         bigint not null default 750,
  cores        int    not null default 1,
  bounty       bigint not null default 0,
  kills        int    not null default 0,
  deaths       int    not null default 0,
  best_streak  int    not null default 0,
  look         jsonb  not null default '{}'::jsonb,
  state        jsonb  not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

create index if not exists players_bounty_idx  on players (bounty desc) where bounty > 0;
create index if not exists players_kills_idx   on players (kills desc);
create index if not exists players_seen_idx    on players (last_seen desc);

-- global activity feed shown in every player's killfeed
create table if not exists feed (
  id         bigserial primary key,
  kind       text   not null,           -- bounty_placed | bounty_claimed | fusion | upgrade | joined
  actor      text   not null,
  target     text,
  amount     bigint not null default 0,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists feed_recent_idx on feed (created_at desc);

-- every bounty ever funded, and who collected it
create table if not exists bounty_ledger (
  id         bigserial primary key,
  target     text   not null,
  placed_by  text   not null,
  amount     bigint not null,
  active     boolean not null default true,
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bounty_target_idx on bounty_ledger (target) where active;
