// Pokemon out in the world: the PokemonEntity behaviours its components cannot carry, driven with the helpers
// scripts/main.js hands over in installWorld. Sleeping on the trainer's bed (pokemon_sleeps_on_trainer_bed.json),
// lightning (PokemonEntity.thunderHit), Levitate's gravity, the Mooshtank Miltank (PokemonEntity.mobInteract), leads,
// Smeargle's tail paint (PokemonAspects.CHARACTERISTIC_RAINBOW_ASPECT), the raft at send-out
// (PokemonEntity.getAdjustedSendoutPosition) and a baby's size (Pokemon.effectiveScale).
import { world, system, ItemStack, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";
import { POKEMON, NATURES } from "./data.js";
import { VARIANT_LOOKS } from "./variants.js";
import { BED_SLEEPERS, SENDOUT_WATER } from "./world_rules.js";

const OWNER = "cobblemon:owner", LEVEL = "cobblemon:level", ABILITY = "cobblemon:ability", FAINTED = "cobblemon:fainted";
const DIMENSIONS = ["overworld", "nether", "the_end"];
// main.js's helpers, as installWorld hands them over
let D = { prop: () => undefined, setProp() { }, isAlpha: () => false, battling: () => false, natureOf: () => "hardy", ivsOf: () => ({}), variantOf: () => 0 };

function pokemonIn(dim, query = {}) {
    try { return world.getDimension(dim).getEntities({ families: ["pokemon"], ...query }); } catch (e) { return []; }
}
const isWater = (b) => !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water" || b.isWaterlogged);
const hashOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

// Pokemon.effectiveScale: babyPokemonSizeMultiplier 0.9 at level 1, growing evenly to full size at babyPokemonLevelDuration, 9
export function babyScale(level) {
    const min = 0.9, maxLevel = 9;
    if (!(level > 1)) return min;
    if (level >= maxLevel) return 1;
    return min + (1 - min) * ((level - 1) / (maxLevel - 1));
}

// the block over a Pokemon is air: TargetEntityTaskConfig's q.entity.world.is_air(x, y + 1, z), a Magikarp out of the water
export function airAbove(e) {
    try { return !!e.dimension.getBlock({ x: Math.floor(e.location.x), y: Math.floor(e.location.y) + 1, z: Math.floor(e.location.z) })?.isAir; } catch (err) { return false; }
}

// Characteristic.calculate: the highest IV picks the stat (the first of equals, counting round the list from where the
// uuid's hash points, as the personality value turns it); CHARACTERISTIC_RAINBOW_ASPECT pairs the nature's raised stat
// with it for the paint colour. Cobblemon's own light-blue never matches its resolver's rainbow-light_blue, so nor here.
const IV_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];
const RAINBOW = {
    "atk:atk": "red", "atk:hp": "red", "none:atk": "red", "spe:def": "red", "def:spe": "red",
    "atk:def": "orange", "def:atk": "orange",
    "def:def": "yellow", "def:hp": "yellow", "none:def": "yellow", "atk:spd": "yellow", "spd:atk": "yellow",
    "def:spd": "lime", "spd:def": "lime",
    "spd:spd": "green", "spd:hp": "green", "none:spd": "green", "def:spa": "green", "spa:def": "green",
    "spd:spa": "cyan", "spa:spd": "cyan",
    "spa:spa": "blue", "spa:hp": "blue", "none:spa": "blue", "spd:spe": "blue", "spe:spd": "blue",
    "spa:spe": "purple", "spe:spa": "purple",
    "spe:spe": "magenta", "spe:hp": "magenta", "none:spe": "magenta", "spa:atk": "magenta", "atk:spa": "magenta",
    "spe:atk": "pink", "atk:spe": "pink",
    "none:hp": "light-blue",
};
export function rainbowColour(ivs, natureUp, seed) {
    const start = Math.abs(seed ?? 0) % IV_ORDER.length;
    let stat = "hp", best = -1;
    for (let i = 0; i < IV_ORDER.length; i++) {
        const key = IV_ORDER[(start + i) % IV_ORDER.length], value = ivs?.[key] ?? 0;
        if (value > best) { best = value; stat = key; }
    }
    return RAINBOW[`${natureUp ?? "none"}:${stat}`] ?? null;
}
// a Smeargle in its plain look takes the paint its nature and IVs give it; a dyed or already painted one is left as it is
function paintTail(e) {
    const looks = VARIANT_LOOKS[e.typeId];
    if (!looks || !looks.some((l) => typeof l[0] === "string" && l[0].startsWith("rainbow-"))) return;
    const [form, female, shiny] = looks[D.variantOf(e)] ?? [null, 0, 0];
    if (form !== null) return;
    const colour = rainbowColour(D.ivsOf(e), NATURES[D.natureOf(e)]?.[0] ?? null, hashOf(e.id));
    const n = colour ? looks.findIndex((l) => l[0] === `rainbow-${colour}` && l[1] === female && l[2] === shiny) : -1;
    if (n >= 0) try { e.triggerEvent(`cobblemon:set_variant_${n}`); } catch (err) { }
}

// PokemonEntity.getAdjustedSendoutPosition: a Pokemon sent out over water (into it, or into the air above it, up to 64
// blocks down) is put at the surface: a flier a block above it, a swimmer half its height under it, a water walker on it,
// and any other on its raft (PlatformType, sendOutRaft). The surface counts when the block over it is open air.
export function adjustSendOut(dim, at, typeId) {
    const kind = SENDOUT_WATER[typeId], column = { x: Math.floor(at.x), z: Math.floor(at.z) };
    const y = Math.floor(at.y);
    let surface;
    try {
        if (isWater(dim.getBlock({ ...column, y }))) {
            let top = y;
            for (let i = 0; i <= 5 && isWater(dim.getBlock({ ...column, y: top })); i++) top++;
            const above = dim.getBlock({ ...column, y: top });
            if (above?.isAir) surface = top;
        } else if (dim.getBlock({ ...column, y })?.isAir) {
            for (let i = 0, p = y - 1; i <= 64; i++, p--) {
                const b = dim.getBlock({ ...column, y: p });
                if (!b) break;
                if (isWater(b)) { surface = p + 1; break; }
                if (!b.isAir) break;
            }
        }
    } catch (e) { surface = undefined; }
    if (surface === undefined) return { at, raft: false };
    if (kind === "f") return { at: { x: at.x, y: surface + 1, z: at.z }, raft: false };
    if (kind === "s") return { at: { x: at.x, y: surface - (POKEMON[typeId]?.height ?? 1) / 2, z: at.z }, raft: false };
    return { at: { x: at.x, y: surface, z: at.z }, raft: kind !== "w" };
}
// the raft a Pokemon sent out onto water stands on, as main.js's battle raft (sized by width, turned as it faces, the
// Pokemon kept a quarter block up on it); it goes when the Pokemon leaves it, is recalled, or a battle's own raft takes over
function raftSize(width) { return width <= 0.511 ? 0 : width < 1.01 ? 1 : width < 1.8 ? 2 : width < 2.875 ? 3 : 4; }
function waterTop(dim, at) {
    let y = Math.floor(at.y);
    try {
        if (!isWater(dim.getBlock({ x: Math.floor(at.x), y, z: Math.floor(at.z) }))) return undefined;
        while (isWater(dim.getBlock({ x: Math.floor(at.x), y: y + 1, z: Math.floor(at.z) }))) y++;
    } catch (e) { return undefined; }
    return y + 1;
}
const sentRafts = new Map();   // Pokemon id -> its raft
export function sendOutRaft(e) {
    if (!e?.isValid || sentRafts.has(e.id)) return;
    let top;
    try { top = waterTop(e.dimension, { x: e.location.x, y: e.location.y - 0.1, z: e.location.z }); } catch (err) { }
    if (top === undefined) return;
    try {
        const raft = e.dimension.spawnEntity("cobblemon:water_platform", { x: e.location.x, y: top, z: e.location.z });
        raft.triggerEvent(`cobblemon:size_${raftSize(POKEMON[e.typeId]?.width ?? 0.6)}`);
        raft.setRotation({ x: 0, y: e.getRotation().y });
        sentRafts.set(e.id, raft);
    } catch (err) { }
}
function tickRafts() {
    for (const [id, raft] of [...sentRafts]) {
        const e = world.getEntity(id);
        let top;
        try { if (e?.isValid && raft.isValid && !D.battling(e) && Math.hypot(e.location.x - raft.location.x, e.location.z - raft.location.z) <= 1.5) top = waterTop(raft.dimension, { ...raft.location, y: raft.location.y - 0.1 }); } catch (err) { }
        if (top === undefined) { try { raft.remove(); } catch (err) { } sentRafts.delete(id); continue; }
        try { e.teleport({ x: raft.location.x, y: top + 0.25, z: raft.location.z }, { keepVelocity: false }); } catch (err) { }
    }
}

// Sleeping on the trainer's bed (pokemon_sleeps_on_trainer_bed.json, for resting.willSleepOnBed): while its trainer lies in
// a bed within 12 blocks (SwitchToSleepOnTrainerBedTaskConfig), a Pokemon of such a species that is not in battle goes to
// the bed (follow_owner brings it to its trainer) and, once beside them, settles on the bed and sleeps
// (SleepIfOnTrainerBedTaskConfig); it wakes when the trainer gets up or is gone (SwitchFromSleepOnTrainerBedTaskConfig)
const BED_SLEEPER_SET = new Set(BED_SLEEPERS), BED_REACH = 3;
const onBed = new Map();   // Pokemon id -> its trainer's id
// the bed a sleeping player lies on, its foot piece first (Cobblemon's walk target is the block opposite the bed's facing)
export function bedOf(dim, at) {
    let found;
    for (const dy of [0, -1, 1]) for (const dx of [0, -1, 1]) for (const dz of [0, -1, 1]) {
        let b;
        try { b = dim.getBlock({ x: Math.floor(at.x) + dx, y: Math.floor(at.y) + dy, z: Math.floor(at.z) + dz }); } catch (e) { continue; }
        if (b?.typeId !== "minecraft:bed") continue;
        let head = false;
        try { head = !!b.permutation.getState("head_piece_bit"); } catch (e) { }
        if (!head) return b;
        found = found ?? b;
    }
    return found;
}
function tickBeds() {
    for (const player of world.getPlayers()) {
        let asleep = false;
        try { asleep = player.isSleeping; } catch (e) { }
        if (!asleep) continue;
        let bed;
        try { bed = bedOf(player.dimension, player.location); } catch (e) { }
        if (!bed) continue;
        let near = [];
        try { near = player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 12 }); } catch (e) { continue; }
        for (const e of near) {
            if (!BED_SLEEPER_SET.has(e.typeId) || D.prop(e, OWNER) !== player.id || onBed.has(e.id) || D.battling(e) || D.prop(e, FAINTED)) continue;
            if (Math.hypot(e.location.x - player.location.x, e.location.z - player.location.z) > BED_REACH) continue;
            try {
                e.teleport({ x: bed.x + 0.5, y: bed.y + 0.5625, z: bed.z + 0.5 }, { keepVelocity: false });
                e.triggerEvent("cobblemon:bedtime");
            } catch (err) { continue; }
            onBed.set(e.id, player.id);
        }
    }
    for (const [id, trainerId] of [...onBed]) {
        const e = world.getEntity(id), trainer = world.getEntity(trainerId);
        let asleep = false;
        try { asleep = !!trainer?.isValid && trainer.isSleeping; } catch (err) { }
        if (e?.isValid && asleep && !D.battling(e)) continue;
        onBed.delete(id);
        if (e?.isValid) try { e.triggerEvent("cobblemon:wake_up"); } catch (err) { }
    }
}

// Lightning (PokemonEntity.thunderHit, LightningBoltMixin): a Ground type takes none (the entity's damage sensor); Lightning
// Rod, Motor Drive and Volt Absorb take none either (the cobblemon:lightning_immune property, kept here with the ability)
// and gain Strength II for a minute, Speed II for a minute, or a heal, and no fire is lit where one absorbed the strike.
// A Mooshtank Miltank struck turns red to brown or back (lightningHit.rotateFeatures) with the mooshroom's sound.
const LIGHTNING_ABILITIES = { lightningrod: ["strength", 1200, 1], motordrive: ["speed", 1200, 1], voltabsorb: ["instant_health", 1, 1] };
const MILTANK = "cobblemon:p0241_miltank";
export function lightningEffect(ability) { return LIGHTNING_ABILITIES[ability] ?? null; }
function struckBy(bolt) {
    let dim, at;
    try { dim = bolt.dimension; at = bolt.location; } catch (e) { return; }
    let absorbed = false;
    for (const e of pokemonIn(dim.id, { location: at, maxDistance: 10 })) {
        // LightningBolt.tick's box: 3 blocks out and 6 up
        if (Math.abs(e.location.x - at.x) > 3 || Math.abs(e.location.z - at.z) > 3 || e.location.y < at.y - 3 || e.location.y > at.y + 9) continue;
        const effect = lightningEffect(D.prop(e, ABILITY));
        if (effect) { absorbed = true; try { e.addEffect(effect[0], effect[1], { amplifier: effect[2] }); } catch (err) { } }
        if (effect || POKEMON[e.typeId]?.types?.includes("ground")) system.run(() => { try { e.extinguishFire(); } catch (err) { } });
        if (e.typeId === MILTANK) flipMooshtank(e);
    }
    if (!absorbed) return;
    system.run(() => {
        for (let x = -2; x <= 2; x++) for (let y = -1; y <= 2; y++) for (let z = -2; z <= 2; z++) {
            try { const b = dim.getBlock({ x: Math.floor(at.x) + x, y: Math.floor(at.y) + y, z: Math.floor(at.z) + z }); if (b?.typeId === "minecraft:fire") b.setType("minecraft:air"); } catch (err) { }
        }
    });
}
function mooshtankOf(e) { const form = VARIANT_LOOKS[e.typeId]?.[D.variantOf(e)]?.[0]; return typeof form === "string" && form.startsWith("mooshtank-") ? form.slice("mooshtank-".length) : null; }
function flipMooshtank(e) {
    const colour = mooshtankOf(e);
    if (!colour) return;
    const looks = VARIANT_LOOKS[e.typeId], [, female, shiny] = looks[D.variantOf(e)];
    const n = looks.findIndex((l) => l[0] === `mooshtank-${colour === "red" ? "brown" : "red"}` && l[1] === female && l[2] === shiny);
    if (n < 0) return;
    try { e.triggerEvent(`cobblemon:set_variant_${n}`); e.dimension.playSound("mob.mooshroom.convert", e.location, { volume: 2 }); } catch (err) { }
}
// once a second: the lightning immunity property follows the ability, and Levitate halves the fall (updateAttributes'
// gravity 0.04, as slow falling here)
function tickAbilities() {
    for (const dim of DIMENSIONS) {
        for (const e of pokemonIn(dim)) {
            const ability = D.prop(e, ABILITY);
            const immune = !!LIGHTNING_ABILITIES[ability];
            try { if (e.getProperty("cobblemon:lightning_immune") !== immune) e.setProperty("cobblemon:lightning_immune", immune); } catch (err) { }
            if (ability === "levitate") try { e.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false }); } catch (err) { }
        }
    }
}

// The Mooshtank Miltank (PokemonEntity.mobInteract, by its owner or anyone on a wild one): a bowl fills with Mushroom
// Stew; a brown one fed a flower remembers it (Pokemon.lastFlowerFed) and the next bowl fills with Suspicious Stew carrying
// that flower's effect (SuspiciousEffectHolder), which Bedrock gives when the stew is eaten, since a script cannot write the
// stew's own effect. Java 1.21's flowers: the effect and its ticks. Cobblemon's Pep-Up Flower is Levitation for 10 seconds.
export const FLOWER_STEW = {
    "minecraft:allium": ["fire_resistance", 80], "minecraft:azure_bluet": ["blindness", 220], "minecraft:blue_orchid": ["saturation", 7],
    "minecraft:dandelion": ["saturation", 7], "minecraft:cornflower": ["jump_boost", 100], "minecraft:lily_of_the_valley": ["poison", 220],
    "minecraft:oxeye_daisy": ["regeneration", 140], "minecraft:poppy": ["night_vision", 100], "minecraft:torchflower": ["night_vision", 80],
    "minecraft:pink_tulip": ["weakness", 140], "minecraft:red_tulip": ["weakness", 140], "minecraft:white_tulip": ["weakness", 140],
    "minecraft:orange_tulip": ["weakness", 140], "minecraft:wither_rose": ["wither", 140], "cobblemon:pep_up_flower": ["levitation", 200],
};
const FLOWER_FED = "cobblemon:flower_fed", STEW_EFFECT = "cobblemon:stew_effect";
// one of the item in hand becomes another: the stack shrinks and the result goes into the inventory, or the hand takes it
function swapHand(player, result) {
    try {
        const equipment = player.getComponent(EntityComponentTypes.Equippable), held = equipment?.getEquipment(EquipmentSlot.Mainhand);
        if (!held) return;
        if (held.amount <= 1) { equipment.setEquipment(EquipmentSlot.Mainhand, new ItemStack(result, 1)); return; }
        held.amount -= 1; equipment.setEquipment(EquipmentSlot.Mainhand, held);
        const left = player.getComponent(EntityComponentTypes.Inventory)?.container?.addItem(new ItemStack(result, 1));
        if (left) player.dimension.spawnItem(left, player.location);
    } catch (e) { }
}
function mooshtankInteract(event) {
    const { player, target, itemStack } = event;
    if (target?.typeId !== MILTANK || !itemStack) return;
    const colour = mooshtankOf(target);
    if (!colour) return;
    const owner = D.prop(target, OWNER);
    if (owner !== undefined && owner !== player.id) return;
    if (itemStack.typeId === "minecraft:bowl") {
        event.cancel = true;
        system.run(() => {
            const fed = colour === "brown" ? FLOWER_STEW[D.prop(target, FLOWER_FED)] : undefined;
            if (fed) { D.setProp(player, STEW_EFFECT, JSON.stringify(fed)); D.setProp(target, FLOWER_FED, undefined); }
            swapHand(player, fed ? "minecraft:suspicious_stew" : "minecraft:mushroom_stew");
            try { player.dimension.playSound(fed ? "mob.mooshroom.suspicious_milk" : "mob.cow.milk", target.location); } catch (e) { }
        });
    } else if (colour === "brown" && FLOWER_STEW[itemStack.typeId]) {
        event.cancel = true;
        system.run(() => {
            D.setProp(target, FLOWER_FED, itemStack.typeId);
            try { if (player.getGameMode?.() !== "Creative") swapHand(player, "minecraft:air"); } catch (e) { }
            try { player.dimension.playSound("mob.mooshroom.eat", target.location); } catch (e) { }
        });
    }
}
function stewEaten({ itemStack, source }) {
    if (itemStack?.typeId !== "minecraft:suspicious_stew") return;
    let effect;
    try { effect = JSON.parse(D.prop(source, STEW_EFFECT) ?? "null"); } catch (e) { }
    if (!effect) return;
    D.setProp(source, STEW_EFFECT, undefined);
    try { source.addEffect(effect[0], Math.max(1, effect[1]), { amplifier: 0 }); } catch (e) { }
}

// PokemonEntity.setLeashedTo: a lead on an owned Pokemon holds only in its owner's hand
function leadInteract(event) {
    const { player, target, itemStack } = event;
    if (itemStack?.typeId !== "minecraft:lead" || !POKEMON[target?.typeId]) return;
    const owner = D.prop(target, OWNER);
    if (owner !== undefined && owner !== player.id) event.cancel = true;
}

export function installWorld(deps) {
    D = { ...D, ...deps };
    system.runInterval(tickBeds, 20);
    system.runInterval(tickAbilities, 20);
    system.runInterval(tickRafts, 2);
    world.afterEvents.entitySpawn.subscribe(({ entity }) => {
        if (entity?.typeId === "minecraft:lightning_bolt") struckBy(entity);
        else if (POKEMON[entity?.typeId]) system.runTimeout(() => { if (entity.isValid) paintTail(entity); }, 8);
    });
    world.afterEvents.entityLoad.subscribe(({ entity }) => { if (POKEMON[entity?.typeId]) system.runTimeout(() => { if (entity.isValid) paintTail(entity); }, 8); });
    world.beforeEvents.playerInteractWithEntity.subscribe(mooshtankInteract);
    world.beforeEvents.playerInteractWithEntity.subscribe(leadInteract);
    world.afterEvents.itemCompleteUse.subscribe(stewEaten);
    world.afterEvents.entityHurt.subscribe(({ hurtEntity }) => {
        if (!onBed.delete(hurtEntity?.id)) return;
        try { hurtEntity.triggerEvent("cobblemon:wake_up"); } catch (e) { }
    });
}
