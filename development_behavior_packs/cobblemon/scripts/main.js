// Turn-based battles. A "Battle" button on a wild Pokemon's panel (or a trainer's challenge) fires a
// script event; this sends out the player's nearest owned Pokemon that can still fight, freezes both, and
// runs turns through a button form: the Pokemon's four moves with their PP, Switch, Throw Poke Ball and
// Run. Damage is the main-series formula over Showdown's move table and type chart, generated into data.js,
// with stat stages, accuracy and evasion, the major status conditions, a handful of abilities, critical
// hits and Struggle. A win earns experience; levels, the moves learned on the way and fainting are kept on
// the Pokemon as dynamic properties, and a fainted Pokemon sits out until a healing machine or the
// professor heals it.
import { world, system, EntityComponentTypes, EntityInitializationCause, ItemStack, InputButton, ButtonState } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { POKEMON, MOVES, TYPES, BALLS, ABILITY_NAMES, ABILITY_DESC, MOVE_DESC, NATURES, TIME_RANGES } from "./data.js";
import { SUMMARY_LAYOUT } from "./summary_layout.js";
import { PC_LAYOUT } from "./pc_layout.js";
import { DEX_LAYOUT } from "./dex_layout.js";
import { STARTERS, STARTER_LAYOUT } from "./starters.js";
import { BERRIES, FOSSILS, APRICORN_TREES } from "./blocks.js";
import { FORMATIONS, BRUSH_LOOT } from "./fossil_loot.js";
import { RODS, FISHING_SPAWNS, BIOME_TAGS, BUCKETS, ROD_TREASURE } from "./fishing.js";
import { NATIONAL, REGIONS, DEX_INFO } from "./dex.js";
import { HELD_ITEMS, MEDICINE, CANDIES, EV_ITEMS, MINTS, EV_BERRIES, HOLD_BLACKLIST, TOOLTIPS } from "./items.js";
import { HELD_INDEX, HELD_ICONS } from "./held_display.js";

const battles = new Map(); // player id -> battle
const LEVEL = "cobblemon:level", EXP = "cobblemon:exp", MOVESET = "cobblemon:moves", FAINTED = "cobblemon:fainted";
const STAT_NAMES = { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
const STATUS_TEXT = { brn: "was burned", par: "is paralyzed! It may be unable to move", psn: "was poisoned", tox: "was badly poisoned", slp: "fell asleep", frz: "was frozen solid" };
const STATUS_TAG = { brn: "§6BRN§r", par: "§ePAR§r", psn: "§5PSN§r", tox: "§5TOX§r", slp: "§7SLP§r", frz: "§bFRZ§r" };
const STATUS_IMMUNE = { brn: ["fire"], par: ["electric"], psn: ["poison", "steel"], tox: ["poison", "steel"], frz: ["ice"] };
// abilities that make a move type miss, and the ones that power up a type in a pinch
const ABILITY_IMMUNE = { levitate: "ground", flashfire: "fire", voltabsorb: "electric", lightningrod: "electric", motordrive: "electric", waterabsorb: "water", stormdrain: "water", dryskin: "water", sapsipper: "grass" };
const ABILITY_PINCH = { blaze: "fire", torrent: "water", overgrow: "grass", swarm: "bug" };
const ABILITY_CONTACT = { static: "par", flamebody: "brn", poisonpoint: "psn" };
// held items in battle, as Showdown's item scripts: type boosts 1.2x, Choice items 1.5x a stat and lock the move,
// Life Orb 1.3x for a tenth of HP, Expert Belt 1.2x on super effective hits, Leftovers a sixteenth a turn,
// Focus Sash survives a knockout from full HP, Rocky Helmet a sixth back on contact, Assault Vest 1.5x Sp. Def,
// Eviolite 1.5x defences on a Pokemon that can evolve, and the healing and curing berries once, when they apply
const TYPE_ITEMS = { charcoal_stick: "fire", mystic_water: "water", miracle_seed: "grass", magnet: "electric", never_melt_ice: "ice", black_belt: "fighting",
    poison_barb: "poison", soft_sand: "ground", sharp_beak: "flying", twisted_spoon: "psychic", silver_powder: "bug", hard_stone: "rock",
    spell_tag: "ghost", dragon_fang: "dragon", black_glasses: "dark", metal_coat: "steel", silk_scarf: "normal", fairy_feather: "fairy" };
const STATUS_BERRIES = { cheri_berry: ["par"], chesto_berry: ["slp"], pecha_berry: ["psn", "tox"], rawst_berry: ["brn"], aspear_berry: ["frz"], lum_berry: null };
function held(f) { return f.held ? f.held.slice("cobblemon:".length) : null; }
// more of Showdown's items: the species items that double a stat, the crit items, and the items used up when they act
const SPECIES_ITEMS = { light_ball: [["pikachu"], ["atk", "spa"]], thick_club: [["cubone", "marowak"], ["atk"]], deep_sea_tooth: [["clamperl"], ["spa"]],
    deep_sea_scale: [["clamperl"], ["spd"]], metal_powder: [["ditto"], ["def"]] };
const CRIT_ITEMS = { scope_lens: [null, 1], razor_claw: [null, 1], leek: [["farfetchd", "sirfetchd"], 2], stick: [["farfetchd", "sirfetchd"], 2], lucky_punch: [["chansey"], 2] };
const HIT_BOOSTS = { absorb_bulb: ["water", { spa: 1 }], cell_battery: ["electric", { atk: 1 }], luminous_moss: ["water", { spd: 1 }], snowball: ["ice", { atk: 1 }] };
const POWER_ITEMS = { power_weight: "hp", power_bracer: "atk", power_belt: "def", power_lens: "spa", power_band: "spd", power_anklet: "spe" };
function holds(f, item, speciesList) { return held(f) === item && (!speciesList || speciesList.some((n) => f.info.name.toLowerCase().replace(/[^a-z]/g, "").startsWith(n))); }
function useUp(battle, f, text) { if (text) say(battle, text); f.held = null; setProp(f.entity, "cobblemon:held", undefined); }
const STRUGGLE = { name: "Struggle", type: "???", power: 50, accuracy: true, category: "Physical", priority: 0, pp: 1, target: "normal", contact: true };

function statAt(base, level, iv = 31, ev = 0, nature = 1) { return Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * nature); }
function hpAt(base, level, iv = 31, ev = 0) { return base === 1 ? 1 : Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10; }   // Shedinja has 1

// Each Pokemon rolls its IVs (0 to 31) and nature once, as Cobblemon does when it creates one, and keeps them with
// its EVs as dynamic properties. EVs come from battles by the foe's EV yield and from vitamins and feathers, 252 at
// most in a stat and 510 in all; a mint changes the nature its stats use, and the berries that lower EVs undo them.
const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
const EV_STAT_MAX = 252, EV_TOTAL_MAX = 510;
function storedObject(entity, key, make) {
    let value;
    try { value = JSON.parse(prop(entity, key) ?? "null"); } catch (e) { }
    if (!value || typeof value !== "object") { value = make(); setProp(entity, key, JSON.stringify(value)); }
    return value;
}
function ivsOf(entity) { return storedObject(entity, "cobblemon:ivs", () => Object.fromEntries(STAT_KEYS.map((k) => [k, Math.floor(Math.random() * 32)]))); }
function evsOf(entity) { return storedObject(entity, "cobblemon:evs", () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]))); }
function natureOf(entity) {
    let nature = prop(entity, "cobblemon:nature");
    if (!NATURES[nature]) { const all = Object.keys(NATURES); nature = all[Math.floor(Math.random() * all.length)]; setProp(entity, "cobblemon:nature", nature); }
    return nature;
}
function effectiveNature(entity) { const minted = prop(entity, "cobblemon:mint"); return NATURES[minted] ? minted : natureOf(entity); }
function natureMultiplier(nature, stat) { const [up, down] = NATURES[nature] ?? []; return up === down ? 1 : stat === up ? 1.1 : stat === down ? 0.9 : 1; }
function statsOf(entity, info, level) {
    const ivs = ivsOf(entity), evs = evsOf(entity), nature = effectiveNature(entity), out = {};
    for (const k of STAT_KEYS) out[k] = k === "hp" ? hpAt(info.stats.hp, level, ivs.hp, evs.hp) : statAt(info.stats[k], level, ivs[k], evs[k], natureMultiplier(nature, k));
    return out;
}
// adds (or with a negative amount removes) EVs within the caps; returns how many changed
function addEvs(entity, stat, amount) {
    const evs = evsOf(entity), total = STAT_KEYS.reduce((t, k) => t + (evs[k] ?? 0), 0);
    const change = amount > 0 ? Math.min(amount, EV_STAT_MAX - evs[stat], EV_TOTAL_MAX - total) : Math.max(amount, -evs[stat]);
    if (!change) return 0;
    evs[stat] += change; setProp(entity, "cobblemon:evs", JSON.stringify(evs));
    return change;
}
function natureName(nature) { return cap(nature ?? "hardy"); }
function stage(s) { return s >= 0 ? (2 + s) / 2 : 2 / (2 - s); }
function accStage(s) { return s >= 0 ? (3 + s) / 3 : 3 / (3 - s); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function bar(hp, max) { const n = Math.max(0, Math.round((hp / max) * 20)); return "§a" + "|".repeat(n) + "§8" + "|".repeat(20 - n) + "§r"; }
function prop(entity, key) { try { return entity.getDynamicProperty(key); } catch (e) { return undefined; } }
function setProp(entity, key, value) { try { entity.setDynamicProperty(key, value); } catch (e) { } }

// experience needed to reach level n, by Cobblemon's experience groups
function expFor(group, n) {
    const c = n * n * n;
    switch (group) {
        case "fast": return Math.floor((4 * c) / 5);
        case "slow": return Math.floor((5 * c) / 4);
        case "medium_slow": return Math.max(0, Math.floor((6 * c) / 5 - 15 * n * n + 100 * n - 140));
        case "erratic": return n <= 50 ? Math.floor((c * (100 - n)) / 50) : n <= 68 ? Math.floor((c * (150 - n)) / 100) : n <= 98 ? Math.floor((c * Math.floor((1911 - 10 * n) / 3)) / 500) : Math.floor((c * (160 - n)) / 100);
        case "fluctuating": return n <= 15 ? Math.floor((c * (Math.floor((n + 1) / 3) + 24)) / 50) : n <= 36 ? Math.floor((c * (n + 14)) / 50) : Math.floor((c * (Math.floor(n / 2) + 32)) / 50);
        default: return c;
    }
}

// the four latest moves a species knows at a level, keeping at least one that does damage
function movesAt(info, level) {
    const learned = [];
    for (const [at, id] of info.learnset ?? []) if (at <= level && !learned.includes(id)) learned.push(id);
    let known = learned.slice(-4);
    if (!known.some((id) => MOVES[id]?.power)) {
        const damaging = learned.filter((id) => MOVES[id]?.power);
        if (damaging.length) known = known.slice(1).concat(damaging.slice(-1));
    }
    return known.length ? known : info.moves;
}

function fighter(entity) {
    const species = POKEMON[entity.typeId];
    if (!species) return undefined;
    // a regional form (minecraft:variant) fights with its own name, types and base stats
    let variant = 0;
    try { variant = entity.getComponent("minecraft:variant")?.value ?? 0; } catch (e) { }
    const info = { ...species, ...(species.variants?.[variant] ?? {}) };
    const level = prop(entity, LEVEL) ?? info.level;
    let ids;
    try { ids = JSON.parse(prop(entity, MOVESET) ?? "null"); } catch (e) { }
    if (!Array.isArray(ids)) ids = level === info.level ? info.moves : movesAt(info, level);
    const stats = statsOf(entity, info, level);
    // a Pokemon enters with the share of its health its entity has left
    let hp = stats.hp;
    try {
        const health = entity.getComponent(EntityComponentTypes.Health);
        if (health) hp = Math.max(1, Math.round((stats.hp * health.currentValue) / health.effectiveMax));
    } catch (e) { }
    const moves = ids.filter((id) => MOVES[id]).map((id) => ({ id, ...MOVES[id], left: MOVES[id].pp }));
    let rolled = prop(entity, "cobblemon:ability");
    if (!rolled || !([...(info.abilities ?? []), ...(info.hidden ?? [])]).includes(rolled)) {
        const list = info.abilities?.length ? info.abilities : [info.ability];
        rolled = list[Math.floor(Math.random() * list.length)];
        setProp(entity, "cobblemon:ability", rolled);
    }
    const f = { entity, info, level, stats, hp, moves, ability: rolled, status: null, sleep: 0, stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 } };
    f.held = prop(entity, "cobblemon:held") ?? null;
    return f;
}

function effectiveness(moveType, defenderTypes) {
    let mult = 1;
    for (const t of defenderTypes) { const row = TYPES[t]; if (row && row[moveType] !== undefined) mult *= row[moveType]; }
    return mult;
}

// Battle weather, as Showdown's: rain, sun, sand and snow for five turns (eight with the matching rock), from a move
// or an ability on entry. The world's own weather does not carry into a battle, as in Cobblemon.
const WEATHER_TEXT = { rain: ["It started to rain!", "The rain stopped."], sun: ["The sunlight turned harsh!", "The harsh sunlight faded."],
    sand: ["A sandstorm kicked up!", "The sandstorm subsided."], snow: ["It started to snow!", "The snow stopped."] };
const WEATHER_ROCKS = { rain: "damp_rock", sun: "heat_rock", sand: "smooth_rock", snow: "icy_rock" };
const WEATHER_ABILITIES = { drizzle: "rain", drought: "sun", sandstream: "sand", snowwarning: "snow", orichalcumpulse: "sun" };
const WEATHER_SPEED = { swiftswim: "rain", chlorophyll: "sun", sandrush: "sand", slushrush: "snow" };
function weatherOf(battle) { return battle?.weather?.kind ?? null; }
function setWeather(battle, kind, setter) {
    if (weatherOf(battle) === kind) return false;
    battle.weather = { kind, turns: held(setter) === WEATHER_ROCKS[kind] ? 8 : 5 };
    say(battle, `§b${WEATHER_TEXT[kind][0]}`);
    return true;
}
function speedOf(f, battle) {
    let spe = f.stats.spe * stage(f.stages.spe) * (f.status === "par" ? 0.5 : 1) * (held(f) === "choice_scarf" ? 1.5 : 1);
    if (held(f) === "iron_ball" || held(f) === "macho_brace" || POWER_ITEMS[held(f)]) spe *= 0.5;
    if (holds(f, "quick_powder", ["ditto"])) spe *= 2;
    if (WEATHER_SPEED[f.ability] && WEATHER_SPEED[f.ability] === weatherOf(battle)) spe *= 2;
    return spe;
}

// every battle message goes to chat and to the battle screen's log (BattleMessagePane), which shows the last few
function say(battle, text) {
    battle.player.sendMessage(text);
    (battle.log ??= []).push(text);
    if (battle.log.length > 8) battle.log.shift();
}

function syncHealth(f) {
    try {
        const health = f.entity.getComponent(EntityComponentTypes.Health);
        if (health) health.setCurrentValue(Math.max(1, Math.ceil((f.hp / f.stats.hp) * health.effectiveMax)));
    } catch (e) { }
}

// Abilities, as Showdown's scripts have them, for those that act in a single battle without weather or terrain.
// moldbreaker (and Teravolt, Turboblaze) ignore the defender's.
const STAT_GUARD = { clearbody: null, whitesmoke: null, fullmetalbody: null, keeneye: ["accuracy"], hypercutter: ["atk"], bigpecks: ["def"], mirrorarmor: null };
const STATUS_GUARD = { insomnia: ["slp"], vitalspirit: ["slp"], sweetveil: ["slp"], limber: ["par"], immunity: ["psn", "tox"], pastelveil: ["psn", "tox"],
    waterveil: ["brn"], waterbubble: ["brn"], thermalexchange: ["brn"], magmaarmor: ["frz"], comatose: ["slp", "par", "psn", "tox", "brn", "frz"], purifyingsalt: ["slp", "par", "psn", "tox", "brn", "frz"] };
const INTIMIDATE_GUARD = new Set(["innerfocus", "owntempo", "oblivious", "scrappy", "guarddog"]);
const BREAKERS = new Set(["moldbreaker", "teravolt", "turboblaze"]);
function abilityName(id) { return ABILITY_NAMES[id] ?? cap(id); }
function ability(f, other) { return other && BREAKERS.has(other.ability) ? null : f.ability; }   // a defender's ability, unless the attacker breaks it

function boost(battle, target, boosts, source) {
    const guard = source && source !== target ? STAT_GUARD[target.ability] : undefined;
    let lowered = false;
    for (const [stat, amount] of Object.entries(boosts ?? {})) {
        if (amount < 0 && source && source !== target && held(target) === "clear_amulet") {
            say(battle, `§7${target.info.name}'s Clear Amulet prevents its stats from being lowered!`); continue;
        }
        if (amount < 0 && guard !== undefined && (guard === null || guard.includes(stat))) {
            say(battle, `§7${target.info.name}'s ${abilityName(target.ability)} prevents its stats from being lowered!`); continue;
        }
        const before = target.stages[stat];
        target.stages[stat] = Math.max(-6, Math.min(6, before + (target.ability === "simple" ? amount * 2 : target.ability === "contrary" ? -amount : amount)));
        const name = STAT_NAMES[stat] ?? stat, change = target.stages[stat] - before;
        if (!change) say(battle, `§7${target.info.name}'s ${name} won't go any ${amount > 0 ? "higher" : "lower"}!`);
        else say(battle, `§7${target.info.name}'s ${name} ${change > 0 ? "rose" : "fell"}${Math.abs(change) >= 2 ? " sharply" : ""}!`);
        if (change < 0) lowered = true;
    }
    if (lowered && held(target) === "white_herb") {
        for (const k of Object.keys(target.stages)) if (target.stages[k] < 0) target.stages[k] = 0;
        useUp(battle, target, `§7${target.info.name} returned its stats to normal using its White Herb!`);
    }
    // Defiant and Competitive answer a drop from the foe
    if (lowered && source && source !== target) {
        if (target.ability === "defiant") { say(battle, `§7${target.info.name}'s Defiant!`); boost(battle, target, { atk: 2 }); }
        if (target.ability === "competitive") { say(battle, `§7${target.info.name}'s Competitive!`); boost(battle, target, { spa: 2 }); }
    }
}

function inflict(battle, target, status, announceFailure, source) {
    const guard = STATUS_GUARD[ability(target, source)] ?? [];
    if (target.hp <= 0 || target.status || (STATUS_IMMUNE[status] ?? []).some((t) => target.info.types.includes(t)) || guard.includes(status)) {
        if (announceFailure) say(battle, guard.includes(status) ? `§7${target.info.name}'s ${abilityName(target.ability)} prevents it!` : "§7But it failed!");
        return;
    }
    target.status = status;
    if (status === "slp") target.sleep = 1 + Math.floor(Math.random() * 3);
    say(battle, `§d${target.info.name} ${STATUS_TEXT[status] ?? "was afflicted"}!`);
    // Synchronize passes burn, paralysis and poison back
    if (target.ability === "synchronize" && source && source !== target && ["brn", "par", "psn", "tox"].includes(status)) {
        say(battle, `§7${target.info.name}'s Synchronize!`); inflict(battle, source, status === "tox" ? "psn" : status, false);
    }
}

// whether a Pokemon can act this turn, given its status
function canAct(battle, f) {
    if (f.flinched) {
        f.flinched = false;
        say(battle, `§7${f.info.name} flinched and couldn't move!`);
        if (f.ability === "steadfast") boost(battle, f, { spe: 1 });
        return false;
    }
    if (f.status === "slp") {
        if (f.sleep > 0) { f.sleep -= f.ability === "earlybird" ? 2 : 1; if (f.sleep >= 0) { say(battle, `§7${f.info.name} is fast asleep.`); return false; } }
        f.status = null; f.sleep = 0; say(battle, `§7${f.info.name} woke up!`);
    }
    if (f.status === "frz") {
        if (Math.random() < 0.2) { f.status = null; say(battle, `§7${f.info.name} thawed out!`); }
        else { say(battle, `§7${f.info.name} is frozen solid!`); return false; }
    }
    if (f.status === "par" && Math.random() < 0.25) { say(battle, `§7${f.info.name} is paralyzed! It can't move!`); return false; }
    return true;
}

// indirect damage (status, recoil, items): Magic Guard ignores it
function hurt(battle, f, amount, text) {
    if (f.ability === "magicguard" || f.hp <= 0) return;
    f.hp = Math.max(0, f.hp - Math.max(1, Math.floor(amount))); say(battle, `§7${text}`); syncHealth(f);
}

function useMove(battle, attacker, defender, move) {
    const name = attacker.info.name, atkAb = attacker.ability, defAb = ability(defender, attacker);
    if (!canAct(battle, attacker)) return;
    if (move.left !== undefined) move.left -= defender.ability === "pressure" && move.left > 1 ? 2 : 1;
    const self = move.target === "self" || move.target === "adjacentAllyOrSelf" || move.target === "allies";
    if (!self && move.accuracy !== true && atkAb !== "noguard" && defAb !== "noguard") {
        let chance = move.accuracy * accStage(attacker.stages.accuracy - (atkAb === "unaware" ? 0 : defender.stages.evasion));
        if (atkAb === "compoundeyes") chance *= 1.3;
        if ((defAb === "sandveil" && weatherOf(battle) === "sand") || (defAb === "snowcloak" && weatherOf(battle) === "snow")) chance *= 0.8;
        if (atkAb === "hustle" && move.category === "Physical") chance *= 0.8;
        if (held(attacker) === "wide_lens") chance *= 1.1;
        if (held(attacker) === "zoom_lens" && battle.movedFirst === defender) chance *= 1.2;
        if (held(defender) === "bright_powder" || held(defender) === "lax_incense") chance *= 0.9;
        if (move.ohko) chance = attacker.level >= defender.level ? 30 + attacker.level - defender.level : 0;
        if (Math.random() * 100 >= chance) {
            say(battle, `§7${name} used ${move.name}... it missed!`);
            if (held(attacker) === "blunder_policy") { useUp(battle, attacker, `§7${name}'s Blunder Policy!`); boost(battle, attacker, { spe: 2 }); }
            return;
        }
    }
    if (move.weather) {
        say(battle, `§e${name} used ${move.name}!`);
        if (!setWeather(battle, move.weather, attacker)) say(battle, "§7But it failed!");
        return;
    }
    if (self) { say(battle, `§e${name} used ${move.name}!`); boost(battle, attacker, move.boosts, attacker); return; }
    if (move.flags?.includes("powder") && held(defender) === "safety_goggles") { say(battle, `§e${name} used ${move.name}!§r §7${defender.info.name} is protected by its Safety Goggles!`); return; }
    if (move.type === "ground" && move.category !== "Status" && held(defender) === "air_balloon" && !battle.gravity) {
        say(battle, `§e${name} used ${move.name}!§r §7It doesn't affect ${defender.info.name}... (Air Balloon)`); return;
    }
    if ((ABILITY_IMMUNE[defAb] === move.type && move.category !== "Status") || (defAb === "soundproof" && move.flags?.includes("sound"))
        || (defAb === "bulletproof" && move.flags?.includes("bullet"))) {
        say(battle, `§e${name} used ${move.name}!§r §7It doesn't affect ${defender.info.name}... (${abilityName(defender.ability)})`);
        if (["voltabsorb", "waterabsorb", "dryskin"].includes(defAb) && defender.hp < defender.stats.hp) {
            defender.hp = Math.min(defender.stats.hp, defender.hp + Math.floor(defender.stats.hp / 4)); syncHealth(defender);
        }
        if (defAb === "sapsipper") boost(battle, defender, { atk: 1 });
        if (defAb === "motordrive") boost(battle, defender, { spe: 1 });
        if (defAb === "lightningrod" || defAb === "stormdrain") boost(battle, defender, { spa: 1 });
        if (defAb === "flashfire") defender.flashFire = true;
        return;
    }
    if (move.ohko) {
        if (defAb === "sturdy") { say(battle, `§e${name} used ${move.name}!§r §7${defender.info.name} endured it with Sturdy!`); return; }
        say(battle, `§e${name} used ${move.name}!§r §cIt's a one-hit KO!`); defender.hp = 0; syncHealth(defender); return;
    }
    let dealt = 0, note = "";
    const sheer = atkAb === "sheerforce" && (move.secondary || move.selfBoosts);
    if (move.power) {
        let types = defender.info.types;
        let eff = move.type === "???" ? 1 : effectiveness(move.type, types);
        if (eff === 0 && atkAb === "scrappy" && (move.type === "normal" || move.type === "fighting")) eff = effectiveness(move.type, types.filter((t) => t !== "ghost"));
        if (eff === 0) { say(battle, `§e${name} used ${move.name}!§r §7It doesn't affect ${defender.info.name}...`); return; }
        if (defAb === "wonderguard" && eff <= 1) { say(battle, `§e${name} used ${move.name}!§r §7${defender.info.name}'s Wonder Guard protects it!`); return; }
        const physical = move.category === "Physical";
        const noCrit = defAb === "shellarmor" || defAb === "battlearmor";
        let critStage = Math.max(0, (move.critRatio ?? 1) - 1) + (atkAb === "superluck" ? 1 : 0);
        for (const [item, [who, n]] of Object.entries(CRIT_ITEMS)) if (holds(attacker, item, who)) critStage += n;
        const crit = !noCrit && Math.random() < [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, critStage)];
        // a critical hit ignores the attacker's drops and the defender's raises; Unaware ignores the other side's stages
        let atkStage = physical ? attacker.stages.atk : attacker.stages.spa, defStage = physical ? defender.stages.def : defender.stages.spd;
        if (defAb === "unaware") atkStage = 0;
        if (atkAb === "unaware") defStage = 0;
        let a = (physical ? attacker.stats.atk : attacker.stats.spa) * stage(crit ? Math.max(0, atkStage) : atkStage);
        let d = (physical ? defender.stats.def : defender.stats.spd) * stage(crit ? Math.min(0, defStage) : defStage);
        if ((held(attacker) === "choice_band" && physical) || (held(attacker) === "choice_specs" && !physical)) a *= 1.5;
        if (physical && (atkAb === "hugepower" || atkAb === "purepower")) a *= 2;
        if (physical && atkAb === "hustle") a *= 1.5;
        if (physical && atkAb === "guts" && attacker.status) a *= 1.5;
        if (physical && defAb === "furcoat") d *= 2;
        const w = weatherOf(battle);
        if (!physical && w === "sand" && defender.info.types.includes("rock")) d *= 1.5;
        if (physical && w === "snow" && defender.info.types.includes("ice")) d *= 1.5;
        if (!physical && w === "sun" && atkAb === "solarpower") a *= 1.5;
        if (physical && defAb === "marvelscale" && defender.status) d *= 1.5;
        if (held(defender) === "assault_vest" && !physical) d *= 1.5;
        for (const [item, [who, stats]] of Object.entries(SPECIES_ITEMS)) {
            if (holds(attacker, item, who) && stats.includes(physical ? "atk" : "spa")) a *= 2;
            if (holds(defender, item, who) && stats.includes(physical ? "def" : "spd")) d *= 2;
        }
        if (held(defender) === "eviolite" && defender.info.canEvolve) d *= 1.5;
        let power = move.power;
        if (ABILITY_PINCH[atkAb] === move.type && attacker.hp <= attacker.stats.hp / 3) power *= 1.5;
        if (atkAb === "technician" && power <= 60) power *= 1.5;
        if (atkAb === "strongjaw" && move.flags?.includes("bite")) power *= 1.5;
        if (atkAb === "ironfist" && move.flags?.includes("punch")) power *= 1.2;
        if (atkAb === "megalauncher" && move.flags?.includes("pulse")) power *= 1.5;
        if (atkAb === "sharpness" && move.flags?.includes("slicing")) power *= 1.5;
        if (atkAb === "toughclaws" && move.contact) power *= 1.3;
        if (atkAb === "reckless" && move.recoil) power *= 1.2;
        if (sheer) power *= 1.3;
        if (held(attacker) === `${move.type}_gem`) { power *= 1.3; useUp(battle, attacker, `§7The ${cap(move.type)} Gem strengthened ${name}'s power!`); }
        if (held(attacker) === "punching_glove" && move.flags?.includes("punch")) power *= 1.1;
        const umbrella = held(attacker) === "utility_umbrella" || held(defender) === "utility_umbrella";
        if (w === "rain" && !umbrella) power *= move.type === "water" ? 1.5 : move.type === "fire" ? 0.5 : 1;
        if (w === "sun" && !umbrella) power *= move.type === "fire" ? 1.5 : move.type === "water" ? 0.5 : 1;
        if (atkAb === "flashfire" && attacker.flashFire && move.type === "fire") power *= 1.5;
        let dmg = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * a) / d) / 50) + 2;
        if (crit) dmg = Math.floor(dmg * (atkAb === "sniper" ? 2.25 : 1.5));
        if (attacker.info.types.includes(move.type)) dmg = Math.floor(dmg * (atkAb === "adaptability" ? 2 : 1.5));
        dmg = Math.floor(dmg * eff);
        if (physical && attacker.status === "brn" && atkAb !== "guts") dmg = Math.floor(dmg / 2);
        if (eff < 1 && atkAb === "tintedlens") dmg *= 2;
        if (eff > 1 && (defAb === "filter" || defAb === "solidrock" || defAb === "prismarmor")) dmg = Math.floor(dmg * 0.75);
        if (defAb === "thickfat" && (move.type === "fire" || move.type === "ice")) dmg = Math.floor(dmg / 2);
        if (defAb === "heatproof" && move.type === "fire") dmg = Math.floor(dmg / 2);
        if (defAb === "dryskin" && move.type === "fire") dmg = Math.floor(dmg * 1.25);
        if ((defAb === "multiscale" || defAb === "shadowshield") && defender.hp === defender.stats.hp) dmg = Math.floor(dmg / 2);
        const item = held(attacker);
        if (TYPE_ITEMS[item] === move.type) dmg = Math.floor(dmg * 1.2);
        if (item === "life_orb") dmg = Math.floor(dmg * 1.3);
        if (item === "expert_belt" && eff > 1) dmg = Math.floor(dmg * 1.2);
        if ((item === "muscle_band" && physical) || (item === "wise_glasses" && !physical)) dmg = Math.floor(dmg * 1.1);
        dmg = Math.max(1, Math.floor(dmg * (0.85 + Math.random() * 0.15)));
        dealt = Math.min(dmg, defender.hp);
        if (dealt >= defender.hp && defender.hp === defender.stats.hp) {
            if (defAb === "sturdy") { dealt = defender.hp - 1; say(battle, `§7${defender.info.name} endured the hit with Sturdy!`); }
            else if (held(defender) === "focus_sash") { dealt = defender.hp - 1; defender.held = null; say(battle, `§7${defender.info.name} hung on using its Focus Sash!`); }
        }
        if (dealt >= defender.hp && held(defender) === "focus_band" && Math.random() < 0.1) { dealt = defender.hp - 1; say(battle, `§7${defender.info.name} hung on using its Focus Band!`); }
        defender.hp -= dealt;
        if (crit) note += " A critical hit!";
        if (eff > 1) note += " It's super effective!"; else if (eff < 1) note += " It's not very effective...";
        say(battle, `§e${name} used ${move.name}!§r ${dmg} damage.${note}`);
        syncHealth(defender);
        if (move.drain && attacker.hp < attacker.stats.hp) {
            const heal = Math.max(1, Math.floor((dealt * move.drain[0]) / move.drain[1] * (held(attacker) === "big_root" ? 1.3 : 1)));
            attacker.hp = Math.min(attacker.stats.hp, attacker.hp + heal); say(battle, `§a${name} drained ${heal} HP.`); syncHealth(attacker);
        }
        if (move.recoil && atkAb !== "rockhead") hurt(battle, attacker, (dealt * move.recoil[0]) / move.recoil[1], `${name} is damaged by recoil!`);
        if (dealt && held(attacker) === "shell_bell" && attacker.hp > 0 && attacker.hp < attacker.stats.hp) {
            attacker.hp = Math.min(attacker.stats.hp, attacker.hp + Math.max(1, Math.floor(dealt / 8))); say(battle, `§a${name} restored a little HP using its Shell Bell!`); syncHealth(attacker);
        }
        if (dealt && held(defender) === "air_balloon") useUp(battle, defender, `§7${defender.info.name}'s Air Balloon popped!`);
        if (dealt && defender.hp > 0 && eff > 1 && held(defender) === "weakness_policy") { useUp(battle, defender, `§7${defender.info.name}'s Weakness Policy!`); boost(battle, defender, { atk: 2, spa: 2 }); }
        const hitBoost = HIT_BOOSTS[held(defender)];
        if (dealt && defender.hp > 0 && hitBoost && hitBoost[0] === move.type) { useUp(battle, defender, `§7${defender.info.name}'s ${itemName(defender.held)}!`); boost(battle, defender, hitBoost[1]); }
    } else say(battle, `§e${name} used ${move.name}!`);
    if (move.flags?.includes("sound") && held(attacker) === "throat_spray" && attacker.hp > 0) { useUp(battle, attacker, `§7${name}'s Throat Spray!`); boost(battle, attacker, { spa: 1 }); }
    if (move.status) inflict(battle, defender, move.status, true, attacker);
    if (move.boosts && defender.hp > 0) boost(battle, defender, move.boosts, attacker);
    const contact = move.contact && held(attacker) !== "protective_pads" && !(held(attacker) === "punching_glove" && move.flags?.includes("punch"));
    if (move.secondary && !sheer && defAb !== "shielddust" && !(held(defender) === "covert_cloak" && !move.secondary.self) && Math.random() * 100 < move.secondary.chance * (atkAb === "serenegrace" ? 2 : 1)) {
        if (move.secondary.status && defender.hp > 0) inflict(battle, defender, move.secondary.status, false, attacker);
        if (move.secondary.flinch && defender.hp > 0 && battle.movedFirst === attacker && defender.ability !== "innerfocus") defender.flinched = true;
        if (move.secondary.boosts) boost(battle, move.secondary.self ? attacker : defender, move.secondary.boosts, attacker);
    }
    if (move.selfBoosts && !sheer) boost(battle, attacker, move.selfBoosts, attacker);
    if (dealt && defender.hp > 0 && !move.secondary?.flinch && battle.movedFirst === attacker && (held(attacker) === "kings_rock" || held(attacker) === "razor_fang")
        && defender.ability !== "innerfocus" && Math.random() < 0.1) defender.flinched = true;
    // Eject Button sends its holder back when it is hit; Red Card sends back the Pokemon that hit its holder
    if (dealt && defender.hp > 0 && attacker.hp > 0) {
        if (held(defender) === "eject_button" && defender === battle.ally) { useUp(battle, defender, `§7${defender.info.name} is switched out with the Eject Button!`); battle.ejectAlly = true; }
        else if (held(defender) === "red_card" && attacker === battle.ally) { useUp(battle, defender, `§7${defender.info.name} held up its Red Card against ${name}!`); battle.ejectAlly = true; }
        else if (held(defender) === "red_card" && attacker === battle.foe) {
            useUp(battle, defender, `§7${defender.info.name} held up its Red Card against ${name}!`);
            if (!battle.trainer) battle.dragFoe = true;   // a wild Pokemon is sent away, which ends the battle
        }
    }
    if (move === STRUGGLE) { attacker.hp = Math.max(0, attacker.hp - Math.max(1, Math.floor(attacker.stats.hp / 4))); say(battle, `§7${name} is damaged by recoil!`); syncHealth(attacker); }
    if (dealt && held(attacker) === "life_orb" && !sheer) hurt(battle, attacker, attacker.stats.hp / 10, `${name} lost some of its HP!`);
    if (dealt && contact && held(defender) === "rocky_helmet") hurt(battle, attacker, attacker.stats.hp / 6, `${name} was hurt by the Rocky Helmet!`);
    if (dealt && contact && (defAb === "roughskin" || defAb === "ironbarbs")) hurt(battle, attacker, attacker.stats.hp / 8, `${name} was hurt by ${defender.info.name}'s ${abilityName(defender.ability)}!`);
    for (const f of [attacker, defender]) heldBerry(battle, f);
    if (dealt && contact && attacker.hp > 0) {
        if (held(defender) === "sticky_barb" && !attacker.held) {
            // Sticky Barb moves to the Pokemon that touches its holder
            attacker.held = defender.held; defender.held = null; say(battle, `§7The Sticky Barb latched onto ${name}!`);
            setProp(attacker.entity, "cobblemon:held", attacker.held); setProp(defender.entity, "cobblemon:held", undefined);
        }
        let status = ABILITY_CONTACT[defAb];
        if (defAb === "effectspore") status = ["psn", "par", "slp"][Math.floor(Math.random() * 3)];
        if (status && Math.random() < 0.3) { say(battle, `§7${defender.info.name}'s ${abilityName(defender.ability)}!`); inflict(battle, attacker, status, false); }
    }
    if (dealt && defAb === "stamina" && defender.hp > 0) boost(battle, defender, { def: 1 });
    if (dealt && defAb === "weakarmor" && move.category === "Physical" && defender.hp > 0) boost(battle, defender, { def: -1, spe: 2 });
    if (dealt && defAb === "justified" && move.type === "dark" && defender.hp > 0) boost(battle, defender, { atk: 1 });
    if (dealt && defAb === "rattled" && ["dark", "bug", "ghost"].includes(move.type) && defender.hp > 0) boost(battle, defender, { spe: 1 });
    if (defender.hp <= 0 && (atkAb === "moxie" || atkAb === "chillingneigh")) boost(battle, attacker, { atk: 1 });
    if (defender.hp <= 0 && atkAb === "grimneigh") boost(battle, attacker, { spa: 1 });
    if (defender.hp <= 0 && atkAb === "beastboost") {
        const best = ["atk", "def", "spa", "spd", "spe"].reduce((x, y) => (attacker.stats[y] > attacker.stats[x] ? y : x));
        boost(battle, attacker, { [best]: 1 });
    }
}

// berries eaten when they apply: Oran and Sitrus below half HP, the status berries on their status, Leppa on an empty move
function heldBerry(battle, f) {
    const item = held(f);
    if (!item || f.hp <= 0) return;
    let used = false;
    if ((item === "oran_berry" || item === "sitrus_berry") && f.hp <= f.stats.hp / 2) {
        f.hp = Math.min(f.stats.hp, f.hp + (item === "oran_berry" ? 10 : Math.floor(f.stats.hp / 4))); used = true; syncHealth(f);
    } else if (item in STATUS_BERRIES && f.status && (STATUS_BERRIES[item] === null || STATUS_BERRIES[item].includes(f.status))) {
        f.status = null; used = true;
    } else if (item === "leppa_berry") {
        const empty = f.moves.find((m) => m.left === 0);
        if (empty) { empty.left = Math.min(empty.pp, 10); used = true; }
    }
    if (used) { say(battle, `§a${f.info.name} ate its ${itemName(f.held)}!`); f.held = null; setProp(f.entity, "cobblemon:held", undefined); }
}

function freeze(entity, on) {
    try {
        entity.triggerEvent(on ? "cobblemon:battle_start" : "cobblemon:battle_end");
        entity.setProperty("cobblemon:battle", on);   // the client's battle poses
        if (on) entity.addEffect("slowness", 20 * 600, { amplifier: 255, showParticles: false });
        else entity.removeEffect("slowness");
    } catch (e) { }
}

function gainFriendship(entity, amount, cap = 255) {
    if (amount <= 0) return;
    const boost = prop(entity, "cobblemon:caught_ball") === "cobblemon:luxury_ball" ? 2 : 1;
    setProp(entity, "cobblemon:friendship", Math.min(cap, friendshipOf(entity) + Math.round(amount * boost)));
}

// Friendship, as PlayerPartyStore does it: every two minutes a Pokemon out in the world gains one, up to 160
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        let near;
        try { near = player.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: 96 }); } catch (e) { continue; }
        for (const e of near) {
            if (prop(e, OWNER) !== player.id) continue;
            const f = friendshipOf(e);
            if (f < 160) gainFriendship(e, 1, 160);
        }
    }
}, 20 * 120);

// Under water, as Cobblemon's poses mean it: the head in water. Molang on the client only knows whether a Pokemon
// touches water, so the server looks at the block at each Pokemon's eyes, four times a second, near players; and
// whether it holds an item, which the client cannot read from a dynamic property.
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        let near;
        try { near = player.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: 96 }); } catch (e) { continue; }
        for (const e of near) {
            try {
                const block = e.dimension.getBlock(e.getHeadLocation());
                const under = !!block && (block.typeId === "minecraft:water" || block.typeId === "minecraft:flowing_water" || block.isWaterlogged);
                if (e.getProperty("cobblemon:submerged") !== under) e.setProperty("cobblemon:submerged", under);
                // the sand underfoot, within two blocks, as Cobblemon's is_standing_on_blocks(2, sand, red sand) reads it
                let sand = 0;
                for (let dy = 1; dy <= 2 && !sand; dy++) {
                    const below = e.dimension.getBlock({ x: e.location.x, y: e.location.y - dy + 0.5, z: e.location.z })?.typeId;
                    sand = below === "minecraft:sand" ? 1 : below === "minecraft:red_sand" ? 2 : 0;
                }
                if (e.getProperty("cobblemon:on_sand") !== sand) e.setProperty("cobblemon:on_sand", sand);
                const holding = !!prop(e, "cobblemon:held");   // the poses that show a held item
                if (e.getProperty("cobblemon:holding") !== holding) e.setProperty("cobblemon:holding", holding);
                if (e.getProperty("cobblemon:held_index") !== ((prop(e, "cobblemon:held") && HELD_INDEX[prop(e, "cobblemon:held")]) || 0)) showHeld(e);
            } catch (err) { }
        }
    }
}, 5);

function endBattle(battle, text) {
    battles.delete(battle.player.id);
    system.runTimeout(() => offerLevelEvolutions(battle.player), 40);
    for (const f of [battle.ally, battle.foe]) if (f?.entity?.isValid) freeze(f.entity, false);
    // PokemonBattle.end: a wild Pokemon still out heals fully, whether it won, fled or was left
    const foe = battle.foe?.entity;
    if (!battle.trainer && foe?.isValid && POKEMON[foe.typeId] && !prop(foe, OWNER)) healFully(foe);
    if (text) say(battle, text);
}

// on entering battle: Intimidate
function enter(battle, f, other) {
    if (WEATHER_ABILITIES[f.ability]) { say(battle, `§7${f.info.name}'s ${abilityName(f.ability)}!`); setWeather(battle, WEATHER_ABILITIES[f.ability], f); }
    if (f.ability === "intimidate") {
        say(battle, `§7${f.info.name}'s Intimidate!`);
        if (INTIMIDATE_GUARD.has(other.ability)) say(battle, `§7${other.info.name}'s ${abilityName(other.ability)} prevents it!`);
        else boost(battle, other, { atk: -1 }, f);
    }
}

// Ownership: the tameable component is not readable once a Pokemon is tamed, so the owner is
// remembered on the entity when the claiming interaction succeeds.
const OWNER = "cobblemon:owner";

// Nicknames live in a property of their own, so the name tag can carry Cobblemon's label; a nickname from before
// (a plain name tag, not a label) still counts
const NICK = "cobblemon:nickname", BATTLE_WINS = "cobblemon:battle_wins";
function nicknameOf(entity) {
    const nick = prop(entity, NICK);
    if (nick !== undefined) return nick;
    let tag = "";
    try { tag = entity.nameTag ?? ""; } catch (e) { }
    return tag && tag !== "NPC" && !tag.includes("Lv. ") ? tag : "";
}

// Item tooltips (CobblemonTooltipGenerator): Cobblemon's gray lines under an item's name, set as its lore when it
// turns up in a player's inventory without them
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
        if (!inv) continue;
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i), lines = item && TOOLTIPS[item.typeId];
            if (!lines || item.getLore().length) continue;
            try { item.setLore(lines.map((line) => `§7${line}`)); inv.setItem(i, item); } catch (e) { }
        }
    }
}, 40);

// The interact wheel (PokemonEntity.showInteractionWheel, InteractWheelGUI) on sneak and right-click on one of your own
// Pokemon, whatever is in hand; a plain right-click on a wild Pokemon with an empty hand challenges it, as Cobblemon's
// send-out key aimed at it does. Items used on a Pokemon without sneaking keep their own handlers.
const WHEEL_ORDER = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
function openWheel(player, target) {
    if (!target?.isValid) return;
    const rideable = target.hasComponent("minecraft:rideable");
    const following = !prop(target, "cobblemon:staying");
    const hand = player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex)?.typeId;
    const options = {
        // offered when there is something to give or take, as InteractPokemonUIPacket's canHoldItem says
        north: { icon: "held", tip: "Change held item", on: !!(heldItem(target) || hand), act: () => {
            if (hand && !HOLD_BLACKLIST.includes(hand)) giveHeld(player, target); else if (heldItem(target)) takeHeld(target);
            else player.sendMessage("§7Hold the item to give it.");
        } },
        northeast: { icon: "cosmetic", tip: "Change cosmetic item", on: false },
        east: { icon: "summary", tip: "Summary", on: true, act: () => showSummary(target, "i", player) },
        south: { icon: "follow", tip: following ? "Stay" : "Follow", on: true, act: () => {
            try { target.triggerEvent(following ? "cobblemon:stay" : "cobblemon:follow"); } catch (e) { }
            setProp(target, "cobblemon:staying", following ? true : undefined);
        } },
        west: { icon: "ride", tip: "Ride", on: rideable, act: () => { try { target.getComponent("minecraft:rideable").addRider(player); } catch (e) { } } },
        northwest: { icon: "shoulder", tip: "Shoulder", on: false },
    };
    // each button's texture is its place, its icon and whether it is offered (the layout adds "_hover")
    const form = new ActionFormData().title("cbm:interact").body("");
    for (const o of WHEEL_ORDER) {
        const opt = options[o];
        form.button(opt?.tip ?? "", `textures/ui/cobblemon/interact/${o}_${!opt ? "none" : opt.on ? opt.icon : `${opt.icon}_off`}`);
    }
    form.show(player).then((r) => {
        if (r.canceled) return;
        const opt = options[WHEEL_ORDER[r.selection]];
        if (opt?.on && target.isValid) opt.act();
    }).catch(() => { });
}
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target, itemStack } = event;
    if (!POKEMON[target?.typeId]) return;
    const id = itemStack?.typeId, sneaking = player.isSneaking, mine = prop(target, OWNER) === player.id;
    if (mine && sneaking && !id?.startsWith("cobblemon:pokedex_")) {
        event.cancel = true;
        system.run(() => openWheel(player, target));
        return;
    }
    if (!mine && !id && !sneaking && !prop(target, OWNER) && !capturing.has(target.id)) {
        event.cancel = true;
        system.run(() => { if (!battles.has(player.id) && target.isValid) startBattle(player, target, false); });
    }
});

// PokemonRenderer.renderNameTag's label: the Pokemon's name, or "???" while the nearest player has not registered its
// species, then "Lv. N"; under a wild Pokemon that can be battled, "Press Use to battle." until that player's first win
// (showChallengeLabel). It is the Pokemon's name tag, which Bedrock draws when the Pokemon is looked at, as Cobblemon
// draws its label; Pokemon are not NPCs, so the tag is theirs to carry.
function labelFor(player, e) {
    const info = POKEMON[e.typeId];
    let variant = 0;
    try { variant = e.getComponent("minecraft:variant")?.value ?? 0; } catch (err) { }
    const known = dexStatus(player, e.typeId) > 0 || prop(e, OWNER);
    const name = known ? (nicknameOf(e) || info.variants?.[variant]?.name || info.name) : "???";
    let label = `${name} §fLv. ${prop(e, LEVEL) ?? info.level}`;
    const wild = !prop(e, OWNER) && !e.hasComponent(EntityComponentTypes.IsTamed);
    if (wild && !(player.getDynamicProperty(BATTLE_WINS) > 0) && !battles.has(player.id) && !capturing.has(e.id)) label += "\n§7Press Use to battle.";
    return label;
}
system.runInterval(() => {
    const seen = new Set();
    for (const player of world.getPlayers()) {
        let near = [];
        try { near = player.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: 64 }); } catch (e) { continue; }
        for (const e of near) {
            if (seen.has(e.id) || !POKEMON[e.typeId]) continue;
            seen.add(e.id);
            const label = labelFor(player, e);
            try { if (e.nameTag !== label) e.nameTag = label; } catch (err) { }
        }
    }
}, 10);

world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    // itemStack is the hand after the interaction, empty once the last ball is used
    const { player, target } = event, itemStack = event.beforeItemStack ?? event.itemStack;
    if (!target || !POKEMON[target.typeId] || !BALLS[itemStack?.typeId]) return;
    system.runTimeout(() => {
        try {
            if (target.isValid && target.hasComponent(EntityComponentTypes.IsTamed) && !target.getDynamicProperty(OWNER)) {
                target.setDynamicProperty(OWNER, player.id);
                register(player, target.typeId, 2);
                player.sendMessage(`§a${POKEMON[target.typeId].name} is now yours!`);
            }
        } catch (e) { }
    }, 2);
});

// The player's party: up to six of their Pokemon within 64 blocks that have not fainted, nearest first.
// A Pokemon claimed before owners were recorded counts for whoever battles with it.
function findParty(player, near) {
    const found = [];
    for (const e of player.dimension.getEntities({ families: ["owned"], location: near, maxDistance: 64 })) {
        if (!POKEMON[e.typeId] || prop(e, FAINTED) || prop(e, "cobblemon:pasture")) continue;
        const owner = prop(e, OWNER);
        if (owner && owner !== player.id) continue;
        const dx = e.location.x - player.location.x, dz = e.location.z - player.location.z;
        found.push({ e, mine: owner === player.id, dist: dx * dx + dz * dz });
    }
    found.sort((a, b) => (b.mine - a.mine) || (a.dist - b.dist));
    return found.slice(0, 6).map((f) => f.e);
}

function sendOut(battle, entity, spot) {
    const f = fighter(entity);
    if (!f) return undefined;
    // a Pokemon coming back in keeps the PP and status it left with
    const kept = battle.kept?.[entity.id];
    if (kept) { f.moves = kept.moves; f.status = kept.status; f.sleep = kept.sleep; }
    freeze(entity, true);
    try { entity.teleport(spot, { facingLocation: battle.foe.entity.location }); } catch (e) { }
    sendOutEffect(battle.player, entity);
    battle.ally = f;
    say(battle, `§6Go, ${f.info.name}! §7(Lv ${f.level})`);
    enter(battle, f, battle.foe);
    return f;
}

function startBattle(player, foeEntity, trainer) {
    if (battles.has(player.id)) return;
    const party = findParty(player, foeEntity.location);
    if (!party.length) { player.sendMessage("§cYou have no Pokemon that can fight. Claim one with a Poke Ball, or heal yours."); return; }
    const foe = fighter(foeEntity);
    if (!foe) return;
    const battle = { player, foe, trainer, turn: 0, spot: { x: foeEntity.location.x - 2, y: foeEntity.location.y, z: foeEntity.location.z } };
    battles.set(player.id, battle);
    freeze(foeEntity, true);
    say(battle, `§6A ${trainer ? "Trainer's " : "wild "}${foe.info.name} appeared! §7(Lv ${foe.level})`);
    register(player, foeEntity.typeId, 1);
    if (!sendOut(battle, party[0], { x: battle.spot.x, y: party[0].location.y, z: battle.spot.z })) { endBattle(battle); return; }
    enter(battle, foe, battle.ally);
    system.runTimeout(() => turn(battle), 20);
}

// Switch: BattleSwitchPokemonSelection's party tiles, laid out by the resource pack (SWITCH_FIELDS in port.py). The one in
// battle and the fainted show greyed and cannot be picked; the one leaving steps aside and stops fighting
function switchTile(battle, e) {
    const f = e.id === battle.ally.entity.id ? battle.ally : fighter(e);
    const fainted = !!prop(e, FAINTED) || f.hp <= 0;
    const step = fainted ? 0 : Math.max(1, Math.round((Math.max(0, f.hp) / f.stats.hp) * 50));
    const name = (nicknameOf(e) || f.info.name).normalize("NFD").replace(/[^ -~]/g, "");
    const ball = Math.max(0, BALL_INDEX.indexOf(prop(e, "cobblemon:caught_ball") ?? "cobblemon:poke_ball"));
    const status = !fainted && f.status ? { tox: "psn" }[f.status] ?? f.status : "non";
    return pad(name, 12) + pad(`Lv.${f.level}`, 6) + "h" + String(step).padStart(2, "0") + status.toUpperCase() + iconOf(e.typeId)
        + "b" + String(ball).padStart(2, "0") + `§f${Math.max(0, f.hp)}/${f.stats.hp}`;   // a colour code first, or it reads as a number
}
function chooseSwitch(battle, forced) {
    const player = battle.player, ally = battle.ally.entity;
    const ready = findParty(player, battle.foe.entity.location).filter((e) => e.id !== ally.id);
    if (!ready.length) return Promise.resolve(undefined);
    let fainted = [];
    try {
        fainted = player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 64 })
            .filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id && prop(e, FAINTED) && !prop(e, "cobblemon:pasture"));
    } catch (e) { }
    const tiles = [...(ally.isValid && !forced ? [ally] : []), ...ready, ...fainted].slice(0, 6);
    const form = new ActionFormData().title("cbm:battle_switch").body(battleBody(battle));
    for (let i = 0; i < 6; i++) {
        const e = tiles[i];
        const picked = e && ready.includes(e);
        form.button(e ? switchTile(battle, e) : "", e ? `${UI}/battle/${picked ? "pselect" : e.id === ally.id ? "pselect_on" : "pselect_off"}` : undefined);
    }
    form.button(forced ? "" : "Back", `${UI}/battle/back`);
    return form.show(player).then((r) => {
        if (r.canceled || r.selection >= 6 || !battles.has(player.id)) return forced && !r.canceled ? chooseSwitch(battle, forced) : undefined;
        const e = tiles[r.selection];
        return e && ready.includes(e) ? e : chooseSwitch(battle, forced);
    });
}

function switchTo(battle, entity) {
    battle.choiceLock = null;
    const old = battle.ally.entity;
    battle.kept = battle.kept ?? {};
    const leaving = battle.ally;
    if (leaving.ability === "naturalcure") leaving.status = null;
    if (leaving.ability === "regenerator" && leaving.hp > 0) { leaving.hp = Math.min(leaving.stats.hp, leaving.hp + Math.floor(leaving.stats.hp / 3)); syncHealth(leaving); }
    battle.kept[old.id] = { moves: leaving.moves, status: leaving.status, sleep: leaving.sleep };
    const spot = { x: battle.spot.x, y: old.isValid ? old.location.y : entity.location.y, z: battle.spot.z };
    if (old.isValid) {
        freeze(old, false);
        say(battle, `§7${battle.ally.info.name}, come back!`);
        recallEffect(battle.player, old, () => {
            try { old.teleport({ x: spot.x - 2, y: spot.y, z: spot.z + 2 }); } catch (e) { }
            setSize(old, 1);
        });
    }
    sendOut(battle, entity, spot);
}

// The ball's catch multiplier, from the rules in Cobblemon's tooltips. Thrown in the world, the Pokemon's
// own catch event applies what can be judged there; in battle, turns, levels and the moon count too.
function ballMultiplier(battle, id) {
    const ball = BALLS[id], f = battle.foe, a = battle.ally;
    switch (ball.rule) {
        case "master": return Infinity;
        case "quick": return battle.turn <= 1 ? 5 : 1;
        case "timer": return Math.min(4, 1 + (battle.turn - 1) * 0.3);
        case "level": { const r = a.level / f.level; return r >= 4 ? 4 : r >= 2 ? 3 : r > 1 ? 2 : 1; }
        case "moon": {
            let night = false, phase = 4;
            try { const t = world.getTimeOfDay(); night = t >= 13000 && t < 23000; phase = world.getMoonPhase(); } catch (e) { }
            return night ? [4, 3, 2, 1, 1, 1, 2, 3][phase] ?? 1 : 1;
        }
        case "net": return f.info.types.some((t) => t === "water" || t === "bug") ? 3 : 1;
        case "fast": return f.info.stats.spe >= 100 ? 4 : 1;
        case "heavy": { const kg = (f.info.weight || 0) / 10; return kg < 100 ? 1 : kg < 200 ? 2 : kg < 300 ? 3 : 4; }
        case "nest": return Math.min(4, Math.max(1, (41 - f.level) / 10));
        case "beast": return f.info.ultraBeast ? 5 : 0.1;
        case "dive": return f.entity.isInWater ? 3.5 : 1;
        case "dusk": {
            let light = 15;
            try { light = f.entity.dimension.getLightLevel(f.entity.location); } catch (e) { }
            return light === 0 ? 3.5 : light <= 7 ? 3 : 1;
        }
        case "park": {
            let biome = "";
            try { biome = f.entity.dimension.getBiome(f.entity.location).id; } catch (e) { }
            return /forest|plains/.test(biome) ? 2.5 : 1;
        }
        // Safari counts outside battle only; Dream needs sleep, Love a gender, Lure a rod, Repeat a Pokedex: 1x here
        case "repeat": return dexStatus(battle.player, f.entity.typeId) === 2 ? 3.5 : 1;
        case "safari": case "dream": case "love": case "lure": return 1;
        default: return ball.mult;
    }
}


function statusTag(f) { return f.status ? ` ${STATUS_TAG[f.status]}` : ""; }

function turn(battle) {
    if (!battles.has(battle.player.id)) return;
    const { ally, foe } = battle;
    if (!ally.entity.isValid || !foe.entity.isValid) { endBattle(battle, "§7The battle ended."); return; }
    battle.turn++;
    const usable = ally.moves.filter((m) => m.left > 0);
    const options = usable.length ? ally.moves.map((m) => ({ kind: "move", move: m })) : [{ kind: "move", move: STRUGGLE }];
    const canSwitch = findParty(battle.player, foe.entity.location).some((e) => e.id !== ally.entity.id);
    if (canSwitch) options.push({ kind: "switch" });
    options.push({ kind: "run" });
    if (battle.choiceLock && held(ally)?.startsWith("choice_")) {
        for (const o of options) if (o.kind === "move" && o.move !== STRUGGLE && o.move.id !== battle.choiceLock) o.locked = true;
    }
    pickAction(battle, options).then((choice) => {
        if (!battles.has(battle.player.id)) return;
        if (!choice) { minimise(battle); return; }
        if (choice.kind === "catch") { minimise(battle, "§7Throw a Poke Ball at your opponent to capture it."); return; }
        if (choice.kind === "forfeit") { endBattle(battle, "§7You forfeited the battle."); return; }
        if (choice.kind === "run") { endBattle(battle, "§7Got away safely."); return; }
        if (choice.kind === "switch") {
            chooseSwitch(battle, false).then((entity) => {
                if (!battles.has(battle.player.id)) return;
                if (!entity) { battle.turn--; turn(battle); return; }
                switchTo(battle, entity);
                foeTurn(battle);
            }).catch(() => endBattle(battle));
            return;
        }
        if (choice.locked) { say(battle, `§7${ally.info.name} can only use ${MOVES[battle.choiceLock]?.name}!`); battle.turn--; turn(battle); return; }
        const move = choice.move;
        if (held(ally)?.startsWith("choice_") && move !== STRUGGLE) battle.choiceLock = battle.choiceLock ?? move.id;
        if (move !== STRUGGLE && move.left <= 0) { say(battle, "§cThere's no PP left for this move!"); battle.turn--; turn(battle); return; }
        const foeMove = pickFoeMove(foe);
        const last = (f) => held(f) === "lagging_tail" || held(f) === "full_incense";
        const claw = (f) => held(f) === "quick_claw" && Math.random() < 0.2;
        const allyClaw = claw(ally), foeClaw = claw(foe);
        if (allyClaw) say(battle, `§7${ally.info.name}'s Quick Claw let it move first!`); else if (foeClaw) say(battle, `§7${foe.info.name}'s Quick Claw let it move first!`);
        const sameBracket = (move.priority || 0) === (foeMove.priority || 0);
        const allyFirst = (move.priority || 0) > (foeMove.priority || 0) || (sameBracket && (
            allyClaw !== foeClaw ? allyClaw : last(ally) !== last(foe) ? last(foe) : speedOf(ally, battle) >= speedOf(foe, battle)));
        battle.movedFirst = allyFirst ? ally : foe;
        const order = allyFirst ? [[ally, foe, move], [foe, ally, foeMove]] : [[foe, ally, foeMove], [ally, foe, move]];
        for (const [a, d, m] of order) {
            if (a.hp <= 0 || d.hp <= 0) continue;
            useMove(battle, a, d, m);
        }
        endOfTurn(battle);
    }).catch(() => endBattle(battle));
}

// The battle screen, laid out by the resource pack's ui/server_form.json on Cobblemon's battle textures: the form's
// title picks the layout and its body carries both Pokemon as fixed-width fields (see BATTLE_FIELDS in port.py).
const UI = "textures/ui/cobblemon";
function pad(value, width) { const s = String(value ?? ""); return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length); }
function battleBody(battle) {
    const ascii = (n) => n.normalize("NFD").replace(/[^ -~]/g, "");   // the layout slices by position, so the body stays one byte a character
    const side = (f) => {
        const step = f.hp > 0 ? Math.max(1, Math.round((Math.max(0, f.hp) / f.stats.hp) * 50)) : 0;
        return pad(ascii(f.info.name), 14) + pad(`Lv.${f.level}`, 6) + "h" + String(step).padStart(2, "0") + pad(f.hp <= 0 ? "fnt" : f.status ?? "", 3) + iconOf(f.entity?.typeId);
    };
    // Cobblemon shows the player's own Pokemon's health as a number and an opponent's as a share
    const own = `${Math.max(0, battle.ally.hp)}/${battle.ally.stats.hp}`, theirs = `${Math.ceil((Math.max(0, battle.foe.hp) / battle.foe.stats.hp) * 100)}%%`;   // a lone % is read as a format
    // the log follows the fixed fields; a lone % would be read as a format there too
    const log = (battle.log ?? []).slice(-6).map((line) => line.replace(/%/g, "%%")).join("\n");
    return "~" + side(battle.ally) + side(battle.foe) + "§f" + pad(own, 10) + "§f" + pad(theirs, 6) + log;
}

// BattleGeneralActionSelection (Fight, Bag, Switch, Run) and then BattleMoveSelection; undefined when the player closes it
// The battle screen minimised (ClientBattle.minimised), as Catch and closing the screen leave it: the player can throw a
// ball at the foe or use medicine on their own Pokemon, either taking the turn, and sneaking brings the screen back,
// where Cobblemon's R key does
function minimise(battle, prompt) {
    battle.minimised = true;
    if (prompt) battle.player.sendMessage(prompt);
    try { battle.player.onScreenDisplay.setActionBar("§7Sneak to return to the battle."); } catch (e) { }
}
function restore(battle) {
    if (!battle.minimised) return false;
    battle.minimised = false;
    return true;
}
world.afterEvents.playerButtonInput.subscribe(({ player, button, newButtonState }) => {
    if (button !== InputButton.Sneak || newButtonState !== ButtonState.Pressed) return;
    const battle = battles.get(player.id);
    if (battle && restore(battle)) { battle.turn--; turn(battle); }
});

// BattleGeneralActionSelection: Fight, Switch, then Catch and Run against a wild Pokemon or Forfeit against a trainer
function pickAction(battle, options) {
    const menu = new ActionFormData().title("cbm:battle_menu").body(battleBody(battle))
        .button("Fight", `${UI}/battle/menu_fight`).button("Switch", `${UI}/battle/menu_switch`);
    if (battle.trainer) menu.button("Forfeit", `${UI}/battle/menu_forfeit`);
    else menu.button("Catch", `${UI}/battle/menu_bag`).button("Run", `${UI}/battle/menu_run`);
    return menu.show(battle.player).then((r) => {
        if (r.canceled || !battles.has(battle.player.id)) return undefined;
        if (r.selection === 3) return options.find((o) => o.kind === "run");
        if (r.selection === 2) return { kind: battle.trainer ? "forfeit" : "catch" };
        if (r.selection === 1) {
            const sw = options.find((o) => o.kind === "switch");
            if (!sw) { say(battle, "§7There is no other Pokemon to switch to."); return pickAction(battle, options); }
            return sw;
        }
        const moves = options.filter((o) => o.kind === "move");
        const form = new ActionFormData().title("cbm:battle_moves").body(battleBody(battle));
        for (const o of moves) {
            const m = o.move, off = o.locked || (m !== STRUGGLE && m.left <= 0);
            const colour = m === STRUGGLE ? "§f" : m.left === 0 ? "§c" : m.left <= Math.floor(m.pp / 2) ? "§6" : "§f";
            form.button(pad(m.name, 16) + colour + (m === STRUGGLE ? "-/-" : `${m.left}/${m.pp}`), `${UI}/battle/move_${m.type ?? "normal"}${off ? "_off" : ""}`);
        }
        form.button("Back", `${UI}/battle/back`);
        return form.show(battle.player).then((m) => {
            if (m.canceled || !battles.has(battle.player.id)) return undefined;
            if (m.selection >= moves.length) return pickAction(battle, options);
            return moves[m.selection];
        });
    });
}

// The party HUD (ui/hud_screen.json): the player's own Pokemon nearby, fainted ones included, sent as one fixed-width
// record per slot in a title starting "cbm:party" whenever it changes, and every five seconds for a HUD that rejoined
const PARTY_MARKER = "cbm:party", BALL_INDEX = Object.keys(BALLS);
const partySent = new Map();
function partyRecord(e) {
    const info = POKEMON[e.typeId];
    const level = prop(e, LEVEL) ?? info.level, group = info.expGroup;
    const exp = Math.max(prop(e, EXP) ?? 0, expFor(group, level));
    const span = Math.max(1, expFor(group, level + 1) - expFor(group, level));
    let share = 1;
    try { const h = e.getComponent(EntityComponentTypes.Health); share = Math.max(0, h.currentValue) / h.effectiveMax; } catch (err) { }
    const fainted = !!prop(e, FAINTED);
    const steps = (r) => String(Math.max(0, Math.min(18, Math.round(r * 18)))).padStart(2, "0");
    const tag = nicknameOf(e);   // the npc component names every entity "NPC"
    const name = (tag || info.name).normalize("NFD").replace(/[^ -~]/g, "");
    const ball = Math.max(0, BALL_INDEX.indexOf(prop(e, "cobblemon:caught_ball") ?? "cobblemon:poke_ball"));
    const gender = { male: "m", female: "f" }[genderOf(e)] ?? "o";
    return pad(name, 12) + pad(`Lv.${level}`, 6) + "h" + steps(fainted ? 0 : share) + "e" + steps(level >= 100 ? 1 : (exp - expFor(group, level)) / span)
        + "b" + String(ball).padStart(2, "0") + (fainted ? "x" : "n") + gender + iconOf(e.typeId);
}
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        let mine = [];
        try {
            // Cobblemon hides the party overlay while its battle overlay is up
            if (!battles.has(player.id)) mine = player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 64 })
                .filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id && !prop(e, "cobblemon:pasture") && !recalling.has(e.id))
                .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
        } catch (e) { continue; }
        const empty = " ".repeat(18) + "h00e00bxxeoi----";
        const text = PARTY_MARKER + mine.map(partyRecord).join("") + empty.repeat(6 - mine.length);
        const last = partySent.get(player.id);
        if (last && last.text === text && system.currentTick - last.tick < 100) continue;
        partySent.set(player.id, { text, tick: system.currentTick });
        try { player.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }); } catch (e) { }
    }
}, 10);

function pickFoeMove(foe) {
    const usable = foe.moves.filter((m) => m.left > 0);
    return usable.length ? usable[Math.floor(Math.random() * usable.length)] : STRUGGLE;
}

function foeTurn(battle) {
    const { ally, foe } = battle;
    battle.movedFirst = null;   // the player used an item or switched; the foe's move can make nobody flinch
    if (foe.hp > 0 && ally.hp > 0) useMove(battle, foe, ally, pickFoeMove(foe));
    endOfTurn(battle);
}

// burn and poison damage, then whoever fainted
function endOfTurn(battle) {
    for (const f of [battle.ally, battle.foe]) {
        if (f.hp <= 0) continue;
        if ((f.status === "psn" || f.status === "tox") && f.ability === "poisonheal") {
            if (f.hp < f.stats.hp) { f.hp = Math.min(f.stats.hp, f.hp + Math.floor(f.stats.hp / 8)); say(battle, `§a${f.info.name} is healed by its Poison Heal!`); syncHealth(f); }
        } else if (["brn", "psn", "tox"].includes(f.status)) {
            hurt(battle, f, f.stats.hp / (f.status === "brn" ? (f.ability === "heatproof" ? 32 : 16) : 8), `${f.info.name} is hurt by its ${f.status === "brn" ? "burn" : "poison"}!`);
        }
        if (f.status && f.ability === "shedskin" && Math.random() < 1 / 3) { f.status = null; say(battle, `§a${f.info.name} shed its skin and was cured!`); }
        if (f.ability === "speedboost" && f.hp > 0) boost(battle, f, { spe: 1 });
        const w = weatherOf(battle);
        if (w === "sand" && f.hp > 0 && !f.info.types.some((t) => ["rock", "ground", "steel"].includes(t))
            && !["sandveil", "sandrush", "sandforce", "overcoat"].includes(f.ability) && held(f) !== "safety_goggles") {
            hurt(battle, f, f.stats.hp / 16, `${f.info.name} is buffeted by the sandstorm!`);
        }
        const heal = (w === "rain" && (f.ability === "raindish" || f.ability === "dryskin")) ? (f.ability === "dryskin" ? 8 : 16) : (w === "snow" && f.ability === "icebody") ? 16 : 0;
        if (heal && f.hp > 0 && f.hp < f.stats.hp) { f.hp = Math.min(f.stats.hp, f.hp + Math.floor(f.stats.hp / heal)); say(battle, `§a${f.info.name} restored HP with its ${abilityName(f.ability)}!`); syncHealth(f); }
        if (w === "sun" && (f.ability === "dryskin" || f.ability === "solarpower")) hurt(battle, f, f.stats.hp / 8, `${f.info.name} is hurt by the sunlight!`);
    }
    if (battle.weather && --battle.weather.turns <= 0) { say(battle, `§b${WEATHER_TEXT[battle.weather.kind][1]}`); battle.weather = null; }
    for (const f of [battle.ally, battle.foe]) {
        if (f.hp > 0 && held(f) === "black_sludge") {
            if (f.info.types.includes("poison")) { if (f.hp < f.stats.hp) { f.hp = Math.min(f.stats.hp, f.hp + Math.max(1, Math.floor(f.stats.hp / 16))); say(battle, `§a${f.info.name} restored a little HP using its Black Sludge!`); syncHealth(f); } }
            else hurt(battle, f, f.stats.hp / 8, `${f.info.name} was hurt by its Black Sludge!`);
        }
        if (f.hp > 0 && held(f) === "sticky_barb") hurt(battle, f, f.stats.hp / 8, `${f.info.name} was hurt by its Sticky Barb!`);
        if (f.hp > 0 && !f.status && held(f) === "flame_orb") inflict(battle, f, "brn", false);
        if (f.hp > 0 && !f.status && held(f) === "toxic_orb") inflict(battle, f, "tox", false);
        if (f.hp > 0 && f.hp < f.stats.hp && held(f) === "leftovers") {
            f.hp = Math.min(f.stats.hp, f.hp + Math.max(1, Math.floor(f.stats.hp / 16))); say(battle, `§a${f.info.name} restored a little HP using its Leftovers!`); syncHealth(f);
        }
        heldBerry(battle, f);
    }
    for (const f of [battle.ally, battle.foe]) f.flinched = false;
    if (battle.foe.hp <= 0) { faint(battle, battle.foe); return; }
    if (battle.ally.hp <= 0) { faint(battle, battle.ally); return; }
    if (battle.dragFoe) { battle.dragFoe = false; endBattle(battle, `§7The wild ${battle.foe.info.name} fled!`); return; }
    if (battle.ejectAlly) {
        battle.ejectAlly = false;
        chooseSwitch(battle, true).then((entity) => {
            if (!battles.has(battle.player.id)) return;
            if (entity) switchTo(battle, entity);
            system.runTimeout(() => turn(battle), 20);
        }).catch(() => endBattle(battle));
        return;
    }
    system.runTimeout(() => turn(battle), 30);
}

// experience for beating a Pokemon, and the levels and moves it brings
// Pokemon that levelled up, asked about evolving once the battle (or the candy) is done
const leveled = new Set();
function offerLevelEvolutions(player) {
    for (const e of [...leveled]) { leveled.delete(e); if (e.isValid) offerEvolution(player, e); }
}

function gainExperience(battle, f, foe, amount) {
    // Cobblemon's config: a Lucky Egg gives 1.5 times the experience
    const gain = amount ?? Math.max(1, Math.floor(((foe.info.baseExp || 50) * foe.level * (battle.trainer ? 1.5 : 1)) / 7 * (held(f) === "lucky_egg" ? 1.5 : 1)));
    if (foe) {
        // the foe's EV yield, doubled by Macho Brace; a power item adds 8 to its own stat
        const brace = held(f) === "macho_brace" ? 2 : 1;
        for (const [stat, n] of Object.entries(foe.info.evYield ?? {})) addEvs(f.entity, stat, n * brace);
        if (POWER_ITEMS[held(f)]) addEvs(f.entity, POWER_ITEMS[held(f)], 8);
    }
    const group = f.info.expGroup;
    let exp = Math.max(prop(f.entity, EXP) ?? 0, expFor(group, f.level)) + gain, level = f.level;
    say(battle, `§b${f.info.name} gained ${gain} Exp. Points!`);
    const ids = f.moves.map((m) => m.id);
    while (level < 100 && exp >= expFor(group, level + 1)) {
        level++;
        const fr = friendshipOf(f.entity);
        gainFriendship(f.entity, fr <= 99 ? 3 : fr <= 199 ? 2 : 0);
        leveled.add(f.entity);
        say(battle, `§b${f.info.name} grew to level ${level}!`);
        for (const [at, id] of f.info.learnset ?? []) {
            if (at !== level || ids.includes(id) || !MOVES[id]) continue;
            if (ids.length < 4) { ids.push(id); say(battle, `§b${f.info.name} learned ${MOVES[id].name}!`); }
            else {
                // the oldest move of the same kind makes way: an attack for an attack, a status move for a status move
                const attack = !!MOVES[id].power;
                let slot = ids.findIndex((m) => !!MOVES[m]?.power === attack);
                if (slot < 0) slot = 0;
                const old = ids[slot]; ids.splice(slot, 1); ids.push(id);
                say(battle, `§b${f.info.name} forgot ${MOVES[old]?.name ?? old} and learned ${MOVES[id].name}!`);
            }
        }
    }
    setProp(f.entity, EXP, exp); setProp(f.entity, LEVEL, level); setProp(f.entity, MOVESET, JSON.stringify(ids));
}

function faint(battle, fainted) {
    if (fainted === battle.foe) {
        say(battle, `§a${battle.foe.info.name} fainted! ${battle.ally.info.name} wins!`);
        try { battle.player.setDynamicProperty(BATTLE_WINS, (battle.player.getDynamicProperty(BATTLE_WINS) ?? 0) + 1); } catch (e) { }
        try { battle.foe.entity.triggerEvent("cobblemon:vanish"); } catch (e) { }
        if (battle.trainer) say(battle, "§6You defeated the Trainer!");
        gainExperience(battle, battle.ally, battle.foe);
        // an Exp. Share holder elsewhere in the party gets Cobblemon's half share
        for (const e of findParty(battle.player, battle.ally.entity.location)) {
            if (e.id === battle.ally.entity.id || prop(e, "cobblemon:held") !== "cobblemon:exp_share") continue;
            const sharer = fighter(e);
            if (sharer) gainExperience(battle, sharer, null, Math.max(1, Math.floor(((battle.foe.info.baseExp || 50) * battle.foe.level * (battle.trainer ? 1.5 : 1)) / 7 * 0.5)));
        }
        endBattle(battle);
        return;
    }
    say(battle, `§c${battle.ally.info.name} fainted!`);
    setProp(battle.ally.entity, FAINTED, true);
    freeze(battle.ally.entity, false);
    try { battle.ally.entity.triggerEvent("cobblemon:stay"); } catch (e) { }
    chooseSwitch(battle, true).then((entity) => {
        if (!battles.has(battle.player.id)) return;
        if (!entity) { endBattle(battle, "§cYou have no more Pokemon that can fight!"); return; }
        switchTo(battle, entity);
        system.runTimeout(() => turn(battle), 20);
    }).catch(() => endBattle(battle));
}

// Heal a player's Pokemon: full health, and fit to battle again
function healAround(dimension, location, player) {
    let healed = 0;
    for (const e of dimension.getEntities({ families: ["owned"], location, maxDistance: 12 })) {
        if (!POKEMON[e.typeId]) continue;
        const owner = prop(e, OWNER);
        if (owner && owner !== player.id) continue;
        try { e.getComponent(EntityComponentTypes.Health)?.resetToMaxValue(); } catch (err) { }
        setProp(e, FAINTED, undefined);
        try { e.dimension.spawnParticle("minecraft:heart_particle", { x: e.location.x, y: e.location.y + 1, z: e.location.z }); } catch (err) { }
        healed++;
    }
    return healed;
}

function nearestPlayer(entity) {
    let best, bestDist = 100;
    for (const p of entity.dimension.getPlayers({ location: entity.location, maxDistance: 10 })) {
        const dx = p.location.x - entity.location.x, dz = p.location.z - entity.location.z, dist = dx * dx + dz * dz;
        if (dist < bestDist) { best = p; bestDist = dist; }
    }
    return best;
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    const source = event.sourceEntity;
    if (!source) return;
    if (event.id === "cobblemon:battle") {
        const player = nearestPlayer(source);
        if (player) startBattle(player, source, false);
    } else if (event.id === "cobblemon:clear_wild") {
        // testing: "/scriptevent cobblemon:clear_wild x y z r" removes the wild Pokemon in that sphere, never an owned one
        const [x, y, z, r] = event.message.split(/\s+/).map(Number);
        for (const e of source.dimension.getEntities({ families: ["pokemon"], location: { x, y, z }, maxDistance: r || 16 })) {
            if (!prop(e, OWNER) && !e.hasComponent(EntityComponentTypes.IsTamed)) try { e.remove(); } catch (err) { }
        }
    } else if (event.id === "cobblemon:fossil_time") {
        // testing: /execute as <player> run scriptevent cobblemon:fossil_time <seconds> sets what running machines have left
        loadMachines();
        const seconds = Math.max(1, parseInt(event.message) || 1);
        for (const st of machines.values()) if (st.left > 0) st.left = seconds;
        saveMachines();
    } else if (event.id === "cobblemon:fish_now") {
        // testing: /execute as <player> run scriptevent cobblemon:fish_now makes a floating bobber bite at once
        for (const cast of fishing.values()) if (cast.phase === "waiting" || cast.phase === "travel") { cast.phase = "travel"; cast.travel = 1; }
    } else if (event.id === "cobblemon:scan") {
        // for testing: "/scriptevent cobblemon:scan x y z dx dy dz" logs the blocks in that box by type, to find
        // what a structure or a formation left in generated terrain
        const [x, y, z, dx, dy, dz] = event.message.split(/\s+/).map(Number);
        const counts = {};
        for (let i = 0; i <= dx; i++) for (let j = 0; j <= dy; j++) for (let k = 0; k <= dz; k++) {
            let t; try { t = source.dimension.getBlock({ x: x + i, y: y + j, z: z + k })?.typeId; } catch (e) { }
            if (t) counts[t] = (counts[t] ?? 0) + 1;
        }
        console.warn(`[scan] ${x} ${y} ${z} +${dx} ${dy} ${dz}: ` + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}=${n}`).join(" "));
    } else if (event.id === "cobblemon:find_formations") {
        // for testing: looks through the chunks within the given radius (in chunks) for suspicious gravel or sand
        // buried 3 to 24 blocks under the surface, which is where the fossil formations put theirs, and logs them
        const radius = Number(event.message) || 6, dim = source.dimension;
        const cx = Math.floor(source.location.x / 16), cz = Math.floor(source.location.z / 16);
        const hits = [];
        system.runJob((function* () {
            for (let i = -radius; i <= radius; i++) for (let j = -radius; j <= radius; j++) {
                for (let bx = 0; bx < 16; bx++) for (let bz = 0; bz < 16; bz++) {
                    const x = (cx + i) * 16 + bx, z = (cz + j) * 16 + bz;
                    let top;
                    try { top = dim.getTopmostBlock({ x, z })?.location.y; } catch (e) { }
                    if (top === undefined) continue;
                    for (let y = top - 24; y <= top - 3; y++) {
                        let t; try { t = dim.getBlock({ x, y, z })?.typeId; } catch (e) { }
                        if (t === "minecraft:suspicious_gravel" || t === "minecraft:suspicious_sand") hits.push(`${x} ${y} ${z} ${t.slice(21)}`);
                    }
                }
                yield;
            }
            console.warn(`[formations] ${hits.length} buried suspicious blocks within ${radius} chunks of ${cx * 16} ${cz * 16}: ${hits.slice(0, 30).join(", ")}`);
        })());
    } else if (event.id === "cobblemon:starter") {
        // "/scriptevent cobblemon:starter [reset]" opens the starter screen for the running player; "reset" lets them choose again
        const player = source?.typeId === "minecraft:player" ? source : nearestPlayer(source);
        if (!player) return;
        if (event.message?.trim() === "reset") player.setDynamicProperty(STARTER_CHOSEN, false);
        openStarter(player);
    } else if (event.id === "cobblemon:test_beam") {
        // for testing: a beam from the running player's hand to 4 blocks in front of them, held for 10 seconds
        const player = source.typeId === "minecraft:player" ? source : nearestPlayer(source);
        if (!player) return;
        const a = handOf(player), d = player.getViewDirection(), b = { x: a.x + d.x * 4, y: a.y + d.y * 4 - 0.5, z: a.z + d.z * 4 };
        const beam = player.dimension.spawnEntity("cobblemon:beam", a);
        system.runTimeout(() => drawBeam(beam, a, b, 0, 1), 2);
        system.runTimeout(() => { try { beam.remove(); } catch (e) { } }, 200);
    } else if (event.id === "cobblemon:test_capture") {
        // for testing: "/scriptevent cobblemon:test_capture [ball id]" plays a throw of that ball at the nearest wild
        // Pokemon within 8 blocks of the running player, as if it had just hit
        const player = source.typeId === "minecraft:player" ? source : nearestPlayer(source);
        const target = player?.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: 8 })
            .filter((e) => prop(e, OWNER) === undefined && !e.hasComponent(EntityComponentTypes.IsTamed))
            .sort((a, b) => Math.hypot(a.location.x - player.location.x, a.location.z - player.location.z) - Math.hypot(b.location.x - player.location.x, b.location.z - player.location.z))[0];
        const ballId = event.message?.trim() || "cobblemon:poke_ball";
        const projectile = [...BALL_FROM_PROJECTILE].find(([, id]) => id === ballId)?.[0];
        if (!target || !projectile) return;
        const d = { x: target.location.x - player.location.x, y: 0, z: target.location.z - player.location.z }, len = Math.hypot(d.x, d.z) || 1;
        const hit = { x: target.location.x - (d.x / len) * 0.5, y: target.location.y + 0.4, z: target.location.z - (d.z / len) * 0.5 };
        startCapture(player, projectile, target, hit, { x: d.x / len, y: 0, z: d.z / len });
    } else if (event.id === "cobblemon:claim") {
        // for testing: "/scriptevent cobblemon:claim [level]" makes the running Pokemon, or else the nearest wild one within
        // 8 blocks of the running player, that player's own, as a claim does, at the level given
        const player = source.typeId === "minecraft:player" ? source : nearestPlayer(source);
        const target = POKEMON[source.typeId] ? source : player?.dimension.getEntities({ families: ["pokemon"], location: player.location, maxDistance: 8 })
            .filter((e) => prop(e, OWNER) === undefined && !e.hasComponent(EntityComponentTypes.IsTamed))
            .sort((a, b) => Math.hypot(a.location.x - player.location.x, a.location.z - player.location.z) - Math.hypot(b.location.x - player.location.x, b.location.z - player.location.z))[0];
        if (!target || !player) return;
        try { target.triggerEvent("cobblemon:caught"); target.getComponent(EntityComponentTypes.Tameable)?.tame(player); } catch (e) { }
        setProp(target, OWNER, player.id);
        const level = Number(event.message);
        if (level >= 1 && level <= 100) { setProp(target, LEVEL, level); setProp(target, EXP, expFor(POKEMON[target.typeId].expGroup, level)); }
        player.sendMessage(`§a${POKEMON[target.typeId]?.name} is now yours.`);
    } else if (event.id === "cobblemon:summary") {
        showSummary(source);
    } else if (event.id === "cobblemon:take_item") {
        takeHeld(source);
    } else if (event.id === "cobblemon:join_fences") {
        // for testing and for fences placed by commands or structures: join every fence and wall within 8 blocks
        const { x, y, z } = source.location;
        for (let dx = -8; dx <= 8; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -8; dz <= 8; dz++) {
            try { joinFence(source.dimension.getBlock({ x: Math.floor(x) + dx, y: Math.floor(y) + dy, z: Math.floor(z) + dz })); } catch (e) { }
        }
    } else if (event.id === "cobblemon:heal") {
        const player = nearestPlayer(source);
        if (player) healAround(source.dimension, player.location, player);
    } else if (event.id === "cobblemon:trainer") {
        const player = nearestPlayer(source);
        const typeId = `cobblemon:${event.message.trim()}`;
        if (!player || !POKEMON[typeId]) return;
        const dx = player.location.x - source.location.x, dz = player.location.z - source.location.z, len = Math.hypot(dx, dz) || 1;
        const loc = { x: source.location.x + (dx / len) * 1.5, y: source.location.y, z: source.location.z + (dz / len) * 1.5 };
        let foe;
        try { foe = source.dimension.spawnEntity(typeId, loc); } catch (e) { return; }
        system.runTimeout(() => startBattle(player, foe, true), 5);
    }
}, { namespaces: ["cobblemon"] });

// Evolution by item transforms a Pokemon into a new entity, which comes out wild. The old one's owner is
// noted as it is removed, and the transformed entity that appears in its place is tamed back to them.
const evolving = [];
world.beforeEvents.entityRemove.subscribe((event) => {
    const e = event.removedEntity;
    if (!POKEMON[e.typeId]) return;
    let owner, kept = {}, name = "";
    try {
        owner = e.getDynamicProperty(OWNER);
        for (const id of e.getDynamicPropertyIds()) kept[id] = e.getDynamicProperty(id);
        name = e.nameTag;
    } catch (err) { }
    if (owner) evolving.push({ owner, kept, name, from: e.typeId, location: { ...e.location }, tick: system.currentTick });
});
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== EntityInitializationCause.Transformed || !POKEMON[entity.typeId]) return;
    const i = evolving.findIndex((p) => system.currentTick - p.tick < 40 && Math.hypot(p.location.x - entity.location.x, p.location.z - entity.location.z) < 3);
    if (i < 0) return;
    const { owner, kept, name, from } = evolving.splice(i, 1)[0];
    const player = world.getPlayers().find((p) => p.id === owner);
    system.run(() => {
        try {
            if (!entity.isValid) return;
            if (player) entity.getComponent(EntityComponentTypes.Tameable)?.tame(player);
            // level, experience, moves, IVs, EVs, nature, friendship and held item carry over; the ability keeps its slot
            for (const [key, value] of Object.entries(kept ?? {})) { try { entity.setDynamicProperty(key, value); } catch (e) { } }
            const before = POKEMON[from], after = POKEMON[entity.typeId], ability = kept?.["cobblemon:ability"];
            if (before && after && ability) {
                const hidden = (before.hidden ?? []).indexOf(ability), slot = (before.abilities ?? []).indexOf(ability);
                const next = hidden >= 0 ? (after.hidden ?? [])[hidden] ?? (after.hidden ?? [])[0] : (after.abilities ?? [])[Math.max(0, slot)] ?? (after.abilities ?? [])[0];
                if (next) entity.setDynamicProperty("cobblemon:ability", next);
            }
            entity.setDynamicProperty(OWNER, owner);
            if (player) register(player, entity.typeId, 2);
            player?.sendMessage(`§aYour Pokemon evolved into ${POKEMON[entity.typeId].name}!`);
        } catch (e) { }
    });
});

// The fossil machine: a Restoration Tank (two blocks) with a Fossil Analyzer beside it, and a Monitor within two
// blocks for the progress. Using any part: a fossil goes into the analyzer (up to three), a natural material into
// the tank until it holds 128, an empty hand takes the last fossil back. With a matching set of fossils and a full
// tank, the Pokemon grows for twelve minutes inside the tank; a Poke Ball used on the machine then takes it out as
// the player's own. Machines are kept in a world dynamic property, keyed by the tank's lower block.
const MACHINES = "cobblemon:fossil_machines";
const machines = new Map();
let machinesLoaded = false;

function loadMachines() {
    if (machinesLoaded) return;
    machinesLoaded = true;
    try { for (const [k, v] of Object.entries(JSON.parse(world.getDynamicProperty(MACHINES) ?? "{}"))) machines.set(k, v); } catch (e) { }
}
function saveMachines() { try { world.setDynamicProperty(MACHINES, JSON.stringify(Object.fromEntries(machines))); } catch (e) { } }
function keyOf(dimension, p) { return `${dimension.id}|${p.x},${p.y},${p.z}`; }

// the tank's lower block for any part of a machine, and the analyzer and monitor beside it
function findMachine(block) {
    const d = block.dimension, around = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
        try { const b = d.getBlock({ x: block.location.x + dx, y: block.location.y + dy, z: block.location.z + dz }); if (b) around.push(b); } catch (e) { }
    }
    const tank = around.find((b) => b.typeId === "cobblemon:restoration_tank" && b.permutation.getState("cobblemon:part") === "bottom"
        && Math.abs(b.location.x - block.location.x) <= 1 && Math.abs(b.location.z - block.location.z) <= 1);
    if (!tank) return undefined;
    const near = (b, r) => Math.abs(b.location.x - tank.location.x) <= r && Math.abs(b.location.z - tank.location.z) <= r;
    const analyzer = around.find((b) => b.typeId === "cobblemon:fossil_analyzer" && b.location.y === tank.location.y && near(b, 1));
    const monitor = around.find((b) => b.typeId === "cobblemon:monitor" && near(b, 2));
    return { tank, analyzer, monitor, key: keyOf(tank.dimension, tank.location) };
}

function stateFor(key) {
    loadMachines();
    if (!machines.has(key)) machines.set(key, { fossils: [], material: 0, left: -1, done: false, owner: null, result: null, protect: 0 });
    return machines.get(key);
}

function resultFor(fossils) {
    const want = [...fossils].sort().join(",");
    return FOSSILS.results.find((r) => [...r.fossils].sort().join(",") === want);
}

function setState(block, name, value) {
    try { if (block && block.permutation.getState(name) !== value) block.setPermutation(block.permutation.withState(name, value)); } catch (e) { console.warn(`[cobblemon] ${name}: ${e}`); }
}

// blocks show the machine: analyzer scanning while it runs, the tank's fill level, the monitor's screen
function show(m, st) {
    setState(m.analyzer, "cobblemon:on", st.left > 0);
    setState(m.tank, "cobblemon:fill", Math.min(8, Math.floor((st.material * 8) / FOSSILS.materialToStart)));
    let screen = "off";
    if (st.done) screen = st.protect > 0 ? "locked" : "music";
    else if (st.left > 0) screen = `scanning_${Math.min(8, Math.floor(((FOSSILS.reviveSeconds - st.left) * 9) / FOSSILS.reviveSeconds))}`;
    else if (st.fossils.length || st.material) screen = "grid";
    setState(m.monitor, "cobblemon:screen", screen);
    showFetus(m, st);
}

// what floats in the tank: nothing idle, the embryo through its three stages, then the fetus growing
function showFetus(m, st) {
    const d = m.tank.dimension, at = { x: m.tank.location.x + 0.5, y: m.tank.location.y + 0.55, z: m.tank.location.z + 0.5 };
    let display = d.getEntities({ type: "cobblemon:fossil_display", location: at, maxDistance: 0.8 })[0];
    const active = st.left > 0 || st.done;
    if (!active) { display?.remove(); return; }
    if (!display) { try { display = d.spawnEntity("cobblemon:fossil_display", at); } catch (e) { return; } }
    const progress = st.done ? 1 : (FOSSILS.reviveSeconds - st.left) / FOSSILS.reviveSeconds;
    const result = FOSSILS.results.find((r) => r.entity === st.result);
    const stage = progress < 0.25 ? 0 : progress < 0.4 ? 1 : progress < 0.55 ? 2 : (result?.stage ?? 2);
    const growth = Math.max(0, Math.min(4, Math.floor(((progress - 0.55) / 0.45) * 5)));
    try {
        if (display.getComponent("minecraft:variant")?.value !== stage) display.triggerEvent(`cobblemon:stage_${stage}`);
        if (display.getComponent("minecraft:mark_variant")?.value !== growth) display.triggerEvent(`cobblemon:growth_${growth}`);
    } catch (e) { }
}

function takeFromHand(player, count = 1) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    const slot = player.selectedSlotIndex, item = inv?.getItem(slot);
    if (!item) return;
    if (item.amount > count) { item.amount -= count; inv.setItem(slot, item); } else inv.setItem(slot, undefined);
}

function useMachine(block, player) {
    const m = findMachine(block);
    if (!m) { player.sendMessage("§7A Restoration Tank needs a Fossil Analyzer right beside it."); return; }
    if (!m.analyzer) { player.sendMessage("§7Place a Fossil Analyzer beside the Restoration Tank."); return; }
    const st = stateFor(m.key);
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    const item = inv?.getItem(player.selectedSlotIndex);
    const id = item?.typeId;
    if (st.done) {
        if (!id || !BALLS[id]) { player.sendMessage("§eThe Pokemon is ready. Use a Poke Ball on the machine to take it."); return; }
        if (st.protect > 0 && st.owner && st.owner !== player.id) { player.sendMessage("§cThis Pokemon belongs to whoever revived it for a few more minutes."); return; }
        takeFromHand(player);
        const out = { x: m.tank.location.x + 0.5, y: m.tank.location.y, z: m.tank.location.z + 0.5 };
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
            try { if (m.tank.dimension.getBlock({ x: out.x + dx - 0.5, y: out.y, z: out.z + dz - 0.5 })?.isAir) { out.x += dx; out.z += dz; break; } } catch (e) { }
        }
        let pokemon;
        try { pokemon = m.tank.dimension.spawnEntity(st.result, out); } catch (e) { player.sendMessage("§cThe Pokemon could not come out here."); return; }
        system.run(() => {
            try {
                pokemon.triggerEvent("cobblemon:caught");
                pokemon.getComponent(EntityComponentTypes.Tameable)?.tame(player);
                pokemon.setDynamicProperty(OWNER, player.id);
                register(player, st.result, 2);
            } catch (e) { }
        });
        player.sendMessage(`§a${POKEMON[st.result]?.name ?? "The Pokemon"} was revived! It is yours.`);
        try { player.playSound("random.levelup"); } catch (e) { }
        machines.set(m.key, { fossils: [], material: 0, left: -1, done: false, owner: null, result: null, protect: 0 });
        saveMachines(); show(m, machines.get(m.key));
        return;
    }
    if (st.left > 0) { player.sendMessage(`§7Reviving... ${Math.ceil(st.left / 60)} minute(s) left.`); return; }
    if (id && FOSSILS.fossilItems.includes(id)) {
        if (st.fossils.length >= FOSSILS.maxFossils) { player.sendMessage("§7The analyzer is full."); return; }
        st.fossils.push(id); st.owner = player.id; takeFromHand(player);
        const r = resultFor(st.fossils);
        player.sendMessage(r ? `§bThe analyzer reads the fossils: ${POKEMON[r.entity]?.name}.` : "§7The analyzer does not recognise these fossils together.");
    } else if (id && FOSSILS.materials[id]) {
        if (st.material >= FOSSILS.materialToStart) { player.sendMessage("§7The tank is full."); return; }
        const [worth, back] = FOSSILS.materials[id];
        st.material = Math.min(FOSSILS.materialToStart, st.material + worth); takeFromHand(player);
        if (back) { try { inv.addItem(new ItemStack(back, 1)); } catch (e) { } }
        player.sendMessage(`§7Natural material ${st.material}/${FOSSILS.materialToStart}`);
    } else if (!id) {
        if (!st.fossils.length) { player.sendMessage("§7Put fossils in the analyzer and natural materials (berries, crops, seeds) in the tank."); return; }
        const last = st.fossils.pop();
        try { inv.setItem(player.selectedSlotIndex, new ItemStack(last, 1)); } catch (e) { }
    } else {
        player.sendMessage("§7That is neither a fossil nor a natural material.");
        return;
    }
    // start once there is a result and a full tank
    const r = resultFor(st.fossils);
    if (r && st.material >= FOSSILS.materialToStart) {
        st.result = r.entity; st.left = FOSSILS.reviveSeconds; st.fossils = [];
        player.sendMessage(`§aThe machine starts reviving ${POKEMON[r.entity]?.name}. Come back in ${FOSSILS.reviveSeconds / 60} minutes.`);
    }
    saveMachines(); show(m, st);
}

// once a second, running machines count down
system.runInterval(() => {
    loadMachines();
    let changed = false;
    for (const [key, st] of machines) {
        if (st.left <= 0 && !(st.done && st.protect > 0)) continue;
        const [dimId, pos] = key.split("|"), [x, y, z] = pos.split(",").map(Number);
        let block;
        try { block = world.getDimension(dimId).getBlock({ x, y, z }); } catch (e) { continue; }   // unloaded: time waits
        if (!block) continue;
        if (block.typeId !== "cobblemon:restoration_tank") { machines.delete(key); changed = true; continue; }
        if (st.left > 0) {
            st.left--;
            if (st.left === 0) { st.done = true; st.protect = FOSSILS.protectionSeconds; st.left = -1; }
        } else st.protect--;
        changed = true;
        if (st.left % 5 === 0 || st.done) { const m = findMachine(block); if (m) show(m, st); }
    }
    if (changed && system.currentTick % 100 < 20) saveMachines();
}, 20);

// a two-block machine's upper half (the tank's, the PC's) comes with it, and goes with it
const TWO_TALL = ["cobblemon:restoration_tank", "cobblemon:pc", "cobblemon:pasture"];
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (!TWO_TALL.includes(block.typeId)) return;
    const above = block.above();
    if (above?.isAir) {
        above.setPermutation(block.permutation.withState("cobblemon:part", "top"));
    }
});
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    const type = brokenBlockPermutation.type.id;
    if (!TWO_TALL.includes(type)) return;
    const other = brokenBlockPermutation.getState("cobblemon:part") === "bottom" ? block.above() : block.below();
    if (other?.typeId === type) other.setType("minecraft:air");
    if (type === "cobblemon:pasture") {
        const bottom = brokenBlockPermutation.getState("cobblemon:part") === "bottom" ? block : block.below();
        emptyPasture(block.dimension, keyOf(block.dimension, bottom.location), bottom.location);
    }
    if (type !== "cobblemon:restoration_tank") return;
    loadMachines();
    const bottom = brokenBlockPermutation.getState("cobblemon:part") === "bottom" ? block : block.below();
    const key = keyOf(block.dimension, bottom.location), st = machines.get(key);
    if (st) {
        for (const f of st.fossils) { try { block.dimension.spawnItem(new ItemStack(f, 1), block.location); } catch (e) { } }
        machines.delete(key); saveMachines();
    }
    for (const e of block.dimension.getEntities({ type: "cobblemon:fossil_display", location: bottom.location, maxDistance: 2 })) e.remove();
});

// Brushing a fossil formation. Bedrock gives nothing for a suspicious block placed from a structure, whatever
// loot it names, so the script does: a suspicious block a player starts brushing is watched, and once it has
// turned to plain sand or gravel with nothing dropped (a vanilla one drops its own find), the formation that
// biome holds is picked and its loot rolled, each loot table as likely as its share of the formation's blocks.
const brushing = new Map();
// the before event, because brushing a block is not an interaction the after event reports
world.beforeEvents.playerInteractWithBlock.subscribe(({ block, itemStack }) => {
    if (itemStack?.typeId !== "minecraft:brush" || !/suspicious_(sand|gravel)/.test(block.typeId)) return;
    const key = keyOf(block.dimension, block.location);
    const { x, y, z } = block.location;
    if (!brushing.has(key)) brushing.set(key, { dimension: block.dimension, location: { x, y, z }, since: system.currentTick });
});

function pick(weighted) {
    const total = weighted.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total;
    for (const entry of weighted) { r -= entry[1]; if (r < 0) return entry; }
    return weighted[weighted.length - 1];
}

function brushLoot(dimension, location) {
    let biome = "";
    try { biome = dimension.getBiome(location).id; } catch (e) { }
    const here = FORMATIONS.filter((f) => new RegExp(f.biomes).test(biome));
    const formation = (here.length ? here : FORMATIONS)[Math.floor(Math.random() * (here.length || FORMATIONS.length))];
    const table = pick(Object.entries(formation.tables))[0];
    const entries = BRUSH_LOOT[table];
    if (!entries?.length) return undefined;
    const [item, , least, most] = pick(entries);
    return new ItemStack(item, least + Math.floor(Math.random() * (most - least + 1)));
}

system.runInterval(() => {
    for (const [key, watch] of brushing) {
        let block;
        try { block = watch.dimension.getBlock(watch.location); } catch (e) { console.warn(`[cobblemon] brush watch: ${e}`); brushing.delete(key); continue; }
        if (!block || system.currentTick - watch.since > 400) { brushing.delete(key); continue; }
        if (/suspicious_/.test(block.typeId)) continue;
        brushing.delete(key);
        if (block.typeId !== "minecraft:sand" && block.typeId !== "minecraft:gravel" && block.typeId !== "minecraft:red_sand") continue;
        const centre = { x: watch.location.x + 0.5, y: watch.location.y + 0.5, z: watch.location.z + 0.5 };
        // a vanilla find drops its own item (unless a player standing close has already picked it up)
        if (watch.dimension.getEntities({ type: "minecraft:item", location: centre, maxDistance: 2 }).length) continue;
        const find = brushLoot(watch.dimension, watch.location);
        if (find) { try { watch.dimension.spawnItem(find, { x: centre.x, y: centre.y + 0.5, z: centre.z }); } catch (e) { console.warn(`[cobblemon] brush spawn: ${e}`); } }
    }
}, 5);

// The PC. Using it opens the player's storage: 40 boxes of 30, as Cobblemon's PC has, kept on the player as one
// dynamic property per box. Deposit takes one of the player's Pokemon standing within 32 blocks into the first
// free slot; Withdraw sends one out beside the player, while fewer than six of theirs are out; Release lets one
// go for good. A stored Pokemon keeps its form, level, experience, moves, health and whether it has fainted.
const PC_BOXES = 40, PER_BOX = 30, PARTY_SIZE = 6;   // CobblemonConfig.defaultBoxCount, PCBox.POKEMON_PER_BOX

function box(player, n) {
    try { const b = JSON.parse(player.getDynamicProperty(`cobblemon:pc_${n}`) ?? "[]"); return Array.from({ length: PER_BOX }, (_, i) => b[i] ?? null); }
    catch (e) { return Array(PER_BOX).fill(null); }
}
function saveBox(player, n, contents) { player.setDynamicProperty(`cobblemon:pc_${n}`, JSON.stringify(contents)); }

function mine(player, radius) {
    return player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: radius })
        .filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id && !prop(e, "cobblemon:pasture"));   // pastured ones are not with the player
}

function describe(record) {
    const species = POKEMON[record.t];
    const name = record.n || species?.variants?.[record.v]?.name || species?.name || record.t;
    return `${name}  Lv ${record.lv}${record.f ? "  §c(fainted)" : ""}${record.p ? "  §2(pastured)" : ""}`;
}

function snapshot(entity) {
    const species = POKEMON[entity.typeId];
    let variant = 0, hp = 1;
    try { variant = entity.getComponent("minecraft:variant")?.value ?? 0; } catch (e) { }
    try { const h = entity.getComponent(EntityComponentTypes.Health); hp = h.currentValue / h.effectiveMax; } catch (e) { }
    return { t: entity.typeId, v: variant, lv: prop(entity, LEVEL) ?? species.level, xp: prop(entity, EXP) ?? 0,
             mv: prop(entity, MOVESET) ?? null, f: !!prop(entity, FAINTED), hp,
             n: nicknameOf(entity),   // "NPC" is the name the panel component gives
             k: Object.fromEntries(KEPT.map((key) => [key, prop(entity, key)]).filter(([, v]) => v !== undefined)) };
}

// what a Pokemon keeps through the PC and the pasture besides its level, moves and name
const KEPT = ["cobblemon:ivs", "cobblemon:evs", "cobblemon:nature", "cobblemon:mint", "cobblemon:friendship", "cobblemon:ability", "cobblemon:held",
    "cobblemon:gender", "cobblemon:caught_ball"];

function setPcScreen(block, on) {
    const top = block.permutation.getState("cobblemon:part") === "top" ? block : block.above();
    if (top?.typeId === "cobblemon:pc") setState(top, "cobblemon:on", on);
}

// The PC, laid out by ui/server_form.json on Cobblemon's PC textures (PC_LAYOUT in port.py): box slots 0 to 29, the
// party 30 to 35, then previous and next box, release and exit. Choosing a Pokemon selects it (the pointer shows over
// it); choosing another slot moves it there, swapping with what is there, depositing or withdrawing as the slots say.
const PC_UI = "textures/ui/cobblemon";
const iconOf = (typeId) => (typeId ? `i${typeId.slice("cobblemon:p".length, "cobblemon:p".length + 4)}` : "i----");
function pcInfo(v, rec, entity) {
    const typeId = rec?.t ?? entity?.typeId, info = POKEMON[typeId];
    if (!info) { Object.assign(v, { portrait: "i----", gender: "o", ball: "b--", type1: "t--", type2: "t--" }); return; }
    const kept = (key) => (rec ? rec.k?.[key] : prop(entity, key));
    const variant = rec ? rec.v : (entity.getComponent("minecraft:variant")?.value ?? 0);
    const form = { ...info, ...(info.variants?.[variant] ?? {}) };
    const level = rec ? rec.lv : prop(entity, LEVEL) ?? info.level;
    let moves = [];
    try { moves = JSON.parse((rec ? rec.mv : prop(entity, MOVESET)) ?? "null") ?? movesAt(form, level); } catch (e) { moves = movesAt(form, level); }
    const ball = Object.keys(BALLS).indexOf(kept("cobblemon:caught_ball") ?? "cobblemon:poke_ball");
    const tag = rec ? rec.n : (nicknameOf(entity));
    Object.assign(v, {
        level: num(level), name: tag || form.name, portrait: iconOf(typeId),
        gender: { male: "m", female: "f" }[kept("cobblemon:gender")] ?? "o", ball: `b${String(Math.max(0, ball)).padStart(2, "0")}`,
        type1: typeCode(form.types[0]), type2: typeCode(form.types[1]),
        nature: natureName(kept("cobblemon:mint") ?? kept("cobblemon:nature")), ability: abilityName(kept("cobblemon:ability") ?? form.ability),
    });
    moves.slice(0, 4).forEach((id, n) => { v[`move${n}`] = MOVES[id]?.name ?? ""; });
    const held = kept(HELD);
    v.item = (held && HELD_ICONS[(HELD_INDEX[held] ?? 0) - 1]) || `${PC_UI}/summary/blank`;
}

function openPc(block, player, state) {
    if (battles.has(player.id)) { player.sendMessage("§cYou cannot use a PC while in battle!"); return; }
    if (!state) { tidyPastured(player); setPcScreen(block, true); state = { box: 0, sel: null }; }
    const done = () => { try { setPcScreen(block, false); } catch (e) { } };
    const party = summaryParty(player), contents = box(player, state.box);
    const v = { box: `Box ${state.box + 1}`, item: `${PC_UI}/summary/blank` };
    const sel = state.sel;
    if (sel?.kind === "box") pcInfo(v, box(player, sel.box)[sel.slot], null);
    else if (sel?.kind === "party" && party[sel.slot]?.isValid) pcInfo(v, null, party[sel.slot]);
    else pcInfo(v, null, null);
    for (let n = 0; n < 30; n++) {
        v[`b${n}`] = iconOf(contents[n]?.t); v[`s${n}`] = sel?.kind === "box" && sel.box === state.box && sel.slot === n ? "y" : "n";
        v[`q${n}`] = contents[n]?.p ? "y" : "n";
    }
    for (let n = 0; n < 6; n++) { v[`p${n}`] = iconOf(party[n]?.typeId); v[`s${30 + n}`] = sel?.kind === "party" && sel.slot === n ? "y" : "n"; }
    const body = PC_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:pc").body(body);
    for (let n = 0; n < 36; n++) form.button("slot", `${PC_UI}/pc/slot${v[`s${n}`] === "y" ? "_on" : ""}`);
    form.button("prev", `${PC_UI}/pc/prev`).button("next", `${PC_UI}/pc/next`).button("release", `${PC_UI}/pc/release`).button("exit", `${PC_UI}/summary/exit`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 39) { done(); return; }
        const pick = r.selection, again = (delay = 0) => system.runTimeout(() => openPc(block, player, state), delay);
        if (pick === 36 || pick === 37) { state.box = (state.box + (pick === 37 ? 1 : PC_BOXES - 1)) % PC_BOXES; again(); return; }
        if (pick === 38) { pcRelease(player, state, party, () => again(5)); return; }
        const target = pick < 30 ? { kind: "box", box: state.box, slot: pick } : { kind: "party", slot: pick - 30 };
        const occupied = target.kind === "box" ? !!contents[target.slot] : !!party[target.slot];
        if (!sel) { state.sel = occupied ? target : null; again(); return; }
        if (sel.kind === target.kind && sel.slot === target.slot && (sel.kind === "party" || sel.box === target.box)) { state.sel = null; again(); return; }
        state.sel = null;
        pcMove(player, sel, target, party);
        again(12);   // the party changes as Pokemon beam in and out
    }).catch(done);
}

// moves the selected Pokemon to a slot: within the PC it swaps, between the PC and the party it deposits and withdraws
function pcMove(player, from, to, party) {
    const here = (pos) => (pos.kind === "box" ? box(player, pos.box)[pos.slot] : party[pos.slot]);
    const a = here(from), b = here(to);
    if ((from.kind === "box" && a?.p) || (to.kind === "box" && b?.p)) { player.sendMessage("§7That Pokemon is out in a pasture. Bring it back there first."); return; }
    if (from.kind === "box" && to.kind === "box") {
        const src = box(player, from.box), dst = from.box === to.box ? src : box(player, to.box);
        const moving = src[from.slot]; src[from.slot] = dst[to.slot]; dst[to.slot] = moving;
        saveBox(player, from.box, src); if (dst !== src) saveBox(player, to.box, dst);
        return;
    }
    if (from.kind === "party" && to.kind === "party") return;
    const [boxPos, partyPos] = from.kind === "box" ? [from, to] : [to, from];
    const contents = box(player, boxPos.box), rec = contents[boxPos.slot], entity = party[partyPos.slot];
    if (!entity && party.length >= PARTY_SIZE) { player.sendMessage(`§cYou already have ${PARTY_SIZE} Pokemon with you.`); return; }
    contents[boxPos.slot] = entity?.isValid ? snapshot(entity) : null;
    saveBox(player, boxPos.box, contents);
    if (entity?.isValid) recallEffect(player, entity, () => { try { entity.remove(); } catch (e) { } });
    if (rec) {
        const d = player.getViewDirection(), at = { x: player.location.x + d.x * 2, y: player.location.y, z: player.location.z + d.z * 2 };
        try { spawnStored(player, rec, at); } catch (e) { contents[boxPos.slot] = rec; saveBox(player, boxPos.box, contents); }
    }
}

function pcRelease(player, state, party, then) {
    const sel = state.sel;
    if (!sel) { then(); return; }
    const rec = sel.kind === "box" ? box(player, sel.box)[sel.slot] : null, entity = sel.kind === "party" ? party[sel.slot] : null;
    if (!rec && !entity?.isValid) { state.sel = null; then(); return; }
    if (rec?.p) { player.sendMessage("§7That Pokemon is out in a pasture. Bring it back there first."); then(); return; }
    const label = rec ? describe(rec) : describe(snapshot(entity));
    new MessageFormData().title("Release").body(`Release ${label}? It will be gone for good.`).button1("Keep").button2("Release")
        .show(player).then((r) => {
            if (r.selection === 1) {
                if (rec) { const contents = box(player, sel.box); contents[sel.slot] = null; saveBox(player, sel.box, contents); }
                else { try { entity.remove(); } catch (e) { } }
                player.sendMessage(`§7${label} was released. Bye-bye!`);
                state.sel = null;
            }
            then();
        }).catch(then);
}

function deposit(player, done) {
    const party = mine(player, 32);
    if (!party.length) { player.sendMessage("§7None of your Pokemon are nearby."); done(); return; }
    const form = new ActionFormData().title("Deposit which Pokemon?");
    for (const e of party) form.button(describe(snapshot(e)));
    form.show(player).then((r) => {
        if (r.canceled || !party[r.selection]?.isValid) { done(); return; }
        const entity = party[r.selection];
        for (let n = 0; n < PC_BOXES; n++) {
            const contents = box(player, n), slot = contents.indexOf(null);
            if (slot < 0) continue;
            contents[slot] = snapshot(entity);
            saveBox(player, n, contents);
            player.sendMessage(`§a${describe(contents[slot])} went to Box ${n + 1}.`);
            recallEffect(player, entity, () => { try { entity.remove(); } catch (e) { } });
            done();
            return;
        }
        player.sendMessage("§cYour PC is full."); done();
    }).catch(done);
}

function pickStored(player, action, then, done) {
    const boxes = [];
    for (let n = 0; n < PC_BOXES; n++) { const c = box(player, n).filter(Boolean).length; if (c) boxes.push([n, c]); }
    if (!boxes.length) { player.sendMessage("§7Your PC is empty."); done(); return; }
    const form = new ActionFormData().title(`${action}: which box?`);
    for (const [n, c] of boxes) form.button(`Box ${n + 1}\n§7${c}/${PER_BOX}`);
    form.show(player).then((r) => {
        if (r.canceled) { done(); return; }
        const n = boxes[r.selection][0], contents = box(player, n);
        const slots = contents.map((rec, i) => [rec, i]).filter(([rec]) => rec);
        const list = new ActionFormData().title(`Box ${n + 1}: ${action.toLowerCase()} which?`);
        for (const [rec] of slots) list.button(describe(rec));
        list.show(player).then((q) => { if (q.canceled) done(); else then(n, slots[q.selection][1]); }).catch(done);
    }).catch(done);
}

function withdraw(player, n, slot, done) {
    if (mine(player, 64).length >= PARTY_SIZE) { player.sendMessage(`§cYou already have ${PARTY_SIZE} Pokemon with you.`); done(); return; }
    const contents = box(player, n), rec = contents[slot];
    if (!rec) { done(); return; }
    if (rec.p) { player.sendMessage("§7That Pokemon is out in a pasture. Bring it back there first."); done(); return; }
    const d = player.getViewDirection(), at = { x: player.location.x + d.x * 2, y: player.location.y, z: player.location.z + d.z * 2 };
    try { spawnStored(player, rec, at); } catch (e) { player.sendMessage("§cThat Pokemon could not come out here."); done(); return; }
    contents[slot] = null; saveBox(player, n, contents);
    player.sendMessage(`§aGo, ${describe(rec)}!`);
    done();
}

function release(player, n, slot, done) {
    const contents = box(player, n), rec = contents[slot];
    if (!rec) { done(); return; }
    if (rec.p) { player.sendMessage("§7That Pokemon is out in a pasture. Bring it back there first."); done(); return; }
    new MessageFormData().title("Release").body(`Release ${describe(rec)}? It will be gone for good.`).button1("Keep").button2("Release")
        .show(player).then((r) => {
            if (r.selection === 1) { contents[slot] = null; saveBox(player, n, contents); player.sendMessage(`§7${describe(rec)} was released. Bye-bye!`); }
            done();
        }).catch(done);
}

// The pasture. As in Cobblemon, a pastured Pokemon stays in its PC box and is out in the world at the same time,
// wandering within 32 blocks of the pasture; up to 16 per pasture (defaultPasturedPokemonLimit). Using the pasture
// lists the player's PC Pokemon to send out and the ones it already has to bring back; a PC slot that is out shows
// as pastured and cannot be withdrawn or released until it is back. Breaking the pasture brings them all back.
const PASTURE_LIMIT = 16, PASTURE_SLOT = "cobblemon:pc_slot", PASTURE_AT = "cobblemon:pasture";

function pastureKey(block) {
    const bottom = block.permutation.getState("cobblemon:part") === "top" ? block.below() : block;
    return keyOf(bottom.dimension, bottom.location);
}

function pasturedHere(dimension, key, location) {
    return dimension.getEntities({ families: ["owned"], location, maxDistance: 80 }).filter((e) => prop(e, PASTURE_AT) === key);
}

// a PC slot marked as pastured whose Pokemon is gone (its pasture broken while the player was away) comes back
function tidyPastured(player) {
    for (let n = 0; n < PC_BOXES; n++) {
        const contents = box(player, n);
        let changed = false;
        contents.forEach((rec, i) => {
            if (!rec?.p) return;
            const [dimId, pos] = rec.p.split("|"), [x, y, z] = pos.split(",").map(Number);
            let block;
            try { block = world.getDimension(dimId).getBlock({ x, y, z }); } catch (e) { return; }   // unloaded: leave it
            if (block && block.typeId !== "cobblemon:pasture") { delete rec.p; changed = true; }
        });
        if (changed) saveBox(player, n, contents);
    }
}

// sends a stored Pokemon out as the player's own; used by the PC and the pasture
function spawnStored(player, rec, at) {
    const entity = player.dimension.spawnEntity(rec.t, at);
    system.run(() => {
        try { entity.triggerEvent(`cobblemon:set_variant_${rec.v}`); } catch (e) { }
        try {
            entity.triggerEvent("cobblemon:caught");
            entity.getComponent(EntityComponentTypes.Tameable)?.tame(player);
            setProp(entity, OWNER, player.id); setProp(entity, LEVEL, rec.lv); setProp(entity, EXP, rec.xp);
            if (rec.mv) setProp(entity, MOVESET, rec.mv);
            if (rec.f) setProp(entity, FAINTED, true);
            if (rec.n) setProp(entity, NICK, rec.n);
            for (const [key, value] of Object.entries(rec.k ?? {})) setProp(entity, key, value);
            const h = entity.getComponent(EntityComponentTypes.Health);
            if (h) h.setCurrentValue(Math.max(1, Math.round(h.effectiveMax * rec.hp)));
        } catch (e) { }
        sendOutEffect(player, entity);
    });
    return entity;
}

function setPastureLamp(block, on) {
    const top = block.permutation.getState("cobblemon:part") === "top" ? block : block.above();
    if (top?.typeId === "cobblemon:pasture") setState(top, "cobblemon:on", on);
}

// The pasture, laid out by ui/server_form.json as Cobblemon's PC with the pasture panel in place of the party: choose a
// Pokemon in a box, then a row of the pasture list, to send it out; choose one of your own rows to bring it back; Recall
// All brings back all of yours. The list shows four rows at a time; the count above it turns the page.
function openPasture(block, player, state) {
    if (battles.has(player.id)) { player.sendMessage("§cYou cannot use a pasture while in battle!"); return; }
    if (!state) { tidyPastured(player); state = { box: 0, sel: null, page: 0 }; }
    const key = pastureKey(block), here = pasturedHere(block.dimension, key, block.location).filter((e) => e.isValid && !recalling.has(e.id));
    // a slot marked out in this pasture whose Pokemon is gone (it fainted or left) comes back to the box
    if (!state.sel && system.currentTick - (state.tidied ?? -100) > 40) {
        state.tidied = system.currentTick;
        const out = new Set(here.map((e) => prop(e, PASTURE_SLOT)));
        for (let n = 0; n < PC_BOXES; n++) {
            const c = box(player, n);
            let changed = false;
            c.forEach((rec, i) => { if (rec?.p === key && !out.has(`${n}:${i}`)) { delete rec.p; changed = true; } });
            if (changed) saveBox(player, n, c);
        }
    }
    const pages = Math.max(1, Math.ceil(here.length / 4));
    state.page %= pages;
    const contents = box(player, state.box), sel = state.sel;
    const v = { box: `Box ${state.box + 1}`, item: `${PC_UI}/summary/blank`, count: num(`${here.length}/${PASTURE_LIMIT}`) };
    if (sel) pcInfo(v, box(player, sel.box)[sel.slot], null); else pcInfo(v, null, null);
    for (let n = 0; n < 30; n++) {
        v[`b${n}`] = iconOf(contents[n]?.t); v[`s${n}`] = sel && sel.box === state.box && sel.slot === n ? "y" : "n";
        v[`q${n}`] = contents[n]?.p ? "y" : "n";
    }
    const shown = here.slice(state.page * 4, state.page * 4 + 4);
    for (let n = 0; n < 4; n++) {
        const e = shown[n];
        if (!e) { Object.assign(v, { [`r${n}icon`]: "i----", [`r${n}gender`]: "o", [`r${n}slot`]: "e", [`r${n}move`]: "n" }); continue; }
        const own = prop(e, OWNER) === player.id, info = POKEMON[e.typeId];
        Object.assign(v, {
            [`r${n}icon`]: iconOf(e.typeId), [`r${n}level`]: `Lv. ${prop(e, LEVEL) ?? info.level}`,
            [`r${n}name`]: nicknameOf(e) || info.name,
            [`r${n}gender`]: { male: "m", female: "f" }[genderOf(e)] ?? "o", [`r${n}slot`]: own ? "o" : "n", [`r${n}move`]: own ? "y" : "n",
        });
    }
    const body = PC_LAYOUT.map(([k, width]) => (width ? padBytes(v[k] ?? "", width) : v[k] ?? "")).join("");
    const form = new ActionFormData().title("cbm:pasture").body(body);
    for (let n = 0; n < 30; n++) form.button("slot", `${PC_UI}/pc/slot${v[`s${n}`] === "y" ? "_on" : ""}`);
    form.button("prev", `${PC_UI}/pc/prev`).button("next", `${PC_UI}/pc/next`).button("exit", `${PC_UI}/summary/exit`);
    for (let n = 0; n < 4; n++) form.button("row", `${PC_UI}/pc/row_${v[`r${n}slot`]}`);
    form.button("recall", `${PC_UI}/pc/recall_all`).button("page", `${PC_UI}/pc/page`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 32) return;
        const pick = r.selection, again = (delay = 0) => system.runTimeout(() => openPasture(block, player, state), delay);
        if (pick === 30 || pick === 31) { state.box = (state.box + (pick === 31 ? 1 : PC_BOXES - 1)) % PC_BOXES; again(); return; }
        if (pick === 38) { state.page = (state.page + 1) % pages; again(); return; }
        if (pick === 37) {
            for (const e of here) if (prop(e, OWNER) === player.id) recall(player, e, block);
            again(14); return;
        }
        if (pick < 30) {
            const rec = contents[pick];
            state.sel = rec && !rec.p && !(sel && sel.box === state.box && sel.slot === pick) ? { box: state.box, slot: pick } : null;
            if (rec?.p) player.sendMessage("§7That Pokemon is already out in a pasture.");
            again(); return;
        }
        const row = shown[pick - 33];
        if (row) {
            if (prop(row, OWNER) === player.id) { recall(player, row, block); again(14); }
            else { player.sendMessage("§7That Pokemon isn't yours."); again(); }
            return;
        }
        if (!sel) { again(); return; }
        if (here.length >= PASTURE_LIMIT) { player.sendMessage(`§cThis pasture already has ${PASTURE_LIMIT} Pokemon.`); again(); return; }
        const pcBox = box(player, sel.box), rec = pcBox[sel.slot];
        state.sel = null;
        if (!rec || rec.p) { again(); return; }
        const at = { x: block.location.x + 0.5 + (Math.random() * 4 - 2), y: block.location.y, z: block.location.z + 0.5 + (Math.random() * 4 - 2) };
        let entity;
        try { entity = spawnStored(player, rec, at); } catch (e) { player.sendMessage("§cThat Pokemon could not come out here."); again(); return; }
        system.run(() => {
            try { entity.triggerEvent("cobblemon:pasture"); setProp(entity, PASTURE_SLOT, `${sel.box}:${sel.slot}`); setProp(entity, PASTURE_AT, key); } catch (e) { }
        });
        rec.p = key; saveBox(player, sel.box, pcBox);
        setPastureLamp(block, true);
        again(14);
    }).catch(() => { });
}

// back into its PC slot, carrying what changed while it was out (its health, a name given to it)
function recall(player, entity, block) {
    const [n, slot] = String(prop(entity, PASTURE_SLOT) ?? "").split(":").map(Number);
    if (!(n >= 0) || !(slot >= 0)) { try { entity.remove(); } catch (e) { } return; }
    const contents = box(player, n);
    contents[slot] = { ...snapshot(entity) };
    saveBox(player, n, contents);
    player.sendMessage(`§a${describe(contents[slot])} is back in Box ${n + 1}.`);
    recallEffect(player, entity, () => {
        try { entity.remove(); } catch (e) { }
        if (block && !pasturedHere(block.dimension, pastureKey(block), block.location).filter((e) => e.isValid).length) setPastureLamp(block, false);
    });
}

// a broken pasture brings its Pokemon back: into their owners' PCs if they are online, and otherwise the next
// time they use a PC or pasture (tidyPastured)
function emptyPasture(dimension, key, location) {
    for (const e of pasturedHere(dimension, key, location)) {
        const owner = world.getPlayers().find((p) => p.id === prop(e, OWNER));
        if (owner) recall(owner, e); else { try { e.remove(); } catch (err) { } }
    }
}

// Fishing with a Poke Rod, after PokeRodFishingBobberEntity. Using the rod casts its ball as a bobber; using it
// again reels in. Once the bobber floats, a wait of 100 to 600 ticks runs down (faster by the rod's Lure level),
// then something swims up for 20 to 80 ticks and bites: 85 times in 100 a Pokemon, chosen by rarity bucket and
// then weight from the fishing spawns this biome, depth, sky, weather, time and Lure allow; otherwise an item.
// Reeling in during the bite (a Pokemon's window is 15 to 40 ticks by rarity, an item's 20 to 40) lands it: the
// Pokemon comes out of the water at the level its spawn gives, pulled to the player unless it weighs 90 kg or
// more; an item comes from the Poke Rod table, junk 66, Cobblemon treasure 17, vanilla treasure 17.
const fishing = new Map();   // player id -> cast
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function filterPasses(filter, tags) {
    if (!filter) return true;
    if (filter.all_of) return filter.all_of.every((f) => filterPasses(f, tags));
    if (filter.any_of) return filter.any_of.some((f) => filterPasses(f, tags));
    if (filter.none_of) return !filter.none_of.some((f) => filterPasses(f, tags));
    if (filter.test === "has_biome_tag") return tags.includes(filter.value) === (filter.operator !== "!=");
    return true;
}

function lureLevel(item) {
    try { return item.getComponent("minecraft:enchantable")?.getEnchantment("lure")?.level ?? 0; } catch (e) { return 0; }
}

// Cobblemon's time ranges, in ticks of the day, are TIME_RANGES from data.js (TimeRange.kt)

function spawnAllowed(spawn, cast, bobber, tags) {
    const at = bobber.location;
    if (!filterPasses(spawn.biome, tags) || (spawn.notBiome && filterPasses(spawn.notBiome, tags))) return false;
    if (spawn.minLureLevel !== undefined && cast.lure < spawn.minLureLevel) return false;
    if (spawn.maxLureLevel !== undefined && cast.lure > spawn.maxLureLevel) return false;
    if (spawn.minY !== undefined && at.y < spawn.minY) return false;
    if (spawn.maxY !== undefined && at.y > spawn.maxY) return false;
    if (spawn.bait) return false;   // bait is not ported
    if (spawn.rodType && ![].concat(spawn.rodType).some((r) => cast.rod === r || cast.rod === `cobblemon:${r}`)) return false;
    if (spawn.isRaining !== undefined) {
        let raining = false;
        try { raining = bobber.dimension.getWeather() !== "Clear"; } catch (e) { }
        if (raining !== spawn.isRaining) return false;
    }
    if (spawn.canSeeSky !== undefined) {
        let sky = true;
        try { const top = bobber.dimension.getTopmostBlock({ x: at.x, z: at.z }); sky = !top || top.location.y <= at.y + 1; } catch (e) { }
        if (sky !== spawn.canSeeSky) return false;
    }
    if (spawn.timeRange) {
        const t = world.getTimeOfDay(), ranges = [].concat(spawn.timeRange).flatMap((r) => TIME_RANGES[r] ?? []);
        if (ranges.length && !ranges.some(([a, b]) => t >= a && t <= b)) return false;
    }
    if (spawn.moonPhase !== undefined) {
        const phase = world.getMoonPhase();
        const ok = String(spawn.moonPhase).split(",").some((part) => {
            const [a, b] = part.split("-").map(Number);
            return b === undefined ? phase === a : phase >= a && phase <= b;
        });
        if (!ok) return false;
    }
    return true;
}

// the Pokemon on the line: a rarity bucket by Cobblemon's weights, then a spawn in it by weight
function planSpawn(cast, bobber) {
    let tags = [];
    try { tags = BIOME_TAGS[bobber.dimension.getBiome(bobber.location).id] ?? []; } catch (e) { }
    const allowed = FISHING_SPAWNS.filter((sp) => spawnAllowed(sp, cast, bobber, tags));
    if (!allowed.length) return undefined;
    const present = Object.entries(BUCKETS).filter(([b]) => allowed.some((sp) => sp.bucket === b));
    const bucket = pick(present)[0];
    const inBucket = allowed.filter((sp) => sp.bucket === bucket).map((sp) => [sp, sp.weight]);
    return { spawn: pick(inBucket)[0], bucketWeight: BUCKETS[bucket] };
}

function castRod(player, item) {
    const eye = player.getHeadLocation(), d = player.getViewDirection();
    let bobber;
    try { bobber = player.dimension.spawnEntity("cobblemon:poke_bobber", { x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6, z: eye.z + d.z * 0.6 }); } catch (e) { return; }
    system.run(() => {
        try {
            bobber.triggerEvent(`cobblemon:ball_${RODS[item.typeId] ?? 0}`);
            bobber.applyImpulse({ x: d.x * 0.9, y: d.y * 0.9 + 0.2, z: d.z * 0.9 });
        } catch (e) { }
    });
    try { player.playSound("random.bow", { pitch: 0.6 }); } catch (e) { }
    fishing.set(player.id, { player, bobber, rod: item.typeId, lure: lureLevel(item), phase: "flying", wait: ri(100, 600), travel: 0, hook: 0, catch: null, age: 0 });
}

function endCast(cast) {
    fishing.delete(cast.player.id);
    try { if (cast.bobber.isValid) cast.bobber.remove(); } catch (e) { }
}

function damageRod(player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, slot = player.selectedSlotIndex, item = inv?.getItem(slot);
    const dur = item?.getComponent("minecraft:durability");
    if (!dur) return;
    if (dur.damage + 1 >= dur.maxDurability) { inv.setItem(slot, undefined); try { player.playSound("random.break"); } catch (e) { } }
    else { dur.damage += 1; inv.setItem(slot, item); }
}

function reel(cast) {
    const { player, bobber } = cast;
    if (cast.phase !== "bite" || !bobber.isValid) { endCast(cast); return; }
    const at = { ...bobber.location }, dim = bobber.dimension;
    endCast(cast);
    damageRod(player);
    if (cast.catch) {
        const { spawn } = cast.catch;
        let pokemon;
        try { pokemon = dim.spawnEntity(spawn.entity, { x: at.x, y: at.y + 0.5, z: at.z }); } catch (e) { return; }
        const level = ri(spawn.level[0], spawn.level[1]);
        system.run(() => {
            try {
                setProp(pokemon, LEVEL, level);
                if ((POKEMON[spawn.entity]?.weight ?? 0) < 900) {   // lighter than 90 kg: pulled to the player
                    const p = player.location, dx = p.x - at.x, dz = p.z - at.z, len = Math.hypot(dx, dz) || 1;
                    pokemon.applyImpulse({ x: (dx / len) * Math.min(1.6, len * 0.12), y: 0.55, z: (dz / len) * Math.min(1.6, len * 0.12) });
                }
            } catch (e) { }
        });
        player.sendMessage(`§bYou fished up a wild ${POKEMON[spawn.entity]?.name ?? "Pokemon"}! §7(Lv ${level})`);
        register(player, spawn.entity, 1);
        try { player.playSound("random.splash"); } catch (e) { }
        return;
    }
    // an item: the Poke Rod table
    const p = player.location, roll = Math.random() * 100;
    try {
        if (roll < 66) dim.runCommand(`loot spawn ${p.x} ${p.y} ${p.z} loot "gameplay/fishing/junk"`);
        else if (roll < 83) dim.spawnItem(new ItemStack(ROD_TREASURE[Math.floor(Math.random() * ROD_TREASURE.length)], 1), p);
        else {
            dim.runCommand(`loot spawn ${p.x} ${p.y} ${p.z} loot "gameplay/fishing/treasure"`);
            if (Math.random() < 0.167) dim.spawnItem(new ItemStack("cobblemon:pokerod_smithing_template", 1), p);
        }
        dim.spawnEntity("minecraft:xp_orb", p);
    } catch (e) { }
}

// a rod's use is long so that a click counts; the cast or reel happens as the use starts, and the use is cut short
// each click on a rod starts a use (its long use_duration makes the click count as one); that start casts or reels
world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack || RODS[itemStack.typeId] === undefined) return;
    const cast = fishing.get(player.id);
    if (cast) reel(cast); else castRod(player, itemStack);
});

system.runInterval(() => {
    for (const cast of fishing.values()) {
        const { player, bobber } = cast;
        cast.age++;
        let held;
        try { held = player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex)?.typeId; } catch (e) { }
        if (!player.isValid || !bobber.isValid || held !== cast.rod || cast.age > 20 * 300) { endCast(cast); continue; }
        const b = bobber.location, p = player.location;
        if (Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z) > 32) { endCast(cast); continue; }
        if (cast.phase === "flying") { if (bobber.isInWater) cast.phase = "waiting"; else if (cast.age > 100 && bobber.isOnGround) endCast(cast); continue; }
        if (cast.phase === "waiting") {
            cast.wait -= 1 + cast.lure;
            if (cast.wait <= 0) { cast.phase = "travel"; cast.travel = ri(20, 80); }
        } else if (cast.phase === "travel") {
            if (--cast.travel <= 0) {
                cast.catch = Math.random() * 100 < 85 ? planSpawn(cast, bobber) : null;
                if (cast.catch) {
                    const w = cast.catch.bucketWeight;
                    cast.hook = ri(Math.max(15, Math.min(20, Math.floor(15 + 0.05 * w))), Math.max(20, Math.min(40, Math.floor(20 + 0.2 * w))));
                } else cast.hook = ri(20, 40);
                cast.phase = "bite";
                try {
                    bobber.teleport({ x: b.x, y: b.y - 0.25, z: b.z });
                    bobber.dimension.playSound("random.splash", b, { volume: 0.6 });
                    bobber.dimension.spawnParticle("minecraft:water_splash_particle_manual", { x: b.x, y: b.y + 0.1, z: b.z });
                } catch (e) { }
            }
        } else if (cast.phase === "bite") {
            if (--cast.hook <= 0) { cast.phase = "waiting"; cast.wait = ri(100, 600); cast.catch = null; }
        }
        if (cast.phase === "bite" && cast.hook % 5 === 0) {
            try { bobber.dimension.spawnParticle("minecraft:water_splash_particle_manual", { x: b.x, y: b.y + 0.1, z: b.z }); } catch (e) { }
        }
    }
}, 1);

// The Pokedex. Each player's register is one dynamic property, a character per National dex entry: 0 unknown,
// 1 seen, 2 caught. A Pokemon is seen when the player battles it, scans it with a Pokedex or fishes it up, and
// caught when it becomes theirs (a claim, a capture, a revival, an evolution) or they hold it in a filled ball.
// Using a Pokedex while looking at a Pokemon within 12 blocks scans it; otherwise it opens the register.
const DEX = "cobblemon:dex", DEX_INDEX = new Map(NATIONAL.map((id, n) => [id, n]));

function dexString(player) {
    const s = String(player.getDynamicProperty(DEX) ?? "");
    return s.length >= NATIONAL.length ? s : s.padEnd(NATIONAL.length, "0");
}

function dexStatus(player, typeId) {
    const n = DEX_INDEX.get(typeId);
    return n === undefined ? 0 : Number(dexString(player)[n]);
}

function register(player, typeId, status) {
    const n = DEX_INDEX.get(typeId);
    if (n === undefined || !player?.isValid) return;
    const s = dexString(player);
    if (Number(s[n]) >= status) return;
    player.setDynamicProperty(DEX, s.slice(0, n) + status + s.slice(n + 1));
    const name = POKEMON[typeId]?.name ?? typeId;
    if (status === 2) player.sendMessage(`§b${name}'s data was added to the Pokedex.`);
}

// the owner of a Pokemon that just became theirs; used wherever ownership is set
function registerOwned(entity) {
    const owner = world.getPlayers().find((p) => p.id === prop(entity, OWNER));
    if (owner) register(owner, entity.typeId, 2);
}

// filled balls in an inventory count as caught; checked every few seconds
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
        if (!inv) continue;
        for (let i = 0; i < inv.size; i++) {
            const id = inv.getItem(i)?.typeId;
            if (id?.startsWith("cobblemon:poke_ball_")) register(player, `cobblemon:p${id.slice("cobblemon:poke_ball_".length)}`, 2);
        }
    }
}, 60);


// The Pokedex, laid out by ui/server_form.json on Cobblemon's Pokedex textures (DEX_LAYOUT in port.py): the region
// and its arrows, a page of 25 entries, and the chosen entry with its Info, Abilities and Stats tabs and the cry.
const DEX_FILTERS = [["All", () => true], ["Seen", (st) => st !== "0"], ["Owned", (st) => st === "2"], ["Unregistered", (st) => st === "0"]];
function openDex(player, colour = "red", state = { region: 0, page: 0, filter: 0, chosen: null, tab: "i" }) {
    const s = dexString(player), region = REGIONS[state.region];
    const entries = region.entries.filter((n) => DEX_FILTERS[state.filter][1](s[n]));
    const pages = Math.max(1, Math.ceil(entries.length / 25));
    state.page = Math.min(state.page, pages - 1);
    const shown = entries.slice(state.page * 25, state.page * 25 + 25);
    const v = {
        colour: { red: "r", blue: "b", green: "g", pink: "p", yellow: "y", black: "k", white: "w" }[colour] ?? "r", region: region.name, filter: DEX_FILTERS[state.filter][0],
        seen: num(region.entries.filter((n) => s[n] !== "0").length), caught: num(region.entries.filter((n) => s[n] === "2").length),
    };
    for (let i = 0; i < 25; i++) {
        const n = shown[i];
        if (n === undefined) { Object.assign(v, { [`e${i}icon`]: "i----", [`e${i}state`]: "s", [`e${i}sel`]: "n" }); continue; }
        const id = NATIONAL[n], st = s[n];
        Object.assign(v, {
            [`e${i}icon`]: st === "0" ? "i----" : iconOf(id), [`e${i}num`]: num(String(DEX_INFO[id]?.n ?? n + 1).padStart(4, "0")),
            [`e${i}state`]: st === "0" ? "u" : st === "2" ? "c" : "s", [`e${i}sel`]: state.chosen === n ? "y" : "n",
        });
    }
    const chosen = state.chosen;
    if (chosen !== null) {
        const id = NATIONAL[chosen], st = s[chosen], info = DEX_INFO[id] ?? {}, species = POKEMON[id];
        v.num = num(String(info.n ?? chosen + 1).padStart(4, "0"));
        v.name = st === "0" ? "???" : species.name;
        v.caughtmark = st === "2" ? "y" : "n";
        v.type1 = st === "0" ? "t--" : typeCode(species.types[0]); v.type2 = st === "0" ? "t--" : typeCode(species.types[1]);
        v.portrait = st === "0" ? "i----" : iconOf(id);
        v.platform = st === "0" ? "p--" : `p${typeCode(species.types[0]).slice(1)}`;
        v.tab = state.tab;
        if (st === "2" && state.tab === "i") v.desc = info.d ?? "";
        if (st === "2" && state.tab === "a") {
            v.line1 = `Abilities: ${(species.abilities ?? [species.ability]).map(abilityName).join(", ")}`;
            v.line2 = species.hidden?.length ? `Hidden: ${species.hidden.map(abilityName).join(", ")}` : "";
        }
        if (st === "2" && state.tab === "s") for (const k of STAT_KEYS) v[`stat${k}`] = `${STAT_NAMES[k]} ${species.stats[k]}`;
        if (st !== "2") v.line1 = st === "0" ? "Not yet seen." : "Seen, not yet caught.";
    } else { Object.assign(v, { caughtmark: "n", type1: "t--", type2: "t--", portrait: "i----", platform: "p--", tab: "x" }); }
    const body = DEX_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:pokedex").body(body);
    for (let i = 0; i < 25; i++) form.button("entry", `${PC_UI}/pokedex/slot${v[`e${i}sel`] === "y" ? "_on" : ""}`);
    form.button("up", `${PC_UI}/pokedex/arrow_up`).button("down", `${PC_UI}/pokedex/arrow_down`);
    form.button("page up", `${PC_UI}/pokedex/arrow_up`).button("page down", `${PC_UI}/pokedex/arrow_down`);
    for (const [letter, name] of [["i", "info"], ["a", "abilities"], ["s", "stats"]]) form.button(name, `${PC_UI}/pokedex/tab_${name}${state.tab === letter ? "_on" : ""}`);
    form.button("cry", `${PC_UI}/pokedex/${chosen !== null && s[chosen] !== "0" ? "cry" : "none"}`);
    form.button("filter", `${PC_UI}/pokedex/filter`);
    form.show(player).then((r) => {
        if (r.canceled) return;
        const pick = r.selection, again = () => openDex(player, colour, state);
        if (pick < 25) { if (shown[pick] !== undefined) state.chosen = shown[pick]; }
        else if (pick === 25 || pick === 26) { state.region = (state.region + (pick === 26 ? 1 : REGIONS.length - 1)) % REGIONS.length; state.page = 0; }
        else if (pick === 27) state.page = (state.page + pages - 1) % pages;
        else if (pick === 28) state.page = (state.page + 1) % pages;
        else if (pick <= 31) state.tab = "ias"[pick - 29];
        else if (pick === 32 && chosen !== null) { const cry = POKEMON[NATIONAL[chosen]]?.cry; if (cry) try { player.playSound(cry); } catch (e) { } }
        else if (pick === 33) { state.filter = (state.filter + 1) % DEX_FILTERS.length; state.page = 0; }
        again();
    }).catch(() => { });
}

function scan(player, entity, colour) {
    register(player, entity.typeId, prop(entity, OWNER) === player.id ? 2 : 1);
    try { player.playSound("random.orb", { pitch: 1.5 }); } catch (e) { }
    const n = DEX_INDEX.get(entity.typeId), at = REGIONS[0].entries.indexOf(n);
    openDex(player, colour, { region: 0, page: Math.max(0, Math.floor(at / 25)), filter: 0, chosen: n ?? null, tab: "i" });
}

// right-clicking a Pokemon with a Pokedex scans it (in place of its panel); right-clicking anything else opens the register
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!event.itemStack?.typeId.startsWith("cobblemon:pokedex_") || !POKEMON[event.target.typeId]) return;
    event.cancel = true;
    const { player, target } = event;
    const colour = event.itemStack.typeId.slice("cobblemon:pokedex_".length);
    system.run(() => scan(player, target, colour));
});
world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack?.typeId.startsWith("cobblemon:pokedex_")) return;
    const hit = player.getEntitiesFromViewDirection({ maxDistance: 12 }).find((h) => POKEMON[h.entity.typeId]);
    const colour = itemStack.typeId.slice("cobblemon:pokedex_".length);
    if (hit) scan(player, hit.entity, colour); else openDex(player, colour);
});

// Apricorns (ApricornBlock): a fruit ripens a stage on one random tick in five; used when ripe it drops its apricorn,
// and a sprout one time in ten, and starts again; broken when ripe it drops the same; bone meal ripens it a stage.
// A sapling grows into a tree on one random tick in seven, or at once from bone meal 45 times in 100, placing one
// of the grown-tree structures of its colour. An axe strips an apricorn log or wood.
function colourOf(typeId) { return typeId.slice("cobblemon:".length).split("_")[0]; }

function holding(player, typeId) {
    try { return player.getComponent(EntityComponentTypes.Inventory).container.getItem(player.selectedSlotIndex)?.typeId === typeId; } catch (e) { return false; }
}

function pickApricorn(block, dimension) {
    const colour = colourOf(block.typeId), at = { x: block.location.x + 0.5, y: block.location.y + 0.3, z: block.location.z + 0.5 };
    dimension.spawnItem(new ItemStack(`cobblemon:${colour}_apricorn`, 1), at);
    if (Math.random() < 0.1) dimension.spawnItem(new ItemStack(`cobblemon:${colour}_apricorn_seed`, 1), at);
}

function growTree(block) {
    const colour = colourOf(block.typeId), n = Math.floor(Math.random() * APRICORN_TREES.variants);
    const name = `apricorn_tree_${colour}_grown_${n}`, [ox, oy, oz] = APRICORN_TREES.origins[name];
    const { x, y, z } = block.location;
    block.setType("minecraft:air");
    try { world.structureManager.place(`cobblemon:${name}`, block.dimension, { x: x + ox, y: y + oy, z: z + oz }, { includeEntities: false }); }
    catch (e) { console.warn(`[cobblemon] apricorn tree: ${e}`); block.setType(`cobblemon:${colour}_apricorn_sapling`); }
}

function useBoneMeal(player) {
    if (player.getGameMode?.() === "Creative") return;
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, slot = player.selectedSlotIndex, item = inv?.getItem(slot);
    if (!item) return;
    if (item.amount > 1) { item.amount--; inv.setItem(slot, item); } else inv.setItem(slot, undefined);
}

// Wood pieces. Fences and walls join whatever they touch that they would join in Java: their own kind, fence
// gates for a fence, and full solid blocks; each side is a block state the model shows as an arm. Doors, trapdoors
// and fence gates open and shut on a click; a button stays pressed for 30 ticks and a pressure plate while something
// stands on it, powering redstone meanwhile.
const JOINING = /^cobblemon:.*_(fence|wall)$/;
const NOT_SOLID = /(slab|stairs|door|button|pressure_plate|sign|torch|flower|sapling|carpet|rail|ladder|vine|leaves|glass_pane|bars|bush|berry|apricorn$|grass$|fern|air|water|lava|snow_layer|chain|lantern|candle)/;

function joins(kind, other) {
    if (!other || other.isAir || other.isLiquid) return false;
    const t = other.typeId;
    if (kind === "fence" && (t.endsWith("_fence") || t.endsWith("fence_gate"))) return true;
    if (kind === "wall" && t.endsWith("_wall")) return true;
    if (t.startsWith("cobblemon:")) return false;
    return !NOT_SOLID.test(t);
}

function joinFence(block) {
    if (!block || !JOINING.test(block.typeId)) return;
    const kind = block.typeId.endsWith("_wall") ? "wall" : "fence";
    let perm = block.permutation;
    for (const [side, other] of [["north", block.north()], ["east", block.east()], ["south", block.south()], ["west", block.west()]]) {
        perm = perm.withState(`cobblemon:${side}`, joins(kind, other));
    }
    block.setPermutation(perm);
}

function joinAround(block) {
    for (const b of [block, block.north(), block.east(), block.south(), block.west()]) { try { joinFence(b); } catch (e) { } }
}

function toggleOpen(block, sound) {
    const open = !block.permutation.getState("cobblemon:open");
    block.setPermutation(block.permutation.withState("cobblemon:open", open));
    try { block.dimension.playSound(open ? `open.${sound}` : `close.${sound}`, block.location); } catch (e) { }
    return open;
}

// Shears or Silk Touch keep Cobblemon's leaves as the leaves block, as its loot tables say; Bedrock loot cannot
// tell those tools from the rest, so the break is taken over here
function silkTouch(item) {
    try { return (item?.getComponent("minecraft:enchantable")?.getEnchantment("silk_touch")?.level ?? 0) > 0; } catch (e) { return false; }
}
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { block, player, itemStack } = event, id = block.typeId;
    if (!id.startsWith("cobblemon:") || !id.endsWith("_leaves")) return;
    if (itemStack?.typeId !== "minecraft:shears" && !silkTouch(itemStack)) return;
    event.cancel = true;
    const where = block.location, dim = block.dimension;
    system.run(() => {
        const b = dim.getBlock(where);
        if (b?.typeId !== id) return;
        b.setType("minecraft:air");
        try { dim.playSound("dig.grass", where); } catch (e) { }
        if (player.getGameMode?.() !== "Creative") dim.spawnItem(new ItemStack(id, 1), { x: where.x + 0.5, y: where.y + 0.5, z: where.z + 0.5 });
    });
});

// a click on a button does not always reach its component, as with bone meal, so the interaction event presses it too
function pressButton(block) {
    if (!block?.typeId.endsWith("_button") || !block.typeId.startsWith("cobblemon:") || block.permutation.getState("cobblemon:powered")) return;
    const type = block.typeId, where = block.location, dim = block.dimension;
    block.setPermutation(block.permutation.withState("cobblemon:powered", true));
    try { dim.playSound("click_on.wooden_button", where); } catch (e) { }
    system.runTimeout(() => {
        const b = dim.getBlock(where);
        if (b?.typeId !== type) return;
        b.setPermutation(b.permutation.withState("cobblemon:powered", false));
        try { dim.playSound("click_off.wooden_button", where); } catch (e) { }
    }, 30);
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!event.isFirstEvent || !event.block.typeId.endsWith("_button") || !event.block.typeId.startsWith("cobblemon:")) return;
    const block = event.block;
    system.run(() => pressButton(block));
});

function plateCheck(block) {
    if (!block?.typeId?.endsWith("_pressure_plate")) return;   // a step off can come after the plate is broken
    const { x, y, z } = block.location;
    let on = false;
    // anything whose feet are on the plate: over its 14 pixels and no more than a step above it. A wooden plate,
    // as Cobblemon's apricorn and saccharine ones are, is pressed by items too
    try {
        on = block.dimension.getEntities({ location: { x: x + 0.5, y, z: z + 0.5 }, maxDistance: 1.5 }).some((e) => {
            const p = e.location;
            return p.x >= x + 0.0625 && p.x <= x + 0.9375 && p.z >= z + 0.0625 && p.z <= z + 0.9375 && p.y >= y - 0.05 && p.y <= y + 0.5;
        });
    } catch (e) { }
    if (on === block.permutation.getState("cobblemon:powered")) return;
    block.setPermutation(block.permutation.withState("cobblemon:powered", on));
    try { block.dimension.playSound(on ? "click_on.wooden_pressure_plate" : "click_off.wooden_pressure_plate", block.location); } catch (e) { }
}

// Model blocks: a stack of placed items grows when the same item is used on it (up to the blockstate's amounts),
// a crop grows a stage on random ticks as Cobblemon's mints and grains do, and an open state toggles on a click
function registerModelBlockComponents(registry) {
    registry.registerCustomComponent("cobblemon:stackable", {
        onPlayerInteract({ block, player }) {
            if (!player) return;
            const item = block.typeId.replace(/_block$/, ""), hand = player.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex);
            if (hand?.typeId !== item) return;
            const amount = block.permutation.getState("cobblemon:amount");
            let next;
            try { next = block.permutation.withState("cobblemon:amount", amount + 1); } catch (e) { return; }   // already a full stack
            block.setPermutation(next); consumeHand(player);
        }
    });
    registry.registerCustomComponent("cobblemon:grows", {
        onRandomTick({ block }) {
            let half;
            try { half = block.permutation.getState("cobblemon:half"); } catch (e) { }
            if (half === "upper") return;   // a tall crop grows from its lower half, which carries the upper along
            const age = block.permutation.getState("cobblemon:age");
            if (Math.random() >= 0.2) return;
            let next;
            try { next = block.permutation.withState("cobblemon:age", age + 1); } catch (e) { return; }   // fully grown
            block.setPermutation(next);
            // Hearty Grains: from stage 4 the crop stands two blocks tall
            if (half === "lower" && age + 1 >= 4) {
                const above = block.above();
                if (above && (above.isAir || above.typeId === block.typeId)) {
                    try { above.setPermutation(next.withState("cobblemon:half", "upper")); } catch (e) { }
                }
            }
        }
    });
    registry.registerCustomComponent("cobblemon:openable", {
        onPlayerInteract({ block }) {
            const open = !block.permutation.getState("cobblemon:open");
            block.setPermutation(block.permutation.withState("cobblemon:open", open));
            try { block.dimension.playSound(open ? "random.chestopen" : "random.chestclosed", block.location); } catch (e) { }
        }
    });
}

// Gilded chests: the block Cobblemon's item places becomes a chest entity with Cobblemon's model and 27 slots
// (a Bedrock custom block holds no items). The lid opens when a player uses it and shuts when nobody is near.
const CHEST_TURN = { north: 180, south: 0, east: 270, west: 90 };
function chestFromBlock(block) {
    if (!/^cobblemon:(\w+_)?gilded_chest$/.test(block?.typeId ?? "")) return null;
    let facing = "north";
    try { facing = block.permutation.getState("minecraft:cardinal_direction") ?? "north"; } catch (e) { }
    const { x, y, z } = block.location, dim = block.dimension, id = `${block.typeId}_entity`;
    block.setType("minecraft:air");
    const chest = dim.spawnEntity(id, { x: x + 0.5, y, z: z + 0.5 });
    try { chest.setRotation({ x: 0, y: CHEST_TURN[facing] ?? 0 }); } catch (e) { }
    // the chest screen takes its title from the entity's name
    try { chest.nameTag = itemName(id.replace(/_entity$/, "")); } catch (e) { }
    return chest;
}
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => { if (/gilded_chest$/.test(block.typeId)) chestFromBlock(block); });
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!/^cobblemon:(\w+_)?gilded_chest$/.test(event.block.typeId) || !event.isFirstEvent) return;
    event.cancel = true;   // a chest block a structure placed becomes the chest on first use
    const block = event.block;
    system.run(() => chestFromBlock(block));
});
world.afterEvents.playerInteractWithEntity.subscribe(({ target }) => {
    if (!target.typeId.endsWith("gilded_chest_entity")) return;
    try { if (!target.getProperty("cobblemon:open")) { target.setProperty("cobblemon:open", true); target.dimension.playSound("random.chestopen", target.location); } } catch (e) { }
});
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        let chests;
        try { chests = player.dimension.getEntities({ families: ["gilded_chest"], location: player.location, maxDistance: 16 }); } catch (e) { continue; }
        for (const c of chests) {
            if (!c.getProperty("cobblemon:open")) continue;
            const near = c.dimension.getPlayers({ location: c.location, maxDistance: 4 }).length > 0;
            if (!near) { c.setProperty("cobblemon:open", false); try { c.dimension.playSound("random.chestclosed", c.location); } catch (e) { } }
        }
    }
}, 10);

function registerWoodComponents(registry) {
    registry.registerCustomComponent("cobblemon:door", {
        onPlayerInteract({ block }) {
            const open = toggleOpen(block, "wooden_door");
            const other = block.permutation.getState("minecraft:multi_block_part") === 0 ? block.above() : block.below();
            if (other?.typeId === block.typeId) other.setPermutation(other.permutation.withState("cobblemon:open", open));
        }
    });
    registry.registerCustomComponent("cobblemon:trapdoor", { onPlayerInteract({ block }) { toggleOpen(block, "wooden_trapdoor"); } });
    registry.registerCustomComponent("cobblemon:fence_gate", { onPlayerInteract({ block }) { toggleOpen(block, "fence_gate"); } });
    registry.registerCustomComponent("cobblemon:button", { onPlayerInteract({ block }) { pressButton(block); } });
    registry.registerCustomComponent("cobblemon:pressure_plate", {
        onStepOn({ block }) { plateCheck(block); },
        onStepOff({ block }) { plateCheck(block); },
        // every half second, as Java checks a pressed plate: pressed while any entity stands on it
        onTick({ block }) { plateCheck(block); }
    });
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => joinAround(block));
world.afterEvents.playerBreakBlock.subscribe(({ block }) => joinAround(block));

function registerApricornComponents(registry) {
    registry.registerCustomComponent("cobblemon:apricorn", {
        onRandomTick({ block }) {
            const age = block.permutation.getState("cobblemon:age");
            if (age < 3 && Math.random() < 0.2) block.setPermutation(block.permutation.withState("cobblemon:age", age + 1));
        },
        onPlayerInteract({ block, player }) {
            const age = block.permutation.getState("cobblemon:age");
            if (age !== 3 || (player && holding(player, "minecraft:bone_meal"))) return;
            pickApricorn(block, block.dimension);
            block.setPermutation(block.permutation.withState("cobblemon:age", 0));
            try { block.dimension.playSound("block.sweet_berry_bush.pick", block.location); } catch (e) { }
        }
    });
    registry.registerCustomComponent("cobblemon:apricorn_sapling", {
        onRandomTick({ block }) { if (Math.random() < 1 / 7) growTree(block); }
    });
    registry.registerCustomComponent("cobblemon:strippable", {
        onPlayerInteract({ block, player }) {
            if (!player) return;
            let tool;
            try { tool = player.getComponent(EntityComponentTypes.Inventory).container.getItem(player.selectedSlotIndex)?.typeId; } catch (e) { }
            if (!tool?.endsWith("_axe")) return;
            const stripped = block.typeId.replace("cobblemon:", "cobblemon:stripped_");
            const face = block.permutation.getState("minecraft:block_face");
            block.setType(stripped);
            try { block.setPermutation(block.permutation.withState("minecraft:block_face", face)); } catch (e) { }
            try { block.dimension.playSound("use.wood", block.location); } catch (e) { }
        }
    });
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack } = event;
    if (itemStack?.typeId !== "minecraft:bone_meal") return;
    const sapling = /^cobblemon:[a-z]+_apricorn_sapling$/.test(block.typeId), fruit = /^cobblemon:[a-z]+_apricorn$/.test(block.typeId);
    if (!sapling && !fruit) return;
    if (fruit && block.permutation.getState("cobblemon:age") >= 3) return;
    event.cancel = true;
    system.run(() => {
        if (!block.isValid) return;
        useBoneMeal(player);
        try { block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center()); } catch (e) { }
        if (fruit) block.setPermutation(block.permutation.withState("cobblemon:age", block.permutation.getState("cobblemon:age") + 1));
        else if (Math.random() < 0.45) growTree(block);
    });
});

// a ripe fruit broken by a player drops its apricorn as it would have been picked
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    const id = brokenBlockPermutation.type.id;
    if (!/^cobblemon:[a-z]+_apricorn$/.test(id) || brokenBlockPermutation.getState("cobblemon:age") !== 3) return;
    const colour = colourOf(id), at = { x: block.location.x + 0.5, y: block.location.y + 0.3, z: block.location.z + 0.5 };
    block.dimension.spawnItem(new ItemStack(`cobblemon:${colour}_apricorn`, 1), at);
    if (Math.random() < 0.1) block.dimension.spawnItem(new ItemStack(`cobblemon:${colour}_apricorn_seed`, 1), at);
});

// Items used on a Pokemon, as Cobblemon's are from the hand: right-clicking one of your Pokemon with medicine heals,
// revives or cures it; with a candy it gains experience (a Rare Candy a whole level); with a held item it takes
// that item to hold, handing back what it held. Its panel's Take Item button gives the held item back. In battle,
// the Bag button uses medicine on the Pokemon fighting, which costs the turn. Medicine amounts are Cobblemon's
// (mechanics/potions.json and remedies.json).
const HELD = "cobblemon:held", HELD_SET = new Set(HELD_ITEMS);

function heldItem(entity) { return prop(entity, HELD) ?? null; }

function consumeHand(player) {
    if (player.getGameMode?.() === "Creative") return;
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, slot = player.selectedSlotIndex, item = inv?.getItem(slot);
    if (!item) return;
    if (item.amount > 1) { item.amount--; inv.setItem(slot, item); } else inv.setItem(slot, undefined);
}

function giveOrDrop(player, id) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    const left = inv?.addItem(new ItemStack(id, 1));
    if (left) player.dimension.spawnItem(left, player.location);
}

// medicine on a Pokemon in the world: returns a message, or undefined when it would do nothing
function applyMedicine(entity, effect) {
    const health = entity.getComponent(EntityComponentTypes.Health);
    const fainted = !!prop(entity, FAINTED), name = POKEMON[entity.typeId]?.name ?? "The Pokemon";
    if (effect.revive) {
        if (!fainted) return undefined;
        setProp(entity, FAINTED, undefined);
        health?.setCurrentValue(Math.max(1, Math.round(health.effectiveMax * effect.revive)));
        return `${name} was revived!`;
    }
    if (fainted) return undefined;
    if (effect.heal) {
        if (!health || health.currentValue >= health.effectiveMax) return effect.cure ? `${name} is already healthy.` : undefined;
        // world health is a share of battle HP; scale the amount by the Pokemon's battle HP at its level
        const f = fighter(entity), per = health.effectiveMax / Math.max(1, f.stats.hp);
        const amount = effect.heal === "max" ? health.effectiveMax : effect.heal === "quarter" ? health.effectiveMax / 4 : effect.heal * per;
        health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + Math.max(1, Math.round(amount))));
        return `${name} regained health.`;
    }
    return effect.cure || effect.pp ? `${name} is already in good shape.` : undefined;
}

function applyCandy(player, entity, candy) {
    const f = fighter(entity);
    if (!f || f.level >= 100) return undefined;
    const group = f.info.expGroup;
    const gain = candy === "level" ? expFor(group, f.level + 1) - Math.max(prop(entity, EXP) ?? 0, expFor(group, f.level)) : candy;
    gainExperience({ player, trainer: false }, f, null, Math.max(1, gain));
    system.runTimeout(() => offerLevelEvolutions(player), 10);
    return true;
}

world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target, itemStack } = event, id = itemStack?.typeId;
    if (!id || !POKEMON[target.typeId] || player.isSneaking) return;   // sneaking opens the wheel instead
    const medicine = MEDICINE[id], candy = CANDIES[id], held = HELD_SET.has(id);
    const changer = id === "cobblemon:ability_capsule" || id === "cobblemon:ability_patch";
    const evItem = EV_ITEMS[id], mint = MINTS[id], evBerry = EV_BERRIES[id];
    if (!medicine && candy === undefined && !held && !changer && !evItem && !mint && !evBerry) return;
    if (prop(target, OWNER) !== player.id) return;   // on a wild Pokemon the item does nothing, and its panel opens
    event.cancel = true;
    system.run(() => {
        if (!target.isValid) return;
        // in battle, medicine on the Pokemon fighting is the turn's action (PokemonSelectingItem.applyToBattlePokemon)
        const battle = battles.get(player.id);
        if (battle) {
            if (!medicine || !battle.minimised || battle.ally.entity?.id !== target.id) { player.sendMessage("§cYou cannot use items right now."); return; }
            if (!useBagItem(battle, id)) return;
            restore(battle);
            foeTurn(battle);
            return;
        }
        const name = POKEMON[target.typeId].name;
        if (evItem) {
            // a vitamin gives 10 EVs and hands back its bottle, a feather 1 (VitaminItem, FeatherItem)
            const [stat, amount, back] = evItem;
            if (!addEvs(target, stat, amount)) { player.sendMessage("§7It won't have any effect."); return; }
            consumeHand(player); if (back && player.getGameMode?.() !== "Creative") giveOrDrop(player, back);
            player.sendMessage(`§a${name}'s ${STAT_NAMES[stat]} base points rose.`);
            refreshHealth(target);
        } else if (mint) {
            // MintItem: the stats follow the mint's nature from now on; the Pokemon keeps its own
            if (effectiveNature(target) === mint) { player.sendMessage(`§7${name} already has the ${natureName(mint)} nature's effect.`); return; }
            setProp(target, "cobblemon:mint", mint); consumeHand(player);
            player.sendMessage(`§a${name}'s stats may have changed due to the effects of the ${itemName(id)}!`);
            refreshHealth(target);
        } else if (evBerry) {
            // FriendshipRaisingBerryItem: 10 EVs off, friendship up by 10, 5 or 1 as it is lower or higher
            const lowered = addEvs(target, evBerry, -10);
            const before = friendshipOf(target), raised = Math.min(255, before + (before < 100 ? 10 : before < 200 ? 5 : 1)) - before;
            if (!lowered && !raised) { player.sendMessage("§7It won't have any effect."); return; }
            setProp(target, "cobblemon:friendship", before + raised); consumeHand(player);
            player.sendMessage(`§a${name} ${raised ? "became more friendly" : "ate the berry"}${lowered ? `, and its ${STAT_NAMES[evBerry]} base points fell` : ""}.`);
            refreshHealth(target);
        } else if (changer) {
            // Ability Capsule swaps between the two normal abilities; Ability Patch gives the hidden one
            const info = POKEMON[target.typeId], current = fighter(target).ability;
            const hidden = (info.hidden ?? []).includes(current);
            const choices = id === "cobblemon:ability_patch" ? (hidden ? [] : info.hidden ?? []) : (hidden ? [] : (info.abilities ?? []).filter((a) => a !== current));
            if (!choices.length) { player.sendMessage("§7It won't have any effect."); return; }
            setProp(target, "cobblemon:ability", choices[0]); consumeHand(player);
            player.sendMessage(`§a${info.name}'s ability became ${abilityName(choices[0])}!`);
        } else if (medicine) {
            const message = applyMedicine(target, medicine);
            if (!message) { player.sendMessage("§7It won't have any effect."); return; }
            consumeHand(player); player.sendMessage(`§a${message}`);
        } else if (candy !== undefined) {
            if (applyCandy(player, target, candy)) consumeHand(player); else player.sendMessage("§7It won't have any effect.");
        } else {
            const old = heldItem(target);
            setProp(target, HELD, id); consumeHand(player);
            if (old) giveOrDrop(player, old);
            player.sendMessage(`§a${POKEMON[target.typeId].name} is now holding the ${itemName(id)}.`);
        }
    });
});

function itemName(id) { return id.slice(id.indexOf(":") + 1).split("_").map(cap).join(" "); }

// The held item on the model, as HeldItemRenderer draws it: the client draws the icon HELD_INDEX names at the
// model's item, item_face or item_hat locator, as Cobblemon's visibility tags say, and nothing for the hidden ones.
function showHeld(entity) {
    const id = prop(entity, "cobblemon:held");
    try {
        entity.setProperty("cobblemon:held_index", (id && HELD_INDEX[id]) || 0);   // the index follows the pack's icon list
    } catch (e) { }
}

// Level-up evolution, as Cobblemon's LevelUpEvolution: when a Pokemon levels up and meets an evolution's
// requirements, its trainer is asked, and a yes transforms it. An Everstone keeps it from evolving.
function genderOf(entity) {
    let g = prop(entity, "cobblemon:gender");
    if (!g) {
        const ratio = POKEMON[entity.typeId]?.maleRatio ?? 0.5;
        g = ratio < 0 ? "genderless" : Math.random() < ratio ? "male" : "female";
        setProp(entity, "cobblemon:gender", g);
    }
    return g;
}
function inTimeRange(name) {
    const t = world.getTimeOfDay() % 24000;
    return (TIME_RANGES[name] ?? [[0, 23999]]).some(([a, b]) => t >= a && t <= b);
}
const MOON_PHASES = ["FULL_MOON", "WANING_GIBBOUS", "LAST_QUARTER", "WANING_CRESCENT", "NEW_MOON", "WAXING_CRESCENT", "FIRST_QUARTER", "WAXING_GIBBOUS"];
function meets(entity, f, r, player) {
    switch (r.t) {
        case "level": return f.level >= r.min;
        case "friendship": return friendshipOf(entity) >= r.min;
        case "time": return inTimeRange(r.range);
        case "held": return prop(entity, "cobblemon:held") === r.item;
        case "move": return f.moves.some((m) => m.id === r.move);
        case "move_type": return f.moves.some((m) => m.type === r.type);
        case "party": { const has = !!player && findParty(player, entity.location).some((e) => e.id !== entity.id && (POKEMON[e.typeId]?.name ?? "").toLowerCase() === r.species); return has === r.contains; }
        case "weather": { let w = "Clear"; try { w = entity.dimension.getWeather(); } catch (e) { } return (r.rain === undefined || (w !== "Clear") === r.rain) && (r.thunder === undefined || (w === "Thunder") === r.thunder); }
        case "moon": { let phase = 0; try { phase = world.getMoonPhase(); } catch (e) { } return MOON_PHASES[phase] === r.phase; }
        case "stat_gt": return f.stats[r.hi] > f.stats[r.lo];
        case "stat_eq": return f.stats[r.a] === f.stats[r.b];
        case "prop":
            if (r.key === "gender") return genderOf(entity) === r.value;
            if (r.key === "nature") return natureOf(entity) === r.value;
            if (r.key === "nickname") return nicknameOf(entity) === r.value;
            if (r.key === "cocoon_species") {
                // Wurmple's split: each Wurmple is one or the other, rolled once
                let c = prop(entity, "cobblemon:cocoon");
                if (!c) { c = Math.random() < 0.5 ? "silcoon" : "cascoon"; setProp(entity, "cobblemon:cocoon", c); }
                return c === r.value;
            }
            return false;
        default: return false;
    }
}
function evolutionFor(entity, player) {
    const f = fighter(entity), info = POKEMON[entity.typeId];
    if (!f || !info?.evolutions?.length || prop(entity, "cobblemon:held") === "cobblemon:everstone") return null;
    return info.evolutions.find((e) => e.req.every((r) => meets(entity, f, r, player))) ?? null;
}
function offerEvolution(player, entity) {
    const evolution = evolutionFor(entity, player);
    if (!evolution || !entity.isValid || prop(entity, "cobblemon:evolving")) return;
    setProp(entity, "cobblemon:evolving", true);
    const name = POKEMON[entity.typeId].name, into = POKEMON[evolution.to]?.name ?? "?";
    new MessageFormData().title("Evolution").body(`What? ${name} is evolving into ${into}!`).button1("Evolve").button2("Not now")
        .show(player).then((r) => {
            if (!entity.isValid) return;
            setProp(entity, "cobblemon:evolving", undefined);
            if (r.canceled || r.selection !== 0) return;
            // an evolution that needs a held item uses it up
            if (evolution.req.some((q) => q.t === "held")) setProp(entity, "cobblemon:held", undefined);
            entity.triggerEvent(evolution.event);
        }).catch(() => setProp(entity, "cobblemon:evolving", undefined));
}

function friendshipOf(entity) { return prop(entity, "cobblemon:friendship") ?? POKEMON[entity.typeId]?.friendship ?? 50; }

// the entity's health follows its battle HP, so a change to its HP stat keeps the same share of health
function refreshHealth(entity) {
    try {
        const health = entity.getComponent(EntityComponentTypes.Health);
        if (health) health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue));
    } catch (e) { }
}

// the panel's Stats button: the Pokemon's own summary, as Cobblemon's summary screen shows it
// The Summary, laid out by ui/server_form.json on Cobblemon's summary textures (see SUMMARY_LAYOUT in port.py): the
// body carries every field at its width in bytes; the buttons are the Info, Moves and Stats tabs, the six party
// slots, the held item slot (give what is in hand, or take what it holds) and the exit.
const TYPE_ORDER = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug",
    "rock", "ghost", "dragon", "dark", "steel", "fairy"];
const SUMMARY_UI = "textures/ui/cobblemon/summary";
function utf8Length(ch) { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
function padBytes(value, width) {
    let out = "", used = 0;
    for (const ch of String(value ?? "")) { const n = utf8Length(ch); if (used + n > width) break; out += ch; used += n; }
    return out + " ".repeat(width - used);
}
const num = (n) => `\u00a7r${n}`;   // a colour code first, so the layout never reads the field as a number
const typeCode = (type) => { const i = TYPE_ORDER.indexOf(type); return i < 0 ? "t--" : `t${String(i).padStart(2, "0")}`; };
function summaryParty(player) {
    try {
        return player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 64 })
            .filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id && !prop(e, "cobblemon:pasture") && !recalling.has(e.id))
            .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
    } catch (e) { return []; }
}

function showSummary(source, tab = "i", viewer, selected = 0) {
    const player = viewer ?? world.getPlayers().find((p) => p.id === prop(source, OWNER)) ?? nearestPlayer(source);
    const f = source?.isValid ? fighter(source) : undefined;
    if (!player || !f) return;
    const info = f.info, mine = prop(source, OWNER) === player.id;
    const v = { tab };
    const tagged = nicknameOf(source);
    Object.assign(v, {
        level: num(f.level), name: tagged || info.name, gender: { male: "m", female: "f" }[genderOf(source)] ?? "o",
        ball: `b${String(Math.max(0, Object.keys(BALLS).indexOf(prop(source, "cobblemon:caught_ball") ?? "cobblemon:poke_ball"))).padStart(2, "0")}`,
        type1: typeCode(info.types[0]), type2: typeCode(info.types[1]), status: prop(source, FAINTED) ? "fnt" : "non",
        dex: num(String(info.dex ?? DEX_INDEX.get(source.typeId) + 1 ?? 0).padStart(4, "0")), species: info.name,
        types: info.types.map(cap).join(" / "),
        ot: mine ? player.name : (world.getPlayers().find((p) => p.id === prop(source, OWNER))?.name ?? "-"),
        nature: mine ? natureName(effectiveNature(source)) : "-", ability: abilityName(f.ability), desc: ABILITY_DESC[f.ability] ?? "",
        friendship: num(friendshipOf(source)),
    });
    const group = info.expGroup, exp = Math.max(prop(source, EXP) ?? 0, expFor(group, f.level));
    const span = Math.max(1, expFor(group, f.level + 1) - expFor(group, f.level));
    v.exp = num(exp); v.tonext = num(f.level >= 100 ? 0 : expFor(group, f.level + 1) - exp);
    v.expbar = `x${String(Math.round(Math.min(1, (exp - expFor(group, f.level)) / span) * 55)).padStart(2, "0")}`;
    f.moves.slice(0, 4).forEach((mv, n) => { v[`m${n}name`] = mv.name; v[`m${n}type`] = typeCode(mv.type); v[`m${n}pp`] = num(`${mv.left}/${mv.pp}`); });
    for (let n = f.moves.length; n < 4; n++) { v[`m${n}type`] = "t--"; }
    for (let n = 0; n < 4; n++) v[`m${n}sel`] = n === selected && f.moves[n] ? "y" : "n";
    const chosen = f.moves[selected];
    if (chosen) {
        // a lone "-" reads as a number and a lone "%" as a format, so both get the colour code and the % is doubled
        v.mpower = num(chosen.power > 0 ? chosen.power : "-");
        v.macc = num(chosen.accuracy === true || !chosen.accuracy ? "-" : `${chosen.accuracy}%%`);
        v.meff = num(chosen.secondary?.chance ? `${chosen.secondary.chance}%%` : "-");
        v.mdesc = MOVE_DESC[chosen.id] ?? "";
    }
    const ivs = ivsOf(source), evs = evsOf(source), [up, down] = NATURES[effectiveNature(source)] ?? [];
    for (const k of STAT_KEYS) {
        v[`s${k}val`] = num(f.stats[k]); v[`s${k}iv`] = mine ? num(ivs[k]) : ""; v[`s${k}ev`] = mine ? num(evs[k]) : "";
        v[`s${k}mark`] = up !== down && k === up ? "u" : up !== down && k === down ? "d" : "n";
    }
    const party = summaryParty(player);
    for (let n = 0; n < 6; n++) {
        const e = party[n];
        if (!e) { v[`p${n}hp`] = "q00"; v[`p${n}gender`] = "o"; v[`p${n}icon`] = "i----"; continue; }
        v[`p${n}icon`] = iconOf(e.typeId);
        const pi = POKEMON[e.typeId];
        let share = 1;
        try { const h = e.getComponent(EntityComponentTypes.Health); share = Math.max(0, h.currentValue) / h.effectiveMax; } catch (err) { }
        v[`p${n}name`] = nicknameOf(e) || pi.name;
        v[`p${n}level`] = `Lv. ${prop(e, LEVEL) ?? pi.level}`;
        v[`p${n}hp`] = `q${String(prop(e, FAINTED) ? 0 : Math.round(share * 37)).padStart(2, "0")}`;
        v[`p${n}gender`] = { male: "m", female: "f" }[genderOf(e)] ?? "o";
    }
    const held = heldItem(source), icon = held ? HELD_ICONS[(HELD_INDEX[held] ?? 0) - 1] : undefined;
    v.item = icon ?? `${SUMMARY_UI}/blank`;
    v.portrait = iconOf(source.typeId);
    // Cobblemon's evolve button shows while an evolution is ready, outside battle, without an Everstone
    const evolution = mine && !battles.has(player.id) ? evolutionFor(source, player) : null;
    v.evolve = evolution ? "Evolve" : "";
    const body = SUMMARY_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");

    const form = new ActionFormData().title("cbm:summary").body(body);
    for (const [key, name] of [["i", "info"], ["m", "moves"], ["s", "stats"]]) form.button(name, `${SUMMARY_UI}/tab_${name}${tab === key ? "_on" : ""}`);
    for (let n = 0; n < 6; n++) form.button(party[n] ? "" : " ", `${SUMMARY_UI}/pslot_${!party[n] ? "e" : prop(party[n], FAINTED) ? "x" : "n"}`);
    form.button("item", `${SUMMARY_UI}/item`);
    form.button("exit", `${SUMMARY_UI}/exit`);
    for (let n = 0; n < 4; n++) form.button("move", `${SUMMARY_UI}/${tab === "m" && f.moves[n] ? "item" : "none"}`);
    form.button("evolve", `${SUMMARY_UI}/${evolution ? "evolve" : "none"}`);
    for (let n = 0; n < 4; n++) {
        form.button("up", `${SUMMARY_UI}/${mine && tab === "m" && n > 0 && f.moves[n] ? "up" : "none"}`);
        form.button("down", `${SUMMARY_UI}/${mine && tab === "m" && f.moves[n + 1] ? "down" : "none"}`);
    }
    form.button("name", `${SUMMARY_UI}/${mine ? "name" : "none"}`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 10) return;
        const pick = r.selection;
        if (pick <= 2) { showSummary(source, ["i", "m", "s"][pick], player, selected); return; }
        if (pick >= 11 && pick <= 14) { showSummary(source, tab, player, tab === "m" && f.moves[pick - 11] ? pick - 11 : selected); return; }
        if (pick === 15) { if (evolution) offerEvolution(player, source); return; }
        if (pick >= 16 && pick <= 23 && mine && tab === "m") {
            // MoveSlotWidget's reorder arrows swap a move with the one above or below it
            const n = (pick - 16) >> 1, other = pick % 2 === 0 ? n - 1 : n + 1, ids = f.moves.map((mv) => mv.id);
            if (other >= 0 && other < ids.length) {
                [ids[n], ids[other]] = [ids[other], ids[n]];
                setProp(source, MOVESET, JSON.stringify(ids));
                showSummary(source, tab, player, selected === n ? other : selected === other ? n : selected); return;
            }
            showSummary(source, tab, player, selected); return;
        }
        if (pick === 24 && mine) {
            // NicknameEntryWidget: a nickname up to 12 characters, an empty one clears it
            new ModalFormData().title("Nickname").textField("Nickname", info.name, { defaultValue: tagged })
                .show(player).then((q) => {
                    if (!q.canceled && source.isValid) {
                        const name = String(q.formValues?.[0] ?? "").trim().slice(0, 12);
                        setProp(source, NICK, name || undefined);
                    }
                    if (source.isValid) showSummary(source, tab, player, selected);
                }).catch(() => { });
            return;
        }
        if (pick <= 8) { const e = party[pick - 3]; showSummary(e && e.isValid ? e : source, tab, player); return; }
        if (pick === 9 && mine) {
            const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
            const hand = inv?.getItem(player.selectedSlotIndex)?.typeId;
            if (hand && !HOLD_BLACKLIST.includes(hand)) giveHeld(player, source);
            else if (heldItem(source)) takeHeld(source);
        }
        showSummary(source, tab, player, selected);
    }).catch(() => { });
}

// the summary's Give button: whatever the player holds, bar containers, as PokemonEntity.offerHeldItem allows
function giveHeld(player, target) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, id = inv?.getItem(player.selectedSlotIndex)?.typeId;
    if (!id || HOLD_BLACKLIST.includes(id) || !target.isValid) return;
    const old = heldItem(target);
    setProp(target, HELD, id); consumeHand(player);
    if (old) giveOrDrop(player, old);
    showHeld(target);
    player.sendMessage(`§a${POKEMON[target.typeId].name} is now holding the ${itemName(id)}.`);
}

// the panel's Take Item button
function takeHeld(source) {
    const owner = world.getPlayers().find((p) => p.id === prop(source, OWNER));
    const player = owner ?? nearestPlayer(source), held = heldItem(source);
    if (!player) return;
    if (!held) { player.sendMessage("§7It isn't holding anything."); return; }
    if (owner?.id !== player.id) { player.sendMessage("§7That isn't your Pokemon."); return; }
    setProp(source, HELD, undefined); giveOrDrop(player, held);
    player.sendMessage(`§aYou took the ${itemName(held)} from ${POKEMON[source.typeId].name}.`);
}

// medicine used in battle on the Pokemon fighting, from the hand
function useBagItem(battle, id) {
    const f = battle.ally, effect = MEDICINE[id];
    let used = false;
    if (effect.heal && f.hp < f.stats.hp) {
        const amount = effect.heal === "max" ? f.stats.hp : effect.heal === "quarter" ? Math.floor(f.stats.hp / 4) : effect.heal;
        const before = f.hp; f.hp = Math.min(f.stats.hp, f.hp + amount); syncHealth(f);
        say(battle, `§a${f.info.name} regained ${f.hp - before} HP.`); used = true;
    }
    if (effect.cure && f.status && (effect.cure === true || effect.cure.includes(f.status))) { f.status = null; say(battle, `§a${f.info.name} was cured.`); used = true; }
    if (effect.pp) {
        const targets = effect.all ? f.moves : [f.moves.filter((m) => m.left < m.pp).sort((a, b) => a.left / a.pp - b.left / b.pp)[0]].filter(Boolean);
        for (const m of targets) { if (m.left < m.pp) { m.left = Math.min(m.pp, m.left + effect.pp); used = true; } }
        if (used) say(battle, `§a${f.info.name}'s PP was restored.`);
    }
    if (!used) { say(battle, "§7It won't have any effect."); return false; }
    const inv = battle.player.getComponent(EntityComponentTypes.Inventory)?.container;
    for (let i = 0; i < inv.size; i++) {
        const it = inv.getItem(i);
        if (it?.typeId !== id) continue;
        if (it.amount > 1) { it.amount--; inv.setItem(i, it); } else inv.setItem(i, undefined);
        break;
    }
    return true;
}

// Blocks. A berry bush moves a stage on each random tick until it is ripe, and a ripe one used by a player
// drops Cobblemon's base yield of its berry and goes back to flowering. The healing machine restores the
// Pokemon around it that belong to the player using it.
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    registerApricornComponents(blockComponentRegistry);
    registerWoodComponents(blockComponentRegistry);
    registerModelBlockComponents(blockComponentRegistry);
    blockComponentRegistry.registerCustomComponent("cobblemon:berry_growth", {
        onRandomTick({ block }) {
            const stage = block.permutation.getState("cobblemon:stage");
            if (stage < 3) block.setPermutation(block.permutation.withState("cobblemon:stage", stage + 1));
        },
        onPlayerInteract({ block }) {
            if (block.permutation.getState("cobblemon:stage") !== 3) return;
            const berry = BERRIES[block.typeId];
            if (!berry) return;
            const count = berry.min + Math.floor(Math.random() * (berry.max - berry.min + 1));
            const { x, y, z } = block.location;
            block.dimension.spawnItem(new ItemStack(berry.item, count), { x: x + 0.5, y: y + 0.6, z: z + 0.5 });
            block.setPermutation(block.permutation.withState("cobblemon:stage", 2));
        }
    });
    blockComponentRegistry.registerCustomComponent("cobblemon:fossil_machine", {
        onPlayerInteract({ block, player }) { if (player) useMachine(block, player); }
    });
    blockComponentRegistry.registerCustomComponent("cobblemon:pasture", {
        onPlayerInteract({ block, player }) { if (player) openPasture(block, player); }
    });
    blockComponentRegistry.registerCustomComponent("cobblemon:pc", {
        onPlayerInteract({ block, player }) { if (player) openPc(block, player); }
    });
    blockComponentRegistry.registerCustomComponent("cobblemon:healing_machine", {
        onPlayerInteract({ block, player }) {
            if (!player) return;
            const center = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
            const healed = healAround(block.dimension, center, player);
            player.sendMessage(healed ? `§aYour Pokemon are fully healed! (${healed})` : "§7No Pokemon of yours nearby to heal.");
            try { player.playSound("random.levelup", { location: center }); } catch (err) { }
        }
    });
});

// ---------------------------------------------------------------------------
// Poke Balls in the world, after EmptyPokeBallEntity, PokeBallPosableState and PokemonClientDelegate. A ball that
// hits a wild Pokemon bounces up and back, opens, and beams the Pokemon in along a red beam (it reddens and
// shrinks), shuts, falls, and on the ground bounces then shakes once per passed check of Cobblemon's capture
// calculator: four checks passed and it clicks shut, otherwise it bursts open and the Pokemon comes back out.
// A ball that misses drops back as an item. Sending a Pokemon out throws its ball, which bursts with the ball's own
// flash and sparkles as the Pokemon grows; recalling one runs the red beam from the Pokemon back to the hand.
// ---------------------------------------------------------------------------
const BEAM_EXTEND = 4, BEAM_SHRINK = 8;   // ticks: PokemonClientDelegate's BEAM_EXTEND_TIME 0.2 and BEAM_SHRINK_TIME 0.4 s
const BALL_FROM_PROJECTILE = new Map(Object.keys(BALLS).map((id) => [`cobblemon:ball_${id.slice("cobblemon:".length)}`, id]));
const capturing = new Set();

// runs fn(tick) every tick until it returns false or `ticks` pass; a thrown error ends it
function timeline(ticks, fn) {
    let t = 0;
    const id = system.runInterval(() => {
        let more = false;
        try { more = t <= ticks && fn(t) !== false; } catch (e) { }
        t++;
        if (!more) system.clearRun(id);
    }, 1);
}

function setSize(entity, size, red = 0) {
    try { entity.setProperty("cobblemon:size", Math.max(0, Math.min(1, size))); entity.setProperty("cobblemon:red", Math.max(0, Math.min(1, red))); } catch (e) { }
}

// the middle of a Pokemon's body at its current send-out scale, where Cobblemon aims the beam
function bodyCentre(entity, size = 1) {
    const h = Math.min(3, Math.max(0.4, (POKEMON[entity.typeId]?.height ?? 10) / 10));
    return { x: entity.location.x, y: entity.location.y + (h / 2) * size, z: entity.location.z };
}

// a player's throwing hand: eye height less 0.4, 0.3 to the right, as PokemonRenderer places the beam's end
function handOf(player) {
    const head = player.getHeadLocation(), yaw = (player.getRotation().y * Math.PI) / 180;
    return { x: head.x - Math.cos(yaw) * 0.3, y: head.y - 0.4, z: head.z - Math.sin(yaw) * 0.3 };
}

// one beam entity drawn from a to b between fractions t0 and t1 of the way
function drawBeam(beam, a, b, t0, t1) {
    const from = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0, z: a.z + (b.z - a.z) * t0 };
    const dx = (b.x - a.x) * (t1 - t0), dy = (b.y - a.y) * (t1 - t0), dz = (b.z - a.z) * (t1 - t0);
    try {
        // the entity's yaw heads the beam (Minecraft faces (-sin yaw, cos yaw)); the pitch bone tilts it, positive downward
        beam.teleport(from, { rotation: { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI } });
        beam.setProperty("cobblemon:pitch", (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI);
        beam.setProperty("cobblemon:length", Math.min(64, Math.hypot(dx, dy, dz)));
    } catch (e) { }
}

// PokemonRenderer.renderBeam's timing: out over 0.2 s, held, gone over 0.2 s after the 0.4 s shrink. The Pokemon
// reddens and shrinks while it is held. A capture beam runs from the ball and pulls back into it; a recall beam
// runs from the Pokemon to the hand and its tail follows it there. onGone runs as the Pokemon vanishes.
function beamIn(pokemon, source, capture, onGone) {
    const dim = pokemon.dimension;
    let beam;
    try { beam = dim.spawnEntity("cobblemon:beam", source()); } catch (e) { onGone?.(); return; }
    try { dim.playSound("cobblemon.poke_ball.recall", source(), { volume: 0.6 }); } catch (e) { }
    const total = BEAM_EXTEND * 2 + BEAM_SHRINK;
    timeline(total, (t) => {
        const ratio = t < BEAM_EXTEND ? t / BEAM_EXTEND : t > BEAM_EXTEND + BEAM_SHRINK ? 1 - Math.min(1, (t - BEAM_EXTEND - BEAM_SHRINK) / BEAM_EXTEND) : 1;
        const shrink = Math.min(1, Math.max(0, (t - BEAM_EXTEND) / BEAM_SHRINK));
        if (pokemon.isValid) setSize(pokemon, 1 - shrink, Math.min(0.6, shrink));
        const ball = source(), body = pokemon.isValid ? bodyCentre(pokemon) : ball;
        if (beam.isValid) {
            if (capture) drawBeam(beam, ball, body, 0, ratio);
            else if (t <= BEAM_EXTEND + BEAM_SHRINK) drawBeam(beam, body, ball, 0, ratio);
            else drawBeam(beam, body, ball, 1 - ratio, 1);
        }
        if (t === BEAM_EXTEND + BEAM_SHRINK) onGone?.();
        if (t >= total) { try { beam.remove(); } catch (e) { } return false; }
    });
}

// a ball's own send-out burst (sendflash, ballsendsparkle), or the Poke Ball's when a ball has none
function ballBurst(dim, ballId, at) {
    const fx = BALLS[ballId]?.fx ?? "pokeball";
    for (const name of ["sendflash", "ballsendsparkle", "ballsparks"]) { try { dim.spawnParticle(`cobblemon:${fx}/casual/${name}`, at); } catch (e) { } }
}

function captureBall(dim, ballId, at) {
    const ball = BALLS[ballId] ?? BALLS["cobblemon:poke_ball"];
    const entity = dim.spawnEntity(ball.ancient ? "cobblemon:capture_ball_ancient" : "cobblemon:capture_ball", at);
    try { entity.setProperty("cobblemon:ball", ball.tex ?? 0); } catch (e) { }
    return entity;
}

function ballState(entity, state) { try { entity.setProperty("cobblemon:state", { fly: 0, hover: 1, open: 2, shut: 3, shake: 4, critical: 5, capture: 6, break: 7 }[state]); } catch (e) { } }

function dropBall(dim, ballId, at, player) {
    if (player?.getGameMode?.() === "Creative") return;
    try { dim.spawnItem(new ItemStack(ballId, 1), at); } catch (e) { }
}

// Send-out: the ball flies from the hand to where the Pokemon stands, bursts, and the Pokemon grows out of it
function sendOutEffect(player, entity, ballId = prop(entity, "cobblemon:caught_ball") ?? "cobblemon:poke_ball") {
    if (!entity?.isValid) return;
    setSize(entity, 0);
    const dim = entity.dimension, from = player?.isValid ? handOf(player) : { ...entity.location, y: entity.location.y + 1 };
    let ball;
    try { ball = captureBall(dim, ballId, from); } catch (e) { setSize(entity, 1); return; }
    try { dim.playSound("cobblemon.poke_ball.throw", from); } catch (e) { }
    const FLIGHT = 10;
    timeline(FLIGHT + BEAM_SHRINK, (t) => {
        if (!entity.isValid) { try { ball.remove(); } catch (e) { } return false; }
        const to = { x: entity.location.x, y: entity.location.y + 0.5, z: entity.location.z };
        if (t < FLIGHT) {
            const k = t / FLIGHT;
            try { ball.teleport({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.8, z: from.z + (to.z - from.z) * k }, { facingLocation: to }); } catch (e) { }
        } else if (t === FLIGHT) {
            try { ball.remove(); } catch (e) { }
            ballBurst(dim, ballId, to);
            try { dim.playSound("cobblemon.poke_ball.send_out", to); } catch (e) { }
            try { const cry = POKEMON[entity.typeId]?.cry; if (cry) dim.playSound(cry, to); } catch (e) { }
        } else setSize(entity, (t - FLIGHT) / BEAM_SHRINK);
        if (t >= FLIGHT + BEAM_SHRINK) { setSize(entity, 1); return false; }
    });
}

// Recall: the red beam runs from the Pokemon to the hand and takes it in; then() runs as it vanishes
const recalling = new Set();   // Pokemon on their way back into a ball, already out of the party
function recallEffect(player, entity, then) {
    if (!entity?.isValid || !player?.isValid) { then?.(); return; }
    recalling.add(entity.id);
    try { entity.addEffect("slowness", 40, { amplifier: 255, showParticles: false }); } catch (e) { }
    beamIn(entity, () => handOf(player), false, () => { recalling.delete(entity.id); then?.(); });
}

// Cobblemon's capture calculator (CobblemonCaptureCalculator.processCapture): the modified catch rate from health,
// half outside battle, the ball, status and a low-level bonus, then four shake checks of 65536 / (255 / rate)^0.1875
function captureRoll(player, pokemon, ballId, battle) {
    // in battle the foe as it stands (its health and status) and the battle's own rules for the ball; half the rate outside
    const f = battle ? battle.foe : fighter(pokemon);
    if (!f) return { shakes: 0, caught: false };
    let mult = battle ? ballMultiplier(battle, ballId) : worldBallMultiplier(player, f, ballId);
    if (mult === Infinity) return { shakes: 3, caught: true };
    if (f.info.ultraBeast && BALLS[ballId]?.rule !== "beast") mult *= 0.1;
    const levelBonus = f.level < 13 ? Math.max(Math.trunc((36 - 2 * f.level) / 10), 1) : 1;
    const statusBonus = f.status === "slp" || f.status === "frz" ? 2.5 : f.status ? 1.5 : 1;
    let rate = (((3 * f.stats.hp - 2 * f.hp) * f.info.catchRate * (battle ? 1 : 0.5) * mult) / (3 * f.stats.hp)) * levelBonus * statusBonus;
    const highest = Math.max(0, ...findParty(player, player.location).map((e) => fighter(e)?.level ?? 0));
    if (highest && highest < f.level && f.level - highest >= 50) rate *= 0.1;
    const chance = Math.round(65536 / Math.pow(255 / Math.max(rate, 0.0001), 0.1875));
    let shakes = 0;
    for (let i = 0; i < 4; i++) if (Math.floor(Math.random() * 65537) < chance) shakes++;
    return { shakes: Math.min(shakes, 3), caught: shakes === 4 };
}

// the ball's multiplier for a throw in the world: the battle rules where they read the world, Safari's 1.5 outside
// battle, and the Level Ball against the thrower's strongest Pokemon
function worldBallMultiplier(player, f, ballId) {
    const ball = BALLS[ballId];
    if (!ball) return 1;
    const party = findParty(player, player.location).map((e) => fighter(e)).filter(Boolean).sort((a, b) => b.level - a.level);
    switch (ball.rule) {
        case "quick": case "timer": case "love": case "lure": case "dream": return 1;
        case "safari": return 1.5;
        case "level": if (!party.length) return 1; break;
        default: break;
    }
    return ballMultiplier({ foe: f, ally: party[0] ?? f, player, turn: 1 }, ballId);
}

const captureBattles = new Map();   // the battle a capture belongs to, by the Pokemon's id
function startCapture(player, projectileId, pokemon, hit, velocity, battle) {
    const mine = battles.get(player.id);
    if (!battle && mine?.minimised && mine.foe.entity?.id === pokemon.id && !mine.trainer) { restore(mine); battle = mine; }
    const ballId = BALL_FROM_PROJECTILE.get(projectileId), dim = pokemon.dimension;
    const wild = POKEMON[pokemon.typeId] && !prop(pokemon, OWNER) && !pokemon.hasComponent(EntityComponentTypes.IsTamed);
    let busy = capturing.has(pokemon.id);
    try { busy = busy || (!battle && pokemon.getProperty("cobblemon:battle")); } catch (e) { }
    if (!wild || busy) { dropBall(dim, ballId, hit, player); if (battle) system.runTimeout(() => foeTurn(battle), 20); return; }
    capturing.add(pokemon.id);
    if (battle) captureBattles.set(pokemon.id, battle);
    else { freeze(pokemon, true); try { pokemon.setProperty("cobblemon:battle", false); } catch (e) { } }
    register(player, pokemon.typeId, 1);
    let ball;
    try { ball = captureBall(dim, ballId, hit); } catch (e) { capturing.delete(pokemon.id); freeze(pokemon, false); dropBall(dim, ballId, hit, player); return; }
    ballState(ball, "hover");
    // bounce back off the Pokemon: a third of a block a tick up, a tenth back and to one side, under gravity
    const side = Math.random() < 0.5 ? 1 : -1, back = Math.hypot(velocity.x, velocity.z) || 1;
    const bx = -velocity.x / back, bz = -velocity.z / back, turn = (side * Math.PI) / 3;
    const v = { x: (bx * Math.cos(turn) - bz * Math.sin(turn)) * 0.1, y: 1 / 3, z: (bx * Math.sin(turn) + bz * Math.cos(turn)) * 0.1 };
    const pos = { ...hit };
    const gone = () => { capturing.delete(pokemon.id); try { if (ball.isValid) ball.remove(); } catch (e) { } };
    const face = () => (pokemon.isValid ? bodyCentre(pokemon) : pos);
    timeline(20 * 12, (t) => {
        if (!ball.isValid) { gone(); if (pokemon.isValid) { setSize(pokemon, 1); freeze(pokemon, false); } return false; }
        if (!pokemon.isValid) { gone(); return false; }
        if (t < 14) {                                    // 0.7 s of bounce
            pos.x += v.x; pos.y += v.y; pos.z += v.z; v.y -= 0.03;
            try { ball.teleport(pos, { facingLocation: face() }); } catch (e) { }
        }
        if (t === 4) ballState(ball, "open");            // opens 0.2 s after the hit
        if (t === 14) beamIn(pokemon, () => ({ x: pos.x, y: pos.y + 0.25, z: pos.z }), true);
        if (t === 39) ballState(ball, "shut");           // and shuts 1.75 s after opening
        if (t === 44) {                                  // falls 2.2 s after the hit, for at most 1.5 s
            try { pokemon.teleport({ x: pos.x, y: pos.y, z: pos.z }); } catch (e) { }
            fall(ball, pos, player, pokemon, ballId, gone);
            return false;
        }
    });
}

function fall(ball, pos, player, pokemon, ballId, gone) {
    const dim = ball.dimension;
    let vy = 0;
    timeline(30, (t) => {
        if (!ball.isValid || !pokemon.isValid) { gone(); return false; }
        vy -= 0.03;
        const next = pos.y + vy;
        let floor;
        try { const b = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(next), z: Math.floor(pos.z) }); if (b && !b.isAir && !b.isLiquid) floor = Math.floor(next) + 1; } catch (e) { }
        if (floor !== undefined || t >= 30) {
            if (floor !== undefined) pos.y = floor;
            try { ball.teleport(pos); } catch (e) { }
            land(ball, pos, player, pokemon, ballId, gone);
            return false;
        }
        pos.y = next;
        try { ball.teleport(pos); } catch (e) { }
    });
}

// on the ground: bounce, then after a second a shake every 1.25 s, one per check passed, then the result
function land(ball, pos, player, pokemon, ballId, gone) {
    const dim = ball.dimension, roll = captureRoll(player, pokemon, ballId, captureBattles.get(pokemon.id));
    ballState(ball, "shake");
    let shake = 0;
    const steps = roll.shakes + 1;
    for (let i = 0; i < steps; i++) {
        system.runTimeout(() => {
            if (!ball.isValid || !pokemon.isValid) { gone(); return; }
            if (i < roll.shakes) { shake++; try { ball.setProperty("cobblemon:shake", shake); } catch (e) { } return; }
            if (roll.caught) caught(ball, pos, player, pokemon, ballId, gone);
            else brokeFree(ball, pos, pokemon, ballId, gone);
        }, 20 + i * 25);
    }
}

function caught(ball, pos, player, pokemon, ballId, gone) {
    ballState(ball, "capture");
    system.runTimeout(() => {
        const name = POKEMON[pokemon.typeId]?.name ?? "The Pokemon";
        if (pokemon.isValid) {
            try { pokemon.teleport(pos); } catch (e) { }
            player.sendMessage(`§aGotcha! ${name} was caught!`);
            const battle = captureBattles.get(pokemon.id);
            captureBattles.delete(pokemon.id);
            keepCaught(player, pokemon, ballId);   // first, so the battle's end does not heal it as a wild one
            if (battle && battles.has(battle.player.id)) endBattle(battle);
        }
        gone();
    }, BALLS[ballId]?.ancient ? 36 : 20);
}

// A caught Pokemon becomes the player's, as Cobblemon's party.add does, and joins the party beside them; with six
// already there it goes to the first free PC slot. The ball's capture effects apply (CaptureEffects): the Friend Ball
// starts it at 150 friendship, the Heal Ball restores it fully.
function keepCaught(player, pokemon, ballId) {
    if (!pokemon?.isValid || !player?.isValid) return;
    try { pokemon.triggerEvent("cobblemon:caught"); pokemon.getComponent(EntityComponentTypes.Tameable)?.tame(player); } catch (e) { }
    setProp(pokemon, OWNER, player.id);
    setProp(pokemon, "cobblemon:caught_ball", ballId);
    register(player, pokemon.typeId, 2);
    if (ballId === "cobblemon:friend_ball") setProp(pokemon, "cobblemon:friendship", 150);
    if (ballId === "cobblemon:heal_ball") healFully(pokemon);
    setSize(pokemon, 1, 0);
    freeze(pokemon, false);
    const party = summaryParty(player).filter((e) => e.id !== pokemon.id);
    if (party.length < PARTY_SIZE) return;
    for (let n = 0; n < PC_BOXES; n++) {
        const contents = box(player, n), slot = contents.indexOf(null);
        if (slot < 0) continue;
        contents[slot] = snapshot(pokemon); saveBox(player, n, contents);
        player.sendMessage(`§a${POKEMON[pokemon.typeId]?.name} was sent to Box ${n + 1}.`);
        try { pokemon.remove(); } catch (e) { }
        return;
    }
}

function healFully(entity) {
    setProp(entity, FAINTED, undefined);
    setProp(entity, "cobblemon:faint_timer", undefined);
    try { const h = entity.getComponent(EntityComponentTypes.Health); h.setCurrentValue(h.effectiveMax); } catch (e) { }
}

// PlayerPartyStore.onSecondPassed, out of battle: a fainted Pokemon wakes after defaultFaintTimer (300 s) with
// faintAwakenHealthPercent (20%) of its health; a hurt one heals healPercent (5%) every healTimer (60 s). Sleeping
// the night in a bed heals the party by half and wakes the fainted (Pokemon.didSleep).
const FAINT_SECONDS = 300, AWAKEN_SHARE = 0.2, HEAL_SHARE = 0.05, HEAL_SECONDS = 60;
const sleepers = new Map();
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        let asleep = false;
        try { asleep = player.isSleeping; } catch (e) { }
        const slept = sleepers.get(player.id) ?? 0;
        sleepers.set(player.id, asleep ? slept + 1 : 0);
        const wokeRested = !asleep && slept >= 5;   // five seconds in bed: the night passed
        if (battles.has(player.id) && !wokeRested) continue;
        for (const e of summaryParty(player)) {
            let health;
            try { health = e.getComponent(EntityComponentTypes.Health); } catch (err) { continue; }
            if (!health) continue;
            if (wokeRested) {
                setProp(e, FAINTED, undefined); setProp(e, "cobblemon:faint_timer", undefined);
                health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + health.effectiveMax / 2));
                continue;
            }
            if (prop(e, FAINTED)) {
                const left = (prop(e, "cobblemon:faint_timer") ?? FAINT_SECONDS) - 1;
                if (left > 0) { setProp(e, "cobblemon:faint_timer", left); continue; }
                setProp(e, FAINTED, undefined); setProp(e, "cobblemon:faint_timer", undefined);
                health.setCurrentValue(Math.max(1, Math.ceil(health.effectiveMax * AWAKEN_SHARE)));
                player.sendMessage(`${nicknameOf(e) || POKEMON[e.typeId].name} has recovered from fainting.`);
            } else if (health.currentValue < health.effectiveMax) {
                const left = (prop(e, "cobblemon:heal_timer") ?? HEAL_SECONDS) - 1;
                if (left > 0) { setProp(e, "cobblemon:heal_timer", left); continue; }
                setProp(e, "cobblemon:heal_timer", HEAL_SECONDS);
                health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + Math.max(1, Math.round(health.effectiveMax * HEAL_SHARE))));
            }
        }
        if (wokeRested) player.sendMessage("§aYour Pokemon are rested.");
    }
}, 20);
function brokeFree(ball, pos, pokemon, ballId, gone) {
    ballState(ball, "break");
    const dim = ball.dimension;
    try { pokemon.teleport(pos); } catch (e) { }
    system.runTimeout(() => {
        ballBurst(dim, ballId, { x: pos.x, y: pos.y + 0.3, z: pos.z });
        timeline(BEAM_SHRINK, (t) => { if (pokemon.isValid) setSize(pokemon, t / BEAM_SHRINK); });
        capturing.delete(pokemon.id);
        const battle = captureBattles.get(pokemon.id);
        captureBattles.delete(pokemon.id);
        // in battle the Pokemon breaks out and the battle goes on, its move costing the player's turn
        if (battle) {
            if (pokemon.isValid) say(battle, `§7Oh no! ${battle.foe.info.name} broke free!`);
            if (battles.has(battle.player.id)) system.runTimeout(() => foeTurn(battle), 20);
        } else freeze(pokemon, false);
    }, 2);
    system.runTimeout(() => { try { if (ball.isValid) ball.remove(); } catch (e) { } }, 24);
}

// A thrown ball is tracked from the tick it spawns and tested against the Pokemon around it every tick, so a hit
// never depends on the engine's own projectile collision
const flying = new Map();
world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (BALL_FROM_PROJECTILE.has(entity.typeId)) flying.set(entity.id, { entity, last: { ...entity.location } });
});
system.runInterval(() => {
    for (const [id, f] of flying) {
        const ball = f.entity;
        if (!ball.isValid) { flying.delete(id); continue; }
        const at = ball.location;
        let near = [];
        try { near = ball.dimension.getEntities({ families: ["pokemon"], location: at, maxDistance: 4 }); } catch (e) { }
        const hit = near.find((e) => {
            const h = Math.min(3, Math.max(0.4, (POKEMON[e.typeId]?.height ?? 10) / 10)), r = Math.max(0.35, Math.min(1.5, h * 0.45)) + 0.15;
            // the ball's path since the last tick, sampled, against the Pokemon's box
            for (let k = 0; k <= 4; k++) {
                const x = f.last.x + (at.x - f.last.x) * (k / 4), y = f.last.y + (at.y - f.last.y) * (k / 4), z = f.last.z + (at.z - f.last.z) * (k / 4);
                if (Math.hypot(x - e.location.x, z - e.location.z) <= r && y >= e.location.y - 0.2 && y <= e.location.y + h + 0.2) return true;
            }
            return false;
        });
        if (hit) {
            flying.delete(id);
            let owner, velocity = { x: at.x - f.last.x, y: at.y - f.last.y, z: at.z - f.last.z };
            try { owner = ball.getComponent("minecraft:projectile")?.owner; } catch (e) { }
            const typeId = ball.typeId, where = { ...at };
            try { ball.remove(); } catch (e) { }
            if (owner?.typeId === "minecraft:player" && POKEMON[hit.typeId]) startCapture(owner, typeId, hit, where, velocity);
            else dropBall(hit.dimension, BALL_FROM_PROJECTILE.get(typeId), where, owner);
            continue;
        }
        f.last = { ...at };
    }
}, 1);
world.afterEvents.projectileHitEntity.subscribe((event) => {
    const { projectile, source, dimension, location, hitVector } = event;
    const ballId = BALL_FROM_PROJECTILE.get(projectile?.typeId);
    if (!ballId) return;
    flying.delete(projectile.id);
    const target = event.getEntityHit()?.entity;
    const player = source?.typeId === "minecraft:player" ? source : undefined;
    if (target && POKEMON[target.typeId] && player) startCapture(player, projectile.typeId, target, { ...location }, hitVector ?? { x: 0, y: 0, z: 1 });
    else dropBall(dimension, ballId, location, player);
});
world.afterEvents.projectileHitBlock.subscribe((event) => {
    const ballId = BALL_FROM_PROJECTILE.get(event.projectile?.typeId);
    if (!ballId) return;
    flying.delete(event.projectile.id);
    const player = event.source?.typeId === "minecraft:player" ? event.source : undefined;
    dropBall(event.dimension, ballId, event.location, player);
});

// every ball entity and beam is the script's; none outlives a restart
world.afterEvents.worldLoad?.subscribe?.(() => {
    for (const dim of ["overworld", "nether", "the_end"].map((d) => world.getDimension(d))) {
        for (const type of ["cobblemon:capture_ball", "cobblemon:capture_ball_ancient", "cobblemon:beam"]) {
            try { for (const e of dim.getEntities({ type })) e.remove(); } catch (e) { }
        }
    }
});

// Starter selection, laid out by ui/server_form.json on Cobblemon's starter textures: offered when a player joins
// without having chosen, as Cobblemon's starter prompt is, until they choose. The starter comes out of its ball
// beside them at the level StarterConfig gives it, and is registered as caught.
const STARTER_CHOSEN = "cobblemon:starter_chosen";
function openStarter(player, state = { page: 0, cat: 0, pick: 0 }) {
    if (player.getDynamicProperty(STARTER_CHOSEN)) { player.sendMessage("§7You already selected a starter!"); return; }
    const pages = Math.ceil(STARTERS.length / 3);
    const chosen = STARTERS[state.cat].pokemon[state.pick], info = POKEMON[chosen.id];
    const v = {
        name: info.name, dex: num(`No. ${String(DEX_INFO[chosen.id]?.n ?? 0).padStart(4, "0")}`), portrait: iconOf(chosen.id),
        type1: typeCode(info.types[0]), type2: typeCode(info.types[1]), platform: `p${typeCode(info.types[0]).slice(1)}`, desc: DEX_INFO[chosen.id]?.d ?? "",
    };
    const shown = STARTERS.slice(state.page * 3, state.page * 3 + 3);
    for (let k = 0; k < 3; k++) {
        const cat = shown[k];
        v[`c${k}name`] = cat?.name ?? "";
        for (let n = 0; n < 3; n++) v[`c${k}p${n}icon`] = iconOf(cat?.pokemon[n]?.id);
    }
    const body = STARTER_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:starter").body(body);
    for (let k = 0; k < 3; k++) for (let n = 0; n < 3; n++) {
        const here = shown[k]?.pokemon[n], on = state.page * 3 + k === state.cat && n === state.pick;
        form.button("starter", `${PC_UI}/starter/${here ? (on ? "slot_on" : "slot") : "none"}`);
    }
    form.button("choose", `${PC_UI}/starter/choose`).button("exit", `${PC_UI}/summary/exit`);
    form.button("up", `${PC_UI}/pokedex/arrow_up`).button("down", `${PC_UI}/pokedex/arrow_down`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 10) return;
        const pick = r.selection;
        if (pick < 9) {
            const k = Math.floor(pick / 3), n = pick % 3;
            if (shown[k]?.pokemon[n]) { state.cat = state.page * 3 + k; state.pick = n; try { const cry = POKEMON[shown[k].pokemon[n].id]?.cry; if (cry) player.playSound(cry); } catch (e) { } }
            openStarter(player, state); return;
        }
        if (pick === 11 || pick === 12) { state.page = (state.page + (pick === 12 ? 1 : pages - 1)) % pages; openStarter(player, state); return; }
        giveStarter(player, chosen);
    }).catch(() => { });
}

function giveStarter(player, chosen) {
    if (player.getDynamicProperty(STARTER_CHOSEN)) return;
    player.setDynamicProperty(STARTER_CHOSEN, true);
    const d = player.getViewDirection(), at = { x: player.location.x + d.x * 2, y: player.location.y, z: player.location.z + d.z * 2 };
    const info = POKEMON[chosen.id];
    let entity;
    try { entity = player.dimension.spawnEntity(chosen.id, at); } catch (e) { player.setDynamicProperty(STARTER_CHOSEN, false); return; }
    system.run(() => {
        try {
            entity.triggerEvent("cobblemon:caught");
            entity.getComponent(EntityComponentTypes.Tameable)?.tame(player);
            setProp(entity, OWNER, player.id); setProp(entity, LEVEL, chosen.level);
            setProp(entity, EXP, expFor(info.expGroup, chosen.level));
            setProp(entity, MOVESET, JSON.stringify(movesAt(info, chosen.level)));
            setProp(entity, "cobblemon:caught_ball", chosen.ball);
        } catch (e) { }
        register(player, chosen.id, 2);
        sendOutEffect(player, entity, chosen.ball);
        player.sendMessage(`§aYou chose ${info.name}!`);
    });
}

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn || player.getDynamicProperty(STARTER_CHOSEN)) return;
    // a player who already has Pokemon (from before the starter screen existed) keeps them and is not asked
    system.runTimeout(() => {
        if (!player.isValid) return;
        if (summaryParty(player).length) { player.setDynamicProperty(STARTER_CHOSEN, true); return; }
        openStarter(player);
    }, 60);
});

world.afterEvents.worldLoad?.subscribe?.(() => console.log("[cobblemon] battle script ready"));
