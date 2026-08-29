# TEMPLE OF HEROES

A browser action-RPG with blocky Roblox-style humanoid characters. Claim a temple, become that
hero, and upgrade the suit far past anything in the films — then fuse two heroes into something
new that never existed.

## Run it

```
npm install
DATABASE_URL='postgres://...' npm run init-db   # once, creates the tables
DATABASE_URL='postgres://...' npm start         # http://localhost:3000
```

Without `DATABASE_URL` the server still runs and the game is fully playable — it just falls back to
local browser saves with a simulated bounty board. You can also open `public/index.html` straight
off disk for a no-server, offline game.

## Online play

With a database attached the game becomes shared:

- **Cloud saves** — your progress follows your name, not your browser. The name is claimed by the
  first browser to use it and protected by a token kept in that browser's `localStorage`.
- **A real bounty board** — every player's bounty is stored server-side and shown to everyone.
- **Hunt real people** — players carrying a bounty spawn in your danger zones wearing *their* hero,
  tier and colours. Take one down and the server moves their bounty into your wallet and hands you
  35% of it as fresh heat on your own head.
- **Fund bounties on real players** — pay credits to put a price on any name on the leaderboard.
- **Shared killfeed and leaderboard** — fusions, final-tier upgrades and bounty claims broadcast to
  everyone.

Your own bounty is server-owned, so a hunter's claim can't be undone by re-saving.

## Controls

| Key | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Attack |
| `Space` | Ultimate |
| `Shift` | Sprint |
| `E` | Interact with a temple / the Fusion Forge / the Bounty Board |
| `T U F J B P C` | Temples · Upgrade · Fusion · Tasks · Bounty · Shop · Avatar |
| `Esc` | Close panel |

## The loop

**Temples.** Twelve temples ring the plaza, one per hero. Walk into one and press `E` to see its
suit ladder. Your first claim is free; each hero after that costs credits. Claiming never removes a
hero you already own — every hero keeps its own tier progress, and you can swap freely.

**Upgrading.** Each hero has **8 tiers** that run past the movies. Iron Man goes Mark I → Mark III →
Mark VII → Mark 50 → Mark 85 → Mark 90 "Singularity" → Mark 100 "Aegis Prime" → Mark ∞ "Godforge".
Thor ends at Thor Eternal, Hulk at Titan Gamma, Wanda at Witch of Ends. A tier costs **credits +
Upgrade Cores**, and cores only come from tasks — so you cannot buy your way to the top without
doing the work.

**Money.** Credits drop from kills, from bounties, and from task rewards.

**Bounties.** The other "players" fight each other in the background; whoever robs someone gets a
price on their head, and they roam the danger zones. Kill a bountied player and you collect their
bounty — but robbing them puts a bounty on **you**, and hunters spawn to come collect. Dying wipes
your bounty and 25% of your credits. You can also fund a bounty on any name from the board.

**Enemies.** Bandits, raiders, Chitauri drones, frost beasts, Ultron sentries, void wraiths and
Symbiote brutes, spread over four danger zones (levels 1–5) around a safe central plaza that heals
you.

**Fusion.** At the Fusion Forge, bind two heroes you own into a brand-new one: the **attack style of
the first**, the **ultimate of the second**, blended stats, blended colours, and a name you pick.
Both originals stay exactly where they were — nothing is consumed but credits and cores. Fusions can
themselves be fused, and they have their own 8-tier upgrade ladder.

**Avatar & Shop.** Skin colour, shirt, trousers, accessory, trail and expression are all yours to
set in **Avatar**. The basics are free; halos, wings, jetpacks, crowns, flaming heads, rainbow and
void trails, sunglasses and glowing eyes, chrome/galaxy/lava colours are bought in the **Shop**.
Cosmetics are pure style and never affect stats — your suit colours come from the hero you have
equipped.

## Deploying to Render (free plan)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` describes the service.
3. When prompted, paste your Neon connection string as **`DATABASE_URL`**. It is marked
   `sync: false`, so it is stored as a Render secret and never lives in the repo.
4. Run the schema once — either locally with `npm run init-db`, or from the Render shell.

Free instances sleep after ~15 minutes idle, so the first request after a nap takes ~50s to wake.
The game detects that: it starts in local mode and flips the HUD badge to `online` once the server
answers.

## Files

| File | What's in it |
|---|---|
| `server.js` | Express API + static host: sessions, cloud saves, bounty transactions, feed |
| `db/schema.sql`, `db/init.js` | Postgres schema and its one-shot installer |
| `render.yaml` | Render Blueprint (free plan, health check, `DATABASE_URL` as a secret) |
| `public/index.html` | Page shell, HUD, panel container |
| `public/style.css` | All styling |
| `public/data.js` | Heroes, tier names, stat curve, attack archetypes, cosmetics, zones, enemies, tasks |
| `public/net.js` | Cloud session, sync, bounty calls — silently degrades to offline |
| `public/game.js` | Engine: figure renderer, world, combat, AI, economy, panels, save/load |

### Adding a hero

Append an entry to `HEROES` in `data.js` with `hpM`/`dmgM`/`spdM` multipliers, an `atk` archetype
from `ATK`, an `ult` (`nova`, `rain`, `summon`, `buff`, `freeze` or `dash`), and 8 `[name, blurb]`
tiers. Stats, costs, its temple in the plaza ring and its shop previews are all generated from that.
