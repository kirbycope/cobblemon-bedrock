// Block behaviours main.js hands to this module (initBlockLogic lends it main.js's tables and helpers): a Monitor on
// its own (FossilMultiblockEntity: discs, the Upgrade and the Dubious Disc), the Disc Shelf's slots
// (DiscShelfBlockEntity), the fossil machine's comparators, redstone release, hoppers and breaking
// (FossilMultiblockStructure), the gilded chests' hoppers (GildedChestBlockEntity) and the healing machine's recall
// (HealingMachineBlock.useWithoutItem).
import { world, system, ItemStack, BlockPermutation, EntityComponentTypes } from "@minecraft/server";

let D = {};   // what main.js lends: findMachine, stateFor, machines, FOSSILS, TM_INDEX, learnTms, rollAlpha and the rest

const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const keyOf = (dimension, p) => `${dimension.id}|${p.x},${p.y},${p.z}`;
function blockAt(key) {
    const [dimId, pos] = key.split("|"), [x, y, z] = pos.split(",").map(Number);
    try { return world.getDimension(dimId).getBlock({ x, y, z }); } catch (e) { return undefined; }
}
function facingOf(block) { try { return block.permutation.getState("minecraft:cardinal_direction") ?? "north"; } catch (e) { return "north"; } }
// the block's front, toward the player who placed it: Java's FACING the other way (its getStateForPlacement)
const frontOf = (block) => OPPOSITE[facingOf(block)] ?? "south";
function quietState(block, name, value) {
    try { if (block && block.permutation.getState(name) !== value) block.setPermutation(block.permutation.withState(name, value)); } catch (e) { }
}
function heldItem(player) { try { return player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex); } catch (e) { return undefined; } }
function takeOne(player) {
    if (player.getGameMode?.() === "Creative") return;
    try {
        const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, slot = player.selectedSlotIndex, item = inv?.getItem(slot);
        if (!item) return;
        if (item.amount > 1) { item.amount--; inv.setItem(slot, item); } else inv.setItem(slot, undefined);
    } catch (e) { }
}
function give(player, typeId, amount = 1) {
    try {
        const left = player.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(new ItemStack(typeId, amount));
        if (left) player.dimension.spawnItem(left, player.location);
    } catch (e) { }
}
function playSound(block, id) { try { block?.dimension.playSound(id, block.location); } catch (e) { } }
function spawnItem(block, typeId, amount, at) { try { block.dimension.spawnItem(new ItemStack(typeId, amount), at ?? { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }); } catch (e) { } }
// Pokemon.isShiny by a one-in-n roll: the species' shiny look of its form and gender (as the fossil machine does)
function rollShiny(e, oneIn) {
    if (oneIn <= 0 || Math.floor(Math.random() * oneIn) !== 0) return;
    const looks = D.VARIANT_LOOKS?.[e.typeId], [form, female] = looks?.[D.variantOf(e)] ?? [null, 0];
    const n = (looks ?? []).findIndex(([f, g, sh]) => f === form && g === female && sh);
    if (n >= 0) try { e.triggerEvent(`cobblemon:set_variant_${n}`); } catch (err) { }
}
// a standing place for a Pokemon out from a block: the blocks forward of its front, nearest first, with a little
// room up or down (FossilMultiblockEntity.findSafeSpawnPos); failing all, straight in front
export function spawnSpot(block, front, forwardMax = 2) {
    const [fx, fz] = STEP[front] ?? [0, 1], [rx, rz] = [-fz, fx];
    const candidates = [];
    for (let f = 1; f <= forwardMax; f++) for (let s = -f; s <= f; s++) candidates.push({ x: block.x + fx * f + rx * s, y: block.y, z: block.z + fz * f + rz * s, d: f * f + s * s });
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) for (const dy of [0, 1, -1, 2, -2]) {
        try {
            const b = block.dimension.getBlock({ x: c.x, y: c.y + dy, z: c.z });
            if (b?.isAir && b.above()?.isAir && !b.below()?.isAir) return { x: c.x + 0.5, y: c.y + dy, z: c.z + 0.5 };
        } catch (e) { }
    }
    return { x: block.x + fx + 0.5, y: block.y, z: block.z + fz + 0.5 };
}

// ---- the Monitor on its own (FossilMultiblockEntity) --------------------------------------------------------------
// A Monitor in no machine takes a TM disc or a music disc: the disc's screen shows (TM_<type> or MUSIC), an empty hand
// ejects it in front, breaking drops it, and a TM is unlocked for the player on insert and eject (unlockTmForPlayer).
// An Upgrade runs PORYGON_TIME (90 ticks) of the loading screen, then the Monitor breaks into a Damaged Monitor and a
// Porygon comes out, one in five a Porygon2 at level 25, else level 20; a Dubious Disc runs the glitching screen, then
// the Monitor blows up (iron ingots, sculk veins to three blocks, 1 or 2 hearts off nearby mobs) and a Porygon-Z at 35
// comes out half the time. Alpha one in monitorAlphaRate (40), shiny one in monitorShinyRate (200).
const MONITORS = "cobblemon:monitors", PORYGON_TIME = 90, MONITOR_ALPHA = 40, MONITOR_SHINY = 200;
// the disc screens over two states, since a state holds at most 16 values; a music disc shows the fossil screen's
// MUSIC, which is the same texture
export const DISC_A = ["none", "normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon"];
export const DISC_B = ["none", "dark", "steel", "fairy"];
const processes = new Map();   // monitor key -> { kind: "upgrade" | "dubious", ticks }
function monitors() { try { return JSON.parse(world.getDynamicProperty(MONITORS) ?? "{}"); } catch (e) { return {}; } }
function saveMonitors(all) { try { world.setDynamicProperty(MONITORS, JSON.stringify(all)); } catch (e) { } }
export const isMusicDisc = (id) => /^minecraft:music_disc_/.test(id ?? "");
export const isTm = (id) => !!id && !!D.TM_INDEX?.has(id);
export const isPorygonItem = (id) => id === "cobblemon:upgrade" || id === "cobblemon:dubious_disc";
// the screen states a held disc gives: [screen, disc, disc_b]
export function discScreen(itemId) {
    if (!itemId) return ["off", "none", "none"];
    if (isMusicDisc(itemId)) return ["music", "none", "none"];
    const type = D.MOVES?.[itemId.slice("cobblemon:tm_".length)]?.type ?? "normal";
    if (DISC_B.includes(type)) return ["off", "none", type];
    return ["off", DISC_A.includes(type) ? type : "normal", "none"];
}
function showDisc(block, itemId) {
    const [screen, a, b] = discScreen(itemId);
    quietState(block, "cobblemon:screen", screen); quietState(block, "cobblemon:disc", a); quietState(block, "cobblemon:disc_b", b);
}
// the TM's recipe unlocked for the player (TMMoveManager.syncTMFromMove), as a Pokemon knowing the move would
function unlockTm(player, itemId) {
    if (!isTm(itemId) || !player?.isValid) return;
    try { D.learnTms(player, [itemId.slice("cobblemon:tm_".length)]); } catch (e) { }
}
function ejectDisc(block, itemId) {
    const [fx, fz] = STEP[frontOf(block)] ?? [0, 1];
    try {
        const item = block.dimension.spawnItem(new ItemStack(itemId, 1), { x: block.x + 0.5 + fx * 0.6, y: block.y + 0.5, z: block.z + 0.5 + fz * 0.6 });
        item.applyImpulse({ x: fx * 0.15, y: 0.05, z: fz * 0.15 });
    } catch (e) { }
}
function useLoneMonitor(block, player, itemId) {
    const key = keyOf(block.dimension, block.location), all = monitors(), held = all[key];
    if (processes.has(key)) return;
    if (isPorygonItem(itemId)) {
        if (held) { unlockTm(player, held); ejectDisc(block, held); delete all[key]; saveMonitors(all); }
        takeOne(player);
        playSound(block, "cobblemon.block.monitor.insert");
        startProcess(block, key, itemId === "cobblemon:dubious_disc" ? "dubious" : "upgrade");
        return;
    }
    if (isMusicDisc(itemId) || isTm(itemId)) {
        if (player.getGameMode?.() === "Creative" && held === itemId) return;   // no ejection spam in creative
        if (held) { unlockTm(player, held); ejectDisc(block, held); }
        all[key] = itemId; saveMonitors(all);
        takeOne(player);
        unlockTm(player, itemId);
        showDisc(block, itemId);
        return;
    }
    if (!itemId && held) {
        unlockTm(player, held); ejectDisc(block, held);
        delete all[key]; saveMonitors(all);
        showDisc(block, undefined);
    }
}
function startProcess(block, key, kind) {
    processes.set(key, { kind, ticks: 0 });
    playSound(block, kind === "dubious" ? "cobblemon.block.monitor.glitching" : "cobblemon.block.monitor.loading");
    quietState(block, "cobblemon:screen", kind === "dubious" ? "glitching" : "grid");
}
// what comes out of a finished process, by two rolls (FossilMultiblockEntity.spawnPorygon): [species, level] or null
export function porygonFor(kind, roll) {
    if (kind === "upgrade") return roll < 0.2 ? ["cobblemon:p0233_porygon2", 25] : ["cobblemon:p0137_porygon", 20];
    if (kind === "dubious") return roll < 0.5 ? ["cobblemon:p0474_porygonz", 35] : null;
    return null;
}
function spawnPorygon(block, kind) {
    const outcome = porygonFor(kind, Math.random());
    if (!outcome) return;
    const [species, level] = outcome, at = spawnSpot(block, frontOf(block));
    let e;
    try { e = block.dimension.spawnEntity(species, at); } catch (err) { return; }
    system.run(() => {
        if (!e.isValid) return;
        D.setProp(e, D.LEVEL, level);
        D.rollAlpha(e, MONITOR_ALPHA);
        rollShiny(e, MONITOR_SHINY);
    });
}
// Bedrock's sculk vein faces: multi_face_direction_bits, 1 down, 2 up, 4 south, 8 west, 16 north, 32 east
const VEIN_BITS = [[0, -1, 0, 1], [0, 1, 0, 2], [0, 0, 1, 4], [-1, 0, 0, 8], [0, 0, -1, 16], [1, 0, 0, 32]];
function spreadSculk(dimension, origin, radius = 3) {
    const visited = new Set([`${origin.x},${origin.y},${origin.z}`]), queue = [[origin, 0]];
    while (queue.length) {
        const [at, distance] = queue.shift();
        if (distance >= radius) continue;
        for (const [dx, dz] of Object.values(STEP)) {
            for (const dy of [1, 0, -1]) {
                const p = { x: at.x + dx, y: at.y + dy, z: at.z + dz }, id = `${p.x},${p.y},${p.z}`;
                if (visited.has(id)) continue;
                let target; try { target = dimension.getBlock(p); } catch (e) { continue; }
                if (!target || !(target.isAir || target.typeId === "minecraft:sculk_vein")) continue;
                let bits = 0;
                try { bits = target.typeId === "minecraft:sculk_vein" ? target.permutation.getState("multi_face_direction_bits") ?? 0 : 0; } catch (e) { }
                for (const [sx, sy, sz, bit] of VEIN_BITS) {
                    try { if (dimension.getBlock({ x: p.x + sx, y: p.y + sy, z: p.z + sz })?.isSolid) bits |= bit; } catch (e) { }
                }
                if (!bits) continue;
                try { target.setPermutation(BlockPermutation.resolve("minecraft:sculk_vein", { multi_face_direction_bits: bits })); }
                catch (e) { try { target.setType("minecraft:sculk_vein"); } catch (err) { } }
                visited.add(id); queue.push([p, distance + 1]);
                break;
            }
        }
    }
}
function completeProcess(block, key, kind) {
    processes.delete(key);
    const dim = block.dimension, facing = facingOf(block), front = frontOf(block), [fx, fz] = STEP[front] ?? [0, 1];
    const centre = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };
    if (kind === "upgrade") {
        for (let n = 0; n < 10; n++) try { dim.spawnParticle("minecraft:basic_smoke_particle", { x: block.x + 0.5 + fx * 0.6 + (Math.random() - 0.5) * 0.4, y: block.y + 0.7 + (Math.random() - 0.5) * 0.4, z: block.z + 0.5 + fz * 0.6 + (Math.random() - 0.5) * 0.4 }); } catch (e) { }
        playSound(block, "cobblemon.block.monitor.break");
        try { block.setPermutation(BlockPermutation.resolve("cobblemon:damaged_monitor", { "minecraft:cardinal_direction": facing })); } catch (e) { try { block.setType("cobblemon:damaged_monitor"); } catch (err) { } }
    } else {
        try { block.setType("minecraft:air"); } catch (e) { }
        for (let n = 0; n < 3; n++) try { dim.spawnParticle("minecraft:huge_explosion_emitter", centre); } catch (e) { }
        for (let n = 0; n < 25; n++) try { dim.spawnParticle("minecraft:basic_smoke_particle", { x: centre.x + (Math.random() - 0.5), y: centre.y + (Math.random() - 0.5), z: centre.z + (Math.random() - 0.5) }); } catch (e) { }
        try { dim.playSound("random.explode", centre); } catch (e) { }
        spawnItem(block, "minecraft:iron_ingot", 1 + Math.floor(Math.random() * 3), centre);
        spreadSculk(dim, block.location);
        try {
            for (const e of dim.getEntities({ location: centre, maxDistance: 3 })) {
                if (!e.getComponent(EntityComponentTypes.Health)) continue;
                try { e.applyDamage(Math.random() < 0.5 ? 2 : 4); } catch (err) { }
            }
        } catch (e) { }
    }
    spawnPorygon(block, kind);
}
function tickProcesses() {
    for (const [key, p] of [...processes]) {
        const block = blockAt(key);
        if (!block) continue;   // unloaded: it waits
        if (block.typeId !== "cobblemon:monitor") { processes.delete(key); continue; }
        p.ticks++;
        if (p.ticks % 30 === 0) playSound(block, p.kind === "dubious" ? "cobblemon.block.monitor.glitching" : "cobblemon.block.monitor.loading");
        if (p.ticks >= PORYGON_TIME) completeProcess(block, key, p.kind);
        else quietState(block, "cobblemon:screen", p.kind === "dubious" ? "glitching" : "grid");
    }
}
// a Monitor broken, or joined into a machine: its disc comes out, and a process under way gives its item back
function monitorGone(block, dimension, location) {
    const key = keyOf(dimension, location), all = monitors();
    if (all[key]) { spawnItem({ dimension, x: location.x, y: location.y, z: location.z }, all[key], 1); delete all[key]; saveMonitors(all); }
    const p = processes.get(key);
    if (p) { spawnItem({ dimension, x: location.x, y: location.y, z: location.z }, p.kind === "dubious" ? "cobblemon:dubious_disc" : "cobblemon:upgrade", 1); processes.delete(key); }
    if (block?.typeId === "cobblemon:monitor") showDisc(block, undefined);
}

// ---- the Disc Shelf (DiscShelfBlockEntity) ------------------------------------------------------------------------
// Fourteen slots in two columns of seven on the front face, each holding one TM, Blank TM, Upgrade, Dubious Disc or
// music disc: a click on a slot puts the held item in (the one there comes back to the player) and an empty hand
// takes it out; the comparator reads the count; hoppers insert into the first free slot and take from the first
// filled one, one item each eight ticks, as the TM Machine's do. The slots are kept by the world, by place.
// Not carried: the note block on top playing the discs as notes (NoteBlockMixin), and drawing the discs.
const SHELF_SITES = "cobblemon:shelf_sites", SHELF_SLOTS = 14;
const shelfKey = (block) => `cobblemon:shelf|${keyOf(block.dimension, block.location)}`;
function shelfData(block) { try { return JSON.parse(world.getDynamicProperty(shelfKey(block)) ?? "null") ?? Array(SHELF_SLOTS).fill(null); } catch (e) { return Array(SHELF_SLOTS).fill(null); } }
function saveShelf(block, slots) {
    const empty = slots.every((s) => !s);
    try { world.setDynamicProperty(shelfKey(block), empty ? undefined : JSON.stringify(slots)); } catch (e) { }
    let sites = [];
    try { sites = JSON.parse(world.getDynamicProperty(SHELF_SITES) ?? "[]"); } catch (e) { }
    const key = keyOf(block.dimension, block.location);
    if (empty) sites = sites.filter((k) => k !== key); else if (!sites.includes(key)) sites.push(key);
    try { world.setDynamicProperty(SHELF_SITES, JSON.stringify(sites)); } catch (e) { }
    quietState(block, "cobblemon:signal", Math.min(14, slots.filter(Boolean).length));
}
export const shelfAccepts = (id) => !!id && (isTm(id) || id === "cobblemon:blank_tm" || isPorygonItem(id) || isMusicDisc(id));
// the slot under a click on the front face (DiscShelfBlockEntity.getHitSlot): the face's left column is slots
// 0, 2, 4 ... 12 from the top, the right 1, 3 ... 13, each row two pixels tall from pixel 1 to 15; -1 outside
export function shelfSlot(front, faceLocation) {
    const rel = { x: faceLocation.x - Math.floor(faceLocation.x), y: faceLocation.y - Math.floor(faceLocation.y), z: faceLocation.z - Math.floor(faceLocation.z) };
    const x = { north: 1 - rel.x, south: rel.x, west: rel.z, east: 1 - rel.z }[front];
    if (x === undefined) return -1;
    const col = x >= 1 / 16 && x <= 7 / 16 ? 0 : x >= 9 / 16 && x <= 15 / 16 ? 1 : -1;
    if (col < 0 || rel.y < 1 / 16 || rel.y > 15 / 16) return -1;
    const row = 6 - Math.max(0, Math.min(6, Math.floor((rel.y - 1 / 16) / (2 / 16))));
    return row * 2 + col;
}
function useShelf(block, player, slot, itemId) {
    const slots = shelfData(block), old = slots[slot];
    if (itemId) {
        if (!shelfAccepts(itemId)) return;
        if (old) give(player, old, 1);
        slots[slot] = itemId;
        takeOne(player);
    } else {
        if (!old) return;
        slots[slot] = null;
        give(player, old, 1);
    }
    saveShelf(block, slots);
}
function shelfHoppers() {
    let sites = [];
    try { sites = JSON.parse(world.getDynamicProperty(SHELF_SITES) ?? "[]"); } catch (e) { return; }
    for (const key of sites) {
        const block = blockAt(key);
        if (!block) continue;   // not loaded
        const slots = shelfData(block);
        if (block.typeId !== "cobblemon:disc_shelf") {   // broken: what it held comes out where it stood
            for (const id of slots) if (id) spawnItem(block, id, 1);
            saveShelf(block, Array(SHELF_SLOTS).fill(null));
            continue;
        }
        let changed = false;
        for (const [side, facing] of D.HOPPER_INTO ?? []) {
            let from; try { from = block[side](); } catch (e) { continue; }
            const container = D.hopperAt(from);
            if (!container) continue;
            try { if (from.permutation.getState("facing_direction") !== facing) continue; } catch (e) { continue; }
            const free = slots.indexOf(null);
            if (free < 0) break;
            for (let i = 0; i < container.size; i++) {
                const item = container.getItem(i);
                if (!item || !shelfAccepts(item.typeId)) continue;
                slots[free] = item.typeId;
                if (item.amount > 1) { item.amount--; container.setItem(i, item); } else container.setItem(i, undefined);
                changed = true;
                break;
            }
        }
        const below = D.hopperAt(block.below()), filled = slots.findIndex(Boolean);
        if (below && filled >= 0 && !below.addItem(new ItemStack(slots[filled], 1))) { slots[filled] = null; changed = true; }
        if (changed) saveShelf(block, slots);
    }
}

// ---- the fossil machine's redstone, hoppers and breaking (FossilMultiblockStructure) -----------------------------
// getAnalogOutputSignal: the tank reads its material in fifteenths of the 128 it takes, the monitor the progress
// (1 to 15 while it runs, 15 with the Pokemon ready)
export function fossilSignals(st, fossils = D.FOSSILS ?? { materialToStart: 128, reviveSeconds: 720 }) {
    const tank = Math.min(15, Math.floor((st.material * 15) / fossils.materialToStart));
    const monitor = st.done ? 15 : st.left > 0 ? Math.max(1, 15 - Math.floor((st.left * 15) / fossils.reviveSeconds)) : 0;
    return { tank, monitor };
}
export function machineSignals(m, st) {
    const { tank, monitor } = fossilSignals(st);
    quietState(m.tank, "cobblemon:signal", tank);
    try { quietState(m.tank.above(), "cobblemon:signal", tank); } catch (e) { }
    quietState(m.monitor, "cobblemon:signal", monitor);
}
// the fossils drop from a broken machine unless it has started and has less than a second to go (timeRemaining -1
// or 20 ticks and more)
export const fossilsDropOnBreak = (st) => st.left <= 0 || st.left >= 1;
// the finished Pokemon comes out wild behind the tank (spawn), shiny one in fossilMachineShinyChance (100) and alpha
// one in fossilMachineAlphaChance (20), with the retrieve sound, at level 1: the fossil's result is PokemonProperties
// with no level, and PokemonProperties.create starts from a new Pokemon's (Pokemon.level = 1). Set at once, before the
// wild level roll (main.js's wildLevel, four ticks on) would give it one
export const REVIVED_LEVEL = 1;
function releaseWild(tank, st) {
    if (!st.done || !st.result) return false;
    const at = spawnSpot(tank, facingOf(tank));
    let e;
    try { e = tank.dimension.spawnEntity(st.result, at); } catch (err) { return false; }
    D.setProp?.(e, D.LEVEL, REVIVED_LEVEL);
    system.run(() => {
        if (!e.isValid) return;
        D.rollAlpha(e, 20);
        rollShiny(e, 100);
    });
    playSound(tank, "cobblemon.block.fossil_machine.retrieve_pokemon");
    return true;
}
// FossilMultiblockStructure.playerWillDestroy, for the tank's break (main.js) and the analyzer's and monitor's
export function fossilBroken(block, tank, st) {
    if (st.done) releaseWild(tank?.typeId === "cobblemon:restoration_tank" ? tank : block, st);
    if (fossilsDropOnBreak(st)) for (const f of st.fossils) spawnItem(block, f, 1);
}
// the tank beside an analyzer, or under the monitor's analyzer: the machine's key when one of its parts is gone
function tankNear(dimension, location, type) {
    const base = type === "cobblemon:monitor" ? { x: location.x, y: location.y - 1, z: location.z } : location;
    for (const [dx, dz] of Object.values(STEP)) {
        try {
            const b = dimension.getBlock({ x: base.x + dx, y: base.y, z: base.z + dz });
            if (b?.typeId === "cobblemon:restoration_tank") return b.permutation.getState("cobblemon:part") === "bottom" ? b : b.below();
        } catch (e) { }
    }
    return undefined;
}
function partBroken({ block, brokenBlockPermutation }) {
    const type = brokenBlockPermutation?.type?.id;
    if (type === "cobblemon:monitor") monitorGone(undefined, block.dimension, block.location);
    if (type !== "cobblemon:monitor" && type !== "cobblemon:fossil_analyzer") return;
    const tank = tankNear(block.dimension, block.location, type);
    if (!tank) return;
    D.loadMachines();
    const key = keyOf(tank.dimension, tank.location), st = D.machines.get(key);
    if (!st) return;
    fossilBroken(block, tank, st);
    D.machines.delete(key); D.saveMachines();
    for (const e of tank.dimension.getEntities({ families: ["fossil_display"], location: tank.location, maxDistance: 2 })) try { e.remove(); } catch (e) { }
    quietState(tank, "cobblemon:fill", 0); quietState(tank, "cobblemon:signal", 0);
    try { quietState(tank.above(), "cobblemon:signal", 0); } catch (e) { }
}
// a redstone pulse on the tank (onTriggerEvent, TRIGGERED): the finished Pokemon comes out wild four ticks on, once
// nobody is protected on it
const powered = new Set();
function fossilRedstone() {
    D.loadMachines();
    for (const [key, st] of D.machines) {
        if (!st.done) { powered.delete(key); continue; }
        const tank = blockAt(key);
        if (tank?.typeId !== "cobblemon:restoration_tank") continue;
        let power = 0;
        for (const b of [tank, tank.above()]) try { power = Math.max(power, b?.getRedstonePower() ?? 0); } catch (e) { }
        if (power <= 0) { powered.delete(key); continue; }
        if (powered.has(key)) continue;
        powered.add(key);
        if (st.protect > 0) continue;
        system.runTimeout(() => {
            const now = D.machines.get(key), here = blockAt(key);
            if (!now?.done || now.protect > 0 || here?.typeId !== "cobblemon:restoration_tank") return;
            if (!releaseWild(here, now)) return;
            D.machines.set(key, { fossils: [], material: 0, left: -1, done: false, owner: null, result: null, protect: 0 });
            D.saveMachines();
            const m = D.findMachine(here);
            if (m) D.show(m, D.machines.get(key));
        }, 4);
    }
}
// hoppers into the machine (FossilAnalyzerBlock and RestorationTankBlock as WorldlyContainerHolders): one pointing
// into the analyzer puts a fossil in, one into the tank a natural material, one item each eight ticks, while the
// machine is idle; a material's return item (a bowl, a bucket) goes back into the hopper
function fossilHoppers() {
    D.loadMachines();
    for (const key of [...D.machines.keys()]) {
        const tank = blockAt(key);
        if (tank?.typeId !== "cobblemon:restoration_tank") continue;
        const m = D.findMachine(tank);
        if (!m) continue;
        const st = D.machines.get(key);
        if (st.left > 0 || st.done) continue;
        let changed = false;
        const targets = [[m.analyzer, "fossil"], [m.tank, "material"]];
        try { targets.push([m.tank.above(), "material"]); } catch (e) { }
        for (const [target, kind] of targets) {
            for (const [side, facing] of D.HOPPER_INTO ?? []) {
                let from; try { from = target[side](); } catch (e) { continue; }
                const container = D.hopperAt(from);
                if (!container) continue;
                try { if (from.permutation.getState("facing_direction") !== facing) continue; } catch (e) { continue; }
                for (let i = 0; i < container.size; i++) {
                    const item = container.getItem(i), id = item?.typeId;
                    if (!id) continue;
                    if (kind === "fossil") {
                        if (!D.FOSSILS.fossilItems.includes(id) || st.fossils.length >= D.FOSSILS.maxFossils) continue;
                        st.fossils.push(id); st.owner = st.owner ?? null;
                        playSound(m.analyzer, "cobblemon.block.fossil_machine.insert_fossil");
                    } else {
                        const worth = D.FOSSILS.materials[id];
                        if (!worth || st.material >= D.FOSSILS.materialToStart) continue;
                        st.material = Math.min(D.FOSSILS.materialToStart, st.material + worth[0]);
                        playSound(m.tank, st.material >= D.FOSSILS.materialToStart ? "cobblemon.block.fossil_machine.dna_full" : worth[0] > 1 ? "cobblemon.block.fossil_machine.insert_dna" : "cobblemon.block.fossil_machine.insert_dna_small");
                        if (worth[1]) { try { const left = container.addItem(new ItemStack(worth[1], 1)); if (left) spawnItem(from, worth[1], 1); } catch (e) { } }
                    }
                    if (item.amount > 1) { item.amount--; container.setItem(i, item); } else container.setItem(i, undefined);
                    changed = true;
                    break;
                }
                if (changed) break;
            }
            if (changed) break;
        }
        if (!changed) continue;
        // a full tank with a matching set of fossils starts the machine, as a player's last item does (useMachine)
        const r = D.resultFor(st.fossils);
        if (r && st.material >= D.FOSSILS.materialToStart) {
            st.result = r.entity; st.left = D.FOSSILS.reviveSeconds; st.fossils = [];
            playSound(m.tank, "cobblemon.block.fossil_machine.activate"); playSound(m.monitor, "cobblemon.block.monitor.loading");
        }
        D.saveMachines(); D.show(m, st);
    }
}

// ---- the gilded chests' hoppers (GildedChestBlockEntity as a WorldlyContainer) ------------------------------------
// A hopper pointing into the chest from above or a side puts one item in each eight ticks, one under it takes one out
// (canPlaceItemThroughFace: any side but down; canTakeItemThroughFace: down only). The chest is an entity, so the
// script moves the items, as it does for the pot. A solid block over the chest keeps it shut (GildedChestBlock.
// useWithoutItem's isSolidRender check).
const CHEST_INTO = [[[0, 1, 0], 0], [[0, 0, -1], 3], [[0, 0, 1], 2], [[-1, 0, 0], 5], [[1, 0, 0], 4]];   // the hopper's offset from the chest, and the facing_direction pointing at it
function chestHoppers() {
    const seen = new Set();
    for (const player of world.getPlayers()) {
        let chests;
        try { chests = player.dimension.getEntities({ families: ["gilded_chest"], location: player.location, maxDistance: 16 }); } catch (e) { continue; }
        for (const chest of chests) {
            if (seen.has(chest.id)) continue;
            seen.add(chest.id);
            let inv; try { inv = chest.getComponent(EntityComponentTypes.Inventory)?.container; } catch (e) { }
            if (!inv) continue;
            const at = { x: Math.floor(chest.location.x), y: Math.floor(chest.location.y), z: Math.floor(chest.location.z) }, dim = chest.dimension;
            for (const [[dx, dy, dz], facing] of CHEST_INTO) {
                let from; try { from = dim.getBlock({ x: at.x + dx, y: at.y + dy, z: at.z + dz }); } catch (e) { continue; }
                const container = D.hopperAt(from);
                if (!container) continue;
                try { if (from.permutation.getState("facing_direction") !== facing) continue; } catch (e) { continue; }
                for (let i = 0; i < container.size; i++) {
                    const item = container.getItem(i);
                    if (!item) continue;
                    const one = item.clone(); one.amount = 1;
                    let left; try { left = inv.addItem(one); } catch (e) { left = one; }
                    if (left) continue;
                    if (item.amount > 1) { item.amount--; container.setItem(i, item); } else container.setItem(i, undefined);
                    break;
                }
            }
            let below; try { below = dim.getBlock({ x: at.x, y: at.y - 1, z: at.z }); } catch (e) { }
            const out = D.hopperAt(below);
            if (!out) continue;
            for (let i = 0; i < inv.size; i++) {
                const item = inv.getItem(i);
                if (!item) continue;
                const one = item.clone(); one.amount = 1;
                let left; try { left = out.addItem(one); } catch (e) { left = one; }
                if (left) continue;
                if (item.amount > 1) { item.amount--; inv.setItem(i, item); } else inv.setItem(i, undefined);
                break;
            }
        }
    }
}
export function chestBlocked(chest) {
    try { return !!chest.dimension.getBlock({ x: Math.floor(chest.location.x), y: Math.floor(chest.location.y) + 1, z: Math.floor(chest.location.z) })?.isSolid; } catch (e) { return false; }
}

// ---- the healing machine's recall (HealingMachineBlock.useWithoutItem) -------------------------------------------
// the party's Pokemon out in the world go back into their balls as the machine takes them (tryRecallWithAnimation)
export function recallPartyToHealer(player) {
    let slots = [];
    try { slots = D.partyOf(player.id); } catch (e) { return; }
    for (const slot of slots) if (slot.out) try { D.recallMember(player, slot, true); } catch (e) { }
}
// HealingMachineBlock.animateTick: happy villager particles over the machine, half the ticks, while it heals
export function healerParticles(dimension, at, ticks) {
    let left = ticks;
    const loop = system.runInterval(() => {
        if (--left < 0) { system.clearRun(loop); return; }
        if (Math.random() < 0.5) return;
        const sway = () => (Math.random() * 0.3) * (Math.random() < 0.5 ? 1 : -1);
        try { dimension.spawnParticle("minecraft:villager_happy", { x: at.x + 0.5 + sway(), y: at.y + 0.9, z: at.z + 0.5 + sway() }); } catch (e) { }
    }, 1);
}

export function initBlockLogic(deps) {
    D = deps;
    // a Monitor on its own: its disc or the Upgrade and Dubious Disc, before the fossil machine component sees the click
    world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
        const { block, player, itemStack, isFirstEvent } = event;
        if (block?.typeId !== "cobblemon:monitor") return;
        const id = itemStack?.typeId, key = keyOf(block.dimension, block.location);
        if (!(isMusicDisc(id) || isTm(id) || isPorygonItem(id) || monitors()[key] || processes.has(key))) return;
        if (D.findMachine(block)) return;   // part of a machine: the machine takes the click
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => { if (block.isValid) useLoneMonitor(block, player, id); });
    });
    // the Disc Shelf's slots on its front face
    world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
        const { block, player, itemStack, isFirstEvent, blockFace, faceLocation } = event;
        if (block?.typeId !== "cobblemon:disc_shelf" || !faceLocation) return;
        const front = frontOf(block);
        if (String(blockFace ?? "").toLowerCase() !== front) return;
        const slot = shelfSlot(front, faceLocation);
        if (slot < 0) return;
        const id = itemStack?.typeId;
        if (id ? !shelfAccepts(id) : !shelfData(block)[slot]) return;
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => { if (block.isValid) useShelf(block, player, slot, id); });
    });
    world.afterEvents.playerBreakBlock.subscribe((event) => {
        partBroken(event);
        if (event.brokenBlockPermutation?.type?.id !== "cobblemon:disc_shelf") return;
        const { block } = event, slots = shelfData(block);
        for (const id of slots) if (id) spawnItem(block, id, 1);
        saveShelf(block, Array(SHELF_SLOTS).fill(null));
    });
    // a part placed completes a machine: the machine is registered for its hoppers and its Monitor gives up its disc
    world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
        if (!["cobblemon:restoration_tank", "cobblemon:fossil_analyzer", "cobblemon:monitor"].includes(block.typeId)) return;
        system.runTimeout(() => {
            if (!block.isValid) return;
            const m = D.findMachine(block);
            if (!m?.monitor) return;
            D.stateFor(m.key);
            monitorGone(m.monitor, m.monitor.dimension, m.monitor.location);
            D.show(m, D.machines.get(m.key));
        }, 3);
    });
    // a solid block over a gilded chest keeps it shut
    world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
        const { target } = event;
        if (!/gilded_chest_entity$/.test(target?.typeId ?? "")) return;
        if (chestBlocked(target)) event.cancel = true;
    });
    system.runInterval(tickProcesses, 1);
    system.runInterval(fossilRedstone, 2);
    system.runInterval(() => { shelfHoppers(); fossilHoppers(); chestHoppers(); }, 8);
}
