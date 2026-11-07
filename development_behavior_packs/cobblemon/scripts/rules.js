// Cobblemon's game rules (world/gamerules/CobblemonGameRules.kt) and the rest of its command surface (common/command):
// the rules as world settings, since a pack adds no game rule, each a world dynamic property read by main.js where the
// Kotlin reads the rule, and set or shown by a command of its name (cobblemon:dopokemonloot [value]), as the
// doPokemonPredation command already does; the extra property keys PokemonProperties.parse takes; and the commands,
// arguments and aliases main.js's registerCommands lacked. main.js hands the functions it needs in an api object, so
// this module holds no copy of its data.
import { world, system, CustomCommandParamType } from "@minecraft/server";

// CobblemonGameRules: the rule, its Cobblemon default and what it gates here. mobTargetInBattle is not among them: a
// script cannot tell Bedrock's own mobs to leave a battling player alone (TargetingConditionsMixin has no counterpart)
export const RULES = {
    doPokemonSpawning: [true, "Whether wild Pokemon spawn (Bedrock's spawn rules' spawns are removed as they appear, and the script's spawner rests)"],
    doPokemonLoot: [true, "Whether a wild Pokemon that dies or is beaten drops its items, and an evolution its drops"],
    battleInvulnerability: [false, "Whether a player in a battle takes no damage"],
    doShinyStarters: [false, "Whether the starter a player chooses is shiny"],
    healersHealPC: [false, "Whether a Healing Machine heals the PC's Pokemon along with the party"],
};
const ruleKey = (name) => `cobblemon:rule_${name.toLowerCase()}`;
export function ruleOn(name) {
    const fallback = RULES[name]?.[0] ?? true;
    try { const v = world.getDynamicProperty(ruleKey(name)); return typeof v === "boolean" ? v : fallback; } catch (e) { return fallback; }
}
// a rule at its default is not stored, so a default that changes with the add-on follows along
export function setRule(name, value) { try { world.setDynamicProperty(ruleKey(name), value === RULES[name]?.[0] ? undefined : !!value); } catch (e) { } }

// one command a rule, cobblemon:<rule in lower case> [value]: shows it, or sets it on the next tick
export function registerRuleCommands(add, ok, later) {
    for (const [name, [, what]] of Object.entries(RULES)) {
        add(name.toLowerCase(), what, [], [{ type: CustomCommandParamType.Boolean, name: "value" }], (origin, value) => {
            if (value === undefined) return ok(`${name} = ${ruleOn(name)}`);
            later(() => setRule(name, value));
            return ok(`${name} is now ${value}`);
        });
    }
}

// battleInvulnerability (PlayerMixin.isInvulnerableTo): a player in a battle takes no damage. Resistance V turns every
// hit away in Bedrock, so each second a battling player gets two seconds of it, hidden, while the rule holds
export function battleGuard(battles) {
    system.runInterval(() => {
        if (!ruleOn("battleInvulnerability")) return;
        for (const player of world.getPlayers()) {
            if (!battles().has(player.id)) continue;
            try { player.addEffect("resistance", 40, { amplifier: 4, showParticles: false }); } catch (e) { }
        }
    }, 20);
}

// doPokemonSpawning (ServerPlayerMixin.cobblemon$canSpawn gates the whole spawner): Bedrock's spawn rules cannot be
// switched off, so while the rule is off a wild Pokemon they spawn is removed two ticks after it appears, when the
// script's own spawns (a sent-out party member, a trainer's Pokemon, a herd member, a command's) carry their owner or
// level, or the command's tag, and a natural one carries nothing yet
export function watchNaturalSpawns({ POKEMON, prop, OWNER, LEVEL, PID, cause }) {
    world.afterEvents.entitySpawn.subscribe(({ entity, cause: how }) => {
        if (how !== cause || !POKEMON[entity?.typeId] || ruleOn("doPokemonSpawning")) return;
        system.runTimeout(() => {
            try {
                if (!entity.isValid || prop(entity, OWNER) !== undefined || prop(entity, LEVEL) !== undefined || prop(entity, PID) !== undefined) return;
                if (entity.getTags().includes("cobblemon:commanded")) return;
                entity.remove();
            } catch (e) { }
        }, 2);
    });
}

// healersHealPC (HealingMachineBlockEntity.completeHealing: pc().forEach { it.heal() }): every PC record healed,
// as a heal leaves a Pokemon, full health, not fainted and its status gone
export function healPcBoxes(player, { pcBoxes, box, saveBox }) {
    for (let n = 0; n < pcBoxes(player); n++) {
        const contents = box(player, n);
        if (!contents.some(Boolean)) continue;
        saveBox(player, n, contents.map((rec) => (rec ? healedRecord(rec) : null)));
    }
}
export function healedRecord(rec) {
    const k = { ...(rec.k ?? {}) };
    delete k["cobblemon:status"];
    return { ...rec, f: false, hp: 1, k };
}

// The property keys of PokemonProperties.parse and the custom property types (api/properties) beyond those main.js's
// parseProps reads itself: the two-word form ("friendship 200") works for these keys, a flag word alone turns itself on
export const PROP_KEYS = ["friendship", "fullness", "pokeball", "status", "moves", "min_perfect_ivs", "scale_modifier", "tradeable", "tradable",
    "originaltrainer", "ot", "aspect", "unaspect", "label", "tag", "nick", "type", "elemental_type", "tera_type", "tera", "dmax_level", "dmax", "gmax_factor", "gmax",
    "hp_iv", "attack_iv", "defence_iv", "defense_iv", "special_attack_iv", "special_defence_iv", "special_defense_iv", "speed_iv",
    "hp_ev", "attack_ev", "defence_ev", "defense_ev", "special_attack_ev", "special_defence_ev", "special_defense_ev", "speed_ev",
    "season", "vivillon_wings", "color", "colour", "cosmetic_item", "face_spots", "character", "fish_stripes", "striped", "dance_style", "core_color",
    "wolf_form", "sea", "blossom_form", "pumpkin_size", "cream", "decoration", "squawkabilly_color", "poodle_trim", "paint_color", "tatsugiri_texture",
    "maushold_family", "magikarp_jump", "landsnake_form", "gyarados_eye_color", "wooper_heart", "bull_breed", "snake_pattern", "metals", "tree", "mooshtank"];
export const PROP_FLAGS = ["alpha", "is_alpha", "hiddenability", "ha", "uncatchable", "no_ai", "held_item_visible", "alolan", "galarian", "hisuian", "paldean", "valencian"];
const STAT_NAMES = { hp: "hp", attack: "atk", defence: "def", defense: "def", special_attack: "spa", special_defence: "spd", special_defense: "spd", speed: "spe" };
const STATUS_IDS = { poison: "psn", psn: "psn", poisonbadly: "tox", toxic: "tox", tox: "tox", paralysis: "par", paralyzed: "par", par: "par", burn: "brn", brn: "brn",
    frozen: "frz", freeze: "frz", frz: "frz", sleep: "slp", asleep: "slp", slp: "slp" };
const FEATURE_KEYS = PROP_KEYS.slice(PROP_KEYS.indexOf("season"));
const flat = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// a key=value word parseProps did not take itself, onto props under Cobblemon's main key
export function parseExtraProp(props, key, value) {
    const v = String(value);
    switch (key) {
        case "nick": props.nickname = v; return;
        case "is_alpha": case "alpha": props.alpha = v !== "false" && v !== "no"; return;
        case "ha": case "hiddenability": props.hiddenability = v !== "false" && v !== "no"; return;
        case "friendship": props.friendship = Math.max(0, Math.min(255, Number(v) || 0)); return;
        case "fullness": props.fullness = Math.max(0, Number(v) || 0); return;
        case "pokeball": props.pokeball = v.includes(":") ? v.toLowerCase() : `cobblemon:${v.toLowerCase()}`; return;
        case "status": props.status = STATUS_IDS[flat(v)]; return;
        case "moves": props.moves = v.split(",").map(flat).filter(Boolean); return;
        case "min_perfect_ivs": props.min_perfect_ivs = Math.max(0, Math.min(6, Number(v) || 0)); return;
        case "scale_modifier": props.scale_modifier = Math.max(0.05, Math.min(2, Number(v) || 1)); return;
        case "tradable": case "tradeable": props.tradeable = v !== "false" && v !== "no"; return;
        case "ot": case "originaltrainer": props.ot = String(value); return;
        case "tag": case "label": props.label = v.toLowerCase(); return;
        case "aspect": props.form = props.form ?? v.toLowerCase(); return;
        case "unaspect": props.unaspect = v.toLowerCase(); return;
        case "uncatchable": props.uncatchable = v !== "false" && v !== "no"; return;
        case "no_ai": props.no_ai = v !== "false" && v !== "no"; return;
        case "held_item_visible": props.held_item_visible = v !== "false" && v !== "no"; return;
    }
    const stat = key.match(/^(.*)_(iv|ev)$/);
    if (stat && STAT_NAMES[stat[1]]) {
        const bag = stat[2] === "iv" ? (props.ivs ??= {}) : (props.evs ??= {});
        bag[STAT_NAMES[stat[1]]] = Math.max(0, Math.min(stat[2] === "iv" ? 31 : 252, Number(v) || 0));
        return;
    }
    // a species feature's choice is the aspect the species' look carries (season=autumn, vivillon_wings=garden, color=red)
    if (FEATURE_KEYS.includes(key)) { props.form = props.form ?? v.toLowerCase(); props[key] = v.toLowerCase(); return; }
    props[key] = String(value);
}
// a flag word on its own: shiny and s main.js takes; these are the rest
export function parseExtraFlag(props, key) {
    if (["alpha", "is_alpha"].includes(key)) props.alpha = true;
    else if (["ha", "hiddenability"].includes(key)) props.hiddenability = true;
    else if (["alolan", "galarian", "hisuian", "paldean", "valencian"].includes(key)) props.form = props.form ?? key;
    else props[key] = true;
}

// IVs or EVs from the properties over a base: the stats named, min_perfect_ivs stats at 31
function statBag(given, base, perfect = 0) {
    const out = { ...base, ...(given ?? {}) };
    const open = Object.keys(out).filter((k) => !(given ?? {})[k]).sort(() => Math.random() - 0.5);
    for (let n = 0; n < perfect && open.length; n++) out[open.shift()] = 31;
    return out;
}
function statusValue(id) { return id ? JSON.stringify({ s: id, left: 300 }) : undefined; }
const moveList = (props, { MOVES }) => props.moves?.filter((id) => MOVES[id]).slice(0, 4);

// the extra properties onto a new record (recordFor): its kept keys and its moves
export function extraRecord(rec, props, api) {
    const { POKEMON, STAT_KEYS } = api, info = POKEMON[rec.t], k = rec.k;
    if (props.hiddenability && info?.hidden?.[0]) k["cobblemon:ability"] = info.hidden[0];
    if (props.friendship !== undefined) k["cobblemon:friendship"] = props.friendship;
    if (props.fullness !== undefined) k["cobblemon:fullness"] = props.fullness;
    if (props.pokeball) k["cobblemon:caught_ball"] = props.pokeball;
    if (props.status) k["cobblemon:status"] = statusValue(props.status);
    if (props.alpha) k["cobblemon:alpha"] = true;
    if (props.ot) k["cobblemon:ot"] = props.ot;
    if (props.scale_modifier !== undefined) k["cobblemon:scale"] = props.scale_modifier;
    if (props.tradeable === false) k["cobblemon:tradeable"] = false;
    if (props.uncatchable) k["cobblemon:uncatchable"] = true;
    if (props.label) k["cobblemon:labels"] = JSON.stringify([props.label]);
    if (props.ivs || props.min_perfect_ivs) k["cobblemon:ivs"] = JSON.stringify(statBag(props.ivs, Object.fromEntries(STAT_KEYS.map((s) => [s, Math.floor(Math.random() * 32)])), props.min_perfect_ivs));
    if (props.evs) k["cobblemon:evs"] = JSON.stringify(statBag(props.evs, Object.fromEntries(STAT_KEYS.map((s) => [s, 0]))));
    const moves = moveList(props, api);
    if (moves?.length) rec.mv = JSON.stringify(moves);
    return rec;
}
// the same onto a Pokemon that exists (applyProps: spawnpokemon, pokemonedit)
export function extraEntity(e, props, api) {
    const { POKEMON, STAT_KEYS, setProp, prop, makeAlpha, showScale } = api, info = POKEMON[e.typeId];
    if (props.hiddenability && info?.hidden?.[0]) setProp(e, "cobblemon:ability", info.hidden[0]);
    if (props.friendship !== undefined) setProp(e, "cobblemon:friendship", props.friendship);
    if (props.fullness !== undefined) setProp(e, "cobblemon:fullness", props.fullness);
    if (props.pokeball) setProp(e, "cobblemon:caught_ball", props.pokeball);
    if (props.status) setProp(e, "cobblemon:status", statusValue(props.status));
    if (props.alpha) try { makeAlpha(e); } catch (err) { }
    if (props.ot) setProp(e, "cobblemon:ot", props.ot);
    if (props.scale_modifier !== undefined) { setProp(e, "cobblemon:scale", props.scale_modifier); try { showScale(e); } catch (err) { } }
    if (props.tradeable === false) setProp(e, "cobblemon:tradeable", false);
    if (props.uncatchable) setProp(e, "cobblemon:uncatchable", true);
    if (props.label) setProp(e, "cobblemon:labels", JSON.stringify([props.label]));
    if (props.held_item_visible === false) setProp(e, "cobblemon:held_hidden", true);
    if (props.ivs || props.min_perfect_ivs) {
        let base = {}; try { base = JSON.parse(prop(e, "cobblemon:ivs") ?? "{}"); } catch (err) { }
        setProp(e, "cobblemon:ivs", JSON.stringify(statBag(props.ivs, Object.fromEntries(STAT_KEYS.map((s) => [s, base[s] ?? Math.floor(Math.random() * 32)])), props.min_perfect_ivs)));
    }
    if (props.evs) {
        let base = {}; try { base = JSON.parse(prop(e, "cobblemon:evs") ?? "{}"); } catch (err) { }
        setProp(e, "cobblemon:evs", JSON.stringify(statBag(props.evs, Object.fromEntries(STAT_KEYS.map((s) => [s, base[s] ?? 0])))));
    }
    const moves = moveList(props, api);
    if (moves?.length) setProp(e, "cobblemon:moves", JSON.stringify(moves));
    // no_ai (NoAIProperty): the Pokemon stands where it is
    if (props.no_ai) try { e.addEffect("slowness", 20000000, { amplifier: 255, showParticles: false }); } catch (err) { }
}

// PcSearchCommand's PokemonProperties.matches over a PC record: every property given must hold
export function pcMatches(rec, props, { POKEMON, SHINY_VARIANTS, VARIANT_LOOKS, speciesNamed }) {
    const k = rec.k ?? {}, look = VARIANT_LOOKS[rec.t]?.[rec.v ?? 0]?.[0] ?? "";
    const typeId = props.species ? speciesNamed(props.species) : undefined;
    if (props.species && rec.t !== typeId) return false;
    if (props.level !== undefined && rec.lv !== props.level) return false;
    if (props.shiny !== undefined && (SHINY_VARIANTS[rec.t] ?? []).includes(rec.v ?? 0) !== props.shiny) return false;
    if (props.form && !look.includes(props.form.toLowerCase())) return false;
    if (props.gender && (k["cobblemon:gender"] ?? "") !== props.gender.toLowerCase()) return false;
    if (props.nature && (k["cobblemon:nature"] ?? "") !== props.nature.toLowerCase()) return false;
    if (props.ability && flat(k["cobblemon:ability"] ?? POKEMON[rec.t]?.ability ?? "") !== flat(props.ability)) return false;
    if (props.held_item && (k["cobblemon:held"] ?? "").replace(/^cobblemon:/, "") !== props.held_item.replace(/^cobblemon:/, "")) return false;
    if (props.nickname && (rec.n ?? "") !== props.nickname) return false;
    if (props.alpha !== undefined && !!k["cobblemon:alpha"] !== props.alpha) return false;
    if (props.friendship !== undefined && (k["cobblemon:friendship"] ?? POKEMON[rec.t]?.variants?.[rec.v ?? 0]?.friendship ?? POKEMON[rec.t]?.friendship ?? 50) !== props.friendship) return false;
    if (props.pokeball && (k["cobblemon:caught_ball"] ?? "cobblemon:poke_ball") !== props.pokeball) return false;
    return true;
}

// TeachCommand: LearnsetQuery.ANY.canLearn, by what the port knows of a species: its level-up moves at any level, its
// egg moves and the TMs it can learn
export function canLearn(typeId, moveId, { POKEMON, TM_SPECIES, TM_BY_MOVE }) {
    const info = POKEMON[typeId];
    if (!info) return false;
    if (info.learnset?.some(([, id]) => id === moveId)) return true;
    if (info.egg?.includes(moveId)) return true;
    return !!(TM_BY_MOVE.has(moveId) && (TM_SPECIES[typeId] ?? []).includes(TM_BY_MOVE.get(moveId)));
}

// GiveTmCommand: a quantity up to 2304 given in stacks of 64
export function tmStacks(quantity) {
    const stacks = [];
    for (let left = Math.max(1, Math.min(2304, quantity ?? 1)); left > 0; left -= 64) stacks.push(Math.min(64, left));
    return stacks;
}

// PokedexCommand: grant or revoke a whole dex ("all", with a dex named or the National one), one species (every form)
// or one form of it, and printcalculations (SeenCount, CaughtCount, SeenPercent and CaughtPercent for a dex, or
// every dex). Returns the message for the caller, or null when the words name nothing
export function dexCommand(action, player, word, form, api) {
    const { NATIONAL, REGIONS, POKEMON, DEX, DEX_VARIANTS, DEX_CAUGHT, dexString, register, jsonProp, speciesNamed, variantFor, VARIANT_LOOKS } = api;
    const regionNamed = (name) => REGIONS.find((r) => flat(r.name) === flat((name ?? "national").replace(/^cobblemon:/, "")));
    const counts = (region) => {
        const s = dexString(player), ids = region.entries.map((i) => NATIONAL[i]).filter((id) => POKEMON[id]);
        const seen = ids.filter((id) => Number(s[NATIONAL.indexOf(id)]) >= 1).length, caught = ids.filter((id) => Number(s[NATIONAL.indexOf(id)]) >= 2).length;
        const pct = (n) => (ids.length ? Math.round((n * 1000) / ids.length) / 10 : 0);
        return `${region.name}: Seen ${seen} (${pct(seen)}%), Caught ${caught} (${pct(caught)}%)`;
    };
    if (action === "printcalculations") {
        if (word === "all") return REGIONS.map(counts).join("\n");
        const region = regionNamed(word);
        return region ? counts(region) : null;
    }
    const revokeSpecies = (ids, s) => {
        const seen = jsonProp(player, DEX_VARIANTS, {}), caught = jsonProp(player, DEX_CAUGHT, {});
        for (const id of ids) { const n = NATIONAL.indexOf(id); if (n >= 0) s = s.slice(0, n) + "0" + s.slice(n + 1); delete seen[id]; delete caught[id]; }
        player.setDynamicProperty(DEX, s);
        player.setDynamicProperty(DEX_VARIANTS, JSON.stringify(seen)); player.setDynamicProperty(DEX_CAUGHT, JSON.stringify(caught));
    };
    if (word === "all" || word === undefined) {
        const region = regionNamed(form);
        if (!region) return null;
        const ids = region.entries.map((i) => NATIONAL[i]).filter((id) => POKEMON[id]);
        if (action === "grant") { for (const id of ids) register(player, id, 2, 0); return `Filled the ${region.name} dex of ${player.name}`; }
        revokeSpecies(ids, dexString(player));
        return `Cleared the ${region.name} dex of ${player.name}`;
    }
    const typeId = speciesNamed(word);
    if (!typeId) return null;
    const name = POKEMON[typeId].name;
    if (!form) {
        if (action === "grant") { register(player, typeId, 2, 0); return `Granted ${name} to ${player.name}`; }
        revokeSpecies([typeId], dexString(player));
        return `Removed ${name} from ${player.name}`;
    }
    // one form: the variant of that look (its shiny one too), as PokedexCommand's form records
    const variants = (VARIANT_LOOKS[typeId] ?? []).map((look, v) => [look, v]).filter(([look]) => (look[0] ?? "normal").includes(form.toLowerCase()) && !look[1]).map(([, v]) => v);
    if (!variants.length) return null;
    if (action === "grant") { for (const v of variants) register(player, typeId, 2, v); return `Granted ${name}-${form} to ${player.name}`; }
    const seen = jsonProp(player, DEX_VARIANTS, {}), caught = jsonProp(player, DEX_CAUGHT, {});
    seen[typeId] = (seen[typeId] ?? []).filter((v) => !variants.includes(v)); caught[typeId] = (caught[typeId] ?? []).filter((v) => !variants.includes(v));
    player.setDynamicProperty(DEX_VARIANTS, JSON.stringify(seen)); player.setDynamicProperty(DEX_CAUGHT, JSON.stringify(caught));
    if (!seen[typeId].length && !caught[typeId].length) revokeSpecies([typeId], dexString(player));
    return `Removed ${name}-${form} from ${player.name}`;
}

// the village Pokemon Center's chest (villages/<type>/pokecenter.nbt names villages/village_pokecenters), filled once
// the piece stands, since the converted piece carries no loot table
export function fillPokecenterChest(dim, volume) {
    system.runTimeout(() => {
        try {
            for (let x = volume.from.x; x <= volume.to.x; x++) for (let y = volume.from.y; y <= volume.to.y; y++) for (let z = volume.from.z; z <= volume.to.z; z++) {
                const block = dim.getBlock({ x, y, z });
                if (block?.typeId !== "minecraft:chest") continue;
                const items = block.getComponent("minecraft:inventory")?.container;
                if (items && items.emptySlotsCount < items.size) continue;   // a chest with something in it already
                dim.runCommand(`loot insert ${x} ${y} ${z} loot "villages/village_pokecenters"`);
            }
        } catch (e) { console.warn(`[cobblemon] pokecenter chest: ${e}`); }
    }, 2);
}

// The commands main.js's registerCommands lacked: pokemoneditother, pokemonrestart and pokemonrestartother
// (PokemonRestartCommand: the party and PC cleared, and with reset_starters the starter offered again),
// pcsearchother (PcSearchCommand's "other"), each with Cobblemon's aliases
export function registerExtraCommands(add, api) {
    const P = CustomCommandParamType, { ok, bad, later, words, COMMAND_PROPS, commandPlayer, memberAt, parseProps, applyProps, saveParty, partyOf, removeMember,
        pcBoxes, saveBox, box, STARTER_CHOSEN, openStarter, describe } = api;
    add(["pokemoneditother", "pokeeditother"], "Changes another player's party Pokemon's properties", [{ type: P.PlayerSelector, name: "player" }, { type: P.Integer, name: "slot" }, { type: P.String, name: "properties" }], words(COMMAND_PROPS - 1),   // Bedrock allows 8 parameters
        (origin, players, slot, ...w) => {
            const player = commandPlayer(origin, players), m = player && memberAt(player, slot);
            if (!m) return bad("No Pokemon in that slot");
            later(() => { applyProps(m, parseProps(w)); saveParty(player.id); });
            return ok("Edited");
        });
    const restart = (player, resetStarters) => {
        if (!player) return bad("No player");
        later(() => {
            for (const slot of [...partyOf(player.id)]) removeMember(player, slot);
            saveParty(player.id);
            for (let n = 0; n < pcBoxes(player); n++) if (box(player, n).some(Boolean)) saveBox(player, n, []);
            if (resetStarters) { player.setDynamicProperty(STARTER_CHOSEN, false); openStarter(player); }
        });
        return ok(`${player.name}'s Pokemon were reset`);
    };
    add(["pokemonrestart", "pokerestart"], "Clears your party and PC, and with true offers the starter screen again", [], [{ type: P.Boolean, name: "reset_starters" }],
        (origin, resetStarters) => restart(commandPlayer(origin), resetStarters === true));
    add(["pokemonrestartother", "pokerestartother"], "Clears a player's party and PC, and with true offers them the starter screen again", [{ type: P.PlayerSelector, name: "player" }], [{ type: P.Boolean, name: "reset_starters" }],
        (origin, players, resetStarters) => restart(commandPlayer(origin, players), resetStarters === true));
    add("pcsearchother", "Lists where in a player's PC Pokemon of these properties are", [{ type: P.PlayerSelector, name: "player" }, { type: P.String, name: "properties" }], words(COMMAND_PROPS),
        (origin, players, ...w) => {
            const player = commandPlayer(origin, players), props = parseProps(w);
            if (!player) return bad("No player");
            const found = [];
            for (let n = 0; n < pcBoxes(player); n++) box(player, n).forEach((rec, i) => { if (rec && pcMatches(rec, props, api)) found.push(`Box ${n + 1} slot ${i + 1}: ${describe(rec)}`); });
            return ok(found.length ? `${player.name}'s PC:\n${found.slice(0, 30).join("\n")}` : `No Pokemon matching "${w.filter(Boolean).join(" ")}" in ${player.name}'s PC`);
        });
}
