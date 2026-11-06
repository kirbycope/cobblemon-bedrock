// Storage, NPC and villager behaviours that main.js hooks in: Nurse Joy's look, the pasture's lamp and tether, the
// starter's "skipped choosing" line, Professor Sacchi's dialogue branches and the standard trainer's name, hurt memory
// and battle. main.js hands over the functions and constants these need (initStorageNpc) and ticks them every second
// (tickStorageNpc); the dialogue hooks (sceneNext, sceneAction) are called from showScene.
import { world, system, BlockVolume } from "@minecraft/server";

let D = null;   // main.js's functions and constants, given by initStorageNpc
export function initStorageNpc(deps) { D = deps; }
const DIMENSIONS = ["overworld", "nether", "the_end"];

// Nurse Joy (CobblemonVillagerProfessions.getNameTagOverride, VillagerProfessionLayerMixin): a Nurse whose name, formatting
// stripped, ends with one of these wears nurse_joy.png. The nurse entity's events move her to the variant whose texture
// slot holds it (cobblemon:joy_on) and back (cobblemon:joy_off); a Name Tag renames her, as allow_name_tag_renaming lets it
export const NURSE_JOY_NAMES = ["ジョーイ", "간호순", "祖兒", "喬伊", "乔伊", "האחות ג'וי", "الممرضة جوي", "Joy", "Joelle", "Joëlle", "Джой", "จอย"];
export function isNurseJoyName(name) {
    const plain = String(name ?? "").replace(/§./g, "");
    return NURSE_JOY_NAMES.some((n) => plain.endsWith(n));
}
const JOY = "cobblemon:joy";
function tickNurseJoy() {
    for (const dim of DIMENSIONS) {
        let nurses = [];
        try { nurses = world.getDimension(dim).getEntities({ type: "cobblemon:nurse" }); } catch (e) { continue; }
        for (const nurse of nurses) {
            try {
                const joy = isNurseJoyName(nurse.nameTag);
                if (!!nurse.getDynamicProperty(JOY) === joy) continue;
                nurse.triggerEvent(joy ? "cobblemon:joy_on" : "cobblemon:joy_off");
                nurse.setDynamicProperty(JOY, joy || undefined);
            } catch (e) { }
        }
    }
}

// PokemonPastureBlockEntity.TICKER lights the pasture (ON) while a player within 5 blocks of it has its screen open
// (getInRangeViewerCount with isPlayerViewing, the PC's rule); main.js keeps who has which pasture's screen open in
// pastureViewers, and the lamp follows them every second: off when they step out of reach or leave, on when they are back
export function viewerNear(player, block, range = 5) {   // Cobblemon's box: the block's position less the range to its far corner plus it
    const l = block.location, p = player.location;
    return player.dimension.id === block.dimension.id && p.x >= l.x - range && p.x <= l.x + 1 + range
        && p.y >= l.y - range && p.y <= l.y + 1 + range && p.z >= l.z - range && p.z <= l.z + 1 + range;
}
function tickPastureLamps() {
    const lit = new Map();   // pasture key -> [block, any viewer near]
    for (const [id, block] of D.pastureViewers) {
        const player = world.getPlayers().find((p) => p.id === id);
        if (!player?.isValid) { D.pastureViewers.delete(id); }
        let key;
        try { key = `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`; } catch (e) { D.pastureViewers.delete(id); continue; }
        const near = !!player?.isValid && viewerNear(player, block);
        lit.set(key, [block, (lit.get(key)?.[1] ?? false) || near]);
    }
    for (const [block, on] of lit.values()) { try { D.setPastureLamp(block, on); } catch (e) { } }
}

// PokemonEntity.checkPastureTether: a pastured Pokemon outside its box (pastureMaxWanderDistance, 32 blocks each way of
// the pasture) is teleported to behind the pasture, ceil(width) + 1 blocks out along its facing, onto the ground within
// 4 blocks above the pasture's level (randomTeleport's heightAllowance); one that cannot be placed, or whose pasture
// is gone, is recalled into its PC
const TETHER = 32, FACING = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export function outsideTether(location, home, range = TETHER) {
    return Math.abs(location.x - home.x) > range || Math.abs(location.y - home.y) > range || Math.abs(location.z - home.z) > range;
}
export function parsePastureKey(key) {   // main.js's keyOf: "<dimension id>|x,y,z"
    const [dim, pos] = String(key ?? "").split("|");
    const [x, y, z] = (pos ?? "").split(",").map(Number);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { dim, x, y, z } : null;
}
export function tetherSpot(dimension, home, facing, width) {
    const [dx, dz] = FACING[facing] ?? [0, 1], out = Math.ceil(width) + 1;
    const x = home.x + dx * out, z = home.z + dz * out;
    for (let dy = 4; dy >= -3; dy--) {
        const y = home.y + dy;
        let here, below;
        try { here = dimension.getBlock({ x, y, z }); below = dimension.getBlock({ x, y: y - 1, z }); } catch (e) { return null; }
        if (!here || !below) continue;
        if ((here.isAir || here.isLiquid) && !below.isAir && !below.isLiquid) return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
}
function tickPastureTethers() {
    for (const dim of DIMENSIONS) {
        let owned = [];
        try { owned = world.getDimension(dim).getEntities({ families: ["owned"] }); } catch (e) { continue; }
        for (const e of owned) {
            try {
                const home = parsePastureKey(D.prop(e, D.PASTURE_AT));
                if (!home || home.dim !== e.dimension.id || !outsideTether(e.location, home)) continue;
                const block = e.dimension.getBlock(home);
                if (block === undefined) continue;   // the pasture's chunk is not loaded: left for a later pass
                const spot = block.typeId === "cobblemon:pasture"
                    ? tetherSpot(e.dimension, home, block.permutation.getState("minecraft:cardinal_direction"), D.POKEMON[e.typeId]?.width ?? 1) : null;
                if (spot) { e.teleport(spot); continue; }
                const owner = world.getPlayers().find((p) => p.id === D.prop(e, D.OWNER));
                if (owner) D.recall(owner, e); else e.remove();
            } catch (err) { }
        }
    }
}

// CobblemonPartyLockedKeyBinding: a player who owns Pokemon but has chosen no starter is told, once a session, how to
// still choose one ("ui.starter.skippedchoosing"); the key it names is the port's sneak twice
const starterSkipTold = new Set();
export function tellStarterSkipped(player) {
    if (starterSkipTold.has(player.id)) return;
    starterSkipTold.add(player.id);
    try { player.sendMessage("§eYou have not yet selected a starter, but have already received a Pokémon. To select your starter, place all your Pokémon in a PC and then sneak twice."); } catch (e) { }
}

// The standard trainer (npcs/standard.json): named Red, Green, Blue or Yellow as it spawns (NPCEntity takes one of its
// class's names), and it remembers who hit it for 20 seconds (the HURT_BY_ENTITY brain memory q.npc.was_hurt_by reads)
const hurtBy = new Map();   // trainer entity id -> { player, until }
export function noteNpcHurt(npcId, playerId, now) { hurtBy.set(npcId, { player: playerId, until: now + 400 }); }
export function wasHurtBy(npcId, playerId, now) { const h = hurtBy.get(npcId); return !!h && h.player === playerId && h.until > now; }
export function pickName(names, random = Math.random()) { return names?.length ? names[Math.floor(random * names.length)] : "Trainer"; }
function nameTrainer(entity) {
    if (entity?.typeId !== "cobblemon:npc_trainer") return;
    // after the hub's own check, which removes an unnamed trainer that spawned inside it and keeps one summoned by name
    system.runTimeout(() => { try { if (entity.isValid && (!entity.nameTag || entity.nameTag === "NPC")) entity.nameTag = pickName(D?.NPC_BATTLER?.names); } catch (e) { } }, 10);
}
world.afterEvents.entitySpawn.subscribe(({ entity }) => nameTrainer(entity));
world.afterEvents.entityLoad.subscribe(({ entity }) => nameTrainer(entity));
world.afterEvents.entityHitEntity.subscribe(({ damagingEntity, hitEntity }) => {
    if (hitEntity?.typeId === "cobblemon:npc_trainer" && damagingEntity?.typeId === "minecraft:player") noteNpcHurt(hitEntity.id, damagingEntity.id, system.currentTick);
});

// Professor Sacchi (dialogues/sacchi_interaction.json): her initializationAction looks for a healing machine within her
// reach (c.npc.find_nearby_block, 10 blocks), asks whether the party is at full health (Pokemon.canBeHealed: HP short,
// a status, or PP spent) and whether the machine can take it (HealingMachineBlockEntity.canHeal: free, with the charge
// for the party's missing health), and lands on the matching page
const HEALER_REACH = 10;
export function nearestHealer(npc) {
    const l = npc.location, f = Math.floor;
    const from = { x: f(l.x) - HEALER_REACH, y: f(l.y) - HEALER_REACH, z: f(l.z) - HEALER_REACH }, to = { x: f(l.x) + HEALER_REACH, y: f(l.y) + HEALER_REACH, z: f(l.z) + HEALER_REACH };
    let best = null, bestDistance = Infinity;
    try {
        for (const p of npc.dimension.getBlocks(new BlockVolume(from, to), { includeTypes: ["cobblemon:healing_machine"] }, true).getBlockLocationIterator()) {
            const distance = Math.hypot(p.x + 0.5 - l.x, p.y + 0.5 - l.y, p.z + 0.5 - l.z);
            if (distance < bestDistance) { bestDistance = distance; best = npc.dimension.getBlock(p) ?? best; }
        }
    } catch (e) { }
    return best;
}
export function partyNeedsHealing(player) {
    return D.summaryParty(player).some((m) => D.missingShare(m) > 0 || D.prop(m, D.STATUS) !== undefined || D.prop(m, D.PP_LEFT) !== undefined);
}
export function healerCanHeal(block, player) {
    const key = `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
    if (D.healingAt.has(key)) return false;
    const rec = D.healerRecords()[key];
    if (!rec || rec.inf) return true;
    const needed = D.summaryParty(player).reduce((t, m) => t + D.missingShare(m), 0);
    return D.healerCharge(rec, world.getAbsoluteTime()) >= needed;
}
export function sacchiLanding(player, npc) {
    const healer = nearestHealer(npc);
    if (!healer) return "no_healer";
    if (!partyNeedsHealing(player)) return "full_health";
    return healerCanHeal(healer, player) ? "has_charge" : "no_charge";
}
// Yes: npc_heal_player_pokemon, the action effect. She turns to the machine (c.npc.look_at_position), the party goes
// into it (c.player.put_pokemon_in_healer, the machine's own heal with its charge), and 2.5 seconds later sacchi_healed
function sacchiHeal(player, npc) {
    const healer = nearestHealer(npc);
    if (!healer) { D.showScene(player, npc, "cobblemon:npc_sacchi.no_healer"); return; }
    if (!healerCanHeal(healer, player)) { D.showScene(player, npc, "cobblemon:npc_sacchi.no_charge"); return; }
    try {
        const l = healer.location, dx = l.x + 0.5 - npc.location.x, dz = l.z + 0.5 - npc.location.z;
        npc.setRotation({ x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI });
    } catch (e) { }
    D.useHealingMachine(healer, player);
    system.runTimeout(() => { if (player.isValid && npc.isValid) D.showScene(player, npc, "cobblemon:npc_sacchi.healed"); }, 50);
}

// The dialogue hooks: a scene's "next": "@<hook>" asks which page a click on the box goes to, and an option's
// "/scriptevent cobblemon:scene <action>" runs an action for the player who pressed it
const SCENE_HOOKS = {
    trainer_greeting: (player, npc) => (wasHurtBy(npc.id, player.id, system.currentTick) ? "cobblemon:npc_trainer.hurt" : "cobblemon:npc_trainer.chat"),
    sacchi_landing: (player, npc) => `cobblemon:npc_sacchi.${sacchiLanding(player, npc)}`,
};
export function sceneNext(player, npc, scene) {
    const next = scene?.next;
    if (!next) return undefined;
    return next.startsWith("@") ? SCENE_HOOKS[next.slice(1)]?.(player, npc) : next;
}
const SCENE_ACTIONS = {
    trainer_battle: (player, npc) => D.startNpcBattle(player, npc),
    sacchi_heal: (player, npc) => sacchiHeal(player, npc),
};
export function sceneAction(player, npc, action) { SCENE_ACTIONS[action]?.(player, npc); }

let ticks = 0;
export function tickStorageNpc() {
    if (!D) return;
    ticks++;
    tickPastureLamps();
    tickPastureTethers();
    if (ticks % 2 === 0) tickNurseJoy();
}
