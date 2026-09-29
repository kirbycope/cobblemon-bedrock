// Turn-based battles. A "Battle" button on a wild Pokemon's panel (or a trainer's challenge) fires a
// script event; this sends out the player's nearest owned Pokemon that can still fight, freezes both, and
// runs turns through a button form: the Pokemon's four moves with their PP, Switch, Throw Poke Ball and
// Run. Damage is the main-series formula over Showdown's move table and type chart, generated into data.js,
// with stat stages, accuracy and evasion, the major status conditions, a handful of abilities, critical
// hits and Struggle. A win earns experience; levels, the moves learned on the way and fainting are kept on
// the Pokemon as dynamic properties, and a fainted Pokemon sits out until a healing machine or the
// professor heals it.
import { world, system, EntityComponentTypes, EntityInitializationCause, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { POKEMON, MOVES, TYPES, BALLS } from "./data.js";
import { BERRIES, FOSSILS } from "./blocks.js";
import { FORMATIONS, BRUSH_LOOT } from "./fossil_loot.js";

const battles = new Map(); // player id -> battle
const LEVEL = "cobblemon:level", EXP = "cobblemon:exp", MOVESET = "cobblemon:moves", FAINTED = "cobblemon:fainted";
const STAT_NAMES = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
const STATUS_TEXT = { brn: "was burned", par: "is paralyzed! It may be unable to move", psn: "was poisoned", tox: "was badly poisoned", slp: "fell asleep", frz: "was frozen solid" };
const STATUS_TAG = { brn: "§6BRN§r", par: "§ePAR§r", psn: "§5PSN§r", tox: "§5TOX§r", slp: "§7SLP§r", frz: "§bFRZ§r" };
const STATUS_IMMUNE = { brn: ["fire"], par: ["electric"], psn: ["poison", "steel"], tox: ["poison", "steel"], frz: ["ice"] };
// abilities that make a move type miss, and the ones that power up a type in a pinch
const ABILITY_IMMUNE = { levitate: "ground", flashfire: "fire", voltabsorb: "electric", lightningrod: "electric", motordrive: "electric", waterabsorb: "water", stormdrain: "water", dryskin: "water", sapsipper: "grass" };
const ABILITY_PINCH = { blaze: "fire", torrent: "water", overgrow: "grass", swarm: "bug" };
const ABILITY_CONTACT = { static: "par", flamebody: "brn", poisonpoint: "psn" };
const STRUGGLE = { name: "Struggle", type: "???", power: 50, accuracy: true, category: "Physical", priority: 0, pp: 1, target: "normal", contact: true };

function statAt(base, level) { return Math.floor(((2 * base + 31) * level) / 100) + 5; }
function hpAt(base, level) { return Math.floor(((2 * base + 31) * level) / 100) + level + 10; }
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
    const stats = { hp: hpAt(info.stats.hp, level), atk: statAt(info.stats.atk, level), def: statAt(info.stats.def, level), spa: statAt(info.stats.spa, level), spd: statAt(info.stats.spd, level), spe: statAt(info.stats.spe, level) };
    // a Pokemon enters with the share of its health its entity has left
    let hp = stats.hp;
    try {
        const health = entity.getComponent(EntityComponentTypes.Health);
        if (health) hp = Math.max(1, Math.round((stats.hp * health.currentValue) / health.effectiveMax));
    } catch (e) { }
    const moves = ids.filter((id) => MOVES[id]).map((id) => ({ id, ...MOVES[id], left: MOVES[id].pp }));
    return { entity, info, level, stats, hp, moves, ability: info.ability, status: null, sleep: 0, stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 } };
}

function effectiveness(moveType, defenderTypes) {
    let mult = 1;
    for (const t of defenderTypes) { const row = TYPES[t]; if (row && row[moveType] !== undefined) mult *= row[moveType]; }
    return mult;
}

function speedOf(f) { return f.stats.spe * stage(f.stages.spe) * (f.status === "par" ? 0.5 : 1); }

function say(battle, text) { battle.player.sendMessage(text); }

function syncHealth(f) {
    try {
        const health = f.entity.getComponent(EntityComponentTypes.Health);
        if (health) health.setCurrentValue(Math.max(1, Math.ceil((f.hp / f.stats.hp) * health.effectiveMax)));
    } catch (e) { }
}

function boost(battle, target, boosts) {
    for (const [stat, amount] of Object.entries(boosts ?? {})) {
        const before = target.stages[stat];
        target.stages[stat] = Math.max(-6, Math.min(6, before + amount));
        const name = STAT_NAMES[stat] ?? stat;
        if (target.stages[stat] === before) say(battle, `§7${target.info.name}'s ${name} won't go any ${amount > 0 ? "higher" : "lower"}!`);
        else say(battle, `§7${target.info.name}'s ${name} ${amount > 0 ? "rose" : "fell"}${Math.abs(amount) >= 2 ? " sharply" : ""}!`);
    }
}

function inflict(battle, target, status, announceFailure) {
    if (target.hp <= 0 || target.status || (STATUS_IMMUNE[status] ?? []).some((t) => target.info.types.includes(t))) {
        if (announceFailure) say(battle, "§7But it failed!");
        return;
    }
    target.status = status;
    if (status === "slp") target.sleep = 1 + Math.floor(Math.random() * 3);
    say(battle, `§d${target.info.name} ${STATUS_TEXT[status] ?? "was afflicted"}!`);
}

// whether a Pokemon can act this turn, given its status
function canAct(battle, f) {
    if (f.status === "slp") {
        if (f.sleep > 0) { f.sleep--; say(battle, `§7${f.info.name} is fast asleep.`); return false; }
        f.status = null; say(battle, `§7${f.info.name} woke up!`);
    }
    if (f.status === "frz") {
        if (Math.random() < 0.2) { f.status = null; say(battle, `§7${f.info.name} thawed out!`); }
        else { say(battle, `§7${f.info.name} is frozen solid!`); return false; }
    }
    if (f.status === "par" && Math.random() < 0.25) { say(battle, `§7${f.info.name} is paralyzed! It can't move!`); return false; }
    return true;
}

function useMove(battle, attacker, defender, move) {
    const name = attacker.info.name;
    if (!canAct(battle, attacker)) return;
    if (move.left !== undefined) move.left--;
    const self = move.target === "self" || move.target === "adjacentAllyOrSelf" || move.target === "allies";
    if (!self && move.accuracy !== true) {
        const chance = move.accuracy * accStage(attacker.stages.accuracy - defender.stages.evasion);
        if (Math.random() * 100 >= chance) { say(battle, `§7${name} used ${move.name}... it missed!`); return; }
    }
    if (self) { say(battle, `§e${name} used ${move.name}!`); boost(battle, attacker, move.boosts); return; }
    if (ABILITY_IMMUNE[defender.ability] === move.type && move.category !== "Status") {
        say(battle, `§e${name} used ${move.name}!§r §7It doesn't affect ${defender.info.name}... (${cap(defender.ability)})`);
        return;
    }
    let dealt = 0, note = "";
    if (move.power) {
        const eff = move.type === "???" ? 1 : effectiveness(move.type, defender.info.types);
        if (eff === 0) { say(battle, `§e${name} used ${move.name}!§r §7It doesn't affect ${defender.info.name}...`); return; }
        const physical = move.category === "Physical";
        const crit = Math.random() < 1 / 24;
        // a critical hit ignores the attacker's drops and the defender's raises
        const atkStage = physical ? attacker.stages.atk : attacker.stages.spa, defStage = physical ? defender.stages.def : defender.stages.spd;
        const a = (physical ? attacker.stats.atk : attacker.stats.spa) * stage(crit ? Math.max(0, atkStage) : atkStage);
        const d = (physical ? defender.stats.def : defender.stats.spd) * stage(crit ? Math.min(0, defStage) : defStage);
        let power = move.power;
        if (ABILITY_PINCH[attacker.ability] === move.type && attacker.hp <= attacker.stats.hp / 3) power *= 1.5;
        let dmg = Math.floor(Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * power * a) / d) / 50) + 2;
        if (crit) dmg = Math.floor(dmg * 1.5);
        if (attacker.info.types.includes(move.type)) dmg = Math.floor(dmg * 1.5);
        dmg = Math.floor(dmg * eff);
        if (physical && attacker.status === "brn") dmg = Math.floor(dmg / 2);
        dmg = Math.max(1, Math.floor(dmg * (0.85 + Math.random() * 0.15)));
        dealt = Math.min(dmg, defender.hp);
        defender.hp -= dealt;
        if (crit) note += " A critical hit!";
        if (eff > 1) note += " It's super effective!"; else if (eff < 1) note += " It's not very effective...";
        say(battle, `§e${name} used ${move.name}!§r ${dmg} damage.${note}`);
        syncHealth(defender);
    } else say(battle, `§e${name} used ${move.name}!`);
    if (move.status) inflict(battle, defender, move.status, true);
    if (move.boosts && defender.hp > 0) boost(battle, defender, move.boosts);
    if (move.secondary && Math.random() * 100 < move.secondary.chance) {
        if (move.secondary.status && defender.hp > 0) inflict(battle, defender, move.secondary.status, false);
        if (move.secondary.boosts) boost(battle, move.secondary.self ? attacker : defender, move.secondary.boosts);
    }
    if (move.selfBoosts) boost(battle, attacker, move.selfBoosts);
    if (move === STRUGGLE) { attacker.hp = Math.max(0, attacker.hp - Math.max(1, Math.floor(attacker.stats.hp / 4))); say(battle, `§7${name} is damaged by recoil!`); syncHealth(attacker); }
    if (move.contact && ABILITY_CONTACT[defender.ability] && Math.random() < 0.3) {
        say(battle, `§7${defender.info.name}'s ${cap(defender.ability)}!`);
        inflict(battle, attacker, ABILITY_CONTACT[defender.ability], false);
    }
}

function freeze(entity, on) {
    try {
        entity.triggerEvent(on ? "cobblemon:battle_start" : "cobblemon:battle_end");
        if (on) entity.addEffect("slowness", 20 * 600, { amplifier: 255, showParticles: false });
        else entity.removeEffect("slowness");
    } catch (e) { }
}

function endBattle(battle, text) {
    battles.delete(battle.player.id);
    for (const f of [battle.ally, battle.foe]) if (f?.entity?.isValid) freeze(f.entity, false);
    if (text) say(battle, text);
}

// on entering battle: Intimidate
function enter(battle, f, other) {
    if (f.ability === "intimidate") { say(battle, `§7${f.info.name}'s Intimidate!`); boost(battle, other, { atk: -1 }); }
}

// Ownership: the tameable component is not readable once a Pokemon is tamed, so the owner is
// remembered on the entity when the claiming interaction succeeds.
const OWNER = "cobblemon:owner";

world.afterEvents.playerInteractWithEntity.subscribe((event) => {
    // itemStack is the hand after the interaction, empty once the last ball is used
    const { player, target } = event, itemStack = event.beforeItemStack ?? event.itemStack;
    if (!target || !POKEMON[target.typeId] || !BALLS[itemStack?.typeId]) return;
    system.runTimeout(() => {
        try {
            if (target.isValid && target.hasComponent(EntityComponentTypes.IsTamed) && !target.getDynamicProperty(OWNER)) {
                target.setDynamicProperty(OWNER, player.id);
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
        if (!POKEMON[e.typeId] || prop(e, FAINTED)) continue;
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
    if (!sendOut(battle, party[0], { x: battle.spot.x, y: party[0].location.y, z: battle.spot.z })) { endBattle(battle); return; }
    enter(battle, foe, battle.ally);
    system.runTimeout(() => turn(battle), 20);
}

// Switch: the player picks another party member; the one leaving steps aside and stops fighting
function chooseSwitch(battle, forced) {
    const party = findParty(battle.player, battle.foe.entity.location).filter((e) => e.id !== battle.ally.entity.id);
    if (!party.length) return Promise.resolve(undefined);
    const form = new ActionFormData().title(forced ? "Send out which Pokemon?" : "Switch to which Pokemon?");
    for (const e of party) {
        const f = fighter(e);
        form.button(`${f.info.name} Lv ${f.level}\n§7${f.hp}/${f.stats.hp} HP`);
    }
    if (!forced) form.button("Back");
    return form.show(battle.player).then((r) => (r.canceled || r.selection >= party.length ? undefined : party[r.selection]));
}

function switchTo(battle, entity) {
    const old = battle.ally.entity;
    battle.kept = battle.kept ?? {};
    battle.kept[old.id] = { moves: battle.ally.moves, status: battle.ally.status, sleep: battle.ally.sleep };
    const spot = { x: battle.spot.x, y: old.isValid ? old.location.y : entity.location.y, z: battle.spot.z };
    if (old.isValid) {
        freeze(old, false);
        try { old.teleport({ x: spot.x - 2, y: spot.y, z: spot.z + 2 }); } catch (e) { }
        say(battle, `§7${battle.ally.info.name}, come back!`);
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
        case "safari": case "dream": case "love": case "lure": case "repeat": return 1;
        default: return ball.mult;
    }
}

function ballsHeld(player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, held = new Map();
    if (!inv) return held;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && BALLS[item.typeId]) held.set(item.typeId, (held.get(item.typeId) ?? 0) + item.amount);
    }
    return held;
}

// Which ball to throw: the only kind held, or the player's pick when there are several.
function chooseBall(battle) {
    const held = [...ballsHeld(battle.player)];
    if (held.length === 0) { say(battle, "§cYou have no Poke Balls."); return Promise.resolve(undefined); }
    if (held.length === 1) return Promise.resolve(held[0][0]);
    const form = new ActionFormData().title("Throw which ball?");
    for (const [id, count] of held) form.button(`${BALLS[id].name} x${count}
§7${ballMultiplier(battle, id) === Infinity ? "certain" : ballMultiplier(battle, id) + "x"}`);
    return form.show(battle.player).then((r) => (r.canceled ? undefined : held[r.selection][0]));
}

function throwBall(battle, id) {
    const inv = battle.player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (!item || item.typeId !== id) continue;
        if (item.amount > 1) { item.amount -= 1; inv.setItem(i, item); } else inv.setItem(i, undefined);
        const f = battle.foe, mult = ballMultiplier(battle, id);
        // a sleeping or frozen Pokemon is easier to catch, and a burned, paralyzed or poisoned one a little easier
        const bonus = f.status === "slp" || f.status === "frz" ? 2.5 : f.status ? 1.5 : 1;
        const chance = ((3 * f.stats.hp - 2 * f.hp) * f.info.catchRate * mult * bonus) / (3 * f.stats.hp) / 255;
        say(battle, `§7You threw a ${BALLS[id].name}!`);
        if (Math.random() < chance) {
            say(battle, `§aGotcha! ${f.info.name} was caught!`);
            try { f.entity.triggerEvent("cobblemon:capture"); } catch (e) { }
            endBattle(battle);
            return true;
        }
        say(battle, `§7Oh no! ${f.info.name} broke free!`);
        return false;
    }
    return false;
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
    options.push({ kind: "ball" }, { kind: "run" });
    const form = new ActionFormData().title(`${ally.info.name} vs ${foe.info.name}`)
        .body(`§l${foe.info.name}§r Lv ${foe.level}${statusTag(foe)}  ${bar(foe.hp, foe.stats.hp)} ${foe.hp}/${foe.stats.hp}\n§l${ally.info.name}§r Lv ${ally.level}${statusTag(ally)}  ${bar(ally.hp, ally.stats.hp)} ${ally.hp}/${ally.stats.hp}\n\nWhat will ${ally.info.name} do?`);
    for (const o of options) {
        if (o.kind === "move") form.button(o.move === STRUGGLE ? "Struggle\n§7no PP left" : `${o.move.name}  ${o.move.left}/${o.move.pp}\n§7${cap(o.move.type)} ${o.move.power || "-"}${o.move.left ? "" : "  (no PP)"}`);
        else if (o.kind === "switch") form.button("Switch Pokemon");
        else if (o.kind === "ball") form.button(battle.trainer ? "§8(no catching in trainer battles)" : "Throw Poke Ball");
        else form.button("Run");
    }
    form.show(battle.player).then((r) => {
        if (!battles.has(battle.player.id)) return;
        if (r.canceled) { battle.turn--; system.runTimeout(() => turn(battle), 20); return; }
        const choice = options[r.selection];
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
        if (choice.kind === "ball") {
            if (battle.trainer) { battle.turn--; turn(battle); return; }
            chooseBall(battle).then((id) => {
                if (!battles.has(battle.player.id)) return;
                if (!id) { battle.turn--; turn(battle); return; }
                if (throwBall(battle, id)) return;
                foeTurn(battle);
            }).catch(() => endBattle(battle));
            return;
        }
        const move = choice.move;
        if (move !== STRUGGLE && move.left <= 0) { say(battle, "§cThere's no PP left for this move!"); battle.turn--; turn(battle); return; }
        const foeMove = pickFoeMove(foe);
        const allyFirst = (move.priority || 0) > (foeMove.priority || 0) || ((move.priority || 0) === (foeMove.priority || 0) && speedOf(ally) >= speedOf(foe));
        const order = allyFirst ? [[ally, foe, move], [foe, ally, foeMove]] : [[foe, ally, foeMove], [ally, foe, move]];
        for (const [a, d, m] of order) {
            if (a.hp <= 0 || d.hp <= 0) continue;
            useMove(battle, a, d, m);
        }
        endOfTurn(battle);
    }).catch(() => endBattle(battle));
}

function pickFoeMove(foe) {
    const usable = foe.moves.filter((m) => m.left > 0);
    return usable.length ? usable[Math.floor(Math.random() * usable.length)] : STRUGGLE;
}

function foeTurn(battle) {
    const { ally, foe } = battle;
    if (foe.hp > 0 && ally.hp > 0) useMove(battle, foe, ally, pickFoeMove(foe));
    endOfTurn(battle);
}

// burn and poison damage, then whoever fainted
function endOfTurn(battle) {
    for (const f of [battle.ally, battle.foe]) {
        if (f.hp <= 0 || !["brn", "psn", "tox"].includes(f.status)) continue;
        const loss = Math.max(1, Math.floor(f.stats.hp / (f.status === "brn" ? 16 : 8)));
        f.hp = Math.max(0, f.hp - loss);
        say(battle, `§7${f.info.name} is hurt by its ${f.status === "brn" ? "burn" : "poison"}!`);
        syncHealth(f);
    }
    if (battle.foe.hp <= 0) { faint(battle, battle.foe); return; }
    if (battle.ally.hp <= 0) { faint(battle, battle.ally); return; }
    system.runTimeout(() => turn(battle), 30);
}

// experience for beating a Pokemon, and the levels and moves it brings
function gainExperience(battle, f, foe) {
    const gain = Math.max(1, Math.floor(((foe.info.baseExp || 50) * foe.level * (battle.trainer ? 1.5 : 1)) / 7));
    const group = f.info.expGroup;
    let exp = Math.max(prop(f.entity, EXP) ?? 0, expFor(group, f.level)) + gain, level = f.level;
    say(battle, `§b${f.info.name} gained ${gain} Exp. Points!`);
    const ids = f.moves.map((m) => m.id);
    while (level < 100 && exp >= expFor(group, level + 1)) {
        level++;
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
        try { battle.foe.entity.triggerEvent("cobblemon:vanish"); } catch (e) { }
        if (battle.trainer) say(battle, "§6You defeated the Trainer!");
        gainExperience(battle, battle.ally, battle.foe);
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
    } else if (event.id === "cobblemon:fossil_time") {
        // testing: /execute as <player> run scriptevent cobblemon:fossil_time <seconds> sets what running machines have left
        loadMachines();
        const seconds = Math.max(1, parseInt(event.message) || 1);
        for (const st of machines.values()) if (st.left > 0) st.left = seconds;
        saveMachines();
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
    let owner;
    try { owner = e.getDynamicProperty(OWNER); } catch (err) { }
    if (owner) evolving.push({ owner, location: { ...e.location }, tick: system.currentTick });
});
world.afterEvents.entitySpawn.subscribe(({ entity, cause }) => {
    if (cause !== EntityInitializationCause.Transformed || !POKEMON[entity.typeId]) return;
    const i = evolving.findIndex((p) => system.currentTick - p.tick < 40 && Math.hypot(p.location.x - entity.location.x, p.location.z - entity.location.z) < 3);
    if (i < 0) return;
    const { owner } = evolving.splice(i, 1)[0];
    const player = world.getPlayers().find((p) => p.id === owner);
    system.run(() => {
        try {
            if (!entity.isValid) return;
            if (player) entity.getComponent(EntityComponentTypes.Tameable)?.tame(player);
            entity.setDynamicProperty(OWNER, owner);
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

// the tank's upper half comes with it, and goes with it
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.typeId !== "cobblemon:restoration_tank") return;
    const above = block.above();
    if (above?.isAir) {
        above.setPermutation(block.permutation.withState("cobblemon:part", "top"));
    }
});
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    if (brokenBlockPermutation.type.id !== "cobblemon:restoration_tank") return;
    const other = brokenBlockPermutation.getState("cobblemon:part") === "bottom" ? block.above() : block.below();
    if (other?.typeId === "cobblemon:restoration_tank") other.setType("minecraft:air");
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

// Blocks. A berry bush moves a stage on each random tick until it is ripe, and a ripe one used by a player
// drops Cobblemon's base yield of its berry and goes back to flowering. The healing machine restores the
// Pokemon around it that belong to the player using it.
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
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

world.afterEvents.worldLoad?.subscribe?.(() => console.log("[cobblemon] battle script ready"));
