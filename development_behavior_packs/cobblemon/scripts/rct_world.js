// Radical Cobblemon Trainers in the world, re-implemented from RCT's Java (TrainerSpawner.java, TrainerMob.java and its
// goals, TrainerSpawnerBlock, TrainerRepelRodBlock): trainers that spawn near players and wander, stare a player into a
// battle, despawn when unseen, and the two blocks that spawn and repel them; the gyms' display cases and mob-free
// boxes; the trainers' speech. main.js hands in what it keeps (the battles, the series, the level cap) through
// initRctWorld, and the generated tables come from rct_trainers.js and gyms.js.
import { world, system, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { RCT_TRAINER_IDS, RCT_TRAINERS, RCT_TYPES, RCT_DIALOG, RCT_BIOMES, RCT_SPAWN } from "./rct_trainers.js";
import { GYM_CASES, GYM_LEAGUE } from "./gyms.js";

export const TRAINER = "cobblemon:rct_trainer";
// a trainer's own dynamic properties: a wild one (TrainerSpawner's, counted against the caps), the player it spawned
// for (originPlayer), the tick a player was last close (checkDespawnIfUnseen), the spawner block it stands on (HomePos),
// and its wins and defeats against each player (TrainerMob.winsAndDefeats, kept on the entity as RCT keeps them)
const WILD = "cobblemon:rct_wild", ORIGIN = "cobblemon:rct_origin", NEAR = "cobblemon:rct_near", HOME = "cobblemon:rct_home", RECORD = "cobblemon:rct_record";
// the world's: the repel rods and the attuned spawners by position, the gyms' boxes and the gyms whose cases are filled
const RODS = "cobblemon:repel_rods", SPAWNERS = "cobblemon:trainer_spawners", GYM_BOXES = "cobblemon:gym_boxes", CASES_DONE = "cobblemon:gym_cases_done";
const SPAWNER_BLOCK = "rctmod:trainer_spawner", ROD_BLOCK = "rctmod:trainer_repel_rod";

let H = {};   // main.js's hooks: party, levelOf, series, levelCap, unlocked, next, canBattle, startBattle, inBattle
export function initRctWorld(hooks) { H = hooks; }

const dims = () => ["overworld", "nether", "the_end"].map((d) => { try { return world.getDimension(d); } catch (e) { return undefined; } }).filter(Boolean);
function jsonWorld(key, fallback) { try { return JSON.parse(world.getDynamicProperty(key) ?? "null") ?? fallback; } catch (e) { return fallback; } }
function setWorld(key, value) { try { world.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value)); } catch (e) { console.warn(`[cobblemon] ${key}: ${e}`); } }
const posKey = (dim, at) => `${dim.id}:${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`;

export const trainerOf = (npc) => { try { return RCT_TRAINER_IDS[npc.getProperty("cobblemon:trainer")]; } catch (e) { return undefined; } };
export const typeOf = (id) => RCT_TYPES[RCT_TRAINERS[id]?.type ?? "normal"] ?? RCT_TYPES.normal ?? { name: "Normal", symbol: "", colour: "f" };
// TrainerMob.getDisplayName: the trainer's name in its type's colour (leaders green, the Elite Four cyan, champions purple)
export function rctName(id) { const t = RCT_TRAINERS[id]; return t ? `§${typeOf(id).colour}${t.name}§r` : "Trainer"; }
// ChatUtils.reply: one of the context's lines (data/rctmod/dialogs/trainers/default.json), or the fallback
export function rctLine(context, fallback) {
    const lines = RCT_DIALOG[context] ?? [];
    return lines.length ? lines[Math.floor(Math.random() * lines.length)] : fallback;
}
export const isWild = (npc) => { try { return !!npc.getDynamicProperty(WILD); } catch (e) { return false; } };
export const homeOf = (npc) => { try { return npc.getDynamicProperty(HOME); } catch (e) { return undefined; } };

// RCT 0.19.1 shows a trainer's line as a speech bubble over its head (showMessagesAsSpeechBubble); here it is the second
// line of the name tag for four seconds, then the name alone
const speaking = new Map();   // entity id -> the run that clears the line
export function speak(npc, text) {
    if (!npc?.isValid || !text) return;
    const name = rctName(trainerOf(npc));
    try { npc.nameTag = `${name}\n§f${text}`; } catch (e) { return; }
    const old = speaking.get(npc.id);
    if (old !== undefined) system.clearRun(old);
    speaking.set(npc.id, system.runTimeout(() => { speaking.delete(npc.id); try { if (npc.isValid) npc.nameTag = name; } catch (e) { } }, 80));
}

// TrainerMob.winsAndDefeats: a trainer entity's record against each player, [wins, defeats]; a fresh trainer (a leader
// called back by the gym's button) starts with none, so it battles a player who has beaten another of it before
export function record(npc, player) { try { return JSON.parse(npc.getDynamicProperty(RECORD) ?? "{}")[player.id] ?? [0, 0]; } catch (e) { return [0, 0]; } }
export function addRecord(npc, player, wins, defeats) {
    let all = {};
    try { all = JSON.parse(npc.getDynamicProperty(RECORD) ?? "{}"); } catch (e) { }
    const r = all[player.id] ?? [0, 0];
    all[player.id] = [r[0] + wins, r[1] + defeats];
    try { npc.setDynamicProperty(RECORD, JSON.stringify(all)); } catch (e) { }
}

// a trainer entity for an RCT trainer: its skin by the property, its name in its type's colour; a wild one walks
// (cobblemon:wild) and is counted for the player it came for; a spawner's stands on its block (cobblemon:home)
export function spawnTrainer(dim, at, id, opts = {}) {
    const n = RCT_TRAINER_IDS.indexOf(id);
    if (n < 0) return undefined;
    let npc;
    try { npc = dim.spawnEntity(TRAINER, at); } catch (e) { return undefined; }
    try { npc.setProperty("cobblemon:trainer", n); } catch (e) { }
    try { npc.nameTag = rctName(id); } catch (e) { }
    try {
        if (opts.wild) {
            npc.setDynamicProperty(WILD, true); npc.setDynamicProperty(ORIGIN, opts.origin ?? ""); npc.setDynamicProperty(NEAR, system.currentTick);
            npc.triggerEvent("cobblemon:wild");
        } else if (opts.home) { npc.setDynamicProperty(HOME, opts.home); npc.triggerEvent("cobblemon:home"); }
    } catch (e) { }
    return npc;
}

function allTrainers() {
    const out = [];
    for (const dim of dims()) { try { out.push(...dim.getEntities({ type: TRAINER })); } catch (e) { } }
    return out;
}
const identityOf = (id) => RCT_TRAINERS[id]?.identity ?? id;
// TrainerManager.getPlayerLevel: the strongest Pokemon in the party
function playerLevel(player) { try { return Math.max(0, ...H.party(player).map((e) => H.levelOf(e))); } catch (e) { return 0; } }
// TrainerMobData.isOfSeries: a trainer with no series belongs to every one (the empty series and Freeroam among them)
export const inSeries = (t, sid) => !t.series.length || (!!sid && t.series.includes(sid));
// the trainer's biome tags against the biome: none of its blacklist, one of its whitelist (RCT_BIOMES maps each tag to
// Bedrock's biomes, port.py's RCT_BIOME_RULES); a tag the map lacks matches nothing
export function biomeOk(t, biome) {
    const has = (tag) => (RCT_BIOMES[tag] ?? []).includes(biome);
    return !t.noBiomes.some(has) && (!t.biomes.length || t.biomes.some(has));
}

// TrainerSpawner.computeWeight: within the level difference allowed (maxLevelDiff for a key trainer, else that scaled
// by the player's level out of 100, never under 4), closer levels weigh more, times the trainer's spawn weight factor,
// and a key trainer weighs 64 times more the nearer the player's Pokemon are to its level
export function spawnWeight(t, key, pl) {
    let maxDiff, factor = 1;
    if (key) {
        const a = (10 - Math.min(9, Math.floor(pl / 10))) / 2, b = Math.max(0, t.level - pl) * a + 1;
        factor = RCT_SPAWN.keyWeight / b; maxDiff = RCT_SPAWN.maxLevelDiff;
    } else maxDiff = Math.min(RCT_SPAWN.maxLevelDiff, Math.max(RCT_SPAWN.minLevelDiff, Math.floor(RCT_SPAWN.maxLevelDiff * pl / 100)));
    const diff = Math.abs(pl - t.level);
    return diff > maxDiff ? 0 : (maxDiff + 1 - diff) * t.swf * factor;
}
// TrainerSpawner.computeChance: 0.42 (a quarter of that for a trainer that is not key), falling with the square of the
// level difference's share of what is allowed
export function spawnChance(t, key, pl) {
    const maxDiff = key ? RCT_SPAWN.maxLevelDiff : Math.min(RCT_SPAWN.maxLevelDiff, Math.max(RCT_SPAWN.minLevelDiff, Math.floor(RCT_SPAWN.maxLevelDiff * pl / 100)));
    const e = 1 - Math.min(maxDiff, Math.abs(pl - t.level)) / maxDiff;
    return (RCT_SPAWN.directChance / (key ? 1 : RCT_SPAWN.nonKeyDiv)) * e * e;
}
// TrainerSpawner.nextPos: 25 to 70 blocks off along each axis, either way, within 30 up or down, standing on a solid
// block with air for its body
export function nextPos(dim, from) {
    for (let tries = 0; tries < RCT_SPAWN.retries; tries++) {
        const off = () => (RCT_SPAWN.minDistance + Math.floor(Math.random() * (RCT_SPAWN.maxDistance - RCT_SPAWN.minDistance))) * (Math.random() < 0.5 ? -1 : 1);
        const x = Math.floor(from.x) + off(), z = Math.floor(from.z) + off();
        for (let y = Math.floor(from.y) + RCT_SPAWN.vertical; y >= Math.floor(from.y) - RCT_SPAWN.vertical; y--) {
            let ground, feet, head;
            try { ground = dim.getBlock({ x, y, z }); feet = ground?.above(); head = feet?.above(); } catch (e) { break; }
            if (!ground || !feet || !head) continue;
            if (ground.isAir || ground.isLiquid || !feet.isAir || !head.isAir) continue;
            return { x: x + 0.5, y: y + 1, z: z + 0.5 };
        }
    }
    return undefined;
}
// TrainerSpawner.isUnique: no trainer of the same identity within uniqueTrainerRadius (500) blocks
function unique(id, dim, at, trainers) {
    const identity = identityOf(id), d = RCT_SPAWN.uniqueRadius * 2;
    return !trainers.some((e) => e.dimension.id === dim.id && identityOf(trainerOf(e)) === identity
        && Math.abs(e.location.x - at.x) <= d && Math.abs(e.location.z - at.z) <= d && Math.abs(e.location.y - at.y) <= d);
}
// TrainerRepelRodBlock: a rod keeps trainers from spawning in the 7 by 7 chunks about it, unless redstone powers it
export function repelled(dim, at) {
    const rods = jsonWorld(RODS, []), kept = [];
    let blocked = false;
    for (const [dimId, x, y, z] of rods) {
        let block;
        try { block = world.getDimension(dimId).getBlock({ x, y, z }); } catch (e) { kept.push([dimId, x, y, z]); continue; }   // unloaded: kept, and not in reach
        if (block && block.typeId !== ROD_BLOCK) continue;   // gone: forgotten
        kept.push([dimId, x, y, z]);
        if (!block || dimId !== dim.id) continue;
        let power = 0;
        try { power = block.getRedstonePower() ?? 0; } catch (e) { }
        if (power > 0) continue;
        if (Math.abs((x >> 4) - (Math.floor(at.x) >> 4)) <= RCT_SPAWN.repelChunks && Math.abs((z >> 4) - (Math.floor(at.z) >> 4)) <= RCT_SPAWN.repelChunks) blocked = true;
    }
    if (kept.length !== rods.length) setWorld(RODS, kept);
    return blocked;
}

// TrainerSpawner.attemptSpawnFor(player): where no rod reaches, the trainers of the player's series that fit the biome,
// are not about already and can be battled, weighed by spawnWeight; the one drawn spawns with spawnChance
export function candidates(player, dim, at, trainers) {
    let biome = "";
    try { biome = dim.getBiome(at)?.id ?? ""; } catch (e) { return []; }
    const sid = H.series(player), pl = Math.min(H.levelCap(player), playerLevel(player)), out = [];
    const next = new Set(H.next(player));   // PlayerState.isKeyTrainer: the series' trainers up next
    for (const id of RCT_TRAINER_IDS) {
        const t = RCT_TRAINERS[id];
        if (!t.team.length || t.swf <= 0 || !inSeries(t, sid) || !biomeOk(t, biome) || !unique(id, dim, at, trainers) || !H.unlocked(player, id)) continue;
        const key = next.has(id), weight = spawnWeight(t, key, pl);
        if (weight > 0) out.push({ id, key, weight });
    }
    return out;
}
function pick(list) {
    let r = Math.random() * list.reduce((s, c) => s + c.weight, 0);
    for (const c of list) { r -= c.weight; if (r <= 0) return c; }
    return list[list.length - 1];
}
// ModServer.onServerWorldTick and TrainerSpawner.canSpawnFor: an attempt every spawnIntervalTicks (180), stretching to
// 2400 as the player's trainers fill their cap of 12, with a chance from 0.85 down to 0.1 the same way, 60 in all
const nextAttempt = new Map();   // player id -> the tick of the next attempt
export function attemptSpawnFor(player, trainers) {
    const wild = trainers.filter(isWild), mine = wild.filter((e) => { try { return e.getDynamicProperty(ORIGIN) === player.id; } catch (e2) { return false; } }).length;
    if (wild.length >= RCT_SPAWN.total || mine >= RCT_SPAWN.perPlayer || playerLevel(player) <= 0) return undefined;
    const range = Math.max(0, RCT_SPAWN.chance - RCT_SPAWN.chanceMin);
    if (RCT_SPAWN.chance - range * Math.min(1, mine / RCT_SPAWN.perPlayer) < Math.random()) return undefined;
    const dim = player.dimension;
    for (let n = 0; n < RCT_SPAWN.retries; n++) {
        const at = nextPos(dim, player.location);
        if (!at || repelled(dim, at)) continue;
        const list = candidates(player, dim, at, trainers);
        if (!list.length) return undefined;
        const c = pick(list), pl = Math.min(H.levelCap(player), playerLevel(player));
        if (spawnChance(RCT_TRAINERS[c.id], c.key, pl) < Math.random()) return undefined;
        return spawnTrainer(dim, at, c.id, { wild: true, origin: player.id });
    }
    return undefined;
}
system.runInterval(() => {
    let trainers;
    for (const player of world.getPlayers()) {
        if ((nextAttempt.get(player.id) ?? 0) > system.currentTick) continue;
        trainers ??= allTrainers();
        const mine = trainers.filter((e) => isWild(e) && e.getDynamicProperty(ORIGIN) === player.id).length;
        const interval = RCT_SPAWN.interval + Math.floor((RCT_SPAWN.intervalMax - RCT_SPAWN.interval) * Math.min(1, mine / Math.max(1, RCT_SPAWN.perPlayer - 1)));
        nextAttempt.set(player.id, system.currentTick + interval);
        try { attemptSpawnFor(player, trainers); } catch (e) { console.warn(`[cobblemon] trainer spawn: ${e}`); }
    }
}, 20);

// every second, for every trainer about: TrainerMob.aiStep's regeneration (a point about every 20 seconds, 1 in 400 a
// tick), and a wild one's despawn when unseen for 5 minutes (checkDespawnIfUnseen; a player within 48 blocks stands in
// for one with line of sight; beyond 128 the entity's own despawn takes it, as shouldDespawn does)
system.runInterval(() => {
    const now = system.currentTick;
    for (const npc of allTrainers()) {
        try {
            const health = npc.getComponent(EntityComponentTypes.Health);
            if (health && health.currentValue < health.effectiveMax && Math.random() < 0.05) health.setCurrentValue(health.currentValue + 1);
            if (!isWild(npc)) continue;
            if (H.inBattle?.(npc) || npc.dimension.getPlayers({ location: npc.location, maxDistance: 48 }).length) { npc.setDynamicProperty(NEAR, now); continue; }
            if (now - (npc.getDynamicProperty(NEAR) ?? now) > RCT_SPAWN.despawnUnseen) npc.remove();
        } catch (e) { }
    }
}, 20);

// ForceIntoBattleGoal: a trainer stared at by a player within 8 blocks for 60 ticks starts the battle itself, if it may
// battle them and their strongest Pokemon is within 16 levels of its own (forceBattleMaxLevelDiff)
const stare = new Map();   // "trainer|player" -> ticks looked at
system.runInterval(() => {
    const seen = new Set();
    for (const npc of allTrainers()) {
        const id = trainerOf(npc);
        if (!id) continue;
        let players = [];
        try { players = npc.dimension.getPlayers({ location: npc.location, maxDistance: RCT_SPAWN.forceDistance }); } catch (e) { continue; }
        for (const player of players) {
            const key = `${npc.id}|${player.id}`;
            let looking = false;
            try { looking = player.getEntitiesFromViewDirection({ maxDistance: RCT_SPAWN.forceDistance }).some((h) => h.entity?.id === npc.id); } catch (e) { }
            if (!looking) continue;
            seen.add(key);
            const ticks = (stare.get(key) ?? 0) + 10;
            stare.set(key, ticks);
            if (ticks <= RCT_SPAWN.forceLookTicks) continue;
            stare.delete(key);
            if (Math.abs(playerLevel(player) - RCT_TRAINERS[id].level) > RCT_SPAWN.forceLevelDiff) continue;
            if (!H.canBattle || H.canBattle(player, npc) !== null) continue;
            try { H.startBattle(player, npc, id); } catch (e) { }
        }
    }
    for (const key of [...stare.keys()]) if (!seen.has(key)) stare.delete(key);   // looking away starts the count over
}, 10);

// The Trainer Spawner (TrainerSpawnerBlock, TrainerSpawnerBlockEntity): a signature item used on it attunes it to the
// trainers whose signatureItem that is (one item kept, dropped when the block breaks); every 80 ticks with no trainer
// of its own standing on it, a player 2 to 16 blocks away gets one of them spawned on the block, which stays there
// (HomePos), by spawnChance, or surely while redstone powers the block (isBoosted)
function spawners() { return jsonWorld(SPAWNERS, {}); }
export function attuneSpawner(block, player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, slot = player.selectedSlotIndex, hand = inv?.getItem(slot);
    if (!hand) return false;
    const ids = RCT_TRAINER_IDS.filter((id) => RCT_TRAINERS[id].sig === hand.typeId && RCT_TRAINERS[id].team.length);
    if (!ids.length) return false;
    const all = spawners(), key = posKey(block.dimension, block.location), entry = all[key] ?? { ids: [], items: [] };
    const added = ids.filter((id) => !entry.ids.includes(id));
    if (!added.length) return false;
    entry.ids.push(...added); entry.items.push(hand.typeId);
    all[key] = entry; setWorld(SPAWNERS, all);
    if (player.getGameMode?.() !== "Creative") { if (hand.amount > 1) { hand.amount--; inv.setItem(slot, hand); } else inv.setItem(slot, undefined); }
    try { block.dimension.playSound("random.anvil_use", block.location, { volume: 0.4 }); } catch (e) { }
    player.sendMessage(`§7The Trainer Spawner is attuned to ${added.map((id) => RCT_TRAINERS[id].name).join(", ")}.`);
    return true;
}
export function breakSpawner(block) {
    const all = spawners(), key = posKey(block.dimension, block.location), entry = all[key];
    if (!entry) return;
    for (const item of entry.items) { try { block.dimension.spawnItem(new ItemStack(item, 1), { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 }); } catch (e) { } }
    delete all[key]; setWorld(SPAWNERS, all);
}
export function tickSpawner(block) {
    const key = posKey(block.dimension, block.location), entry = spawners()[key];
    if (!entry?.ids.length) return;
    const dim = block.dimension, at = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 };
    const trainers = allTrainers();
    if (trainers.some((e) => homeOf(e) === key)) return;   // its own trainer is about
    if (trainers.filter(isWild).length >= RCT_SPAWN.total) return;
    let above;
    try { above = dim.getBlock(at); } catch (e) { return; }
    if (!above?.isAir || !above.above()?.isAir) return;
    let power = 0;
    try { power = block.getRedstonePower() ?? 0; } catch (e) { }
    const players = dim.getPlayers({ location: at, maxDistance: RCT_SPAWN.spawnerMax }).filter((p) => Math.hypot(p.location.x - at.x, p.location.z - at.z) >= RCT_SPAWN.spawnerMin);
    const ids = [...entry.ids].sort(() => Math.random() - 0.5);
    for (const player of players) {
        if (playerLevel(player) <= 0) continue;
        const pl = Math.min(H.levelCap(player), playerLevel(player)), next = new Set(H.next(player));
        for (const id of ids) {
            const t = RCT_TRAINERS[id];
            if (!unique(id, dim, at, trainers)) continue;
            if (power <= 0 && spawnChance(t, next.has(id), pl) < Math.random()) continue;
            spawnTrainer(dim, at, id, { home: key });
            return;
        }
    }
}
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    blockComponentRegistry.registerCustomComponent("cobblemon:trainer_spawner", {
        onPlayerInteract({ block, player }) { if (player) attuneSpawner(block, player); },
        onPlayerDestroy({ block }) { breakSpawner(block); },
        onTick({ block }) { tickSpawner(block); }
    });
    blockComponentRegistry.registerCustomComponent("cobblemon:repel_rod", {
        onPlace({ block }) {
            const rods = jsonWorld(RODS, []), here = [block.dimension.id, block.location.x, block.location.y, block.location.z];
            if (!rods.some((r) => r.join() === here.join())) { rods.push(here); setWorld(RODS, rods); }
        },
        onPlayerDestroy({ block }) {
            const here = [block.dimension.id, block.location.x, block.location.y, block.location.z].join();
            setWorld(RODS, jsonWorld(RODS, []).filter((r) => r.join() !== here));
        }
    });
});

// The gyms' display cases (Radical Gyms saves an evolution item in each gym's and medicine in the League's, which a
// converted structure cannot carry) and their boxes, from the door plate and trainer spot the structure's markers
// stand at: the template's door-to-spot line turned onto the world's gives the building's rotation
const ROTATIONS = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];   // x' = a x + b z, z' = c x + d z
export function gymTransform(trainer, spot, entrance) {
    const g = GYM_CASES[String(trainer)];
    if (!g || !spot || !entrance) return undefined;
    const dt = [g.spot[0] - g.entrance[0], g.spot[2] - g.entrance[2]], dw = [Math.floor(spot.x) - Math.floor(entrance.x), Math.floor(spot.z) - Math.floor(entrance.z)];
    const r = ROTATIONS.find(([a, b, c, d]) => a * dt[0] + b * dt[1] === dw[0] && c * dt[0] + d * dt[1] === dw[1]);
    if (!r) return undefined;
    const ex = Math.floor(entrance.x), ey = Math.floor(entrance.y), ez = Math.floor(entrance.z);
    const map = (x, y, z) => ({ x: ex + r[0] * (x - g.entrance[0]) + r[1] * (z - g.entrance[2]), y: ey + (y - g.entrance[1]), z: ez + r[2] * (x - g.entrance[0]) + r[3] * (z - g.entrance[2]) });
    const corners = [[0, 0], [g.size[0] - 1, 0], [0, g.size[2] - 1], [g.size[0] - 1, g.size[2] - 1]].map(([x, z]) => map(x, 0, z));
    const box = [Math.min(...corners.map((c) => c.x)), ey - 1, Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), ey + g.size[1], Math.max(...corners.map((c) => c.z))];
    return { map, box, cases: g.cases.map(([x, y, z, item]) => [map(x, y, z), item]) };
}
function recordBox(dimId, box) {
    const boxes = jsonWorld(GYM_BOXES, []), entry = [dimId, ...box];
    if (boxes.some((b) => b.join() === entry.join())) return;
    boxes.push(entry); setWorld(GYM_BOXES, boxes.slice(-64));
}
function fillCases(dim, key, cases, setCaseItem) {
    const done = jsonWorld(CASES_DONE, []);
    if (done.includes(key)) return true;
    let all = true;
    for (const [at, item] of cases) {
        let block;
        try { block = dim.getBlock(at); } catch (e) { all = false; continue; }
        if (!block) { all = false; continue; }   // not loaded yet: tried again on a later tick
        if (block.typeId !== "cobblemon:display_case") continue;
        try { setCaseItem(block, new ItemStack(item, 1)); } catch (e) { }
    }
    if (all) { done.push(key); setWorld(CASES_DONE, done.slice(-64)); }
    return all;
}
// a gym found (its spot marker ticked, or a trainer called): its box recorded and its cases filled once. The door
// plate is looked for only until the gym is handled, since the search is a wide one (findMarker)
const gymsNoted = new Set();   // spot markers handled this session
export function noteGym(trainer, dim, spot, entrance, setCaseItem) {
    const key = posKey(dim, spot);
    if (gymsNoted.has(key)) return;
    const t = gymTransform(trainer, spot, typeof entrance === "function" ? entrance() : entrance);
    if (!t) return;
    recordBox(dim.id, t.box);
    if (fillCases(dim, key, t.cases, setCaseItem)) gymsNoted.add(key);
}
// the League, placed by the script facing north from its origin: its box and its cases at their offsets
export function noteLeague(dim, origin, setCaseItem) {
    const [sx, sy, sz] = GYM_LEAGUE.size;
    recordBox(dim.id, [origin.x, origin.y, origin.z, origin.x + sx - 1, origin.y + sy - 1, origin.z + sz - 1]);
    fillCases(dim, `${dim.id}:league:${origin.x},${origin.y},${origin.z}`, (GYM_LEAGUE.cases ?? []).map(([x, y, z, item]) => [{ x: origin.x + x, y: origin.y + y, z: origin.z + z }, item]), setCaseItem);
}
// the League's Shopkeeper sells what Radical Gyms' CobbleDollars merchant sold, kept on the clerk (completeLeague)
export function leagueStock(entity) { try { return JSON.parse(entity?.getDynamicProperty("cobblemon:shop") ?? "null") ?? undefined; } catch (e) { return undefined; } }

// rgs/worldgen/structure/*.json: no mob spawns inside a building (spawn_overrides empty in every category). A monster
// that spawns inside a known gym box goes at once, and a sweep every five seconds takes any that wandered in
const inBox = (b, dimId, at) => b[0] === dimId && at.x >= b[1] && at.x <= b[4] + 1 && at.y >= b[2] && at.y <= b[5] + 1 && at.z >= b[3] && at.z <= b[6] + 1;
export function inGymBox(dimId, at) { return jsonWorld(GYM_BOXES, []).some((b) => inBox(b, dimId, at)); }
const isMonster = (e) => { try { return e.getComponent(EntityComponentTypes.TypeFamily)?.hasTypeFamily("monster") ?? false; } catch (err) { return false; } };
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    try {
        if (cause !== "Spawned" || !isMonster(entity) || !inGymBox(entity.dimension.id, entity.location)) return;
        entity.remove();
    } catch (e) { }
});
system.runInterval(() => {
    for (const b of jsonWorld(GYM_BOXES, [])) {
        let dim;
        try { dim = world.getDimension(b[0]); } catch (e) { continue; }
        const centre = { x: (b[1] + b[4] + 1) / 2, y: (b[2] + b[5] + 1) / 2, z: (b[3] + b[6] + 1) / 2 };
        const reach = Math.hypot(b[4] + 1 - b[1], b[5] + 1 - b[2], b[6] + 1 - b[3]) / 2 + 1;
        let mobs = [];
        try { mobs = dim.getEntities({ families: ["monster"], location: centre, maxDistance: reach }); } catch (e) { continue; }
        for (const mob of mobs) if (inBox(b, b[0], mob.location)) { try { mob.remove(); } catch (e) { } }
    }
}, 100);
