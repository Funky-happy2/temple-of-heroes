/* ============================================================
   TEMPLE OF HEROES — content data
   ============================================================ */

/* ---------- progression maths ----------
   Every hero shares one curve; per-hero multipliers give each a feel. */
const TIERS_PER_HERO = 8;

function tierStats(hero, t){
  const g = Math.pow(1.33, t);
  return {
    hp:  Math.round(115 * hero.hpM  * g),
    dmg: +(9.0 * hero.dmgM * Math.pow(1.315, t)).toFixed(1),
    spd: +(2.05 * hero.spdM * (1 + t * 0.035)).toFixed(2),
    cd:  Math.max(0.45, 1 - t * 0.055)          // cooldown scale (lower = faster)
  };
}
function tierCost(t){  return t <= 0 ? 0 : Math.round(700 * Math.pow(2.25, t - 1) / 25) * 25; }
function tierCores(t){ return t <= 0 ? 0 : Math.round(1 + t * 2.2); }

/* ---------- attack archetypes ---------- */
const ATK = {
  beam:   {kind:'shot', rate:170, speed:9.5, life:52, size:5,  dmgMul:0.62, pierce:0, count:1, spread:0,    trail:true },
  bolt:   {kind:'shot', rate:520, speed:6.6, life:70, size:11, dmgMul:1.85, pierce:1, count:1, spread:0,    trail:true },
  spread: {kind:'shot', rate:430, speed:8.2, life:40, size:5,  dmgMul:0.72, pierce:0, count:3, spread:0.30, trail:false},
  arrow:  {kind:'shot', rate:340, speed:14,  life:70, size:4,  dmgMul:1.15, pierce:2, count:1, spread:0,    trail:true },
  homing: {kind:'shot', rate:400, speed:6.0, life:110,size:8,  dmgMul:1.22, pierce:0, count:1, spread:0,    homing:true, trail:true},
  thrown: {kind:'shot', rate:600, speed:10,  life:90, size:12, dmgMul:1.35, pierce:99,count:1, spread:0,    boomerang:true},
  melee:  {kind:'melee',rate:400, reach:74,  arc:1.5, dmgMul:1.9,  knock:9 },
  heavy:  {kind:'melee',rate:640, reach:92,  arc:1.9, dmgMul:2.9,  knock:16},
  claw:   {kind:'melee',rate:250, reach:74,  arc:1.2, dmgMul:1.25, knock:5 }
};

/* ---------- ultimate effects ----------
   nova | rain | summon | buff | freeze | dash   (implemented in game.js) */

/* ---------- the twelve temples ---------- */
const HEROES = [
{
  id:'ironman', name:'Iron Man', temple:'Stark Spire',
  tagline:'Genius, billionaire, blockhead, philanthropist.',
  suit:'#b02a24', accent:'#f2c744', trim:'#ffd97a', glow:'#7fd8ff', helmet:'faceplate',
  hpM:1.00, dmgM:1.05, spdM:1.00, atk:'beam',
  ult:{name:'Drone Swarm', effect:'summon', cd:14, desc:'Deploys 4 repulsor drones that hunt for you.'},
  tiers:[
    ['Mark I','Cave-forged scrap plate. It flies. Barely.'],
    ['Mark III','Hot-rod red. First true flight suit.'],
    ['Mark VII','Briefcase deploy, shoulder micro-missiles.'],
    ['Mark 50','Nano-tech. Reshapes itself mid-fight.'],
    ['Mark 85','Nanite gauntlet, stone-rated shielding.'],
    ['Mark 90 "Singularity"','Pocket fusion core. Repulsors never dim.'],
    ['Mark 100 "Aegis Prime"','Predictive AI dodges shots before they fire.'],
    ['Mark ∞ "Godforge"','A suit that rebuilds itself from ambient matter.']
  ]
},
{
  id:'cap', name:'Captain America', temple:'Sentinel Bastion',
  tagline:'I can do this all day.',
  suit:'#2e5fa8', accent:'#e8ecf5', trim:'#c0392b', glow:'#9dc4ff', helmet:'cowl',
  hpM:1.22, dmgM:0.95, spdM:1.00, atk:'thrown',
  ult:{name:'Bastion Guard', effect:'buff', cd:16, desc:'Vibranium stance: immune to damage for 4s and reflects shots.'},
  tiers:[
    ['Steel Shield','Painted steel and pure stubbornness.'],
    ['Vibranium Disc','The classic. Ricochets forever.'],
    ['Wing Suit','Stealth plating, faster recovery.'],
    ['Twin Shields','Wakandan energy shields on both arms.'],
    ['Worthy','Lifts the hammer. Lightning-laced throws.'],
    ['Sentinel Prime','Shield splits into four homing discs.'],
    ['Bastion Eternal','Kinetic armour converts hits into throws.'],
    ['The Unbroken','Nothing that has hit him hits him twice.']
  ]
},
{
  id:'thor', name:'Thor', temple:'Bifrost Shrine',
  tagline:'Bring me Thanos!',
  suit:'#3f4c8c', accent:'#c8332f', trim:'#d9c58a', glow:'#8fe3ff', helmet:'helm',
  hpM:1.18, dmgM:1.20, spdM:0.96, atk:'heavy',
  ult:{name:'Stormcall', effect:'rain', cd:15, desc:'Calls 14 lightning strikes across a wide radius.'},
  tiers:[
    ['Unworthy','No hammer. Just fists and rage.'],
    ['Mjolnir','Worthy again. The hammer answers.'],
    ['Stormbreaker','Axe of the Bifrost. Opens doors anywhere.'],
    ['God of Thunder','Storms obey without the weapon.'],
    ['Rune King','Odinforce woken. Runes burn on the skin.'],
    ['All-Father','Wields the Odinsword one-handed.'],
    ['Herald of the Storm','A permanent thunderhead follows him.'],
    ['Thor Eternal','The last thunder. It never stops rolling.']
  ]
},
{
  id:'hulk', name:'Hulk', temple:'Gamma Pit',
  tagline:'That is my secret — I am always angry.',
  suit:'#3f9e4a', accent:'#6ac46f', trim:'#5a3fa0', glow:'#9dff9d', helmet:'none',
  hpM:1.85, dmgM:1.30, spdM:0.86, atk:'heavy',
  ult:{name:'Thunderclap', effect:'nova', cd:12, desc:'Slams the ground for massive shockwave damage.'},
  tiers:[
    ['Grey Hulk','Unstable. Strong at night, weaker by day.'],
    ['Savage Hulk','Pure smash. No conversation.'],
    ['Gladiator','Sakaaran arena armour and hammer-axe.'],
    ['Professor Hulk','Brains plus brawn. Regenerates fast.'],
    ['War Hulk','Gamma-plated siege frame.'],
    ['Worldbreaker','The ground cracks where he stands.'],
    ['Green Scar','Every hit he takes makes the next one worse.'],
    ['Titan Gamma','Gamma given a body. Effectively bottomless.']
  ]
},
{
  id:'widow', name:'Black Widow', temple:'Red Room Vault',
  tagline:'I have red in my ledger.',
  suit:'#23262e', accent:'#c0392b', trim:'#6f7580', glow:'#ff8f8f', helmet:'none',
  hpM:0.82, dmgM:0.92, spdM:1.30, atk:'spread',
  ult:{name:'Widow Blitz', effect:'dash', cd:9, desc:'Blink through everything, shocking all you pass.'},
  tiers:[
    ['Field Agent','Pistols, wire, nerve.'],
    ['Widow Bites','Electro-batons that stack a shock.'],
    ['Stealth Suit','Silent movement, bonus damage from behind.'],
    ['Taskmaster Kit','Copies any move she has seen once.'],
    ['Red Guardian Alloy','Armour-weave under the leather.'],
    ['Ghost Protocol','Phases briefly between dashes.'],
    ['Void Widow','Leaves a decoy at every blink point.'],
    ['Ledger Zero','So fast the ledger balances itself.']
  ]
},
{
  id:'hawkeye', name:'Hawkeye', temple:'Marksman Loft',
  tagline:'Nobody misses. I just never do it twice.',
  suit:'#5a3f8c', accent:'#2e2f36', trim:'#b8b8c0', glow:'#c9a6ff', helmet:'goggles',
  hpM:0.88, dmgM:1.10, spdM:1.14, atk:'arrow',
  ult:{name:'Arrow Storm', effect:'rain', cd:13, desc:'Rains 20 trick arrows over a huge area.'},
  tiers:[
    ['Carnival Bow','A bow, a boy, and a lot of practice.'],
    ['SHIELD Marksman','Standard quiver. Never a wasted shaft.'],
    ['Trick Quiver','Boomerang, putty, acid tips.'],
    ['Ronin','Sword-and-bow. Vicious close range.'],
    ['Pym Quiver','Arrows that grow into trucks on impact.'],
    ['Skyshot','Arrows that curve around cover.'],
    ['Arrow of Ages','One shaft, endless copies.'],
    ['The Last Shot','Fired before the target decides to move.']
  ]
},
{
  id:'strange', name:'Doctor Strange', temple:'Sanctum Gate',
  tagline:'We are in the endgame now.',
  suit:'#1f3f8f', accent:'#c0392b', trim:'#e0b64a', glow:'#ffb347', helmet:'none',
  hpM:0.95, dmgM:1.12, spdM:1.02, atk:'homing',
  ult:{name:'Time Lock', effect:'freeze', cd:18, desc:'Freezes every enemy on screen for 4.5s.'},
  tiers:[
    ['Novice of Kamar-Taj','Sparks and a lot of reading.'],
    ['Master of the Mystic Arts','Mandalas, portals, discipline.'],
    ['Cloak of Levitation','The cloak fights on its own.'],
    ['Sorcerer Supreme','Command of the Eye and the Loop.'],
    ['Dark Dimension Pact','Borrowed power. Steep interest.'],
    ['Astral Twin','Fights beside his own soul.'],
    ['Weaver of Loops','Undoes damage that already landed.'],
    ['Supreme Infinite','Every possible spell, cast at once.']
  ]
},
{
  id:'spider', name:'Spider-Man', temple:'Web Nest',
  tagline:'Hey, everyone.',
  suit:'#c0392b', accent:'#1f4fa8', trim:'#111820', glow:'#ff9d9d', helmet:'mask',
  hpM:0.90, dmgM:0.95, spdM:1.35, atk:'spread',
  ult:{name:'Web Snare', effect:'freeze', cd:11, desc:'Cocoons nearby enemies and shreds them while stuck.'},
  tiers:[
    ['Homemade Suit','Hoodie, goggles, good intentions.'],
    ['Stark Suit','Web-wings and a chatty AI.'],
    ['Iron Spider','Four articulated legs. Nano weave.'],
    ['Symbiote Black','Stronger, meaner, harder to take off.'],
    ['Anti-Ock','Charged webbing that tears armour.'],
    ['Cosmic Spider','Enigma Force. Reality-grade reflexes.'],
    ['Web of Life','Reads the strands before they are plucked.'],
    ['The Great Weaver','Everything is connected. He pulls.']
  ]
},
{
  id:'panther', name:'Black Panther', temple:'Wakandan Shrine',
  tagline:'Wakanda forever.',
  suit:'#1b1d26', accent:'#7b4fd6', trim:'#c8a24a', glow:'#c39dff', helmet:'mask',
  hpM:1.10, dmgM:1.02, spdM:1.22, atk:'claw',
  ult:{name:'Kinetic Release', effect:'nova', cd:12, desc:'Dumps every hit you have absorbed back out at once.'},
  tiers:[
    ['Ceremonial Claws','Herb, ritual, resolve.'],
    ['Panther Habit','Vibranium weave, silent step.'],
    ['Kinetic Suit','Stores incoming force, returns it purple.'],
    ['Golden Jaguar Alloy','Heavier plating, heavier hits.'],
    ['King of the Dead','Draws on every Panther before him.'],
    ['Vibranium Prime','The mound itself answers his call.'],
    ['Bast Ascendant','Blessed. Death takes a rain-check.'],
    ['Eternal Wakanda','A nation of vibranium in one body.']
  ]
},
{
  id:'wanda', name:'Scarlet Witch', temple:'Chaos Chapel',
  tagline:'You took everything from me.',
  suit:'#8e2434', accent:'#d3455f', trim:'#2a1420', glow:'#ff5d7a', helmet:'crownlet',
  hpM:0.92, dmgM:1.28, spdM:1.00, atk:'homing',
  ult:{name:'Chaos Barrage', effect:'rain', cd:14, desc:'Hexes fall from nowhere and seek the wounded.'},
  tiers:[
    ['Hex Novice','Red sparks and grief.'],
    ['Mind Stone Touched','Telekinesis, mind blasts.'],
    ['Avenger','Focused hexes. Controlled flight.'],
    ['Scarlet Witch','The title is real. So is the power.'],
    ['Darkhold Bound','Reality edits. Terrible price.'],
    ['Nexus Being','One of the few who can rewrite the branch.'],
    ['Chaos Sovereign','Probability is a suggestion.'],
    ['Witch of Ends','Says no more, and it is so.']
  ]
},
{
  id:'vision', name:'Vision', temple:'Mind Stone Obelisk',
  tagline:'I am not what you think I am.',
  suit:'#a3372f', accent:'#3f9e6a', trim:'#e0c65a', glow:'#ffe27a', helmet:'stone',
  hpM:1.15, dmgM:1.08, spdM:1.04, atk:'beam',
  ult:{name:'Phase Lance', effect:'buff', cd:15, desc:'Go intangible for 4s; your beam pierces everything.'},
  tiers:[
    ['Synthetic Frame','New eyes. New everything.'],
    ['Vibranium Body','Density control comes online.'],
    ['Mind Stone Awake','Forehead beam at full power.'],
    ['White Vision','Logic without memory. Colder, faster.'],
    ['Solar Core','Runs hot enough to melt approach lines.'],
    ['Density Zero','Walks through matter mid-attack.'],
    ['Synthezoid Prime','Rebuilds his own frame in seconds.'],
    ['Infinity Mind','Thinks in outcomes, not moments.']
  ]
},
{
  id:'marvel', name:'Captain Marvel', temple:'Binary Beacon',
  tagline:'I have nothing to prove to you.',
  suit:'#1f3f9e', accent:'#c0392b', trim:'#e8c34a', glow:'#ffd76a', helmet:'mohawkhelm',
  hpM:1.25, dmgM:1.22, spdM:1.06, atk:'bolt',
  ult:{name:'Binary Ignition', effect:'nova', cd:16, desc:'Goes Binary: huge blast plus a full heal.'},
  tiers:[
    ['Air Force Pilot','No powers. All nerve.'],
    ['Vers','Photon blasts, unclear memories.'],
    ['Captain Marvel','Full power. Ceiling removed.'],
    ['Binary','Draws directly from a white hole.'],
    ['Cosmic Aware','Feels the shot before it is aimed.'],
    ['Star Sovereign','Ignites atmospheres for fun.'],
    ['Nova Absolute','A walking main sequence.'],
    ['The Last Light','When she leaves, the room stays bright.']
  ]
}
];

/* ---------- shop & customisation ---------- */
const SKIN_COLORS = [
  {id:'tan',c:'#e0ac69',n:'Tan',p:0},{id:'light',c:'#f5d0a9',n:'Light',p:0},
  {id:'olive',c:'#c68642',n:'Olive',p:0},{id:'brown',c:'#8d5524',n:'Brown',p:0},
  {id:'deep',c:'#5c3317',n:'Deep',p:0},{id:'pale',c:'#ffe0bd',n:'Pale',p:0},
  {id:'green',c:'#6bbf59',n:'Gamma Green',p:900},{id:'blue',c:'#5aa9e6',n:'Kree Blue',p:900},
  {id:'grey',c:'#9aa4b0',n:'Stone Grey',p:1400},{id:'chrome',c:'#dfe7f2',n:'Chrome',p:2600,shine:1},
  {id:'gold',c:'#f2c744',n:'Solid Gold',p:5000,shine:1},{id:'void',c:'#2a1a3f',n:'Void',p:6500,shine:1}
];
const CLOTH_COLORS = [
  {id:'red',c:'#c0392b',n:'Red',p:0},{id:'blue',c:'#2e5fa8',n:'Blue',p:0},
  {id:'green',c:'#3f9e4a',n:'Green',p:0},{id:'yellow',c:'#e8c34a',n:'Yellow',p:0},
  {id:'purple',c:'#7b4fd6',n:'Purple',p:0},{id:'black',c:'#23262e',n:'Black',p:0},
  {id:'white',c:'#e8ecf5',n:'White',p:0},{id:'orange',c:'#e07b39',n:'Orange',p:0},
  {id:'pink',c:'#e86fa9',n:'Pink',p:600},{id:'teal',c:'#2fb8a8',n:'Teal',p:600},
  {id:'crimson',c:'#7a1020',n:'Crimson',p:1200},{id:'neon',c:'#39ff6a',n:'Neon',p:2200,shine:1},
  {id:'chrome',c:'#dfe7f2',n:'Chrome',p:3200,shine:1},{id:'galaxy',c:'#3b2b6b',n:'Galaxy',p:4800,shine:1},
  {id:'lava',c:'#ff5a1f',n:'Lava',p:5600,shine:1},{id:'gold',c:'#f2c744',n:'Gold',p:7000,shine:1}
];
const ACCESSORIES = [
  {id:'none',n:'None',p:0},{id:'halo',n:'Halo',p:1200},{id:'horns',n:'Devil Horns',p:1200},
  {id:'tophat',n:'Top Hat',p:900},{id:'crown',n:'Gold Crown',p:4500},{id:'cape',n:'Hero Cape',p:1800},
  {id:'wings',n:'Angel Wings',p:5200},{id:'jetpack',n:'Jetpack',p:3400},{id:'antenna',n:'Bot Antenna',p:700},
  {id:'headphones',n:'Headphones',p:800},{id:'katana',n:'Back Katana',p:2600},{id:'ears',n:'Bunny Ears',p:1000},
  {id:'propeller',n:'Propeller Cap',p:1500},{id:'flames',n:'Flaming Head',p:6000},{id:'visor',n:'Cyber Visor',p:2100}
];
const TRAILS = [
  {id:'none',n:'None',p:0,c:'#fff'},{id:'sparkle',n:'Sparkle',p:800,c:'#ffe27a'},
  {id:'fire',n:'Fire',p:1600,c:'#ff7b2f'},{id:'ice',n:'Frost',p:1600,c:'#8fe3ff'},
  {id:'rainbow',n:'Rainbow',p:3200,c:'rainbow'},{id:'void',n:'Void',p:4200,c:'#b47bff'},
  {id:'lightning',n:'Lightning',p:3800,c:'#ffe27a'},{id:'bubbles',n:'Bubbles',p:1000,c:'#9fd8ff'},
  {id:'petals',n:'Petals',p:1400,c:'#ff9dc4'},{id:'glitch',n:'Glitch',p:5500,c:'#39ff6a'}
];
const FACES = [
  {id:'neutral',n:'Neutral',p:0},{id:'smile',n:'Smile',p:0},{id:'grin',n:'Big Grin',p:400},
  {id:'angry',n:'Angry',p:400},{id:'cool',n:'Sunglasses',p:1100},{id:'robot',n:'Robot',p:1600},
  {id:'cat',n:'Cat :3',p:900},{id:'determined',n:'Determined',p:700},{id:'shocked',n:'Shocked',p:500},
  {id:'wink',n:'Wink',p:600},{id:'glow',n:'Glowing Eyes',p:3000},{id:'stone',n:'Stone Face',p:2400}
];

/* ---------- world zones ---------- */
const WORLD = {w:3200, h:2400};
const ZONES = [
  {id:'plaza',  n:'Temple Plaza',  x:900, y:700, w:1400, h:1000, lvl:0, safe:true,  fill:'#1a2233', spawn:null},
  {id:'flats',  n:'Bandit Flats',  x:120, y:120, w:760,  h:760,  lvl:1, fill:'#241f18', spawn:['bandit','bandit','raider']},
  {id:'marsh',  n:'Monster Marsh', x:2320,y:120, w:760,  h:760,  lvl:2, fill:'#16281f', spawn:['drone','beast','bandit']},
  {id:'scrap',  n:'The Scrapyard', x:120, y:1520,w:760,  h:760,  lvl:3, fill:'#2a2220', spawn:['sentry','raider','beast']},
  {id:'rift',   n:'Void Rift',     x:2320,y:1520,w:760,  h:760,  lvl:5, fill:'#221630', spawn:['wraith','sentry','brute']},
  {id:'road',   n:'The Crossroads',x:0,   y:0,   w:3200, h:2400, lvl:1, fill:'#12161f', spawn:['bandit','raider'], isBase:true}
];

const ENEMIES = {
  bandit: {n:'Bandit',        hp:60,  dmg:7,  spd:1.55, r:15, cash:38,  xp:1, col:'#9a7448', acc:'#4a3826', eye:'#ffd36b', kind:'melee', range:40},
  raider: {n:'Raider',        hp:78,  dmg:9,  spd:1.35, r:15, cash:62,  xp:1, col:'#a35f52', acc:'#48282a', eye:'#ff9d6b', kind:'shot',  range:330},
  drone:  {n:'Chitauri Drone',hp:96,  dmg:11, spd:1.85, r:15, cash:95,  xp:2, col:'#5f8f7a', acc:'#2e4a40', eye:'#8dff6b', kind:'shot',  range:300},
  beast:  {n:'Frost Beast',   hp:190, dmg:16, spd:1.30, r:22, cash:160, xp:3, col:'#7ba3c9', acc:'#3d5c78', eye:'#8fe3ff', kind:'melee', range:52},
  sentry: {n:'Ultron Sentry', hp:230, dmg:14, spd:1.60, r:17, cash:210, xp:4, col:'#9aa3b2', acc:'#4a5260', eye:'#ff5a5a', kind:'shot',  range:360},
  wraith: {n:'Void Wraith',   hp:300, dmg:20, spd:2.10, r:18, cash:340, xp:5, col:'#7d5ab8', acc:'#3a2560', eye:'#e0a0ff', kind:'melee', range:56},
  brute:  {n:'Symbiote Brute',hp:620, dmg:28, spd:1.10, r:30, cash:900, xp:9, col:'#3b3348', acc:'#b04ecf', eye:'#f2f6fc', kind:'melee', range:66, boss:true}
};

const NPC_NAMES = ['ZeroKnight','Blox_Titan','xX_Vibe_Xx','NoobSlayer','GammaGhost','PixelDoom',
'SkyRunner77','QuantumQuil','IronPeach','LordFizz','MintCondition','VoidPuppy','CaptainSnacc',
'TurboSnail','GlitchWitch','DrPebble','NeonYak','SirCrumb','AtomAnt99','WafflePrime','StormCloudX',
'Bricktopher','JellyFistt','MoonMoth','RustBucket','HexNova','ChaosCarrot','SilentDisco','FrostPop','MegaMuffin'];

/* ---------- task templates ---------- */
const TASK_POOL = [
  {id:'kill_bandit', n:'Clear the Flats',  d:'Defeat %n bandit{s} or raider{s}', key:'killBandit', base:8,  cash:420,  cores:1},
  {id:'kill_monster',n:'Monster Control',  d:'Defeat %n monster{s}',            key:'killMonster',base:6,  cash:620,  cores:2},
  {id:'kill_bounty', n:'Collect a Head',   d:'Take down %n bountied player{s}', key:'killBounty', base:1,  cash:1200, cores:2},
  {id:'damage',      n:'Heavy Hitter',     d:'Deal %n total damage',          key:'damage',     base:900,cash:500,  cores:1},
  {id:'ults',        n:'Show Off',         d:'Land %n ultimate{s}',    key:'ults',       base:5,  cash:380,  cores:1},
  {id:'pickup',      n:'Loose Change',     d:'Pick up %n dropped credits',    key:'pickup',     base:600,cash:300,  cores:1},
  {id:'boss',        n:'Brute Force',      d:'Destroy %n Symbiote Brute{s}',    key:'killBoss',   base:1,  cash:2400, cores:4},
  {id:'upgrade',     n:'Forge Work',       d:'Upgrade any hero %n time(s)',   key:'upgrades',   base:1,  cash:900,  cores:3},
  {id:'anykill',     n:'Field Work',       d:'Defeat %n enem{y} of any kind', key:'anykill',base:15, cash:560,  cores:1},
  {id:'streak',      n:'Killstreak',       d:'Reach a %n kill streak without dying', key:'streak', base:12, cash:1100, cores:2}
];
