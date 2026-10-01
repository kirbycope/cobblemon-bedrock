// Turn-based battles. A "Battle" button on a wild Pokemon's panel (or a trainer's challenge) fires a
// script event; this sends out the player's nearest owned Pokemon that can still fight, freezes both, and
// runs turns through a button form: the Pokemon's four moves with their PP, Switch, Throw Poke Ball and
// Run. Damage is the main-series formula over Showdown's move table and type chart, generated into data.js,
// with stat stages, accuracy and evasion, the major status conditions, a handful of abilities, critical
// hits and Struggle. A win earns experience; levels, the moves learned on the way and fainting are kept on
// the Pokemon as dynamic properties, and a fainted Pokemon sits out until a healing machine or the
// professor heals it.
import { world, system, EntityComponentTypes, EntityInitializationCause, ItemStack, InputButton, ButtonState, BlockPermutation, MolangVariableMap, EntityDamageCause } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import { POT_SHAPED, POT_SHAPELESS, SEASONINGS, SEASONING_FILTERS, APRIJUICES, ITEM_ICONS, BROTH_INDEX } from "./pot.js";
import { POT_LAYOUT } from "./pot_layout.js";
import { POKEMON, MOVES, TYPES, BALLS, ABILITY_NAMES, ABILITY_DESC, MOVE_DESC, NATURES, TIME_RANGES } from "./data.js";
import { SUMMARY_LAYOUT } from "./summary_layout.js";
import { NPC_SCENES } from "./npc_dialogue.js";
import { MARKS } from "./marks.js";
import { TMS, TM_SPECIES } from "./tms.js";
import { FEATURE_BARS } from "./features.js";
import { RIDES } from "./rides.js";
import { DEFENDERS } from "./defenders.js";
import { SHOULDER } from "./shoulder.js";
import { TM_LAYOUT, TM_ROWS, TM_ICONS, TM_TAGS } from "./tm_layout.js";
import { PC_LAYOUT, PC_WALLPAPERS } from "./pc_layout.js";
import { PC_ALT_WALLS } from "./pc_alt_walls.js";
import { SHINY_VARIANTS, VARIANT_FORMS } from "./variants.js";
import { DEX_LAYOUT } from "./dex_layout.js";
import { STARTERS, STARTER_LAYOUT } from "./starters.js";
import { BERRIES, FOSSILS, APRICORN_TREES } from "./blocks.js";
import { FORMATIONS, BRUSH_LOOT } from "./fossil_loot.js";
import { RODS, FISHING_SPAWNS, BIOME_TAGS, BUCKETS, ROD_TREASURE } from "./fishing.js";
import { NATIONAL, REGIONS, DEX_INFO } from "./dex.js";
import { HELD_ITEMS, MEDICINE, CANDIES, EV_ITEMS, MINTS, EV_BERRIES, HOLD_BLACKLIST, TOOLTIPS, POKE_FOOD } from "./items.js";
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
    const f = { entity, info, level, stats, hp, moves, ability: rolled, status: statusOf(entity) ?? null, sleep: 0, stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 } };
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

// every battle message goes to chat and to the battle screen's log (BattleMessagePane), which keeps the last 40 to scroll back through
function say(battle, text) {
    battle.player.sendMessage(text);
    (battle.log ??= []).push(text);
    if (battle.log.length > 40) battle.log.shift();
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
    if (battle.ally?.entity) keepStatus(battle.ally.entity, battle.ally.hp > 0 ? battle.ally.status : null);
    for (const [id, k] of Object.entries(battle.kept ?? {})) {
        if (id === battle.ally?.entity?.id) continue;
        try { keepStatus(world.getEntity(id), k.status); } catch (e) { }
    }
    system.runTimeout(() => offerLevelEvolutions(battle.player), 40);
    for (const f of [battle.ally, battle.foe]) if (f?.entity?.isValid) freeze(f.entity, false);
    // PokemonBattle.end: a wild Pokemon still out heals fully, whether it won, fled or was left
    const foe = battle.foe?.entity;
    if (!battle.trainer && foe?.isValid && POKEMON[foe.typeId] && !prop(foe, OWNER)) { healFully(foe); setProp(foe, STATUS, undefined); }
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

// Persistent statuses (PersistentStatus, PlayerPartyStore.onSecondPassed): a status a Pokemon leaves battle with stays,
// for its statusPeriod (180 to 300 seconds), counted while it is out with its trainer; poison has a 1 in 15 chance a
// second to take 5% of its health, badly poisoned 10% (Poison Heal heals instead), and running out tells the trainer
// it was cured. A wild Pokemon heals fully after battle, status and all.
const STATUS = "cobblemon:status";
const STATUS_CURED = { psn: "was cured of its poisoning", tox: "was cured of its poisoning", par: "was cured of its paralysis", brn: "was cured of its burn",
                       frz: "thawed out", slp: "woke up" };
function statusOf(e) {
    try { const st = JSON.parse(prop(e, STATUS) ?? "null"); return st && st.left > 0 ? st.s : undefined; } catch (err) { return undefined; }
}
function keepStatus(e, status) {
    if (!e?.isValid || !POKEMON[e.typeId]) return;
    if (!status || prop(e, FAINTED) || prop(e, OWNER) === undefined) { setProp(e, STATUS, undefined); return; }
    let left;
    try { left = JSON.parse(prop(e, STATUS) ?? "null")?.s === status ? JSON.parse(prop(e, STATUS)).left : undefined; } catch (err) { }
    setProp(e, STATUS, JSON.stringify({ s: status, left: left ?? 180 + Math.floor(Math.random() * 121) }));
}
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        if (battles.has(player.id)) continue;
        let mine = [];
        try { mine = player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 64 }).filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id); } catch (e) { continue; }
        for (const e of mine) {
            const raw = prop(e, STATUS);
            if (!raw) continue;
            let st; try { st = JSON.parse(raw); } catch (err) { setProp(e, STATUS, undefined); continue; }
            const name = nicknameOf(e) || POKEMON[e.typeId].name;
            if (prop(e, FAINTED)) { setProp(e, STATUS, undefined); continue; }
            if (--st.left <= 0) { setProp(e, STATUS, undefined); player.sendMessage(`${name} ${STATUS_CURED[st.s] ?? "recovered"}!`); continue; }
            if ((st.s === "psn" || st.s === "tox") && Math.random() < 1 / 15) {
                try {
                    const h = e.getComponent(EntityComponentTypes.Health), amount = Math.max(1, Math.round(h.effectiveMax * (st.s === "tox" ? 0.1 : 0.05)));
                    if (fighter(e)?.ability === "poisonheal") {
                        h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + amount));
                        if (h.currentValue >= h.effectiveMax) { setProp(e, STATUS, undefined); continue; }
                    } else if (h.currentValue - amount <= 0) {
                        // as currentHealth reaching 0 does: it faints
                        setProp(e, FAINTED, true); setProp(e, STATUS, undefined); h.setCurrentValue(1);
                        player.sendMessage(`§c${name} fainted!`); continue;
                    } else h.setCurrentValue(h.currentValue - amount);
                } catch (err) { }
            }
            setProp(e, STATUS, JSON.stringify(st));
        }
    }
}, 20);

// Ownership: the tameable component is not readable once a Pokemon is tamed, so the owner is
// remembered on the entity when the claiming interaction succeeds.
const OWNER = "cobblemon:owner";

// Nicknames live in a property of their own, so the name tag can carry Cobblemon's label; a nickname from before
// (a plain name tag, not a label) still counts
const NICK = "cobblemon:nickname", BATTLE_WINS = "cobblemon:battle_wins";
function titled(e, name) {
    const mark = MARKS[prop(e, "cobblemon:active_mark")];
    return mark?.[2] ? mark[2].replace("{}", name) : name;
}
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
            const item = inv.getItem(i), lines = item && (TOOLTIPS[item.typeId] ?? tmLore(item.typeId));
            if (!lines || item.getLore().length) continue;
            try { item.setLore(lines.map((line) => `§7${line}`)); inv.setItem(i, item); } catch (e) { }
        }
    }
}, 40);

// The trainer's and the professor's scenes on Cobblemon's DialogueScreen (the cbm:dialogue layout): the name plate,
// the face in the portrait frame, the text and the options, stacked when there are more than two. An option runs the
// scene's commands as the NPC, with @initiator the player; "/dialogue open" moves to another scene. A scene with no
// options goes on (here, closes) with a click on the box.
function showScene(player, npc, tag) {
    const scene = NPC_SCENES[tag];
    if (!scene || !npc?.isValid) return;
    const options = scene.buttons ?? [];
    const layout = !options.length ? "n" : options.length <= 2 ? "h" : "v";
    const kind = npc.typeId.slice("cobblemon:".length);
    const body = padBytes(kind, 16) + layout + scene.text.replace(/%/g, "%%");
    const form = new ActionFormData().title("cbm:dialogue" + scene.npc_name).body(body);
    if (layout === "n") form.button("", "textures/ui/cobblemon/dialogue/none");
    for (const o of options) form.button(o.name, `textures/ui/cobblemon/dialogue/${layout === "h" ? "button" : "button_full"}`);
    form.show(player).then((r) => {
        if (r.canceled || layout === "n" || !npc.isValid) return;
        for (const command of options[r.selection]?.commands ?? []) {
            const next = command.match(/^\/dialogue open \S+ \S+ (\S+)/);
            if (next) { system.runTimeout(() => showScene(player, npc, next[1]), 2); continue; }
            try { npc.runCommand(command.slice(1).replace(/@initiator/g, `"${player.name}"`)); } catch (e) { }
        }
    }).catch(() => { });
}
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target } = event;
    if (!NPC_SCENES[target?.typeId]) return;
    event.cancel = true;
    system.run(() => showScene(player, target, target.typeId));
});

// TMs (TechnicalMachineItem, TMMoveManager). A TM used on one of your own Pokemon teaches its move when the species
// can learn it from a TM and does not know it or have it to relearn; with four moves known it goes to the moves the
// Pokemon can relearn (BenchedMoves). A player learns a TM, for the TM Machine, as soon as one of their Pokemon can
// learn its move without one (its level-up moves so far, its moves and relearnable moves), and the default TMs from
// the start; the unlock is told in chat, where Cobblemon shows a toast.
const TM_INDEX = new Map(TMS.map((tm, n) => [`cobblemon:tm_${tm[0]}`, n])), TM_BY_MOVE = new Map(TMS.map((tm, n) => [tm[0], n]));
const LEARNED_TMS = "cobblemon:learned_tms", BENCHED = "cobblemon:benched";
function tmLore(typeId) { const n = TM_INDEX.get(typeId); return n === undefined ? undefined : [MOVES[TMS[n][0]]?.name ?? "Unknown Move"]; }
function benchedOf(e) { try { return JSON.parse(prop(e, BENCHED) ?? "[]"); } catch (err) { return []; } }
function learnedTms(player) { return new Set(jsonProp(player, LEARNED_TMS, [])); }
function learnTms(player, moves) {
    const known = learnedTms(player), fresh = moves.filter((m) => TM_BY_MOVE.has(m) && !known.has(m));
    if (!fresh.length) return;
    for (const m of fresh) known.add(m);
    player.setDynamicProperty(LEARNED_TMS, JSON.stringify([...known]));
    player.sendMessage(fresh.length === 1 ? `§bYou unlocked the ${MOVES[fresh[0]]?.name ?? fresh[0]} TM!` : "§bNew TMs Learned! §7Check the TM Machine");
}
// a Pokemon's moves learned without a TM: its level-up moves to its level, its moves and the ones it can relearn
function accessibleMoves(typeId, level, moves, benched) {
    const out = new Set([...(moves ?? []), ...(benched ?? [])]);
    for (const [at, id] of POKEMON[typeId]?.learnset ?? []) if (at <= level) out.add(id);
    return out;
}
function syncTms(player) {
    const moves = new Set();
    for (const id of TMS.filter((tm) => tm[2] === "default" || tm[2] === "advancement").map((tm) => tm[0])) moves.add(id);
    let mine = [];
    try { mine = player.dimension.getEntities({ families: ["owned"] }).filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id); } catch (e) { }
    for (const e of mine) {
        let known = [];
        try { known = JSON.parse(prop(e, MOVESET) ?? "null") ?? []; } catch (err) { }
        for (const m of accessibleMoves(e.typeId, prop(e, LEVEL) ?? POKEMON[e.typeId].level, known, benchedOf(e))) moves.add(m);
    }
    for (let n = 0; n < PC_BOXES; n++) for (const rec of box(player, n)) {
        if (!rec?.t) continue;
        let known = [], benched = [];
        try { known = JSON.parse(rec.mv ?? "null") ?? []; benched = JSON.parse(rec.k?.[BENCHED] ?? "[]"); } catch (err) { }
        for (const m of accessibleMoves(rec.t, rec.lv ?? 1, known, benched)) moves.add(m);
    }
    learnTms(player, [...moves]);
}
system.runInterval(() => { for (const player of world.getPlayers()) syncTms(player); }, 200);
function teachTm(player, target, itemId) {
    const n = TM_INDEX.get(itemId), move = TMS[n][0], info = POKEMON[target.typeId], name = nicknameOf(target) || info.name;
    const moveName = MOVES[move]?.name ?? move;
    // a move the battles do not carry (33 of the TMs) cannot be taught, as no battle could use it
    if (!MOVES[move] || !(TM_SPECIES[target.typeId] ?? []).includes(n)) { player.onScreenDisplay.setActionBar(`§c${name} cannot learn ${moveName}!`); return; }
    const f = fighter(target), ids = f.moves.map((mv) => mv.id), benched = benchedOf(target);
    if (ids.includes(move) || benched.includes(move) || accessibleMoves(target.typeId, f.level, [], []).has(move)) {
        player.onScreenDisplay.setActionBar(`§c${name} already knows ${moveName}!`); return;
    }
    if (player.getGameMode?.() !== "Creative") consumeHand(player);
    if (ids.length < 4) setProp(target, MOVESET, JSON.stringify([...ids, move]));
    else setProp(target, BENCHED, JSON.stringify([...benched, move]));
    player.onScreenDisplay.setActionBar(`§a${name} learned ${moveName}!`);
    try { player.playSound("cobblemon.gui.move_learn"); player.playSound("cobblemon.item.tm.use"); } catch (e) { }
}
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    const { player, target, itemStack } = event;
    if (!TM_INDEX.has(itemStack?.typeId) || !POKEMON[target?.typeId] || player.isSneaking) return;
    event.cancel = true;
    if (prop(target, OWNER) !== player.id) return;
    system.run(() => { if (target.isValid) teachTm(player, target, itemStack.typeId); });
});

// The TM Machine (TMMachineScreen, TMMachineBlockEntity), laid out by the resource pack (TM_LAYOUT in port.py). The
// type slots lead to that type's TMs (the learned ones first, the rest greyed and not chosen), under a search; a TM
// chosen shows its disc with Start, its power, accuracy, effect and description and its recipe. Start takes a blank
// TM and the recipe from the player's inventory, as the machine's slots would hold them, burns for the machine's
// 114 ticks with its sounds and the block's active state, and hands the TM over.
const tmTypes = () => ["all", ...TYPE_ORDER];   // TYPE_ORDER is declared further down
const burning = new Map();   // block key -> ticks left
function tmKey(block) { return `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`; }
function countIn(player, ids) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    let n = 0;
    if (inv) for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && ids.includes(it.typeId)) n += it.amount; }
    return n;
}
function takeFrom(player, ids, count) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    for (let i = 0; i < inv.size && count > 0; i++) {
        const it = inv.getItem(i);
        if (!it || !ids.includes(it.typeId)) continue;
        const take = Math.min(count, it.amount); count -= take;
        if (it.amount > take) { it.amount -= take; inv.setItem(i, it); } else inv.setItem(i, undefined);
    }
}
const recipeIds = (entry) => (entry[0].startsWith("#") ? TM_TAGS[entry[0]] ?? [] : [entry[0]]);
// the party down the machine's left, as the party HUD finds it, and whether each can learn a move (canLearnTMMove)
function tmParty(player) {
    try {
        return player.dimension.getEntities({ families: ["owned"], location: player.location, maxDistance: 64 })
            .filter((e) => POKEMON[e.typeId] && prop(e, OWNER) === player.id && !prop(e, "cobblemon:pasture") && !recalling.has(e.id))
            .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
    } catch (e) { return []; }
}
function tmStatus(e, move) {
    if (!move) return "n";
    let known = [];
    try { known = JSON.parse(prop(e, MOVESET) ?? "null") ?? fighter(e).moves.map((mv) => mv.id); } catch (err) { }
    if (accessibleMoves(e.typeId, prop(e, LEVEL) ?? POKEMON[e.typeId].level, known, benchedOf(e)).has(move)) return "l";
    return (TM_SPECIES[e.typeId] ?? []).includes(TM_BY_MOVE.get(move)) ? "c" : "x";
}
function heldTm(player) {
    try {
        const item = player.getComponent(EntityComponentTypes.Inventory).container.getItem(player.selectedSlotIndex);
        return TM_INDEX.has(item?.typeId) ? item.typeId : null;
    } catch (e) { return null; }
}
function openTmMachine(block, player, state = { mode: "t", type: 0, search: "", tm: null, pokemon: null }) {
    const learned = learnedTms(player), v = { mode: state.mode, search: state.search ? `§f${state.search}` : "§7Search", disc: "dxx" };
    const icons = [`${UI}/tm/none`, `${UI}/tm/none`, `${UI}/tm/none`];
    let blank = `${UI}/tm/none`;
    const typeName = tmTypes()[state.type];
    let list = TMS.map((tm, n) => n).filter((n) => MOVES[TMS[n][0]] && (typeName === "all" || TMS[n][1] === typeName));
    if (state.search) list = list.filter((n) => MOVES[TMS[n][0]].name.toLowerCase().includes(state.search.toLowerCase()));
    const party = tmParty(player), picked = party.find((e) => e.id === state.pokemon);
    if (picked) list = list.filter((n) => (TM_SPECIES[picked.typeId] ?? []).includes(n));   // the TMs that Pokemon can learn
    list.sort((a, b) => (learned.has(TMS[b][0]) - learned.has(TMS[a][0])) || MOVES[TMS[a][0]].name.localeCompare(MOVES[TMS[b][0]].name));
    list = list.slice(0, TM_ROWS.moves);
    const chosen = state.tm !== null ? TMS[state.tm] : null, mv = chosen && MOVES[chosen[0]], recipeNames = [];
    if (mv) {
        v.power = num(mv.power > 0 ? mv.power : "-");
        v.acc = num(mv.accuracy === true || !mv.accuracy ? "-" : `${mv.accuracy}%%`);
        v.eff = num(mv.secondary?.chance ? `${mv.secondary.chance}%%` : "-");
        v.desc = (MOVE_DESC[chosen[0]] ?? "").replace(/%/g, "%%");
        v.disc = `d${String(Math.max(0, TYPE_ORDER.indexOf(chosen[1]))).padStart(2, "0")}`;
        chosen[3].slice(0, 3).forEach((entry, i) => {
            const have = countIn(player, recipeIds(entry));
            icons[i] = `textures/${TM_ICONS[entry[0]] ?? "ui/cobblemon/tm/none"}`;
            recipeNames[i] = itemName(recipeIds(entry)[0] ?? entry[0]);
            v[`r${i}need`] = num(entry[1]);
            v[`r${i}have`] = (have >= entry[1] ? "§a" : "§c") + have;
        });
        blank = `${UI}/tm/bl_${countIn(player, ["cobblemon:blank_tm"]) ? "have" : "empty"}`;
    }
    const body = TM_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:tm").body(body);
    for (let n = 0; n < TM_ROWS.types; n++) form.button(tmTypes()[n], `${UI}/tm/${state.mode === "t" ? `ty${String(n).padStart(2, "0")}` : "none"}`);
    for (let n = 0; n < TM_ROWS.moves; n++) {
        const k = list[n];
        if (state.mode !== "m" || k === undefined) { form.button("", `${UI}/tm/none`); continue; }
        const move = MOVES[TMS[k][0]], code = String(Math.max(0, TYPE_ORDER.indexOf(TMS[k][1]))).padStart(2, "0");
        form.button(`t${code}` + padBytes(move.name, 16) + num(`${move.pp}PP`), `${UI}/tm/mv${code}${learned.has(TMS[k][0]) ? "" : "_off"}`);
    }
    const busy = burning.has(tmKey(block));
    form.button("back", `${UI}/tm/${state.mode === "t" ? "none" : "back"}`);
    form.button("start", `${UI}/tm/${state.mode !== "s" ? "none" : busy ? "start_off" : "start"}`);
    form.button("search", `${UI}/tm/none`);
    for (const icon of icons) form.button("", icon);
    form.button("", blank);
    const held = heldTm(player), move = held ? TMS[TM_INDEX.get(held)][0] : state.mode === "s" && chosen ? chosen[0] : null;
    const LABELS = { n: "", c: "Can Learn", x: "Cannot Learn", l: "Learned" };
    const statuses = party.map((e) => tmStatus(e, move));
    for (let n = 0; n < 6; n++) {
        const e = party[n];
        if (!e) { form.button("i----bxxo", `${UI}/tm/none`); continue; }   // blank portrait, ball and gender
        const info = POKEMON[e.typeId], ball = Math.max(0, BALL_INDEX.indexOf(prop(e, "cobblemon:caught_ball") ?? "cobblemon:poke_ball"));
        const name = (nicknameOf(e) || info.name).normalize("NFD").replace(/[^ -~]/g, "");
        form.button(iconOf(e.typeId, variantOf(e)) + `b${String(ball).padStart(2, "0")}` + ({ male: "m", female: "f" }[genderOf(e)] ?? "o")
            + padBytes(`Lv.${prop(e, LEVEL) ?? info.level}`, 6) + padBytes(LABELS[statuses[n]], 12) + name, `${UI}/tm/ps_${statuses[n]}`);
    }
    // the recipe items' hover areas, each one's text its name (the tooltip)
    for (let i = 0; i < 3; i++) form.button(recipeNames[i] ?? "", `${UI}/tm/none`);
    try { setState(block, "cobblemon:open", true); } catch (e) { }
    form.show(player).then((r) => {
        const again = () => system.runTimeout(() => openTmMachine(block, player, state), 1);
        if (r.canceled) { try { setState(block, "cobblemon:open", false); player.playSound("cobblemon.block.tm_machine.close"); } catch (e) { } return; }
        const pick = r.selection, back = TM_ROWS.types + TM_ROWS.moves;
        if (pick >= back + 13) { again(); return; }   // a recipe item's hover area
        try { player.playSound("cobblemon.gui.click"); } catch (e) { }
        if (pick < TM_ROWS.types && state.mode === "t") { state.type = pick; state.mode = "m"; state.pokemon = null; }
        else if (pick < back && state.mode === "m") {
            const k = list[pick - TM_ROWS.types];
            if (k !== undefined && learned.has(TMS[k][0])) { state.tm = k; state.mode = "s"; }
        }
        else if (pick === back) { state.mode = state.mode === "s" ? "m" : "t"; if (state.mode === "t") state.pokemon = null; }
        else if (pick >= back + 7 && party[pick - back - 7]) {
            // with a TM in hand, teach it to one that can learn it; otherwise list the TMs that Pokemon can learn
            const e = party[pick - back - 7];
            if (held && statuses[pick - back - 7] === "c") teachTm(player, e, held);
            else if (!held && state.mode !== "s") { state.pokemon = e.id; state.type = 0; state.mode = "m"; }
        }
        else if (pick === back + 1 && state.mode === "s" && chosen && !busy) {
            const missing = !countIn(player, ["cobblemon:blank_tm"]) || chosen[3].some((entry) => countIn(player, recipeIds(entry)) < entry[1]);
            if (missing) player.sendMessage("§cYou need a Blank TM and the recipe's items.");
            else {
                takeFrom(player, ["cobblemon:blank_tm"], 1);
                for (const entry of chosen[3]) takeFrom(player, recipeIds(entry), entry[1]);
                burnTm(block, player, chosen[0]);
            }
        }
        else if (pick === back + 2 && state.mode === "m") {
            new ModalFormData().title("Search").textField("Search", "", { defaultValue: state.search })
                .show(player).then((q) => { if (!q.canceled) state.search = String(q.formValues?.[0] ?? "").replace(/[%§]/g, "").slice(0, 20); again(); }).catch(() => { });
            return;
        }
        again();
    }).catch((err) => { console.warn(`TM Machine: ${err}`); try { setState(block, "cobblemon:open", false); } catch (e) { } });
}
// BURN_TOTAL_TIME at two a tick, then the craft and the disc's reset: 114 ticks, with the start, burn and craft sounds
function burnTm(block, player, move) {
    const key = tmKey(block), dim = block.dimension, at = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
    burning.set(key, 114);
    try { setState(block, "cobblemon:active", true); dim.playSound("cobblemon.block.tm_machine.start", at); } catch (e) { }
    const loop = system.runInterval(() => {
        const left = (burning.get(key) ?? 0) - 1;
        burning.set(key, left);
        if (left % 20 === 0 && left > 14) try { dim.playSound("cobblemon.block.tm_machine.burn_loop", at); } catch (e) { }
        if (left > 0) return;
        system.clearRun(loop); burning.delete(key);
        try { setState(dim.getBlock(block.location), "cobblemon:active", false); dim.playSound("cobblemon.block.tm_machine.craft", at); } catch (e) { }
        if (player.isValid) { giveOrDrop(player, `cobblemon:tm_${move}`); player.sendMessage(`§aThe TM Machine made a ${MOVES[move]?.name} TM.`); }
        else try { dim.spawnItem(new ItemStack(`cobblemon:tm_${move}`, 1), at); } catch (e) { }
    }, 1);
}
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { block, player, isFirstEvent } = event;
    if (block?.typeId !== "cobblemon:tm_machine" || player.isSneaking) return;
    event.cancel = true;
    if (!isFirstEvent) return;
    system.run(() => { syncTms(player); try { player.playSound("cobblemon.block.tm_machine.open"); } catch (e) { } openTmMachine(block, player); });
});

// The campfire pot (CampfirePotItem, CampfireBlock): a pot used on a lit campfire sits on it, making Cobblemon's
// campfire with that pot (cobblemon:campfire_<colour>), and on an unlit one does nothing unless sneaking places it as
// a block; using the campfire opens the pot, sneaking with an empty hand takes the pot back, and breaking it drops the
// pot and what is in it. What a pot holds is kept by the world, by place: the result slot, the nine of the grid, the
// three seasonings, and the cooking progress.
const POT_COLOURS = ["red", "yellow", "green", "blue", "pink", "black", "white"];
const potColour = (id) => (id?.startsWith("cobblemon:campfire_") ? POT_COLOURS.find((c) => id === `cobblemon:campfire_${c}`) : undefined);
const potKey = (block) => `cobblemon:pot|${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
function potData(block) {
    try { return JSON.parse(world.getDynamicProperty(potKey(block)) ?? "null") ?? { s: Array(13).fill(null), p: 0 }; } catch (e) { return { s: Array(13).fill(null), p: 0 }; }
}
function savePot(block, data) {
    const key = potKey(block);
    world.setDynamicProperty(key, data ? JSON.stringify(data) : undefined);
    const index = new Set(JSON.parse(world.getDynamicProperty("cobblemon:pots") ?? "[]"));
    if (data && data.s.some(Boolean)) index.add(key); else if (!data || !data.s.some(Boolean)) index.delete(key);
    world.setDynamicProperty("cobblemon:pots", JSON.stringify([...index]));
}
function playAt(block, sound) {
    try { block.dimension.playSound(sound, { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 }); } catch (e) { }
}
function dropPot(dimension, location, data, colour) {
    const at = { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 };
    for (const slot of data?.s ?? []) if (slot) try { dimension.spawnItem(slotStack(slot), at); } catch (e) { }
    if (colour) try { dimension.spawnItem(new ItemStack(`cobblemon:campfire_pot_${colour}`, 1), at); } catch (e) { }
}
function removePot(block, player) {
    const colour = potColour(block.typeId), facing = block.permutation.getState("minecraft:cardinal_direction") ?? "south";
    const data = potData(block);
    dropPot(block.dimension, block.location, data);
    savePot(block, null);
    block.setPermutation(BlockPermutation.resolve("minecraft:campfire", { "minecraft:cardinal_direction": facing }));
    if (player.getGameMode?.() !== "Creative") giveOrDrop(player, `cobblemon:campfire_pot_${colour}`);
    playAt(block, "cobblemon.block.campfire_pot.retrieve");
}
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { block, player, itemStack, isFirstEvent } = event;
    const id = block?.typeId, held = itemStack?.typeId;
    if (id === "minecraft:campfire" && held?.startsWith("cobblemon:campfire_pot_")) {
        const colour = held.slice("cobblemon:campfire_pot_".length);
        if (!POT_COLOURS.includes(colour)) return;
        let lit = false;
        try { lit = !block.permutation.getState("extinguished"); } catch (e) { }
        if (!lit) { if (!player.isSneaking) event.cancel = true; return; }   // an unlit campfire takes no pot
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => {
            const facing = block.permutation.getState("minecraft:cardinal_direction") ?? "south";
            block.setPermutation(BlockPermutation.resolve(`cobblemon:campfire_${colour}`, { "minecraft:cardinal_direction": facing }));
            savePot(block, null);
            consumeHand(player);
            playAt(block, "cobblemon.block.campfire_pot.set");
        });
        return;
    }
    if (!potColour(id)) return;
    event.cancel = true;
    if (!isFirstEvent) return;
    system.run(() => {
        if (player.isSneaking) { if (!held) removePot(block, player); return; }
        openPot(block, player);
    });
});
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    const colour = potColour(brokenBlockPermutation.type.id);
    if (!colour) return;
    dropPot(block.dimension, block.location, potData(block), colour);
    savePot(block, null);
});
// CookingPotScreen: a slot clicked in the inventory is picked up (framed), and an empty grid or seasoning slot clicked
// then takes one of it (the same item there takes the stack, a different one swaps back); the picked slot clicked again moves its stack in as a shift-click
// does (CookingPotMenu.quickMoveStack: the grid, and for a seasoning the seasoning slots after it), and a pot slot
// clicked with nothing picked goes back to the inventory. The Cook button opens and closes the lid. The screen is shown
// again after every click.
const potOpen = new Map();   // player id -> { block, picked }
const POT_INV = [...Array(27).keys()].map((i) => i + 9).concat([...Array(9).keys()]);   // the form's slots 13 to 48: inventory rows, then hotbar
function potIcon(id) { return id ? `textures/${ITEM_ICONS[id] ?? "ui/cobblemon/pot/unknown"}` : `${UI}/pot/none`; }
function maxStack(id) { try { return new ItemStack(id, 1).maxAmount; } catch (e) { return 64; } }
// into the given inventory slots: onto stacks of the same item first, then empty ones (moveItemStackTo)
function moveInto(slots, get, set, id, count, meta) {
    const most = maxStack(id), probe = [id, 0, meta];
    for (const pass of [true, false]) for (const n of slots) {
        if (!count) return 0;
        const here = get(n);
        if (pass ? !(sameSlot(here, probe) && here[1] < most) : here) continue;
        const take = Math.min(count, most - (here?.[1] ?? 0));
        set(n, meta ? [id, (here?.[1] ?? 0) + take, meta] : [id, (here?.[1] ?? 0) + take]); count -= take;
    }
    return count;
}
function potRecipe(grid) {
    const cell = (x, y) => grid[y * 3 + x];
    for (const r of POT_SHAPED) {
        const h = r.rows.length, w = Math.max(...r.rows.map((row) => row.length));
        for (let oy = 0; oy <= 3 - h; oy++) for (let ox = 0; ox <= 3 - w; ox++) for (const mirror of [false, true]) {
            let ok = true;
            for (let y = 0; y < 3 && ok; y++) for (let x = 0; x < 3 && ok; x++) {
                const px = x - ox, py = y - oy, id = cell(x, y)?.[0];
                const ch = px >= 0 && px < w && py >= 0 && py < h ? (r.rows[py][mirror ? w - 1 - px : px] ?? " ") : " ";
                ok = ch === " " ? !id : !!id && (r.key[ch] ?? []).includes(id);
            }
            if (ok) return r;
        }
    }
    const items = grid.filter(Boolean).map((s) => s[0]);
    for (const r of POT_SHAPELESS) {
        if (items.length !== r.ing.length) continue;
        const used = Array(items.length).fill(false);
        const fit = (k) => k === r.ing.length || items.some((id, i) => !used[i] && r.ing[k].includes(id) && ((used[i] = true), fit(k + 1) || ((used[i] = false), false)));
        if (fit(0)) return r;
    }
    return null;
}
// Aprijuice (RideBoostsSeasoningProcessor, AprijuiceItem): cooked with flavour seasonings (the berries), each stat
// takes the points its flavour's sum reaches (statPointFlavourThresholds) plus its apricorn's own, and the juice is
// named Plain, Tasty or Delicious by its total (cookingQualityPointThresholds), its boosts in its lore as
// AprijuiceTooltipGenerator shows them; those lines are read back when it is used on a Pokemon
const RIDE_STATS = ["ACCELERATION", "SKILL", "SPEED", "STAMINA", "JUMP"];
const RIDE_STAT_NAMES = { ACCELERATION: "Accel.", SKILL: "Skill", SPEED: "Speed", STAMINA: "Stamina", JUMP: "Jump" };
const RIDE_FLAVOURS = { ACCELERATION: "SPICY", SKILL: "DRY", SPEED: "SWEET", STAMINA: "SOUR", JUMP: "BITTER" };
const RIDE_COLOURS = { ACCELERATION: "§c", SKILL: "§b", SPEED: "§d", STAMINA: "§e", JUMP: "§a" };
const aprijuiceColour = (id) => (id?.startsWith("cobblemon:aprijuice_") ? id.slice("cobblemon:aprijuice_".length).toUpperCase() : null);
function aprijuiceBoosts(colour, seasonings) {
    const flavours = {};
    for (const id of seasonings) for (const [flavour, value] of Object.entries(SEASONINGS[id]?.flavours ?? {})) flavours[flavour] = (flavours[flavour] ?? 0) + value;
    const boosts = {};
    for (const stat of RIDE_STATS) {
        const value = flavours[RIDE_FLAVOURS[stat]] ?? 0;
        const points = Math.max(0, ...Object.entries(APRIJUICES.statPointFlavourThresholds).filter(([at]) => value >= Number(at)).map(([, p]) => p));
        const total = points + (APRIJUICES.apricornStatEffects[colour]?.[stat] ?? 0);
        if (total) boosts[stat] = total;
    }
    return boosts;
}
function aprijuiceQuality(boosts) {
    const total = Object.values(boosts).reduce((a, b) => a + b, 0), order = ["LOW", "MEDIUM", "HIGH"];
    return Object.entries(APRIJUICES.cookingQualityPointThresholds).filter(([at]) => total >= Number(at)).map(([, q]) => q).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? "LOW";
}
// The other seasoning processors: mob_effects (MobEffectUtils.mergeEffects: the strongest amplifier, durations
// summed at 1, 0.75, 0.5 and 0.25 from the longest), food (FoodUtils.merge on the result's own nutrition, scaled by
// 1, 0.8, 0.6 or 0.4 with the number of seasonings), ingredient (the seasonings' ids: a Ponigiri with sweet berries
// is a Jelly Donut); a seasoning is used up when one of the recipe's processors reads it (consumesItem)
const BASE_FOOD = { "cobblemon:ponigiri": [2, 2.2] };   // PonigiriItem's nutrition 2 at 0.55
const effectName = (id) => id.split(":").pop().split("_").map(cap).join(" ");
const ROMAN = ["", " II", " III", " IV", " V", " VI"];
function seasonResult(recipe, ids) {
    const meta = {}, data = ids.map((id) => SEASONINGS[id] ?? {});
    if (recipe.proc.includes("mob_effects")) {
        const groups = {};
        for (const s of data) for (const e of s.mobEffects ?? []) (groups[e.effect] ??= []).push(e);
        meta.effects = Object.entries(groups).map(([effect, group]) => ({ e: effect, a: Math.max(...group.map((g) => g.amplifier ?? 0)),
            d: Math.ceil(group.map((g) => g.duration).sort((a, b) => b - a).reduce((sum, d, i) => sum + d * ([1, 0.75, 0.5][i] ?? 0.25), 0)) }));
    }
    if (recipe.proc.includes("food")) {
        const foods = data.filter((s) => s.food).map((s) => s.food), [h0, s0] = BASE_FOOD[recipe.out] ?? [0, 0];
        if (foods.length) {
            const k = [1, 0.8, 0.6][foods.length - 1] ?? 0.4;
            meta.food = [Math.ceil((foods.reduce((a, f) => a + (f.hunger ?? 0), 0) + h0) * k), Math.round((foods.reduce((a, f) => a + (f.saturation ?? 0), 0) + s0) * k * 100) / 100];
        } else meta.food = [h0, s0];
    }
    if (recipe.proc.includes("ingredient")) meta.ing = ids.filter((id) => SEASONINGS[id]);
    return Object.keys(meta).length ? meta : undefined;
}
function consumesSeasoning(recipe, id) {
    const s = SEASONINGS[id];
    if (!s) return false;
    return recipe.proc.some((p) => (p === "ride_boosts" ? Object.keys(s.flavours ?? {}).length : p === "mob_effects" ? !!s.mobEffects : p === "food" ? !!s.food
        : p === "spawn_bait" ? !!s.baitEffects?.length : p === "ingredient" || p === "food_colour"));
}
// a slot's item as an ItemStack, with an Aprijuice's name and boosts
function slotStack(s) {
    const stack = new ItemStack(s[0], s[1]);
    const boosts = s[2]?.boosts, colour = aprijuiceColour(s[0]);
    if (boosts && colour) {
        const has = Object.keys(boosts).length, quality = aprijuiceQuality(boosts);
        const prefix = !has ? "Plain" : { HIGH: "Delicious", MEDIUM: "Tasty", LOW: "Plain" }[quality];
        stack.nameTag = `§r${prefix} ${cap(colour.toLowerCase())} Aprijuice`;
        if (has) stack.setLore([`§7Quality: ${cap(quality.toLowerCase())}`, "§7Riding Stat Boosts:",
            ...RIDE_STATS.filter((k) => boosts[k]).map((k) => `${RIDE_COLOURS[k]}${RIDE_STAT_NAMES[k]}§7: ${boosts[k] < 0 ? `§c${boosts[k]}` : `§a+${boosts[k]}`}`)]);
    }
    const meta = s[2];
    if (meta && !colour) {
        const lore = [];
        if (meta.effects?.length) {
            lore.push("§7Effect:");
            for (const e of meta.effects) lore.push(`§9${effectName(e.e)}${ROMAN[e.a] ?? ` ${e.a + 1}`} (${Math.floor(e.d / 1200)}:${String(Math.floor(e.d / 20) % 60).padStart(2, "0")})`);
        }
        if (meta.food) lore.push("§7Nutrition:", `§a+${meta.food[0]} Hunger, +${meta.food[1]} Saturation`);
        if (meta.ing?.length) lore.push(`§8Seasonings: ${meta.ing.map((id) => itemName(id)).join(", ")}`);
        if (meta.ing?.includes("minecraft:sweet_berries") && s[0] === "cobblemon:ponigiri") stack.nameTag = "§rJelly Donut";
        if (lore.length) stack.setLore(lore);
    }
    return stack;
}
function stackSlot(item) {
    if (!item) return null;
    const out = [item.typeId, item.amount];
    if (aprijuiceColour(item.typeId) && /Aprijuice/.test(item.nameTag ?? "")) {
        const boosts = {};
        for (const line of item.getLore()) {
            const m = line.replace(/§./g, "").match(/^(Accel\.|Skill|Speed|Stamina|Jump): ([+-]\d+)$/);
            if (m) boosts[Object.keys(RIDE_STAT_NAMES).find((k) => RIDE_STAT_NAMES[k] === m[1])] = Number(m[2]);
        }
        out.push({ boosts });
        return out;
    }
    const lore = item.getLore?.() ?? [], meta = {};
    for (const raw of lore) {
        const line = raw.replace(/§./g, "");
        const effect = line.match(/^(.+?)( II| III| IV| V| VI)? \((\d+):(\d\d)\)$/);
        if (effect) {
            const id = Object.values(SEASONINGS).flatMap((s) => s.mobEffects ?? []).map((e) => e.effect).find((e) => effectName(e) === effect[1]) ?? `minecraft:${effect[1].toLowerCase().replace(/ /g, "_")}`;
            (meta.effects ??= []).push({ e: id, a: ROMAN.indexOf(effect[2] ?? ""), d: Number(effect[3]) * 1200 + Number(effect[4]) * 20 });
        }
        const food = line.match(/^\+(\d+) Hunger, \+([\d.]+) Saturation$/);
        if (food) meta.food = [Number(food[1]), Number(food[2])];
        const ing = line.match(/^Seasonings: (.+)$/);
        if (ing) meta.ing = ing[1].split(", ").map((name) => Object.keys(SEASONINGS).find((id) => itemName(id) === name)).filter(Boolean);
    }
    if (Object.keys(meta).length) out.push(meta);
    return out;
}
// drinking a tea gives its effects (SinisterTeaItem), eating a Ponigiri adds its nutrition on top (PonigiriItem)
world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
    const meta = stackSlot(itemStack)?.[2];
    if (!meta || aprijuiceColour(itemStack.typeId)) return;
    for (const e of meta.effects ?? []) try { source.addEffect(e.e.split(":").pop(), Math.max(1, e.d), { amplifier: e.a }); } catch (err) { }
    if (meta.food) {
        try {
            const hunger = source.getComponent("minecraft:player.hunger"), saturation = source.getComponent("minecraft:player.saturation");
            hunger.setCurrentValue(Math.min(20, hunger.currentValue + meta.food[0]));
            saturation.setCurrentValue(Math.min(hunger.currentValue, saturation.currentValue + meta.food[1]));
        } catch (err) { }
    }
});
const sameSlot = (a, b) => a && b && a[0] === b[0] && JSON.stringify(a[2] ?? null) === JSON.stringify(b[2] ?? null);
const REMAINDERS = { "minecraft:milk_bucket": "minecraft:bucket", "minecraft:water_bucket": "minecraft:bucket", "minecraft:honey_bottle": "minecraft:glass_bottle",
                     "minecraft:potion": "minecraft:glass_bottle", "minecraft:dragon_breath": "minecraft:glass_bottle" };
// RecipeBookComponent beside the pot (CookingPotScreen's recipe book button): the campfire pot's tabs (the compass
// shows every category, foods, misc, medicines and complex dishes in that order, then each category alone), its
// recipes grouped as ClientRecipeBook groups them (a recipe group is one button, on the many-recipe slot), 20 a page,
// craftable from the inventory and the grid or not, the filter showing only craftable ones, and the search matching
// result names. A craftable recipe clicked is placed (ServerPlaceRecipe: the grid back to the inventory, then one of
// each ingredient from the inventory into place), otherwise it shows as a ghost; a group opens OverlayRecipeComponent
// to pick from, craftable ones first. Whether the book is open and filtering is kept per player, as the recipe book
// settings are. Every recipe shows, as if the book had them all.
const RB_ALL = [...POT_SHAPED, ...POT_SHAPELESS].sort((a, b) => (a.id < b.id ? -1 : 1));
const RB_TABS = [["foods", "misc", "medicines", "complex_dishes"], ["foods"], ["medicines"], ["complex_dishes"], ["misc"]];
const RB_TAB_ICONS = ["minecraft:compass", "cobblemon:leek_and_potato_stew", "cobblemon:potion", "cobblemon:aprijuice_red", "cobblemon:protein"];
const RB_FIRST = 51, RB_SETTINGS = "cobblemon:pot_book";
function rbCollections(tab) {
    const out = [];
    for (const cat of RB_TABS[tab]) {
        const groups = new Map();
        for (const r of RB_ALL.filter((r) => r.cat === cat)) {
            const key = r.grp || r.id;
            if (!groups.has(key)) { groups.set(key, []); out.push(groups.get(key)); }
            groups.get(key).push(r);
        }
    }
    return out;
}
// PlaceRecipe.placeRecipe: where each ingredient goes in the 3 by 3 grid, a shaped recipe (its pattern shrunk to its
// items) from the top left, centred in a direction it is narrower than half the grid, a shapeless one in reading order
function rbPlace(r) {
    let ings, w = 3, h = 3;
    if (r.rows) {
        let rows = r.rows.filter((row) => row.trim());
        const left = Math.min(...rows.map((row) => row.search(/\S/))), right = Math.max(...rows.map((row) => row.trimEnd().length));
        rows = rows.map((row) => row.padEnd(right).slice(left, right));
        w = right - left; h = rows.length;
        ings = rows.flatMap((row) => [...row].map((ch) => (ch === " " ? null : r.key[ch])));
    } else ings = r.ing;
    const out = Array(9).fill(null);
    let it = 0, k = 0;
    for (let l = 0; l < 3; ++l) {
        if (h < 1.5 && Math.floor(1.5 - h / 2) > l) { k += 3; ++l; }
        for (let n = 0; n < 3; ++n) {
            if (it >= ings.length) return out;
            const centred = w < 1.5, mid = Math.floor(1.5 - w / 2);
            const end = centred ? mid + w : w, inside = centred ? mid <= n && n < mid + w : n < w;
            if (inside) { const ing = ings[it++]; if (ing?.length) out[k] = ing; }
            else if (end === n) { k += 3 - n; break; }
            ++k;
        }
    }
    return out;
}
// StackedContents: whether the inventory and the grid together hold one of each ingredient
function rbCraftable(r, counts) {
    const have = new Map(counts);
    for (const ing of rbPlace(r).filter(Boolean).sort((a, b) => a.length - b.length)) {
        const id = ing.find((i) => (have.get(i) ?? 0) > 0);
        if (!id) return false;
        have.set(id, have.get(id) - 1);
    }
    return true;
}
function rbSettings(player) { try { return JSON.parse(player.getDynamicProperty(RB_SETTINGS) ?? "{}"); } catch (e) { return {}; } }
function rbView(player, st, data, inv) {
    const counts = new Map();
    const add = (id, n) => { if (id) counts.set(id, (counts.get(id) ?? 0) + n); };
    for (const slot of POT_INV) { const it = inv?.getItem(slot); add(it?.typeId, it?.amount ?? 0); }
    for (let n = 1; n < 10; n++) add(data.s[n]?.[0], data.s[n]?.[1] ?? 0);
    const set = rbSettings(player), query = (st.search ?? "").toLowerCase();
    const craftable = (r) => rbCraftable(r, counts);
    const shown = rbCollections(st.tab ?? 0)
        .filter((c) => !query || c.some((r) => itemName(r.out).toLowerCase().includes(query)))
        .map((c) => (set.filter ? c.filter(craftable) : c)).filter((c) => c.length);
    const pages = Math.max(1, Math.ceil(shown.length / 20)), page = Math.min(st.page ?? 0, pages - 1);
    return { set, craftable, shown, pages, page };
}

function openPot(block, player) {
    if (!potColour(block.typeId)) return;
    const state = potOpen.get(player.id) ?? { picked: null };
    state.block = block; potOpen.set(player.id, state);
    const data = potData(block), inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    const lid = !!block.permutation.getState("cobblemon:lid"), colour = potColour(block.typeId);
    const recipe = potRecipe(data.s.slice(1, 10));
    const progress = potProgress.get(potKey(block)) ?? 0, step = Math.ceil((progress / 200) * 22);
    const book = rbView(player, state, data, inv), open = !!book.set.open;
    state.page = book.page;
    const ovl = state.overlay;
    const v = { prog: `${progress > 0 ? "an" : "cp"}${String(progress > 0 ? Math.min(21, Math.floor((progress / 200) * 22)) : step).padStart(2, "0")}`,
                sel: state.picked === null ? "s--" : `s${String(state.picked).padStart(2, "0")}`, title: "Campfire Pot",
                book: open ? "y" : "n", page: book.pages > 1 ? `§r${book.page + 1}/${book.pages}` : "",
                search: state.search ? state.search : "§7§oSearch...",
                ovl: ovl ? `o${Math.min(4, ovl.length)}x${Math.ceil(ovl.length / 4)}` : "none" };
    const form = new ActionFormData().title("cbm:pot").body(POT_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join(""));
    // each slot's text: its count (5 bytes) then the item's name, the hovered tooltip; nothing for an empty slot
    const slotText = (id, count, shown) => !id ? "" : padBytes(count > 1 ? `\u00a7r${count}` : "", 5) + (id ? (shown ?? itemName(id)).replace(/\u00a7./g, "") : "");
    for (let n = 0; n < 13; n++) { const s = data.s[n]; form.button(slotText(s?.[0], s?.[1] ?? 0, s ? slotStack(s).nameTag : undefined), potIcon(s?.[0])); }
    for (const slot of POT_INV) { const it = inv?.getItem(slot); form.button(slotText(it?.typeId, it?.amount ?? 0, it?.nameTag), potIcon(it?.typeId)); }
    form.button("cook", `${UI}/pot/cook_${colour}_${lid ? "closed" : "open"}`);
    form.button("", recipe && !data.s[0] ? potIcon(recipe.out) : `${UI}/pot/none`);   // the result's preview
    // the recipe book: its button, the filter, page arrows, search box, tabs and recipe buttons, then the ghost slots
    const P = `${UI}/pot/rb_`, none = `${UI}/pot/none`;
    form.button("book", `${P}button`);
    form.button(book.set.filter ? "Showing Cookable" : "Showing All", `${P}filter_${book.set.filter ? "enabled" : "disabled"}`);
    form.button("back", book.page > 0 ? `${P}page_backward` : none);
    form.button("forward", book.page < book.pages - 1 ? `${P}page_forward` : none);
    form.button("search", none);
    RB_TAB_ICONS.forEach((icon, l) => form.button((state.tab ?? 0) === l ? "s" : "n", potIcon(icon)));
    const onPage = book.shown.slice(book.page * 20, book.page * 20 + 20);
    for (let l = 0; l < 20; l++) {
        const c = onPage[l];
        if (!c) { form.button("", none); continue; }
        const any = c.some(book.craftable), first = c.find(book.craftable) ?? c[0];
        form.button((c.length > 1 ? (any ? "_" : "|") : any ? "~" : "^") + itemName(first.out), potIcon(first.out));
    }
    const ghost = open && state.ghost ? RB_ALL.find((r) => r.id === state.ghost) : null, ghostAt = ghost ? rbPlace(ghost) : [];
    form.button("", ghost && !data.s[0] ? potIcon(ghost.out) : none);
    for (let k = 0; k < 9; k++) form.button("", ghostAt[k] && !data.s[k + 1] ? potIcon(ghostAt[k][0]) : none);
    if (open) {
        // OverlayRecipeComponent: the group's recipes, each with its ingredients small in their places
        for (let n = 0; n < 16; n++) form.button(ovl?.[n] ? (book.craftable(ovl[n]) ? "_overlay" : "_overlay_disabled") : "", none);
        for (let n = 0; n < 16; n++) { const at = ovl?.[n] ? rbPlace(ovl[n]) : []; for (let k = 0; k < 9; k++) form.button("", at[k] ? potIcon(at[k][0]) : none); }
    }
    form.show(player).then((r) => {
        const st = potOpen.get(player.id);
        if (r.canceled) { potOpen.delete(player.id); return; }
        if (!block.isValid || !potColour(block.typeId)) { potOpen.delete(player.id); return; }
        const pick = r.selection, d = potData(block);
        const invGet = (n) => stackSlot(inv.getItem(POT_INV[n - 13]));
        const invSet = (n, s) => inv.setItem(POT_INV[n - 13], s ? slotStack(s) : undefined);
        const toInventory = (s) => moveInto([...Array(36).keys()].map((i) => i + 13), invGet, invSet, s[0], s[1], s[2]);
        const potSet = (n, s) => { d.s[n] = s; };
        // a click anywhere while the overlay is up only closes it, unless it picks one of its recipes
        const overlay = st.overlay; st.overlay = null;
        const settings = rbSettings(player), saveSettings = () => player.setDynamicProperty(RB_SETTINGS, JSON.stringify(settings));
        const act = (recipe) => {
            // ServerPlaceRecipe.recipeClicked: the grid back to the inventory, then one of each ingredient into its place
            // when the two together hold them, or else the ghost of the recipe over the empty grid
            const can = rbView(player, st, d, inv).craftable(recipe);
            for (let n = 1; n < 10; n++) {
                if (!d.s[n]) continue;
                const left = toInventory(d.s[n]);
                if (left) { d.s[n] = [d.s[n][0], left, ...d.s[n].slice(2)]; return; }
                d.s[n] = null;
            }
            if (!can) { st.ghost = recipe.id; return; }
            rbPlace(recipe).forEach((ing, k) => {
                if (!ing) return;
                for (let n = 13; n <= 48; n++) {
                    const here = invGet(n);
                    if (!here || !ing.includes(here[0])) continue;
                    d.s[k + 1] = [here[0], 1, ...here.slice(2)];
                    invSet(n, here[1] > 1 ? [here[0], here[1] - 1, ...here.slice(2)] : null);
                    return;
                }
            });
            st.ghost = null;
        };
        if (pick >= RB_FIRST) {
            const b = pick - RB_FIRST, view = rbView(player, st, d, inv);
            if (b === 0) { settings.open = !settings.open; if (!settings.open) st.ghost = null; saveSettings(); }
            else if (b === 1) { settings.filter = !settings.filter; st.page = 0; saveSettings(); }
            else if (b === 2) st.page = Math.max(0, view.page - 1);
            else if (b === 3) st.page = Math.min(view.pages - 1, view.page + 1);
            else if (b === 4) {
                new ModalFormData().title("Search").textField("Search", "Search...", { defaultValue: st.search ?? "" }).show(player).then((res) => {
                    if (!res.canceled) { st.search = String(res.formValues?.[0] ?? "").normalize("NFD").replace(/[^ -~]/g, "").slice(0, 20).trim(); st.page = 0; }
                    system.run(() => openPot(block, player));
                }).catch(() => potOpen.delete(player.id));
                return;
            }
            else if (b >= 5 && b < 10) { st.tab = b - 5; st.page = 0; }
            else if (b >= 10 && b < 30 && !overlay) {
                const c = view.shown[view.page * 20 + b - 10];
                if (c?.length === 1) act(c[0]);
                else if (c) st.overlay = [...c.filter(view.craftable), ...c.filter((x) => !view.craftable(x))];
            }
            else if (b >= 40 && b < 56 && overlay?.[b - 40]) act(overlay[b - 40]);
            savePot(block, d); showPotContents(block, d);
            system.run(() => openPot(block, player));
            return;
        }
        // a grid or result click puts the ghost away (RecipeBookComponent.slotClicked)
        if (pick < 13) st.ghost = null;
        if (pick === 49) {
            setState(block, "cobblemon:lid", !lid);
            playAt(block, lid ? "cobblemon.block.campfire_pot.open" : "cobblemon.block.campfire_pot.close");
        } else if (pick >= 13 && pick <= 48) {
            const here = invGet(pick);
            if (st.picked === pick && here) {
                // quickMoveStack: the grid, then for a seasoning the seasoning slots
                let left = moveInto([1, 2, 3, 4, 5, 6, 7, 8, 9], (n) => d.s[n], potSet, here[0], here[1], here[2]);
                if (left && SEASONINGS[here[0]]) left = moveInto([10, 11, 12], (n) => d.s[n], potSet, here[0], left, here[2]);
                invSet(pick, left ? [here[0], left, here[2]] : null); st.picked = null;
            } else st.picked = here ? pick : null;
        } else if (pick < 13) {
            const held = st.picked !== null ? invGet(st.picked) : null;
            if (held && pick > 0 && (pick < 10 || SEASONINGS[held[0]])) {
                const there = d.s[pick];
                if (!there) {
                    // an empty slot takes one, as a right-click places one, and the rest stays picked for the next slot
                    // (a seasoning counts once whatever its count, and a recipe takes one from each grid slot)
                    d.s[pick] = [held[0], 1, ...held.slice(2)]; invSet(st.picked, held[1] > 1 ? [held[0], held[1] - 1, ...held.slice(2)] : null);
                    if (held[1] > 1) { savePot(block, d); showPotContents(block, d); system.run(() => openPot(block, player)); return; }
                } else if (sameSlot(there, held)) {
                    const room = maxStack(held[0]) - there[1], take = Math.min(room, held[1]);
                    d.s[pick] = [there[0], there[1] + take, ...there.slice(2)]; invSet(st.picked, held[1] - take ? [held[0], held[1] - take, ...held.slice(2)] : null);
                } else { d.s[pick] = held; invSet(st.picked, there); }
                st.picked = null;
            } else if (d.s[pick]) {
                const left = toInventory(d.s[pick]);
                d.s[pick] = left ? [d.s[pick][0], left, ...d.s[pick].slice(2)] : null;
                if (pick === 0) playAt(block, "cobblemon.block.campfire_pot.take_item");
            }
        }
        savePot(block, d); showPotContents(block, d);
        system.run(() => openPot(block, player));
    }).catch((err) => { console.warn(`campfire pot: ${err}`); potOpen.delete(player.id); });
}
// the broth shows while anything is in the pot (CampfirePotBlock.OCCUPIED), in the colour of the seasonings' dominant
// flavours (getColourMixFromSeasonings: the flavours summed in the order they are met, the first of the strongest
// weighted most), or the base broth without any
// the dominant flavours of the pot's seasonings, in the order met (getColourMixFromSeasonings)
function potDominant(data) {
    const sums = new Map();
    for (const n of [10, 11, 12]) for (const [flavour, value] of Object.entries(SEASONINGS[data.s[n]?.[0]]?.flavours ?? {})) sums.set(flavour, (sums.get(flavour) ?? 0) + value);
    const top = Math.max(...sums.values());
    return [...sums].filter(([f, v]) => v === top && f !== "MILD").map(([f]) => f);
}
// the bubbles' colour: bubbleColourMap's mix (the first at 0.7), or BASE_BROTH_BUBBLE_COLOR
const BUBBLE_COLOURS = { SPICY: 0xFFD9AD, DRY: 0xBCF8FE, SWEET: 0xFEE3F9, BITTER: 0xC8F7BC, SOUR: 0xFDFAB8 };
function bubbleColour(data) {
    const cols = potDominant(data).map((f) => BUBBLE_COLOURS[f]);
    if (!cols.length) return { red: 0xFE / 255, green: 0xFD / 255, blue: 0xE4 / 255, alpha: 1 };
    const w = cols.length === 1 ? [1] : [0.7, ...cols.slice(1).map(() => 0.3 / (cols.length - 1))];
    const ch = (sh) => Math.floor(cols.reduce((a, c, i) => a + ((c >> sh) & 255) * w[i], 0)) / 255;
    return { red: ch(16), green: ch(8), blue: ch(0), alpha: 1 };
}
function showPotContents(block, data) {
    setState(block, "cobblemon:occupied", data.s.slice(1).some(Boolean));
    const sums = new Map();
    for (const n of [10, 11, 12]) for (const [flavour, value] of Object.entries(SEASONINGS[data.s[n]?.[0]]?.flavours ?? {})) sums.set(flavour, (sums.get(flavour) ?? 0) + value);
    const order = ["SPICY", "DRY", "SWEET", "BITTER", "SOUR"], top = Math.max(...sums.values());
    const dominant = [...sums].filter(([f, v]) => v === top && order.includes(f)).map(([f]) => f);
    const index = dominant.length ? BROTH_INDEX[`${dominant[0]}|${dominant.slice(1).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(",")}`] ?? 0 : 0;
    try { block.setPermutation(block.permutation.withState("cobblemon:broth_hi", Math.floor(index / 16)).withState("cobblemon:broth_lo", index % 16)); } catch (e) { }
}
// CampfireBlockEntity.serverTick: with the lid closed and a recipe in the grid the pot cooks, two a tick to 200; then
// the result goes to the result slot (if it is empty or the same item with room), each grid slot gives up one item
// (a bucket or bottle left behind drops beside the pot), and the cook sound plays
const potProgress = new Map();   // pot key -> progress
system.runInterval(() => {
    for (const [id, st] of potOpen) {
        const player = world.getPlayers().find((p) => p.id === id);
        if (!player) { potOpen.delete(id); continue; }
    }
    const index = JSON.parse(world.getDynamicProperty("cobblemon:pots") ?? "[]");
    for (const key of index) {
        const [, dimId, pos] = key.split("|"), [x, y, z] = pos.split(",").map(Number);
        let block;
        try { block = world.getDimension(dimId).getBlock({ x, y, z }); } catch (e) { continue; }
        if (!block) continue;   // not loaded
        if (!potColour(block.typeId)) { savePot(block, null); continue; }
        const data = potData(block), recipe = potRecipe(data.s.slice(1, 10)), lid = !!block.permutation.getState("cobblemon:lid");
        let progress = potProgress.get(key) ?? 0;
        const before = progress > 0;
        const out = data.s[0];
        // the seasonings the recipe takes (its seasoningTag) and what they make of the result
        const filter = SEASONING_FILTERS[recipe?.tag] ?? [], seasoned = [10, 11, 12].filter((n) => data.s[n] && filter.includes(data.s[n][0]));
        const meta = recipe?.proc.includes("ride_boosts") && aprijuiceColour(recipe.out)
            ? { boosts: aprijuiceBoosts(aprijuiceColour(recipe.out), seasoned.map((n) => data.s[n][0])) } : recipe && seasonResult(recipe, seasoned.map((n) => data.s[n][0]));
        const made = meta ? [recipe.out, recipe.n, meta] : recipe && [recipe.out, recipe.n];
        if (!recipe || !lid || (out && (!sameSlot(out, made) || out[1] + recipe.n > maxStack(recipe.out)))) progress = 0;
        else {
            progress += 2;
            if (progress >= 200) {
                progress = 0;
                data.s[0] = [recipe.out, (out?.[1] ?? 0) + recipe.n, ...made.slice(2)];
                // a seasoning with flavours is used up (RideBoostsSeasoningProcessor.consumesItem)
                for (const n of seasoned) if (consumesSeasoning(recipe, data.s[n][0])) data.s[n] = data.s[n][1] > 1 ? [data.s[n][0], data.s[n][1] - 1, ...data.s[n].slice(2)] : null;
                for (let n = 1; n <= 9; n++) {
                    const s = data.s[n];
                    if (!s) continue;
                    if (REMAINDERS[s[0]]) try { block.dimension.spawnItem(new ItemStack(REMAINDERS[s[0]], 1), { x: x + 0.5, y: y + 1, z: z + 0.5 }); } catch (e) { }
                    data.s[n] = s[1] > 1 ? [s[0], s[1] - 1] : null;
                }
                savePot(block, data); showPotContents(block, data);
                playAt(block, "cobblemon.block.campfire_pot.cook");
            }
        }
        potProgress.set(key, progress);
        if (before !== progress > 0) setState(block, "cobblemon:cooking", progress > 0);
        // while it cooks the broth bubbles once a second (particleCooldown 20), in the bubble colour
        if (progress > 0 && system.currentTick % 20 === 0) {
            try {
                const vars = new MolangVariableMap(); vars.setColorRGBA("variable.broth", bubbleColour(data));
                block.dimension.spawnParticle("cobblemon:broth_bubbles", { x: x + 0.5, y: y + 0.5375, z: z + 0.5 }, vars);
            } catch (e) { }
        }
    }
}, 1);

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
        northwest: { icon: "shoulder", tip: "Shoulder", on: canShoulder(target, player), act: () => mountShoulder(target, player) },
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

// PokemonEntity.tryMountingShoulder: one of the player's own Pokemon whose form is shoulderMountable hops at them and,
// half a second later, sits on the free shoulder, the left first, in its shoulder pose, with the item pickup sound.
// The player's two shoulder seats are Bedrock's own, the parrots'. It comes off as a parrot does in Java
// (Player.removeEntitiesOnShoulder): when the player falls more than half a block (so a jump drops it), is hurt,
// goes into water, sleeps or flies.
const SHOULDER_SET = new Set(SHOULDER), SHOULDER_PROP = "cobblemon:shoulder";
const shoulderFall = new Map();   // player id -> the highest y since they left the ground
function shoulderRiders(player) {
    try { return player.getComponent("minecraft:rideable")?.getRiders().filter((e) => POKEMON[e.typeId]) ?? []; } catch (e) { return []; }
}
function canShoulder(target, player) {
    return SHOULDER_SET.has(target.typeId) && prop(target, OWNER) === player.id && !battles.has(player.id) && shoulderRiders(player).length < 2;
}
function mountShoulder(target, player) {
    const d = { x: player.location.x - target.location.x, z: player.location.z - target.location.z }, len = Math.hypot(d.x, d.z) || 1;
    try { target.applyImpulse({ x: (d.x / len) * 0.8, y: 0.5, z: (d.z / len) * 0.8 }); } catch (e) { }
    system.runTimeout(() => {
        if (!target.isValid || !player.isValid || !canShoulder(target, player)) return;
        const left = !shoulderRiders(player).some((e) => e.getProperty(SHOULDER_PROP) === 1);
        // the parrot_tame family the seats take comes with the group, which applies on the next tick
        try { target.triggerEvent("cobblemon:shoulder_on"); } catch (e) { return; }
        system.runTimeout(() => {
            if (!target.isValid || !player.isValid) return;
            try {
                target.teleport(player.location);
                if (!player.getComponent("minecraft:rideable").addRider(target)) { target.triggerEvent("cobblemon:shoulder_off"); return; }
                target.setProperty(SHOULDER_PROP, left ? 1 : 2);
                player.dimension.playSound("random.pop", target.location, { volume: 0.7, pitch: 1.4 });
            } catch (e) { console.warn(`[cobblemon] shoulder: ${e}`); }
            shoulderFall.delete(player.id);
        }, 1);
    }, 10);
}
function dropShoulder(player) {
    for (const e of shoulderRiders(player)) {
        try { player.getComponent("minecraft:rideable").ejectRider(e); e.setProperty(SHOULDER_PROP, 0); e.triggerEvent("cobblemon:shoulder_off"); } catch (err) { }
    }
    shoulderFall.delete(player.id);
}
system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        const riders = shoulderRiders(player);
        if (!riders.length) { shoulderFall.delete(player.id); continue; }
        // facing the way the player faces, as PokemonOnShoulderRenderer draws it in the player's own frame
        const yaw = player.getRotation().y;
        for (const e of riders) try { e.setRotation({ x: 0, y: yaw }); } catch (err) { }
        const y = player.location.y;
        const top = player.isOnGround ? y : Math.max(shoulderFall.get(player.id) ?? y, y);
        shoulderFall.set(player.id, top);
        if (top - y > 0.5 || player.isInWater || player.isSleeping || player.isGliding || player.isFlying) dropShoulder(player);
    }
}, 1);
world.afterEvents.entityHurt.subscribe(({ hurtEntity }) => { if (hurtEntity?.typeId === "minecraft:player") dropShoulder(hurtEntity); });

// PokemonRenderer.renderNameTag's label: the Pokemon's name, or "???" while the nearest player has not registered its
// species, then "Lv. N"; under a wild Pokemon that can be battled, "Press Use to battle." until that player's first win
// (showChallengeLabel). It is the Pokemon's name tag, which Bedrock draws when the Pokemon is looked at, as Cobblemon
// draws its label; Pokemon are not NPCs, so the tag is theirs to carry.
function labelFor(player, e) {
    const info = POKEMON[e.typeId];
    let variant = 0;
    try { variant = e.getComponent("minecraft:variant")?.value ?? 0; } catch (err) { }
    const known = dexStatus(player, e.typeId) > 0 || prop(e, OWNER);
    // PokemonEntity.getTitledName: the name carries the active mark's title ("Pikachu the Early Riser")
    const name = known ? titled(e, nicknameOf(e) || info.variants?.[variant]?.name || info.name) : "???";
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
                register(player, target.typeId, 2, variantOf(target));
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
    say(battle, `§6Go! ${titled(f.entity, nicknameOf(f.entity) || f.info.name)}! §7(Lv ${f.level})`);   // battle.switch.self, with the title
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
    register(player, foeEntity.typeId, 1, variantOf(foeEntity));
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
    return pad(name, 12) + pad(`Lv.${f.level}`, 6) + "h" + String(step).padStart(2, "0") + status.toUpperCase() + iconOf(e.typeId, variantOf(e))
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
    form.button(forced ? "" : "Back", `${UI}/battle/back`).button("", LOG_TOGGLE);
    return form.show(player).then((r) => {
        if (r.selection === 7 && battles.has(player.id)) { toggleLog(battle); return chooseSwitch(battle, forced); }
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
// BattleMessagePane's expand toggle: the log grows to twice its height, showing more lines, until toggled back
const LOG_TOGGLE = "textures/ui/cobblemon/battle/log_toggle";
function toggleLog(battle) { battle.logExpanded = !battle.logExpanded; try { battle.player.playSound("cobblemon.gui.click"); } catch (e) { } }
function battleBody(battle) {
    const ascii = (n) => n.normalize("NFD").replace(/[^ -~]/g, "");   // the layout slices by position, so the body stays one byte a character
    const side = (f) => {
        const step = f.hp > 0 ? Math.max(1, Math.round((Math.max(0, f.hp) / f.stats.hp) * 50)) : 0;
        return pad(ascii(f.info.name), 14) + pad(`Lv.${f.level}`, 6) + "h" + String(step).padStart(2, "0") + pad(f.hp <= 0 ? "fnt" : f.status ?? "", 3) + iconOf(f.entity?.typeId, variantOf(f.entity))
            // the gender, and whether the player has caught this species (BattleOverlay's caught indicator)
            + ({ male: "m", female: "f" }[f.entity?.isValid ? genderOf(f.entity) : ""] ?? "o")
            + (dexStatus(battle.player, f.entity?.typeId) >= 2 ? "y" : "n");
    };
    // Cobblemon shows the player's own Pokemon's health as a number and an opponent's as a share
    const own = `${Math.max(0, battle.ally.hp)}/${battle.ally.stats.hp}`, theirs = `${Math.ceil((Math.max(0, battle.foe.hp) / battle.foe.stats.hp) * 100)}%%`;   // a lone % is read as a format
    // the log follows the fixed fields; a lone % would be read as a format there too
    const log = (battle.log ?? []).slice(-40).map((line) => line.replace(/%/g, "%%")).join("\n");
    return "~" + side(battle.ally) + side(battle.foe) + "§f" + pad(own, 10) + "§f" + pad(theirs, 6) + (battle.logExpanded ? "e" : "c") + log;
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
    menu.button("", LOG_TOGGLE);
    return menu.show(battle.player).then((r) => {
        if (r.canceled || !battles.has(battle.player.id)) return undefined;
        if (r.selection === 4) { toggleLog(battle); return pickAction(battle, options); }
        if (r.selection === 3) return options.find((o) => o.kind === "run");
        if (r.selection === 2) return { kind: battle.trainer ? "forfeit" : "catch" };
        if (r.selection === 1) {
            const sw = options.find((o) => o.kind === "switch");
            if (!sw) { say(battle, "§7There is no other Pokemon to switch to."); return pickAction(battle, options); }
            return sw;
        }
        const moves = options.filter((o) => o.kind === "move");
        const showMoves = () => {
        const form = new ActionFormData().title("cbm:battle_moves").body(battleBody(battle));
        for (const o of moves) {
            const m = o.move, off = o.locked || (m !== STRUGGLE && m.left <= 0);
            const colour = m === STRUGGLE ? "§f" : m.left === 0 ? "§c" : m.left <= Math.floor(m.pp / 2) ? "§6" : "§f";
            form.button(pad(m.name, 16) + colour + (m === STRUGGLE ? "-/-" : `${m.left}/${m.pp}`), `${UI}/battle/move_${m.type ?? "normal"}${off ? "_off" : ""}`);
        }
        form.button("Back", `${UI}/battle/back`).button("", LOG_TOGGLE);
        return form.show(battle.player).then((m) => {
            if (m.canceled || !battles.has(battle.player.id)) return undefined;
            if (m.selection === moves.length + 1) { toggleLog(battle); return showMoves(); }
            if (m.selection >= moves.length) return pickAction(battle, options);
            return moves[m.selection];
        });
        };
        return showMoves();
    });
}

// The party HUD (ui/hud_screen.json): the player's own Pokemon nearby, fainted ones included, sent as one fixed-width
// record per slot in a title starting "cbm:party" whenever it changes, and every five seconds for a HUD that rejoined
const PARTY_MARKER = "cbm:party", BALL_INDEX = Object.keys(BALLS);
const partySent = new Map();
// the slot's pop-ups (PartyOverlayDataControl): the experience text for EXP_POPUP_TIME (63 ticks), and after the bar's
// 17-tick update the new move and evolution pop-ups for POPUP_TIME (46 ticks: 3 in, 40 held, 3 out)
function partyNotes(e) {
    const now = system.currentTick;
    let gain = {};
    try { gain = JSON.parse(prop(e, GAIN_NOTE) ?? "{}"); } catch (err) { }
    const since = now - (gain.tick ?? -1e9), popup = since >= 17 && since < 63;
    const evoSince = now - (prop(e, EVO_NOTE) ?? -1e9), evo = evoSince >= 0 && evoSince < 46, move = popup && gain.move;
    const note = evo && move ? "vm" : evo ? "nv" : move ? "nm" : "nn";
    // ui.exp.number, "+N EXP", with a colour code first since a leading "+" reads as a number
    return note + padBytes(since < 63 && gain.exp ? `§f+${gain.exp} EXP` : "", 10);
}
// the held item's HUD icon: "h" and two letters from its HELD_INDEX, "hzz" for none (and for items with no copy there)
function heldCode(e) {
    const n = HELD_INDEX[prop(e, HELD)] ?? 0;
    return n ? `h${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}` : "hzz";
}
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
    return pad(name, 12) + padBytes(`§r${level}`, 6) + "h" + steps(fainted ? 0 : share) + "e" + steps(level >= 100 ? 1 : (exp - expFor(group, level)) / span)
        + "b" + String(ball).padStart(2, "0") + (fainted ? "x" : "n") + gender + iconOf(e.typeId, variantOf(e))
        + partyNotes(e) + heldCode(e) + (fainted ? "non" : statusOf(e) ?? "non");
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
        const empty = " ".repeat(18) + "h00e00bxxeoi----nn" + " ".repeat(10) + "hzz" + "non";
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
const leveled = new Set(), EVO_NOTE = "cobblemon:evo_note", GAIN_NOTE = "cobblemon:gain_note";
const gained = new Map();   // entity -> { exp, move }: what each Pokemon gained since the party overlay last showed it
// A level-up that makes an evolution ready (PartyOverlayDataControl): the party slot's evolution pop-up and the
// notification jingle; the Summary's Evolve button then opens the choice. Nothing is asked.
function offerLevelEvolutions(player) {
    // PartyOverlayDataControl's pop-ups once the overlay is back: the experience gained, then a new move
    for (const [e, g] of [...gained]) {
        gained.delete(e);
        if (e.isValid) setProp(e, GAIN_NOTE, JSON.stringify({ tick: system.currentTick, exp: g.exp, move: g.move }));
    }
    let ready = false;
    for (const e of [...leveled]) {
        leveled.delete(e);
        if (!e.isValid || !readyEvolutions(e, player).length) continue;
        setProp(e, EVO_NOTE, system.currentTick + 17);
        ready = true;
    }
    if (ready) try { player.playSound("cobblemon.evolution.notification"); } catch (e) { }
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
    const note = gained.get(f.entity) ?? { exp: 0, move: false };
    note.exp += gain; gained.set(f.entity, note);
    const ids = f.moves.map((m) => m.id);
    while (level < 100 && exp >= expFor(group, level + 1)) {
        level++;
        const fr = friendshipOf(f.entity);
        gainFriendship(f.entity, fr <= 99 ? 3 : fr <= 199 ? 2 : 0);
        leveled.add(f.entity);
        say(battle, `§b${f.info.name} grew to level ${level}!`);
        for (const [at, id] of f.info.learnset ?? []) {
            if (at !== level || ids.includes(id) || !MOVES[id]) continue;
            note.move = true;
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
    } else if (event.id === "cobblemon:add_mark") {
        // testing: "/execute as <pokemon> run scriptevent cobblemon:add_mark <mark id> [active]" gives it that mark
        const [name, active] = event.message.trim().split(/\s+/), id = `cobblemon:${name.replace(/^cobblemon:/, "")}`;
        if (MARKS[id] && !marksOf(source).includes(id)) setProp(source, MARK_LIST, JSON.stringify([...marksOf(source), id]));
        if (MARKS[id] && active === "active") setProp(source, ACTIVE_MARK, id);
    } else if (event.id === "cobblemon:inspect") {
        // testing: "/execute as <entity> run scriptevent cobblemon:inspect" logs its variant and dynamic properties
        const props = {};
        try { for (const id of source.getDynamicPropertyIds()) props[id] = source.getDynamicProperty(id); } catch (e) { }
        let shown; try { shown = source.getProperty("cobblemon:intrinsic"); } catch (e) { }
        console.warn(`[cobblemon] ${source.typeId} variant ${variantOf(source)} intrinsic ${shown} ${JSON.stringify(props).slice(0, 600)}`);
    } else if (event.id === "cobblemon:biome") {
        // testing: "/execute as <player> run scriptevent cobblemon:biome" logs the biome the wallpaper unlocks read there
        let id = "?";
        try { id = source.dimension.getBiome(source.location)?.id; } catch (e) { id = `error: ${e}`; }
        console.warn(`[cobblemon] biome at ${source.name ?? source.typeId}: ${id}`);
    } else if (event.id === "cobblemon:set_level") {
        // testing: "/execute as <pokemon> run scriptevent cobblemon:set_level <level>" puts a Pokemon back at a level,
        // with that level's base experience and its species' default moves for it
        const level = Math.max(1, Math.min(100, parseInt(event.message) || 1)), info = POKEMON[source.typeId];
        if (!info) return;
        setProp(source, LEVEL, level); setProp(source, EXP, expFor(info.expGroup, level));
        setProp(source, MOVESET, undefined); setProp(source, GAIN_NOTE, undefined); setProp(source, EVO_NOTE, undefined);
        refreshHealth(source);
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
    } else if (event.id === "cobblemon:pc_take_test") {
        // for testing: "/execute as <player> run scriptevent cobblemon:pc_take_test <species id> <ball id>" logs the
        // marks of that species caught in that ball in the player's PC and removes them, for clearing test catches
        const [species, ball] = event.message.trim().split(/\s+/);
        if (source.typeId !== "minecraft:player" || !species || !ball) return;
        let taken = 0;
        const counts = {};
        for (let n = 0; n < PC_BOXES; n++) {
            const contents = box(source, n);
            let changed = false;
            contents.forEach((rec, i) => {
                if (rec?.t !== species || rec.k?.["cobblemon:caught_ball"] !== ball) return;
                let marks = [];
                try { marks = JSON.parse(rec.k?.[MARK_LIST] ?? "[]"); } catch (e) { }
                const key = marks.join(",") || "none"; counts[key] = (counts[key] ?? 0) + 1;
                contents[i] = null; changed = true; taken++;
            });
            if (changed) saveBox(source, n, contents);
        }
        console.warn(`pc_take_test ${species} ${ball}: ${taken} taken, marks ${JSON.stringify(counts)}`);
    } else if (event.id === "cobblemon:set_status") {
        // for testing: "/execute as <pokemon> run scriptevent cobblemon:set_status <psn|tox|par|brn|frz|slp> [seconds]"
        const [code, seconds] = event.message.trim().split(/\s+/);
        if (POKEMON[source.typeId]) setProp(source, STATUS, STATUS_CURED[code] ? JSON.stringify({ s: code, left: Number(seconds) || 200 }) : undefined);
    } else if (event.id === "cobblemon:hp") {
        // for testing: "/execute as <player> run scriptevent cobblemon:hp <entity type>" logs the health of those within 16 blocks
        try {
            for (const e of source.dimension.getEntities({ type: event.message.trim(), location: source.location, maxDistance: 16 }))
                console.warn(`hp ${e.typeId} ${e.getComponent(EntityComponentTypes.Health)?.currentValue}/${e.getComponent(EntityComponentTypes.Health)?.effectiveMax} target ${e.target?.typeId ?? "-"}`);
        } catch (err) { console.warn(`hp: ${err}`); }
    } else if (event.id === "cobblemon:pasture_test") {
        // for testing: "/execute as <pokemon> run scriptevent cobblemon:pasture_test x y z [owner id] [owner name]" marks it
        // pastured at that block with defend on, and owned by that player when one is given
        const [x, y, z, ownerId, ownerName] = event.message.trim().split(/\s+/);
        if (!POKEMON[source.typeId]) return;
        if (ownerId) { setProp(source, OWNER, ownerId); setProp(source, OWNER_NAME, ownerName ?? ownerId); }
        setProp(source, PASTURE_AT, keyOf(source.dimension, { x: Number(x), y: Number(y), z: Number(z) })); setProp(source, CONFLICT, true);
        try { source.triggerEvent("cobblemon:pasture"); source.triggerEvent("cobblemon:conflict_on"); } catch (e) { }
    } else if (event.id === "cobblemon:particle") {
        // for testing: "/scriptevent cobblemon:particle <id> x y z" spawns a particle, its variable.broth white
        const [id, x, y, z] = event.message.split(" ");
        try { const vars = new MolangVariableMap(); vars.setColorRGBA("variable.broth", { red: 1, green: 1, blue: 1, alpha: 1 }); source.dimension.spawnParticle(id, { x: Number(x), y: Number(y), z: Number(z) }, vars); } catch (e) { console.warn(`particle: ${e}`); }
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
    let owner, kept = {};
    try {
        owner = e.getDynamicProperty(OWNER);
        for (const id of e.getDynamicPropertyIds()) kept[id] = e.getDynamicProperty(id);
    } catch (err) { }
    if (owner) evolving.push({ owner, kept, from: e.typeId, location: { ...e.location }, tick: system.currentTick });
});
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== EntityInitializationCause.Transformed || !POKEMON[entity.typeId]) return;
    const i = evolving.findIndex((p) => system.currentTick - p.tick < 40 && Math.hypot(p.location.x - entity.location.x, p.location.z - entity.location.z) < 3);
    if (i < 0) return;
    const { owner, kept, from } = evolving.splice(i, 1)[0];
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
            if (player) register(player, entity.typeId, 2, variantOf(entity));
            player?.sendMessage(`§a${kept?.[NICK] || POKEMON[from]?.name} evolved into ${POKEMON[entity.typeId].name}!`);
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
    "cobblemon:gender", "cobblemon:caught_ball", "cobblemon:markings", "cobblemon:marks", "cobblemon:active_mark", "cobblemon:benched", "cobblemon:fullness", "cobblemon:blocks_traveled",
    "cobblemon:gimmighoul_coins", "cobblemon:gimmighoul_netherite", "cobblemon:ride_boosts", "cobblemon:status", "cobblemon:scale"];
// Pokemon.markings: six markings, each 0 (off) or one of two colours, cycled by the Summary's MarkingsWidget
const MARKINGS = "cobblemon:markings";

function setPcScreen(block, on) {
    const top = block.permutation.getState("cobblemon:part") === "top" ? block : block.above();
    if (top?.typeId === "cobblemon:pc") setState(top, "cobblemon:on", on);
}

// The PC, laid out by ui/server_form.json on Cobblemon's PC textures (PC_LAYOUT in port.py): box slots 0 to 29, the
// party 30 to 35, then previous and next box, release and exit. Choosing a Pokemon selects it (the pointer shows over
// it); choosing another slot moves it there, swapping with what is there, depositing or withdrawing as the slots say.
const PC_UI = "textures/ui/cobblemon";
// a portrait's texture (portrait_code in port.py): "i", the National number and the variant in two base-36 digits each
const B36 = (n) => n.toString(36).padStart(2, "0").slice(-2);
const iconOf = (typeId, variant = 0) => (typeId ? `i${B36(Number(typeId.slice("cobblemon:p".length, "cobblemon:p".length + 4)))}${B36(variant ?? 0)}` : "i----");
const variantOf = (e) => { try { return e?.getComponent("minecraft:variant")?.value ?? 0; } catch (err) { return 0; } };
function pcInfo(v, rec, entity) {
    const typeId = rec?.t ?? entity?.typeId, info = POKEMON[typeId];
    for (let i = 0; i < 6; i++) { v[`mark${i}`] = "n"; v[`sv${i}`] = ""; }   // no Pokemon chosen, no markings or stats shown
    if (!info) { Object.assign(v, { portrait: "i----", gender: "o", ball: "b--", type1: "t--", type2: "t--" }); return; }
    const kept = (key) => (rec ? rec.k?.[key] : prop(entity, key));
    const marks = String(kept(MARKINGS) ?? "000000");
    for (let i = 0; i < 6; i++) v[`mark${i}`] = marks[i] ?? "0";
    // the info box's IV and EV pages
    let ivs = {}, evs = {};
    try { ivs = rec ? JSON.parse(rec.k?.["cobblemon:ivs"] ?? "{}") : ivsOf(entity); evs = rec ? JSON.parse(rec.k?.["cobblemon:evs"] ?? "{}") : evsOf(entity); } catch (e) { }
    if (v.page === "v" || v.page === "e") STAT_KEYS.forEach((k, i) => { v[`sv${i}`] = num((v.page === "v" ? ivs : evs)[k] ?? 0); });
    const variant = rec ? rec.v : (entity.getComponent("minecraft:variant")?.value ?? 0);
    const form = { ...info, ...(info.variants?.[variant] ?? {}) };
    const level = rec ? rec.lv : prop(entity, LEVEL) ?? info.level;
    let moves = [];
    try { moves = JSON.parse((rec ? rec.mv : prop(entity, MOVESET)) ?? "null") ?? movesAt(form, level); } catch (e) { moves = movesAt(form, level); }
    const ball = Object.keys(BALLS).indexOf(kept("cobblemon:caught_ball") ?? "cobblemon:poke_ball");
    const tag = rec ? rec.n : (nicknameOf(entity));
    Object.assign(v, {
        level: num(level), name: tag || form.name, portrait: iconOf(typeId, variant),
        gender: { male: "m", female: "f" }[kept("cobblemon:gender")] ?? "o", ball: `b${String(Math.max(0, ball)).padStart(2, "0")}`,
        type1: typeCode(form.types[0]), type2: typeCode(form.types[1]),
        nature: natureName(kept("cobblemon:mint") ?? kept("cobblemon:nature")), ability: abilityName(kept("cobblemon:ability") ?? form.ability),
    });
    moves.slice(0, 4).forEach((id, n) => { v[`move${n}`] = MOVES[id]?.name ?? ""; });
    const held = kept(HELD);
    v.item = (held && HELD_ICONS[(HELD_INDEX[held] ?? 0) - 1]) || `${PC_UI}/summary/blank`;
    v.itemName = held ? itemName(held) : "";   // the held item's tooltip
}

// PC box wallpapers (PCBox.wallpaper, WallpapersScrollingWidget): each box keeps its own, the default the fifth
// basic one; the six Cobblemon unlocks come from wallpaper_unlocks.molang (standing in a cave, forest or ocean biome,
// in the Nether or the End; catching an alpha, which the port has none of) and show "new" until the list is opened
const WALLS = "cobblemon:pc_walls", WALLS_UNLOCKED = "cobblemon:walls_unlocked", WALLS_UNSEEN = "cobblemon:walls_unseen";
const WALL_NAMES = { biome_cave: "Caves", biome_forest: "Forest", biome_nether: "The Nether", biome_ocean: "Ocean", biome_the_end: "The End", pokemon_alpha: "Alpha" };
function jsonProp(player, key, fallback) { try { return JSON.parse(player.getDynamicProperty(key) ?? "null") ?? fallback; } catch (e) { return fallback; } }
function wallpapersOf(player) {
    const unlocked = jsonProp(player, WALLS_UNLOCKED, []);
    return PC_WALLPAPERS.filter(([, unlock]) => !unlock || unlocked.includes(unlock));
}
function unlockWallpaper(player, unlock) {
    const unlocked = jsonProp(player, WALLS_UNLOCKED, []);
    if (unlocked.includes(unlock)) return;
    unlocked.push(unlock); player.setDynamicProperty(WALLS_UNLOCKED, JSON.stringify(unlocked));
    const unseen = jsonProp(player, WALLS_UNSEEN, []); unseen.push(unlock); player.setDynamicProperty(WALLS_UNSEEN, JSON.stringify(unseen));
    player.sendMessage(`§eWallpaper Unlocked §7"${WALL_NAMES[unlock] ?? unlock}"`);
    try { player.playSound("cobblemon.pc.wallpaper.unlock"); } catch (e) { }
}
system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const dim = player.dimension.id;
        if (dim === "minecraft:nether") unlockWallpaper(player, "biome_nether");
        if (dim === "minecraft:the_end") unlockWallpaper(player, "biome_the_end");
        let biome = "";
        try { biome = player.dimension.getBiome(player.location)?.id ?? ""; } catch (e) { continue; }
        if (/caves|deep_dark/.test(biome)) unlockWallpaper(player, "biome_cave");
        if (/forest|grove/.test(biome)) unlockWallpaper(player, "biome_forest");
        if (/ocean/.test(biome)) unlockWallpaper(player, "biome_ocean");
    }
}, 20);

// PokemonSortMode: name, level, primary type, National Pokedex number and gender (male, female, genderless), the empty
// slots last. A Pokemon out in a pasture keeps its slot, since the pasture finds it there even while far away and unloaded
const PC_SORTS = ["name", "level", "type", "pokedex_number", "gender"];
function sortBox(player, n, mode, reverse) {
    const contents = box(player, n);
    const key = (rec) => {
        const info = POKEMON[rec.t];
        switch (mode) {
            case "name": return rec.n || info?.name || "";
            case "level": return rec.lv ?? 0;
            case "type": return info?.types?.[0] ?? "";
            case "pokedex_number": return info?.dex ?? DEX_INDEX.get(rec.t) ?? 0;
            default: return ["male", "female"].indexOf(rec.k?.["cobblemon:gender"]) + 1 || 3;
        }
    };
    const loose = contents.filter((rec) => !rec?.p).sort((a, b) => {
        if (!a || !b) return (!a) - (!b);
        const x = key(a), y = key(b), c = x < y ? -1 : x > y ? 1 : 0;
        return reverse ? -c : c;
    });
    saveBox(player, n, contents.map((rec) => (rec?.p ? rec : loose.shift() ?? null)));
}

// PC Search (Search.of): the filter's words must all hold ("!" before one turns it round): holding, fainted, legendary,
// mythical, ultrabeast, or else a part of the species or the nickname, or a property as PokemonProperties reads one:
// shiny, male, female, genderless, a form (alolan, galarian...), level/lvl=N, nature=, ability=, pokeball/ball=, type=,
// friendship=N, gender=. A Pokemon that fails is not drawn and not chosen.
function pcPasses(rec, filter) {
    if (!rec || !filter) return true;
    const info = POKEMON[rec.t] ?? {};
    return filter.toLowerCase().trim().split(/\s+/).every((word) => {
        const inverted = word.startsWith("!"), w = inverted ? word.slice(1) : word;
        let ok;
        if (["holding", "helditem", "held_item"].includes(w)) ok = !!rec.k?.["cobblemon:held"];
        else if (w === "fainted") ok = !!rec.f;
        else if (w === "legendary") ok = !!info.legendary;
        else if (w === "mythical") ok = !!info.mythical;
        else if (w === "ultrabeast" || w === "ultra_beast") ok = !!info.ultraBeast;
        else if (/^(lvl|level)=\d+$/.test(w)) ok = rec.lv === Number(w.split("=")[1]);
        else ok = !w || (info.name ?? "").toLowerCase().includes(w) || (rec.n ?? "").toLowerCase().includes(w) || propertyMatches(rec, info, w);
        return inverted ? !ok : ok;
    });
}
// one PokemonProperties word against a stored Pokemon
function propertyMatches(rec, info, w) {
    const k = rec.k ?? {}, plain = (s) => String(s ?? "").toLowerCase().replace(/^cobblemon:/, "").replace(/[^a-z0-9]/g, "");
    const [key, value] = w.includes("=") ? w.split("=") : [w, undefined];
    if (value === undefined) {
        if (key === "shiny") return (SHINY_VARIANTS[rec.t] ?? []).includes(rec.v ?? 0);
        if (["male", "female", "genderless"].includes(key)) return (k["cobblemon:gender"] ?? "genderless") === key;
        const form = VARIANT_FORMS[rec.t]?.[rec.v ?? 0];
        return !!form && plain(form).startsWith(plain(key));
    }
    const v = plain(value);
    switch (key) {
        case "shiny": return (SHINY_VARIANTS[rec.t] ?? []).includes(rec.v ?? 0) === (v === "true" || v === "yes");
        case "gender": return plain(k["cobblemon:gender"] ?? "genderless") === v;
        case "nature": return plain(k["cobblemon:nature"]) === v;
        case "ability": return plain(k["cobblemon:ability"]) === v;
        case "ball": case "pokeball": return plain(k["cobblemon:caught_ball"] ?? "poke_ball").replace(/ball$/, "") === v.replace(/ball$/, "");
        case "type": return (info.types ?? []).includes(v);
        case "friendship": return Number(k["cobblemon:friendship"] ?? info.friendship ?? 50) === Number(v);
        default: return false;
    }
}
const PC_NAMES = "cobblemon:pc_names";

function openPc(block, player, state) {
    if (battles.has(player.id)) { player.sendMessage("§cYou cannot use a PC while in battle!"); return; }
    if (!state) { tidyPastured(player); setPcScreen(block, true); state = { box: 0, sel: null }; }
    const done = () => { try { setPcScreen(block, false); } catch (e) { } };
    const party = summaryParty(player), contents = box(player, state.box);
    const walls = jsonProp(player, WALLS, {}), available = wallpapersOf(player), unseen = jsonProp(player, WALLS_UNSEEN, []);
    const names = jsonProp(player, PC_NAMES, {});
    const v = { box: names[state.box] ?? `Box ${state.box + 1}`, item: `${PC_UI}/summary/blank`, wall: walls[state.box] ?? "w05", wmode: state.wmode ? "y" : "n", opts: state.opts ? "y" : "n",
                page: state.page ?? "i", filter: state.filter ? `§f${state.filter}` : "§7Filter", rel: state.sel ? "y" : "n" };
    const sel = state.sel;
    if (sel?.kind === "box") {
        // a Pokemon stored before it rolled its IVs rolls them now and keeps them, as every Cobblemon Pokemon has them
        const contents = box(player, sel.box), rec = contents[sel.slot];
        // one out in a pasture shows what the Pokemon itself carries, since that is what comes back on recall
        if (rec?.p) {
            let out;
            try { out = player.dimension.getEntities({ families: ["owned"] }).find((e) => prop(e, OWNER) === player.id && prop(e, PASTURE_SLOT) === `${sel.box}:${sel.slot}`); } catch (e) { }
            if (out) { ivsOf(out); evsOf(out); rec.k = { ...(rec.k ?? {}), "cobblemon:ivs": prop(out, "cobblemon:ivs"), "cobblemon:evs": prop(out, "cobblemon:evs") }; saveBox(player, sel.box, contents); }
        }
        if (rec && !rec.k?.["cobblemon:ivs"]) {
            rec.k = { ...(rec.k ?? {}), "cobblemon:ivs": JSON.stringify(Object.fromEntries(STAT_KEYS.map((k) => [k, Math.floor(Math.random() * 32)]))) };
            if (!rec.k["cobblemon:evs"]) rec.k["cobblemon:evs"] = JSON.stringify(Object.fromEntries(STAT_KEYS.map((k) => [k, 0])));
            saveBox(player, sel.box, contents);
        }
        pcInfo(v, rec, null);
    }
    else if (sel?.kind === "party" && party[sel.slot]?.isValid) pcInfo(v, null, party[sel.slot]);
    else pcInfo(v, null, null);
    for (let n = 0; n < 30; n++) {
        const shown = pcPasses(contents[n], state.filter);
        v[`b${n}`] = shown ? iconOf(contents[n]?.t, contents[n]?.v) : "i----"; v[`s${n}`] = sel?.kind === "box" && sel.box === state.box && sel.slot === n ? "y" : "n";
        v[`q${n}`] = contents[n]?.p && shown ? "y" : "n";
    }
    for (let n = 0; n < 6; n++) { v[`p${n}`] = iconOf(party[n]?.typeId, variantOf(party[n])); v[`s${30 + n}`] = sel?.kind === "party" && sel.slot === n ? "y" : "n"; }
    const body = PC_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:pc").body(body);
    for (let n = 0; n < 36; n++) form.button("slot", `${PC_UI}/pc/slot${v[`s${n}`] === "y" ? "_on" : ""}`);
    form.button("prev", `${PC_UI}/pc/prev`).button("next", `${PC_UI}/pc/next`).button("release", `${PC_UI}/pc/${state.sel ? "release" : "none"}`).button("exit", `${PC_UI}/summary/exit`);
    form.button("options", `${PC_UI}/pc/options${state.opts ? "_on" : ""}`);
    form.button("wallpaper", `${PC_UI}/pc/${state.opts ? `set_wallpaper${state.wmode ? "_on" : ""}` : "none"}`);
    for (let n = 0; n < PC_WALLPAPERS.length; n++) {
        const w = available[n];
        // the box's own wallpaper in its alternate shows the alternate's thumbnail
        const shown = w && walls[state.box] === PC_ALT_WALLS[w[0]] ? PC_ALT_WALLS[w[0]] : w?.[0];
        form.button("wall", `${PC_UI}/pc/${w ? `wps_${shown}${w[1] && unseen.includes(w[1]) ? "_new" : ""}` : "none"}`);
    }
    // the sort buttons show their reverse face after a sort by them, as a shift-click would sort
    // each sort button's text is its tooltip (lang ui.sort.*)
    const SORT_TIPS = { name: "Sort by name", level: "Sort by level", type: "Sort by type", pokedex_number: "Sort by Pok\u00e9dex number", gender: "Sort by gender" };
    for (const mode of PC_SORTS) form.button(state.opts ? SORT_TIPS[mode] : "", `${PC_UI}/pc/${state.opts ? `sort_${mode}${state.sorted === mode ? "_reverse" : ""}` : "none"}`);
    form.button("info page", `${PC_UI}/pc/info_arrow`);
    form.button("filter", `${PC_UI}/pc/bar`).button("box name", `${PC_UI}/pc/bar`);
    // the hover areas: the filter's icon (its format, lang ui.pc.filter.tooltip) and the held item (its name)
    form.button("Format: pikachu shiny held_item lvl=1...", `${PC_UI}/pc/none`).button(v.itemName ?? "", `${PC_UI}/pc/none`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 39) { done(); return; }
        const pick = r.selection, again = (delay = 0) => system.runTimeout(() => openPc(block, player, state), delay);
        if (pick === 36 || pick === 37) { state.box = (state.box + (pick === 37 ? 1 : PC_BOXES - 1)) % PC_BOXES; again(); return; }
        if (pick === 38) { pcRelease(player, state, party, () => again(5)); return; }
        if (pick === 40) { state.opts = !state.opts; if (!state.opts) state.wmode = false; again(); return; }
        if (pick === 41) {
            if (state.opts) { state.wmode = !state.wmode; if (state.wmode) player.setDynamicProperty(WALLS_UNSEEN, "[]"); }
            again(); return;
        }
        if (pick >= 45 + PC_WALLPAPERS.length + PC_SORTS.length) { again(); return; }   // the tooltips' hover areas
        if (pick === 43 + PC_WALLPAPERS.length + PC_SORTS.length || pick === 44 + PC_WALLPAPERS.length + PC_SORTS.length) {
            // TextWidget's 19 characters: the filter, or the box's name (an empty one gives the box its number back)
            const naming = pick === 44 + PC_WALLPAPERS.length + PC_SORTS.length;
            new ModalFormData().title(naming ? "Box Name" : "Filter")
                .textField(naming ? "Name" : "Format: pikachu shiny held_item lvl=1...", "", { defaultValue: naming ? names[state.box] ?? "" : state.filter ?? "" })
                .show(player).then((q) => {
                    if (!q.canceled) {
                        const text = String(q.formValues?.[0] ?? "").replace(/[%§]/g, "").trim().slice(0, 19);
                        if (naming) { if (text) names[state.box] = text; else delete names[state.box]; player.setDynamicProperty(PC_NAMES, JSON.stringify(names)); }
                        else { state.filter = text || undefined; state.sel = null; }
                    }
                    again();
                }).catch(done);
            return;
        }
        if (pick === 42 + PC_WALLPAPERS.length + PC_SORTS.length) {
            // the arrow turns the info box: info, IVs, EVs
            state.page = { i: "v", v: "e", e: "i" }[state.page ?? "i"];
            again(); return;
        }
        if (pick >= 42 + PC_WALLPAPERS.length) {
            const mode = PC_SORTS[pick - 42 - PC_WALLPAPERS.length];
            if (state.opts && mode) {
                // a second press of the same button sorts the other way, where Cobblemon's is a shift-click
                const reverse = state.sorted === mode;
                sortBox(player, state.box, mode, reverse);
                state.sorted = reverse ? null : mode; state.sel = null;
                try { player.playSound("cobblemon.pc.click"); } catch (e) { }
            }
            again(); return;
        }
        if (pick >= 42) {
            const w = available[pick - 42];
            // the wallpaper the box already has, chosen again, turns to its alternate and back (Cobblemon's shift-click)
            const alt = PC_ALT_WALLS[w?.[0]], now = walls[state.box] ?? "w05";
            if (w) { walls[state.box] = alt && now === w[0] ? alt : w[0]; player.setDynamicProperty(WALLS, JSON.stringify(walls)); try { player.playSound("cobblemon.pc.click"); } catch (e) { } }
            again(); return;
        }
        const target = pick < 30 ? { kind: "box", box: state.box, slot: pick } : { kind: "party", slot: pick - 30 };
        if (target.kind === "box" && !pcPasses(contents[target.slot], state.filter)) { again(); return; }
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
const PASTURE_LIMIT = 16, PASTURE_SLOT = "cobblemon:pc_slot", PASTURE_AT = "cobblemon:pasture", OWNER_NAME = "cobblemon:owner_name";

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
const CONFLICT = "cobblemon:pasture_conflict", DEFENDERS_SET = new Set(DEFENDERS);
// AttackHostileMobsTask for a pastured Pokemon with the defend toggle on: it takes the nearest hostile mob it can reach
// within 16 blocks, keeping to the pasture's roaming range (the tether), goes to it and strikes it once a second for its
// attack damage (its minecraft:attack, Attack / 10). DefendOwnerTask for one with its trainer: it goes for the mob that
// last hurt its trainer (DefendOwnerSensor; never a player), for ten seconds. The entity's own targeting proved
// unreliable, so the script drives both.
const lastStrike = new Map(), ownerAttacker = new Map();   // player id -> { id, until }
world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource }) => {
    const by = damageSource?.damagingEntity;
    if (hurtEntity?.typeId !== "minecraft:player" || !by?.isValid || by.typeId === "minecraft:player" || POKEMON[by.typeId]) return;
    ownerAttacker.set(hurtEntity.id, { id: by.id, until: system.currentTick + 200 });
});
system.runInterval(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
        let owned = [];
        try { owned = world.getDimension(dim).getEntities({ families: ["owned"] }); } catch (e) { continue; }
        for (const e of owned) {
            if (prop(e, FAINTED) || !DEFENDERS_SET.has(e.typeId)) continue;
            let foe;
            if (prop(e, PASTURE_AT)) {
                if (!prop(e, CONFLICT)) continue;
                const [, pos] = String(prop(e, PASTURE_AT)).split("|"), home = (pos ?? "").split(",").map(Number);
                let foes = [];
                try { foes = e.dimension.getEntities({ families: ["monster"], location: e.location, maxDistance: 16 }); } catch (err) { continue; }
                const near = (a) => (home.length === 3 ? Math.hypot(a.location.x - home[0], a.location.z - home[2]) <= 32 : true);
                foe = foes.filter(near).sort((a, b) => dist(a, e) - dist(b, e))[0];
            } else {
                // with its trainer, out of battle: the mob that last hurt them
                let inBattle = false;
                try { inBattle = !!e.getProperty("cobblemon:battle"); } catch (err) { }
                const hit = ownerAttacker.get(prop(e, OWNER));
                if (inBattle || !hit || hit.until < system.currentTick) continue;
                const attacker = world.getEntity(hit.id);
                if (attacker?.isValid && attacker.dimension.id === e.dimension.id && dist(attacker, e) <= 16) foe = attacker;
            }
            if (!foe) continue;
            const d = dist(foe, e);
            if (d > 1.8) {
                // a step toward it, turned to face it
                const k = Math.min(0.45, d - 1.5) / d;
                try { e.tryTeleport({ x: e.location.x + (foe.location.x - e.location.x) * k, y: e.location.y, z: e.location.z + (foe.location.z - e.location.z) * k },
                                    { facingLocation: foe.location, checkForBlocks: true, keepVelocity: true }); } catch (err) { }
            } else if (system.currentTick - (lastStrike.get(e.id) ?? -99) >= 20) {
                lastStrike.set(e.id, system.currentTick);
                const damage = Math.max(1, Math.round((POKEMON[e.typeId]?.stats?.atk ?? 40) / 10));
                try { foe.applyDamage(damage, { cause: EntityDamageCause.entityAttack, damagingEntity: e }); } catch (err) { }
            }
        }
    }
}, 4);
function dist(a, b) { return Math.hypot(a.location.x - b.location.x, a.location.y - b.location.y, a.location.z - b.location.z); }
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
    const contents = box(player, state.box), sel = state.sel;
    const v = { box: `Box ${state.box + 1}`, item: `${PC_UI}/summary/blank`, count: num(`${here.length}/${PASTURE_LIMIT}`),
                wall: jsonProp(player, WALLS, {})[state.box] ?? "w05", wmode: "n", opts: "n", page: "i" };
    if (sel) pcInfo(v, box(player, sel.box)[sel.slot], null); else pcInfo(v, null, null);
    for (let n = 0; n < 30; n++) {
        v[`b${n}`] = iconOf(contents[n]?.t, contents[n]?.v); v[`s${n}`] = sel && sel.box === state.box && sel.slot === n ? "y" : "n";
        v[`q${n}`] = contents[n]?.p ? "y" : "n";
    }
    const shown = here.slice(0, PASTURE_LIMIT);
    const body = PC_LAYOUT.map(([k, width]) => (width ? padBytes(v[k] ?? "", width) : v[k] ?? "")).join("");
    const form = new ActionFormData().title("cbm:pasture").body(body);
    for (let n = 0; n < 30; n++) form.button("slot", `${PC_UI}/pc/slot${v[`s${n}`] === "y" ? "_on" : ""}`);
    form.button("prev", `${PC_UI}/pc/prev`).button("next", `${PC_UI}/pc/next`).button("exit", `${PC_UI}/summary/exit`);
    form.button("recall", `${PC_UI}/pc/recall_all`);
    // the list's rows, each carrying its Pokemon in its text (portrait, gender, move icon, level, name), and an empty
    // row's text left empty so the list ends there
    for (let n = 0; n < PASTURE_LIMIT; n++) {
        const e = shown[n];
        if (!e) { form.button("", `${PC_UI}/pc/none`); continue; }
        const own = prop(e, OWNER) === player.id, info = POKEMON[e.typeId];
        const name = (nicknameOf(e) || info.name).normalize("NFD").replace(/[^ -~]/g, "");
        const owner = own ? name : `§o${world.getAllPlayers().find((p) => p.id === prop(e, OWNER))?.name ?? prop(e, OWNER_NAME) ?? ""}`.normalize("NFD").replace(/[^ -~§]/g, "");
        form.button(iconOf(e.typeId, variantOf(e)) + ({ male: "m", female: "f" }[genderOf(e)] ?? "o") + (own ? "y" : "n") + padBytes(`Lv. ${prop(e, LEVEL) ?? info.level}`, 7)
                    + padBytes(owner, 18) + name,
                    `${PC_UI}/pc/row_${own ? "o" : "n"}`);
    }
    // the defend toggle (PastureSlotIconConflictButton) on the player's own rows of species that defend
    for (let n = 0; n < PASTURE_LIMIT; n++) {
        const e = shown[n], can = e && prop(e, OWNER) === player.id && DEFENDERS_SET.has(e.typeId);
        form.button(e ? "defend" : "", `${PC_UI}/pc/def_${can ? (prop(e, CONFLICT) ? "y" : "n") : "x"}`);   // empty text: no row
    }
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 32) return;
        const pick = r.selection, again = (delay = 0) => system.runTimeout(() => openPasture(block, player, state), delay);
        if (pick >= 50 && pick < 50 + PASTURE_LIMIT) {
            const e = shown[pick - 50];
            if (e?.isValid && prop(e, OWNER) === player.id && DEFENDERS_SET.has(e.typeId)) {
                const on = !prop(e, CONFLICT);
                setProp(e, CONFLICT, on || undefined);
                try { e.triggerEvent(on ? "cobblemon:conflict_on" : "cobblemon:conflict_off"); player.playSound("cobblemon.pc.click"); } catch (err) { }
            }
            again(); return;
        }
        if (pick === 30 || pick === 31) { state.box = (state.box + (pick === 31 ? 1 : PC_BOXES - 1)) % PC_BOXES; again(); return; }
        if (pick === 33) {
            for (const e of here) if (prop(e, OWNER) === player.id) recall(player, e, block);
            again(14); return;
        }
        if (pick < 30) {
            const rec = contents[pick];
            state.sel = rec && !rec.p && !(sel && sel.box === state.box && sel.slot === pick) ? { box: state.box, slot: pick } : null;
            if (rec?.p) player.sendMessage("§7That Pokemon is already out in a pasture.");
            again(); return;
        }
        const row = pick >= 34 && pick < 34 + PASTURE_LIMIT ? shown[pick - 34] : undefined;
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
            setProp(entity, OWNER_NAME, player.name);   // PokemonPastureBlockEntity's playerName, for the list while they are away
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
                setProp(pokemon, LEVEL, level); setProp(pokemon, "cobblemon:fished", true);
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

// the variants a player has met of each species (Cobblemon's encountered forms and seen shiny states, which the port's
// variants carry together), for the Pokedex's form arrows
const DEX_VARIANTS = "cobblemon:dex_variants";
function noteVariant(player, typeId, variant) {
    if (variant === undefined || !player?.isValid || !POKEMON[typeId]) return;
    const seen = jsonProp(player, DEX_VARIANTS, {}), list = seen[typeId] ?? [];
    if (list.includes(variant)) return;
    seen[typeId] = [...list, variant].sort((a, b) => a - b);
    player.setDynamicProperty(DEX_VARIANTS, JSON.stringify(seen));
}
function register(player, typeId, status, variant) {
    const n = DEX_INDEX.get(typeId);
    noteVariant(player, typeId, variant);
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
    if (owner) register(owner, entity.typeId, 2, variantOf(entity));
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
// PokedexCategoryFilterType in its order: All, Owned, Seen, Unregistered, then Undiscovered TM Move (a registered
// species with a level-up move whose TM the player has not learned, at a level none of their own of that species has
// reached; the port keeps no record of the highest level met, so their Pokemon's levels stand in) and Rideable
const DEX_FILTERS = [["All", () => true], ["Owned", (st) => st === "2"], ["Seen", (st) => st !== "0"], ["Unregistered", (st) => st === "0"],
    ["Undiscovered TM Move", (st, n, ctx) => st !== "0" && undiscoveredTm(n, ctx)], ["Rideable", (st, n) => st !== "0" && !!RIDES[NATIONAL[n]]]];
function undiscoveredTm(n, ctx) {
    const id = NATIONAL[n], top = ctx.levels.get(id) ?? 0;
    return (POKEMON[id]?.learnset ?? []).some(([level, move]) => {
        const k = TM_BY_MOVE.get(move);
        return k !== undefined && TMS[k][2] !== "default" && TMS[k][2] !== "advancement" && !ctx.learned.has(move) && level > top;
    });
}
// SearchFilter: an entry matches when its species is registered and, by species, its name holds the search; by ability
// or move, only once caught, one of its abilities or level-up moves does. Cobblemon's fourth kind, drops, is left out:
// the port keeps no drop lists in the script's data
const DEX_SEARCH = [["species", "Species Name"], ["abilities", "Ability"], ["moves", "Move Name"], ["drops", "Drops"]];
function dexMatches(n, known, search, by) {
    if (!search) return true;
    const info = POKEMON[NATIONAL[n]], q = search.trim().toLowerCase();
    if (!info || known === "0") return false;
    if (by === 0) return info.name.toLowerCase().includes(q);
    // SearchByType.DROPS: any registered species whose drops' item names hold the search
    if (by === 3) return (DEX_INFO[NATIONAL[n]]?.dr ?? []).some((d) => d.replace(/^[\d-]+x /, "").replace(/ [\d.]+%$/, "").toLowerCase().includes(q));
    if (known !== "2") return false;
    if (by === 1) return [...(info.abilities ?? []), ...(info.hidden ?? [])].some((a) => abilityName(a).toLowerCase().includes(q));
    return (info.learnset ?? []).some(([, id]) => (MOVES[id]?.name ?? "").toLowerCase().includes(q));
}
// every Pokemon the player keeps counts as caught (Cobblemon's Pokedex marks what enters the party or the PC), which
// also catches up a register made before a way of getting a Pokemon registered it
function registerKept(player) {
    for (let n = 0; n < PC_BOXES; n++) for (const rec of box(player, n)) if (rec?.t) { if (dexStatus(player, rec.t) < 2) register(player, rec.t, 2); noteVariant(player, rec.t, rec.v ?? 0); }
    try {
        for (const e of player.dimension.getEntities({ families: ["owned"] }))
            if (POKEMON[e.typeId] && prop(e, OWNER) === player.id) { if (dexStatus(player, e.typeId) < 2) register(player, e.typeId, 2); noteVariant(player, e.typeId, variantOf(e)); }
    } catch (e) { }
}
function openDex(player, colour = "red", state = { region: 0, page: 0, filter: 0, chosen: null, tab: "i" }) {
    if (!state.kept) { registerKept(player); state.kept = true; }
    const s = dexString(player), region = REGIONS[state.region];
    state.by ??= 0;
    // what Undiscovered TM Move reads: the TMs learned and the highest level of each species the player keeps
    const ctx = { learned: learnedTms(player), levels: new Map() };
    if (state.filter === 4) {
        const note = (t, lv) => ctx.levels.set(t, Math.max(ctx.levels.get(t) ?? 0, lv ?? 0));
        for (let b = 0; b < PC_BOXES; b++) for (const rec of box(player, b)) if (rec?.t) note(rec.t, rec.lv);
        try { for (const e of player.dimension.getEntities({ families: ["owned"] })) if (prop(e, OWNER) === player.id) note(e.typeId, prop(e, LEVEL)); } catch (e) { }
    }
    const entries = region.entries.filter((n) => DEX_FILTERS[state.filter][1](s[n], n, ctx) && dexMatches(n, s[n], state.search, state.by));
    const pages = Math.max(1, Math.ceil(entries.length / 25));
    state.page = Math.min(state.page, pages - 1);
    const shown = entries.slice(state.page * 25, state.page * 25 + 25);
    const v = {
        colour: { red: "r", blue: "b", green: "g", pink: "p", yellow: "y", black: "k", white: "w" }[colour] ?? "r", region: region.name, filter: DEX_FILTERS[state.filter][0],
        search: state.search ? `§f${state.search}` : "§8Search",
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
        // the form arrows step through the variants met (the base one when none is recorded)
        const met = jsonProp(player, DEX_VARIANTS, {})[id] ?? [];
        const forms = met.length ? met : [0];
        state.form = (state.form ?? 0) % forms.length;
        const variant = forms[state.form], look = { ...species, ...(species.variants?.[variant] ?? {}) };
        v.name = st === "0" ? "???" : look.name;
        v.caughtmark = st === "2" ? "y" : "n";
        v.type1 = st === "0" ? "t--" : typeCode(look.types[0]); v.type2 = st === "0" ? "t--" : typeCode(look.types[1]);
        v.portrait = st === "0" ? "i----" : iconOf(id, variant);
        state.forms = st === "0" ? 1 : forms.length;
        v.platform = st === "0" ? "p--" : `p${typeCode(species.types[0]).slice(1)}`;
        v.tab = state.tab;
        if (st === "2" && state.tab === "i") v.desc = info.d ?? "";
        if (st === "2" && state.tab === "a") {
            v.line1 = `Abilities: ${(species.abilities ?? [species.ability]).map(abilityName).join(", ")}`;
            v.line2 = species.hidden?.length ? `Hidden: ${species.hidden.map(abilityName).join(", ")}` : "";
        }
        if (st === "2" && state.tab === "s") for (const k of STAT_KEYS) v[`stat${k}`] = `${STAT_NAMES[k]} ${species.stats[k]}`;
        // SizeWidget's height and weight (decimetres and hectograms in the species files)
        if (st === "2" && state.tab === "z") { v.line1 = `Height: ${(info.h ?? 0) / 10}m`; v.line2 = `Weight: ${(info.w ?? 0) / 10}kg`; }
        if (st === "2" && state.tab === "d") v.desc = info.dr?.length ? num(info.dr.join("\n").replace(/%/g, "%%")) : "No drops available.";   // a leading digit reads as a number
        // MovesLearnsetWidget's level-up moves, as many as the box holds
        if (st === "2" && state.tab === "m") {
            const seen = new Set(), rows = [];
            for (const [at, id] of species.learnset ?? []) if (MOVES[id] && !seen.has(id)) { seen.add(id); rows.push(`Lv. ${at} ${MOVES[id].name}`); }
            v.desc = rows.length ? rows.slice(0, 16).reduce((out, r, i) => out + (i % 2 ? `   ${r}\n` : r), "") : "";
        }
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
    form.button("search", `${PC_UI}/pokedex/filter`).button(`Search by ${DEX_SEARCH[state.by][1]}`, `${PC_UI}/pokedex/by_${DEX_SEARCH[state.by][0]}`);   // its text is the tooltip
    for (const [letter, name] of [["z", "size"], ["d", "drops"], ["m", "moves"]]) form.button(name, `${PC_UI}/pokedex/tab_${name}${state.tab === letter ? "_on" : ""}`);
    const arrows = chosen !== null && (state.forms ?? 1) > 1;
    form.button("form left", `${PC_UI}/pokedex/${arrows ? "forms_arrow_left" : "none"}`).button("form right", `${PC_UI}/pokedex/${arrows ? "forms_arrow_right" : "none"}`);
    form.show(player).then((r) => {
        if (r.canceled) return;
        const pick = r.selection, again = () => openDex(player, colour, state);
        if (pick < 25) { if (shown[pick] !== undefined && shown[pick] !== state.chosen) { state.chosen = shown[pick]; state.form = 0; } }
        else if (pick === 25 || pick === 26) { state.region = (state.region + (pick === 26 ? 1 : REGIONS.length - 1)) % REGIONS.length; state.page = 0; }
        else if (pick === 27) state.page = (state.page + pages - 1) % pages;
        else if (pick === 28) state.page = (state.page + 1) % pages;
        else if (pick <= 31) state.tab = "ias"[pick - 29];
        else if (pick >= 36 && pick <= 38) state.tab = "zdm"[pick - 36];
        else if (pick === 39 || pick === 40) { if ((state.forms ?? 1) > 1) state.form = ((state.form ?? 0) + (pick === 40 ? 1 : state.forms - 1)) % state.forms; }
        else if (pick === 32 && chosen !== null) { const cry = POKEMON[NATIONAL[chosen]]?.cry; if (cry) try { player.playSound(cry); } catch (e) { } }
        else if (pick === 33) { state.filter = (state.filter + 1) % DEX_FILTERS.length; state.page = 0; }
        else if (pick === 35) { state.by = (state.by + 1) % DEX_SEARCH.length; state.page = 0; }   // the button's tooltip names the new one
        else if (pick === 34) {
            // the search box: forms cannot type into a layout, so it asks, up to SearchWidget's 23 characters
            new ModalFormData().title(`Search by ${DEX_SEARCH[state.by][1]}`).textField("Search", "", { defaultValue: state.search ?? "" })
                .show(player).then((q) => {
                    if (!q.canceled) { state.search = String(q.formValues?.[0] ?? "").replace(/[%§]/g, "").slice(0, 23); state.page = 0; }
                    again();
                }).catch(() => { });
            return;
        }
        again();
    }).catch(() => { });
}

// The Pokedex in hand (PokedexUsageContext): a tap opens the register; held past five ticks it opens the scanner, the
// HUD layer ui/hud_screen.json draws from a "cbm:scan" title (SCAN_FIELDS in port.py). Aimed at a Pokemon within ten
// blocks it shows the info frames (level and species, and size and types once caught); a species the player has
// not registered is scanned while it stays in the sights, the middle ring's segments running down, until it registers.
const SCAN_MARKER = "cbm:scan", SCAN_OPEN_TICKS = 5, SCAN_RATE = (1 / 0.0175) / 20;   // scan progress an update, 57 updates a second
const scanners = new Map();   // player id -> the scanner's state
function scanTitle(player, text) {
    try { player.onScreenDisplay.setTitle(SCAN_MARKER + text, { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }); } catch (e) { }
}
function scanSound(player, name) { try { player.playSound(`cobblemon.item.pokedex.${name}`); } catch (e) { } }
function scanRecord(st) {
    if (!st.open) return "of" + "of" + "of" + "of" + "xxxx" + " ".repeat(160) + "nn";
    const target = st.target?.isValid ? st.target : null;
    const seg = st.progress > 0 && st.progress >= 20 ? Math.max(0, Math.min(40, Math.floor((st.progress - 20) / 2))) : 40;
    let sides = "xxxx", texts = Array(8).fill("");
    if (target && st.focus >= 9) {
        const info = POKEMON[target.typeId], owned = st.caught;
        const lines = [`Lv.${prop(target, LEVEL) ?? info.level}`, info.name, `Size: ${sizeCategory(target)}`, `${info.types.map(cap).join("/")} Type`];
        sides = st.sides.map((s, k) => (k < 2 || owned ? s : "x")).join("");
        lines.forEach((line, k) => { if (sides[k] !== "x") texts[k * 2 + (sides[k] === "l" ? 0 : 1)] = line; });
    }
    const registered = st.registered > 0;
    // frame numbers go as a letter and a digit (scan_code in port.py), since digits alone read as a number
    const code = (n) => String.fromCharCode(97 + Math.floor(n / 10)) + (n % 10);
    const frame = (angle) => code(Math.floor(angle / 15) % 24);
    return "on" + frame(st.usage * 0.5) + frame(st.inner) + code(seg) + sides + texts.map((x) => padBytes(x, 20)).join("")
        + (registered ? "y" : "n") + (st.progress > 0 && !registered ? "y" : "n") + (registered ? st.regText ?? "Pokémon Registered" : "");
}
world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack?.typeId.startsWith("cobblemon:pokedex_")) return;
    scanners.set(player.id, { player, colour: itemStack.typeId.slice("cobblemon:pokedex_".length), start: system.currentTick, open: false,
                              target: null, focus: 0, progress: 0, registered: 0, usage: 0, inner: 0, sides: ["l", "r", "l", "r"], caught: false, sent: "" });
});
world.afterEvents.itemStopUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack?.typeId.startsWith("cobblemon:pokedex_")) return;
    const st = scanners.get(player.id);
    scanners.delete(player.id);
    if (!st) return;
    if (!st.open) { scanSound(player, "open"); openDex(player, st.colour); return; }
    scanSound(player, "scan_close");
    scanTitle(player, scanRecord({ open: false }));
});
system.runInterval(() => {
    for (const [id, st] of scanners) {
        const player = st.player;
        if (!player.isValid) { scanners.delete(id); continue; }
        if (!st.open && system.currentTick - st.start >= SCAN_OPEN_TICKS) { st.open = true; scanSound(player, "scan_open"); }
        if (!st.open) continue;
        // PokemonScanner.detectEntity: the nearest Pokemon in the sights within ten blocks, not behind a block
        let target;
        try {
            const hit = player.getEntitiesFromViewDirection({ maxDistance: 10 }).find((h) => POKEMON[h.entity.typeId]);
            const wall = player.getBlockFromViewDirection({ maxDistance: 10 });
            const eye = player.getHeadLocation(), at = wall && { x: wall.block.location.x + wall.faceLocation.x, y: wall.block.location.y + wall.faceLocation.y, z: wall.block.location.z + wall.faceLocation.z };
            if (hit && !(at && Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z) < hit.distance)) target = hit.entity;
        } catch (e) { }
        if (target?.id !== st.target?.id) {
            st.target = target ?? null; st.progress = 0; st.focus = 0;
            if (target) {
                st.sides = [0, 1, 2, 3].map(() => (Math.random() < 0.5 ? "l" : "r"));
                st.caught = dexStatus(player, target.typeId) >= 2;
                // new information (PokedexLearnedInformation): the species, or a form or variation of it not met yet
                const met = jsonProp(player, DEX_VARIANTS, {})[target.typeId] ?? [], v = variantOf(target);
                const info = POKEMON[target.typeId], formName = info.variants?.[v]?.name;
                st.fresh = dexStatus(player, target.typeId) === 0 || !met.includes(v);
                st.regText = dexStatus(player, target.typeId) === 0 ? "Pokémon Registered" : formName && formName !== info.name ? "Form Registered" : "Variation Registered";
                if (!st.fresh) scanSound(player, "scan_detail");
            }
        }
        st.usage += SCAN_RATE; st.inner = (st.inner + SCAN_RATE * (st.target ? 10 : 1)) % 360;
        if (st.target) st.focus = Math.min(9, st.focus + SCAN_RATE);
        if (st.target && st.fresh) {
            // new information: the scan runs while it stays in the sights, and registers it at the end
            st.progress += SCAN_RATE;
            if (system.currentTick % 6 === 0) scanSound(player, "scan_loop");
            if (st.progress >= 100) {
                register(player, st.target.typeId, prop(st.target, OWNER) === player.id ? 2 : 1, variantOf(st.target));
                st.fresh = false; st.progress = 0; st.registered = 40;
                scanSound(player, st.regText === "Pokémon Registered" ? "scan_register_pokemon" : "scan_register_aspect");
            }
        }
        if (st.registered > 0) st.registered = Math.max(0, st.registered - SCAN_RATE);
        const record = scanRecord(st);
        if (record !== st.sent) { st.sent = record; scanTitle(player, record); }
    }
}, 1);

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
    // a cure outside battle takes the status it kept (Full Restore cures and heals)
    const st = statusOf(entity), cures = effect.cure && st && (effect.cure === true || effect.cure.includes(st));
    if (cures) setProp(entity, STATUS, undefined);
    if (cures && !(effect.heal && health && health.currentValue < health.effectiveMax)) return `${name} ${STATUS_CURED[st]}.`;
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
    const stash = featureBarsFor(target.typeId).some((b) => b.species && b.items[id]);
    if (aprijuiceColour(id) && RIDES[target.typeId] && prop(target, OWNER) === player.id && !player.isSneaking) {
        const boosts = stackSlot(itemStack)?.[2]?.boosts ?? {};
        if (Object.keys(boosts).length) {
            event.cancel = true;
            system.run(() => {
                if (!target.isValid) return;
                const now = rideBoostsOf(target), most = (k) => Math.max(0, ...RIDES[target.typeId].map(([, , r]) => (r[k.toLowerCase()] ? r[k.toLowerCase()][1] - r[k.toLowerCase()][0] : 0)));
                if (!Object.entries(boosts).some(([k, v]) => (v < 0 ? (now[k] ?? 0) > 0 : (now[k] ?? 0) < most(k)))) { player.sendMessage("§7It won't have any effect."); return; }
                for (const [k, v] of Object.entries(boosts)) now[k] = Math.max(0, Math.min(most(k), (now[k] ?? 0) + v));
                setProp(target, RIDE_BOOSTS, JSON.stringify(now)); feedPokemon(target, 1); consumeHand(player);
                player.sendMessage(`§a${nicknameOf(target) || POKEMON[target.typeId].name} drank the ${itemStack.nameTag?.replace(/§./g, "") ?? "Aprijuice"}.`);
            });
            return;
        }
    }
    if (!medicine && candy === undefined && !held && !changer && !evItem && !mint && !evBerry && !stash) return;
    if (prop(target, OWNER) !== player.id) return;   // on a wild Pokemon the item does nothing, and its panel opens
    event.cancel = true;
    // StashHandler.interactMob comes first: the item goes into the stash rather than being held
    if (stash) { system.run(() => { if (target.isValid && stashItem(target, id)) consumeHand(player); }); return; }
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
        if (POKE_FOOD.includes(id) && fullnessOf(target) >= maxFullness(target.typeId)) { player.sendMessage("§7It won't have any effect."); return; }
        // the foods' feedPokemon: five for the portion berries, one for the other berries and Berry Juice
        const feeds = id === "cobblemon:berry_juice" || id.endsWith("_berry") ? (PORTION_BERRIES.has(id) ? 5 : 1) : 0;
        const fed = () => { if (feeds) feedPokemon(target, feeds); };
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
            setProp(target, "cobblemon:friendship", before + raised); consumeHand(player); fed();
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
            consumeHand(player); fed(); player.sendMessage(`§a${message}`);
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
        case "steps": return (prop(entity, STEPS) ?? 0) >= r.min;
        case "feature": return (prop(entity, `cobblemon:${r.key}`) ?? 0) === r.value;
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
// every evolution ready now, one a species (EvolutionSelectScreen lists them), at most three
function readyEvolutions(entity, player) {
    const f = fighter(entity), info = POKEMON[entity.typeId];
    if (!f || !info?.evolutions?.length || prop(entity, "cobblemon:held") === "cobblemon:everstone") return [];
    const seen = new Set();
    return info.evolutions.filter((e) => !seen.has(e.to) && e.req.every((r) => meets(entity, f, r, player)) && seen.add(e.to)).slice(0, 3);
}
function evolve(entity, evolution) {
    if (!entity.isValid) return;
    // an evolution that needs a held item uses it up
    if (evolution.req.some((q) => q.t === "held")) setProp(entity, "cobblemon:held", undefined);
    setProp(entity, EVO_NOTE, undefined);
    entity.triggerEvent(evolution.event);
}

// Fullness (Pokemon.currentFullness): its most is Grass Knot's power for the species' weight, a tenth, halved, plus
// one; food raises it (feedPokemon, with the eating sound rising as it fills) and Poke food cannot be given once full
// (PokemonSelectingItem.canUseOnPokemon); an owned Pokemon loses one each metabolism cycle (getMetabolismRate)
const FULLNESS = "cobblemon:fullness", metabolism = new Map();   // entity id -> ticks into the cycle
const PORTION_BERRIES = new Set(["figy", "wiki", "mago", "aguav", "iapapa"].map((b) => `cobblemon:${b}_berry`));
function grassKnotPower(weight) {
    return weight >= 0.1 && weight <= 21.8 ? 20 : weight >= 21.9 && weight <= 54.9 ? 40 : weight >= 55 && weight <= 110.1 ? 60
        : weight >= 110.2 && weight <= 220.3 ? 80 : weight >= 220.4 && weight <= 440.8 ? 100 : weight >= 440.9 ? 120 : 0;
}
function maxFullness(typeId) { return Math.floor(Math.floor(grassKnotPower(POKEMON[typeId]?.weight ?? 0) / 10) / 2) + 1; }
function fullnessOf(entity) { return Math.min(prop(entity, FULLNESS) ?? 0, maxFullness(entity.typeId)); }
function metabolismRate(typeId) {
    const stats = POKEMON[typeId]?.stats ?? {}, bst = Object.values(stats).reduce((a, b) => a + b, 0) || 1;
    let seconds = Math.trunc((20 - ((stats.spe ?? 0) / bst) * 20 * 4) * 60);
    if (seconds <= 0) seconds = 60;
    return seconds * 20;
}
function feedPokemon(entity, count) {
    const now = fullnessOf(entity), most = maxFullness(entity.typeId);
    try {
        if (now >= most) entity.dimension.playSound("cobblemon.item.berry.eat.full", entity.location);
        else entity.dimension.playSound("cobblemon.item.berry.eat", entity.location, { pitch: 1 + (now / most) * 0.5 });
    } catch (e) { }
    if (now >= most) return;
    setProp(entity, FULLNESS, Math.min(most, now + count));
    if (now + count === 1) metabolism.set(entity.id, 0);   // the first berry starts the cycle over
}
system.runInterval(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
        let owned = [];
        try { owned = world.getDimension(dim).getEntities({ families: ["owned"] }); } catch (e) { continue; }
        for (const e of owned) {
            if (!POKEMON[e.typeId] || !(prop(e, FULLNESS) > 0)) continue;
            const ticks = (metabolism.get(e.id) ?? 0) + 20;
            if (ticks >= metabolismRate(e.typeId)) { setProp(e, FULLNESS, prop(e, FULLNESS) - 1); metabolism.set(e.id, 0); }
            else metabolism.set(e.id, ticks);
        }
    }
}, 20);
// The species' integer features shown as bars (IntSpeciesFeature): Gimmighoul's coin and scrap stashes, which the
// items in its itemPoints add to (StashHandler, capped at the most), and the blocks travelled, counted for a Pokemon
// whose evolution asks for them as PokemonEntity.updateBlocksTraveled does (the squared distance between block
// positions, not while riding or falling)
const STEPS = "cobblemon:blocks_traveled", RIDE_BOOSTS = "cobblemon:ride_boosts";
function rideBoostsOf(entity) { try { return JSON.parse(prop(entity, RIDE_BOOSTS) ?? "{}"); } catch (e) { return {}; } }
const speciesKey = (typeId) => (POKEMON[typeId]?.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const needsSteps = (typeId) => (POKEMON[typeId]?.evolutions ?? []).some((evo) => evo.req.some((r) => r.t === "steps"));
function featureBarsFor(typeId) {
    return FEATURE_BARS.filter((b) => (b.species ? b.species.includes(speciesKey(typeId)) : b.key !== "blocks_traveled" || needsSteps(typeId)));
}
function stashItem(entity, id) {
    for (const b of featureBarsFor(entity.typeId)) {
        if (!b.species || !b.items[id]) continue;
        setProp(entity, `cobblemon:${b.key}`, Math.min(b.max, (prop(entity, `cobblemon:${b.key}`) ?? b.min) + b.items[id]));
        try { entity.dimension.playSound("cobblemon.pokemon.gimmighoul.give_item", entity.location); } catch (e) { }
        return true;
    }
    return false;
}
const stepsFrom = new Map();   // entity id -> its last block position
system.runInterval(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
        let owned = [];
        try { owned = world.getDimension(dim).getEntities({ families: ["owned"] }); } catch (e) { continue; }
        for (const e of owned) {
            if (!POKEMON[e.typeId] || !needsSteps(e.typeId)) continue;
            const at = { x: Math.floor(e.location.x), y: Math.floor(e.location.y), z: Math.floor(e.location.z) }, from = stepsFrom.get(e.id);
            stepsFrom.set(e.id, at);
            if (!from || e.isFalling || e.getComponent("minecraft:riding")) continue;
            const d = (at.x - from.x) ** 2 + (at.y - from.y) ** 2 + (at.z - from.z) ** 2;
            if (d > 0 && d < 64) setProp(e, STEPS, (prop(e, STEPS) ?? 0) + d);
        }
    }
}, 2);
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

// MoveSwapScreen: the moves a Pokemon can relearn (Pokemon.relearnableMoves, its level-up moves to its level that it does
// not know), and Forget when it knows more than one, for the move whose swap button was pressed; an add button on an
// empty slot offers the same moves without Forget
const summarySwap = new Map(), SWAP_ROWS = 20;
// lang ui.ride_style.<style>.<kind>, by the Ride page's icon code (RIDE_ICONS in port.py)
const RIDE_STYLE_NAMES = { i0: "Bird", i1: "Hover", i2: "Jet", i3: "Rocket", i4: "Standard", i5: "Cart", i6: "Boat", i7: "Dolphin", i8: "Submarine" };
// StatWidget's pages (Stat, IVs, EVs, Other), by player; the polygon's vertices in drawStatPolygon's order
const summaryRideStyle = new Map();   // player id -> the riding behaviour the Ride page shows
const summaryStatTab = new Map(), HEX_ORDER = ["hp", "atk", "def", "spe", "spd", "spa"], HEX_LABELS = ["HP", "Atk", "Def", "Speed", "Sp.Def", "Sp.Atk"];   // player id -> the move slot being swapped
function relearnable(entity, f) {
    const known = f.moves.map((m) => m.id), out = [];
    for (const [at, id] of f.info.learnset ?? []) if (at <= f.level && MOVES[id] && !known.includes(id) && !out.includes(id)) out.push(id);
    for (const id of benchedOf(entity)) if (MOVES[id] && !known.includes(id) && !out.includes(id)) out.push(id);   // taught by a TM
    return out;
}
function showSummary(source, tab = "i", viewer, selected = 0, side = "p") {
    const player = viewer ?? world.getPlayers().find((p) => p.id === prop(source, OWNER)) ?? nearestPlayer(source);
    const f = source?.isValid ? fighter(source) : undefined;
    if (!player || !f) return;
    const info = f.info, mine = prop(source, OWNER) === player.id;
    const v = { tab };
    const tagged = nicknameOf(source);
    Object.assign(v, {
        level: num(f.level), name: tagged || info.name, gender: { male: "m", female: "f" }[genderOf(source)] ?? "o",
        ball: `b${String(Math.max(0, Object.keys(BALLS).indexOf(prop(source, "cobblemon:caught_ball") ?? "cobblemon:poke_ball"))).padStart(2, "0")}`,
        type1: typeCode(info.types[0]), type2: typeCode(info.types[1]), status: prop(source, FAINTED) ? "fnt" : statusOf(source) ?? "non",
        dex: num(String(info.dex ?? DEX_INDEX.get(source.typeId) + 1 ?? 0).padStart(4, "0")), species: info.name,
        types: info.types.map(cap).join(" / "),
        ot: mine ? player.name : (world.getPlayers().find((p) => p.id === prop(source, OWNER))?.name ?? "-"),
        nature: mine ? natureName(effectiveNature(source)) : "-", ability: abilityName(f.ability), desc: ABILITY_DESC[f.ability] ?? "",
        friendship: num(friendshipOf(source)),
    });
    // the Other page's bars (BarSummarySpeciesFeatureRenderer): friendship and fullness, then the species' own (the
    // blocks travelled only while one of its evolutions asks for them), four at most as on StatWidget's first page
    const friendship = friendshipOf(source), bars = [
        ["Friendship", friendship, 0, 255, () => (friendship >= 160 ? "b" : "a"), "v00"],
        ["Fullness", fullnessOf(source), 0, maxFullness(source.typeId), (r) => (r <= 0.33 ? "c" : r <= 0.66 ? "d" : "e"), "v01"],
        ...featureBarsFor(source.typeId).map((b) => [b.name, prop(source, `cobblemon:${b.key}`) ?? b.min, b.min, b.max, () => b.fill, b.ov])];
    for (let n = 0; n < 4; n++) {
        const b = bars[n];
        if (!b) { Object.assign(v, { [`b${n}un`]: "un", [`b${n}bar`]: "o---", [`b${n}ov`]: "v--" }); continue; }
        const [name, value, min, max, colour, ov] = b, ratio = Math.min(1, (value - min) / Math.max(1, max - min)), width = Math.ceil(ratio * 110);
        Object.assign(v, { [`b${n}un`]: "uy",  [`b${n}val`]: num(value), [`b${n}bar`]: `o${colour(ratio)}${B36(width)}`,
                           [`b${n}ov`]: ov, [`b${n}pct`]: num(`${Math.floor(ratio * 100)}%%`) });
    }
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
    // MarksWidget: the marks in their index order, 30 slots; the chosen (active) mark's icon, description and title
    const markIds = marksOf(source).filter((id) => MARKS[id]).sort((a, b) => MARKS[a][7] - MARKS[b][7] || (a < b ? -1 : 1));
    for (let i = 0; i < 30; i++) v[`k${i}`] = markIds[i] ? MARKS[markIds[i]][0] : "kzz";
    const active = MARKS[prop(source, ACTIVE_MARK)];
    v.ksel = active ? active[0] : "kzz";
    v.kdesc = active ? active[4] : "";
    const shownName = tagged || info.name;
    v.ktitle = active?.[2] ? active[2].replace("{}", shownName) : shownName;
    // the polygon: each vertex's share of 400 (a stat), 31 (an IV) or 252 (an EV), in 12 steps as letters
    const rides = RIDES[source.typeId];
    let rideHover = "";
    let stab = summaryStatTab.get(player.id) ?? "s";
    if (stab === "r" && !rides) stab = "s";
    v.stab = stab; v.rtabs = rides ? "r" : "n";
    if (rides) {
        // the Ride page (StatWidget's RIDE): the chosen behaviour's stats, its range's low end with no ride boosts
        // (RidingBehaviourSettings.calculate), as shares of 100 on the pentagon in RidingStat's order
        const [style, icon, ranges] = rides[(summaryRideStyle.get(player.id) ?? 0) % rides.length];
        // the range's low end plus the ride boost, at most its high end (RidingBehaviourSettings.calculate)
        const boosts = rideBoostsOf(source);
        const values = ["acceleration", "skill", "speed", "stamina", "jump"].map((k) => (ranges[k] ? Math.min(ranges[k][0] + (boosts[k.toUpperCase()] ?? 0), ranges[k][1]) : 0));
        const steps = values.map((val) => String.fromCharCode(97 + Math.max(0, Math.min(12, Math.round((val / 100) * 12)))));
        v.pent = steps.join("") + steps[0]; v.rsty = { air: "a", liquid: "w" }[style] ?? "l"; v.rico = `i${icon}`;
        values.forEach((val, i) => { v[`rv${i}`] = num(Math.floor(val)); });
        // hovered (the text of the labels' button): the stat out of its range's top, and the boost as a share of the
        // widest range among the species' behaviours (Pokemon.getMaxRideBoost)
        rideHover = ["acceleration", "skill", "speed", "stamina", "jump"].map((k, i) => {
            const most = Math.max(0, ...rides.map(([, , r]) => (r[k] ? r[k][1] - r[k][0] : 0)));
            return padBytes(num(`${Math.floor(values[i])}/${ranges[k]?.[1] ?? 0}`), 10) + padBytes(num(`+${most ? Math.floor(((boosts[k.toUpperCase()] ?? 0) / most) * 100) : 0}`), 7);
        }).join("");
    }
    const share = (k) => (stab === "v" ? (ivs[k] ?? 0) / 31 : stab === "e" ? (evs[k] ?? 0) / 252 : (k === "hp" ? f.stats.hp : f.stats[k]) / 400);
    const steps = HEX_ORDER.map((k) => String.fromCharCode(97 + Math.max(0, Math.min(12, Math.round(share(k) * 12)))));
    v.hex = steps.join("") + steps[0];
    let hp = f.stats.hp;
    try { hp = Math.ceil(source.getComponent(EntityComponentTypes.Health).currentValue / source.getComponent(EntityComponentTypes.Health).effectiveMax * f.stats.hp); } catch (e) { }
    HEX_ORDER.forEach((k, i) => {
        // the nature's raised stat red and lowered one blue, on the Stat page (getModifiedStatColour)
        const tint = stab === "s" && up !== down ? (k === up ? "§c" : k === down ? "§9" : "§f") : "§f";
        v[`ln${i}`] = tint + HEX_LABELS[i];
        v[`lv${i}`] = num(stab === "v" ? ivs[k] ?? 0 : stab === "e" ? evs[k] ?? 0 : k === "hp" ? `${hp} / ${f.stats.hp}` : f.stats[k]);
        v[`hm${i}`] = stab === "s" && up !== down ? (k === up ? "u" : k === down ? "d" : "n") : "n";
    });
    // Cobblemon's evolve button shows while an evolution is ready, outside battle, without an Everstone; it swaps the
    // party for EvolutionSelectScreen
    const evolutions = mine && !battles.has(player.id) ? readyEvolutions(source, player) : [];
    if (side === "e" && !evolutions.length) side = "p";
    if (side === "s" && !(mine && tab === "m")) side = "p";
    const swapSlot = summarySwap.get(player.id) ?? 0;
    const swapList = side === "s" ? relearnable(source, f) : [];
    const canForget = side === "s" && f.moves.length > 1 && f.moves[swapSlot];
    v.side = side;
    for (let n = 0; n < 3; n++) {
        const e = side === "e" ? evolutions[n] : undefined, into = e && POKEMON[e.to];
        v[`e${n}slot`] = into ? "y" : "n";
        v[`e${n}name`] = into?.name ?? "";
        v[`e${n}type1`] = into ? typeCode(into.types[0]) : "x--";
        v[`e${n}type2`] = into?.types[1] ? typeCode(into.types[1]) : "x--";
        v[`e${n}icon`] = into ? iconOf(e.to) : "i----";
    }
    const party = side === "p" ? summaryParty(player) : [];
    for (let n = 0; n < 6; n++) {
        const e = party[n];
        if (!e) { v[`p${n}hp`] = "q00"; v[`p${n}gender`] = "o"; v[`p${n}icon`] = "i----"; continue; }
        v[`p${n}icon`] = iconOf(e.typeId, variantOf(e));
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
    // InfoWidget's size icon (the port has no alphas)
    v.size = "abcde"[["XS", "S", "M", "L", "XL"].indexOf(sizeCategory(source))] ?? "c";
    v.portrait = iconOf(source.typeId, variantOf(source));
    v.evolve = evolutions.length ? "Evolve" : "";
    const body = SUMMARY_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");

    const form = new ActionFormData().title("cbm:summary").body(body);
    for (const [key, name] of [["i", "info"], ["m", "moves"], ["s", "stats"]]) form.button(name, `${SUMMARY_UI}/tab_${name}${tab === key ? "_on" : ""}`);
    for (let n = 0; n < 6; n++) form.button(party[n] ? "" : " ", `${SUMMARY_UI}/pslot_${!party[n] ? "e" : prop(party[n], FAINTED) ? "x" : "n"}`);
    form.button(held ? itemName(held) : "", `${SUMMARY_UI}/item`);   // its text is the hovered tooltip
    form.button("exit", `${SUMMARY_UI}/exit`);
    for (let n = 0; n < 4; n++) form.button("move", `${SUMMARY_UI}/${tab === "m" && f.moves[n] ? "item" : "none"}`);
    form.button("evolve", `${SUMMARY_UI}/${evolutions.length ? "evolve" : "none"}`);
    for (let n = 0; n < 4; n++) {
        form.button("up", `${SUMMARY_UI}/${mine && tab === "m" && n > 0 && f.moves[n] ? "up" : "none"}`);
        form.button("down", `${SUMMARY_UI}/${mine && tab === "m" && f.moves[n + 1] ? "down" : "none"}`);
    }
    form.button("name", `${SUMMARY_UI}/${mine ? "name" : "none"}`);
    for (let n = 0; n < 3; n++) form.button(side === "e" && evolutions[n] ? "Evolve" : "", `${SUMMARY_UI}/${side === "e" && evolutions[n] ? "evsel" : "none"}`);
    const marks = String(prop(source, MARKINGS) ?? "000000");
    for (let i = 0; i < 6; i++) form.button("mark", `${SUMMARY_UI}/mark${i}_${marks[i] ?? 0}`);
    // SwapMoveButton on each move tile: swap for a known move, add for the first empty slot
    for (let n = 0; n < 4; n++) {
        const kind = f.moves[n] ? "mvswap" : n === f.moves.length ? "mvadd" : "none";
        form.button("swap", `${SUMMARY_UI}/${mine && tab === "m" ? kind : "none"}`);
    }
    // each row is a move id, or null for Forget
    const swapRows = [...swapList.slice(0, SWAP_ROWS - (canForget ? 1 : 0)), ...(canForget ? [null] : [])];
    for (let n = 0; n < SWAP_ROWS; n++) {
        const mv = swapRows[n] && MOVES[swapRows[n]];
        if (n >= swapRows.length) { form.button("", `${SUMMARY_UI}/none`); continue; }
        if (!mv) { form.button("forget", `${SUMMARY_UI}/swap_forget`); continue; }
        const text = padBytes(mv.name, 16) + padBytes(num(mv.power > 0 ? mv.power : "-"), 7)
            + padBytes(num(mv.accuracy === true || !mv.accuracy ? "-" : `${mv.accuracy}%%`), 9)
            + padBytes(num(mv.secondary?.chance ? `${mv.secondary.chance}%%` : "-"), 9) + num(`${mv.pp}PP`);
        form.button(text, `${SUMMARY_UI}/swap_${typeCode(mv.type)}`);
    }
    // StatWidget's page tabs, after the switch list's rows
    for (let i = 0; i < 4; i++) form.button("stat page", `${SUMMARY_UI}/none`);
    form.button("marks", `${SUMMARY_UI}/tab_marks${tab === "k" ? "_on" : ""}`);
    // the slot's face is drawn under it; the text is the hovered tooltip, the mark's name
    for (let i = 0; i < 30; i++) form.button(tab === "k" && markIds[i] ? MARKS[markIds[i]][1] : "", `${SUMMARY_UI}/none`);
    form.button("mark chosen", `${SUMMARY_UI}/none`);
    for (let i = 0; i < 5; i++) form.button("stat page", `${SUMMARY_UI}/none`);   // the tabs with Ride
    // the Ride page's centre and icon: "P", the polygon, the style, whether it can switch, the icon, the tooltip
    const rideCentre = tab === "s" && stab === "r" && rides ? `P${v.pent}${v.rsty}${rides.length > 1 ? "y" : "n"}${v.rico}${RIDE_STYLE_NAMES[v.rico]} | ${cap(rides[(summaryRideStyle.get(player.id) ?? 0) % rides.length][0])}` : "";
    form.button(rideCentre, `${SUMMARY_UI}/none`);
    // the chart's hover text: "R" and the Ride page's readout, or "x" and the IV or EV page's (each out of its most, then
    // as a share of it), or nothing on the other pages
    const hexHover = () => HEX_ORDER.map((k) => {
        const val = (stab === "v" ? ivs[k] : evs[k]) ?? 0, most = stab === "v" ? 31 : 252;
        return padBytes(num(`${val}/${most}`), 14) + padBytes(num(Math.floor((val / most) * 100)), 7);
    }).join("");
    const labelsText = tab !== "s" ? "" : stab === "r" ? "R" + rideHover : (stab === "v" || stab === "e") && mine ? "x" + hexHover() : "";
    form.button(labelsText, `${SUMMARY_UI}/none`);
    form.button(rideCentre, `${SUMMARY_UI}/none`);
    form.button(tab === "i" ? `Size: ${sizeCategory(source)}` : "", `${SUMMARY_UI}/none`);   // the size icon's tooltip
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 10) return;
        const pick = r.selection;
        if (pick <= 2) { showSummary(source, ["i", "m", "s"][pick], player, selected); return; }
        if (pick === 42 + SWAP_ROWS) { showSummary(source, "k", player, selected); return; }
        if (pick >= 43 + SWAP_ROWS && pick < 73 + SWAP_ROWS) {
            // a mark chosen becomes the active one, whose title the Pokemon carries (SetActiveMarkPacket), only your own
            const id = markIds[pick - 43 - SWAP_ROWS];
            if (id && mine) { setProp(source, ACTIVE_MARK, id); try { player.playSound("cobblemon.gui.click"); } catch (e) { } }
            showSummary(source, tab, player, selected); return;
        }
        if (pick === 73 + SWAP_ROWS) { if (mine) setProp(source, ACTIVE_MARK, undefined); showSummary(source, tab, player, selected); return; }
        if (pick >= 11 && pick <= 14) { showSummary(source, tab, player, tab === "m" && f.moves[pick - 11] ? pick - 11 : selected); return; }
        if (pick === 15) { showSummary(source, tab, player, selected, evolutions.length && side === "p" ? "e" : "p"); return; }
        if (pick === 80 + SWAP_ROWS || pick === 82 + SWAP_ROWS) { showSummary(source, tab, player, selected, side); return; }
        if (pick === 79 + SWAP_ROWS || pick === 81 + SWAP_ROWS) {
            if (stab === "r" && rides?.length > 1) { summaryRideStyle.set(player.id, ((summaryRideStyle.get(player.id) ?? 0) + 1) % rides.length); try { player.playSound("cobblemon.gui.click"); } catch (e) { } }
            showSummary(source, tab, player, selected, side); return;
        }
        if ((pick >= 38 + SWAP_ROWS && pick < 42 + SWAP_ROWS) || (pick >= 74 + SWAP_ROWS && pick < 79 + SWAP_ROWS)) {
            summaryStatTab.set(player.id, pick >= 74 + SWAP_ROWS ? "svero"[pick - 74 - SWAP_ROWS] : "sveo"[pick - 38 - SWAP_ROWS]);
            try { player.playSound("cobblemon.gui.click"); } catch (e) { }
            showSummary(source, tab, player, selected, side); return;
        }
        if (pick >= 34 && pick <= 37) {
            // a swap or add button opens the switch list for that slot, and closes it when pressed again
            const n = pick - 34;
            if (!mine || tab !== "m" || n > f.moves.length) { showSummary(source, tab, player, selected, side); return; }
            const open = side === "s" && swapSlot === n;
            summarySwap.set(player.id, n);
            showSummary(source, tab, player, selected, open ? "p" : "s"); return;
        }
        if (pick >= 38 && pick < 38 + SWAP_ROWS) {
            const row = pick - 38, ids = f.moves.map((m) => m.id);
            if (side === "s" && row < swapRows.length) {
                const id = swapRows[row];
                // the move that leaves goes to the benched moves, as Cobblemon's BenchMovePacket does, so a TM's is kept
                const out = !id || swapSlot < ids.length ? ids[swapSlot] : undefined;
                if (!id) ids.splice(swapSlot, 1);                  // Forget
                else if (swapSlot < ids.length) ids[swapSlot] = id;   // the chosen move takes the slot
                else ids.push(id);                                 // or fills the empty one
                const benched = benchedOf(source).filter((b) => b !== id);
                if (out && !benched.includes(out)) benched.push(out);
                setProp(source, BENCHED, benched.length ? JSON.stringify(benched) : undefined);
                setProp(source, MOVESET, JSON.stringify(ids));
                try { player.playSound("cobblemon.gui.click"); } catch (e) { }
                showSummary(source, tab, player, Math.min(selected, ids.length - 1), "p"); return;
            }
            showSummary(source, tab, player, selected, side); return;
        }
        if (pick >= 28 && pick <= 33) {
            // a marking goes to its next state, only on your own Pokemon (canEdit)
            if (mine) {
                const next = marks.split(""); next[pick - 28] = String((Number(next[pick - 28]) + 1) % 3);
                setProp(source, MARKINGS, next.join(""));
                try { player.playSound("cobblemon.gui.click"); } catch (e) { }
            }
            showSummary(source, tab, player, selected, side); return;
        }
        if (pick >= 25 && pick <= 27) {
            // EvolveSlot's Evolve button closes the screen and starts the evolution
            const chosen = side === "e" && evolutions[pick - 25];
            if (chosen) { try { player.playSound("cobblemon.evolution.ui"); } catch (e) { } evolve(source, chosen); }
            else showSummary(source, tab, player, selected, side);
            return;
        }
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
        if (pick <= 8) { const e = party[pick - 3]; showSummary(e && e.isValid ? e : source, tab, player, 0, e ? "p" : side); return; }
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

// Pokemon.initializeScale and PokemonSizeCategory: each Pokemon rolls a scale between pokemonIntrinsicSizeMin and Max
// (0.95 to 1.05) once and keeps it (through the PC and evolution, with its other kept properties); the model is drawn
// at it, and its size category is the fifth of that range it falls in, XS to XL
const SCALE = "cobblemon:scale", SIZE_MIN = 0.95, SIZE_MAX = 1.05, SIZE_CATEGORIES = ["XS", "S", "M", "L", "XL"];
function scaleOf(e) {
    let s = prop(e, SCALE);
    if (typeof s !== "number") { s = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN); setProp(e, SCALE, s); }
    return s;
}
function showScale(e) { try { if (e.getProperty("cobblemon:intrinsic") !== scaleOf(e)) e.setProperty("cobblemon:intrinsic", scaleOf(e)); } catch (err) { } }
function sizeCategory(e) {
    const range = SIZE_MAX - SIZE_MIN, seg = range / SIZE_CATEGORIES.length;
    return SIZE_CATEGORIES[Math.max(0, Math.min(SIZE_CATEGORIES.length - 1, Math.floor(Math.min(range, Math.max(0, scaleOf(e) - SIZE_MIN)) / seg)))];
}
world.afterEvents.entitySpawn.subscribe(({ entity }) => { if (POKEMON[entity?.typeId]) system.runTimeout(() => { if (entity.isValid) showScale(entity); }, 2); });
world.afterEvents.entityLoad.subscribe(({ entity }) => { if (POKEMON[entity?.typeId]) showScale(entity); });
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
    register(player, pokemon.typeId, 1, variantOf(pokemon));
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
// Marks (Pokemon.applyPotentialMarks): a caught Pokemon rolls one mark from its potential ones, the rarest chance group
// first, each group at its own chance; the potential marks are apply_potential_marks.molang's for the moment it is
// caught (the time of day, the weather where it stands, the rare, uncommon and personality marks) and a fished one's
const MARK_LIST = "cobblemon:marks", ACTIVE_MARK = "cobblemon:active_mark";
function marksOf(e) { try { return JSON.parse(prop(e, MARK_LIST) ?? "[]"); } catch (err) { return []; } }
function potentialMarks(pokemon) {
    const out = Object.keys(MARKS).filter((id) => ["rare", "uncommon", "personality"].includes(MARKS[id][5]));
    const time = world.getTimeOfDay(), dim = pokemon.dimension, loc = pokemon.location;
    if (dim.id === "minecraft:overworld") {
        out.push(time >= 22300 || time <= 5999 ? "cobblemon:mark_time_dawn" : time <= 11833 ? "cobblemon:mark_time_lunchtime"
                 : time <= 13701 ? "cobblemon:mark_time_dusk" : "cobblemon:mark_time_sleepy-time");
        if (loc.y > 191) out.push("cobblemon:mark_weather_cloudy");
    }
    let weather = "Clear", biome = "";
    try { weather = dim.getWeather?.() ?? "Clear"; } catch (e) { }
    try { biome = dim.getBiome(loc)?.id ?? ""; } catch (e) { }
    const wet = weather !== "Clear", storm = weather === "Thunder";
    const freezing = /frozen|snowy|ice|grove|jagged|peaks/.test(biome), sandy = /desert|badlands|beach/.test(biome);
    if (!freezing && !sandy && wet) out.push(storm ? "cobblemon:mark_weather_stormy" : "cobblemon:mark_weather_rainy");
    if (freezing && wet) out.push(storm ? "cobblemon:mark_weather_blizzard" : "cobblemon:mark_weather_snowy");
    if (sandy && wet) out.push("cobblemon:mark_weather_sandstorm");
    if (/jungle|swamp|mushroom|snowy_slopes|frozen_peaks|jagged_peaks/.test(biome)) out.push("cobblemon:mark_weather_misty");
    if (/desert|badlands|savanna|nether/.test(biome) && !wet && time >= 6000 && time <= 12000) out.push("cobblemon:mark_weather_dry");
    if (prop(pokemon, "cobblemon:fished")) out.push("cobblemon:mark_fishing");
    return out.filter((id) => MARKS[id]);
}
function applyPotentialMarks(pokemon) {
    const owned = marksOf(pokemon), potentials = potentialMarks(pokemon).filter((id) => !owned.includes(id));
    const groups = new Map();
    for (const id of potentials) { const [, , , , , group, chance] = MARKS[id]; const key = group ?? String(chance); (groups.get(key) ?? groups.set(key, { chance, ids: [] }).get(key)).ids.push(id); }
    for (const g of [...groups.values()].sort((a, b) => a.chance - b.chance)) {
        if (Math.random() * 100 < Math.min(1, Math.max(0, g.chance)) * 100) {
            const id = g.ids[Math.floor(Math.random() * g.ids.length)];
            setProp(pokemon, MARK_LIST, JSON.stringify([...owned, id]));
            return id;
        }
    }
    return null;
}

function keepCaught(player, pokemon, ballId) {
    if (!pokemon?.isValid || !player?.isValid) return;
    try { pokemon.triggerEvent("cobblemon:caught"); pokemon.getComponent(EntityComponentTypes.Tameable)?.tame(player); } catch (e) { }
    setProp(pokemon, OWNER, player.id);
    setProp(pokemon, "cobblemon:caught_ball", ballId);
    register(player, pokemon.typeId, 2, variantOf(pokemon));
    applyPotentialMarks(pokemon);
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
    // a category's slots are its starters and, with randomStarter, the Random slot after them
    const slots = (cat) => (cat ? [...cat.pokemon, ...(cat.random ? [{ random: true }] : [])] : []);
    const chosen = slots(STARTERS[state.cat])[state.pick], info = POKEMON[chosen.id];
    const v = chosen.random
        ? { name: "Random", dex: "", portrait: "iunkn", type1: "t--", type2: "t--", platform: "p--",
            desc: "A random starter Pokémon chosen from the selection pool. It's impossible to know what it will be unless it is chosen." }
        : { name: info.name, dex: num(`No. ${String(DEX_INFO[chosen.id]?.n ?? 0).padStart(4, "0")}`), portrait: iconOf(chosen.id),
            type1: typeCode(info.types[0]), type2: typeCode(info.types[1]), platform: `p${typeCode(info.types[0]).slice(1)}`, desc: DEX_INFO[chosen.id]?.d ?? "" };
    const shown = STARTERS.slice(state.page * 3, state.page * 3 + 3);
    for (let k = 0; k < 3; k++) {
        const cat = shown[k];
        v[`c${k}name`] = cat?.name ?? "";
        for (let n = 0; n < 3; n++) { const here = slots(cat)[n]; v[`c${k}p${n}icon`] = here?.random ? "iunkn" : iconOf(here?.id); }
    }
    const body = STARTER_LAYOUT.map(([key, width]) => (width ? padBytes(v[key] ?? "", width) : v[key] ?? "")).join("");
    const form = new ActionFormData().title("cbm:starter").body(body);
    for (let k = 0; k < 3; k++) for (let n = 0; n < 3; n++) {
        const here = slots(shown[k])[n], on = state.page * 3 + k === state.cat && n === state.pick;
        form.button("starter", `${PC_UI}/starter/${here ? (on ? "slot_on" : "slot") : "none"}`);
    }
    form.button("choose", `${PC_UI}/starter/choose`).button("exit", `${PC_UI}/summary/exit`);
    form.button("up", `${PC_UI}/pokedex/arrow_up`).button("down", `${PC_UI}/pokedex/arrow_down`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === 10) return;
        const pick = r.selection;
        if (pick < 9) {
            const k = Math.floor(pick / 3), n = pick % 3;
            const here = slots(shown[k])[n];
            if (here) { state.cat = state.page * 3 + k; state.pick = n; try { const cry = POKEMON[here.id]?.cry; if (cry) player.playSound(cry); else player.playSound("cobblemon.gui.click"); } catch (e) { } }
            openStarter(player, state); return;
        }
        if (pick === 11 || pick === 12) { state.page = (state.page + (pick === 12 ? 1 : pages - 1)) % pages; openStarter(player, state); return; }
        // the Random slot: any starter of any category (CobbledStarterHandler.chooseStarter)
        const pool = STARTERS.flatMap((c) => c.pokemon);
        giveStarter(player, chosen.random ? pool[Math.floor(Math.random() * pool.length)] : chosen);
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
