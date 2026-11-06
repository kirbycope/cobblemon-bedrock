// Pokemon out in the world (scripts/world.js and main.js's hooks into it): a baby's size, Smeargle's tail paint, the
// send-out over water, the trainer's bed, lightning, the Mooshtank's stew, alphas off the shoulder and retaliating, and
// the wariness after a capture fails
import { M, D, check, flush } from "../harness.mjs";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// world.js and its tables, as the harness loads main.js: a copy beside a package.json that makes them ES modules
const here = dirname(fileURLToPath(import.meta.url));
const copy = mkdtempSync(join(tmpdir(), "cobblemon-world-"));
cpSync(join(here, "..", "..", "..", "development_behavior_packs", "cobblemon", "scripts"), copy, { recursive: true });
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const W = await import(pathToFileURL(join(copy, "world.js")).href);
const { BED_SLEEPERS, SENDOUT_WATER } = await import(pathToFileURL(join(copy, "world_rules.js")).href);
const { PREDATORS } = await import(pathToFileURL(join(copy, "defenders.js")).href);

// a stand-in entity that remembers its dynamic properties and the events triggered on it
function stub(typeId, props = {}) {
    const store = new Map(Object.entries(props)), events = [], effects = [];
    return { typeId, id: `t-${typeId}-${Math.random()}`, isValid: true, location: { x: 0.5, y: 64, z: 0.5 }, events, effects,
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)),
        triggerEvent: (n) => events.push(n), addEffect: (e, t, o) => effects.push([e, t, o]), getProperty: () => undefined, setProperty() { },
        getComponent: () => ({ value: 0, getRiders: () => [] }), hasComponent: () => false, getRotation: () => ({ x: 0, y: 0 }),
        dimension: { spawnParticle() { }, playSound() { }, getEntities: () => [], getBlock: () => undefined } };
}

// Pokemon.effectiveScale: 0.9 at level 1, full at level 9
check("a level 1 Pokemon is drawn at 0.9, a level 9 one at full size", W.babyScale(1) === 0.9 && W.babyScale(9) === 1 && W.babyScale(100) === 1);
check("the baby size grows evenly in between", Math.abs(W.babyScale(5) - 0.95) < 1e-9 && W.babyScale(3) > 0.9 && W.babyScale(3) < W.babyScale(4));

// Characteristic.calculate and CHARACTERISTIC_RAINBOW_ASPECT's pairs
{
    const ivs = { hp: 3, atk: 31, def: 5, spa: 7, spd: 9, spe: 11 };
    check("an Attack nature with the highest IV in Attack paints the tail red", W.rainbowColour(ivs, "atk", 0) === "red");
    check("a neutral nature with the highest IV in HP paints it light blue", W.rainbowColour({ hp: 31, atk: 2, def: 2, spa: 2, spd: 2, spe: 2 }, null, 0) === "light-blue");
    check("Special Attack raised with Speed highest is purple, Speed raised with Special Attack highest the same", W.rainbowColour({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 31 }, "spa", 0) === "purple" && W.rainbowColour({ hp: 0, atk: 0, def: 0, spa: 31, spd: 0, spe: 0 }, "spe", 0) === "purple");
    const tied = { hp: 31, atk: 31, def: 0, spa: 0, spd: 0, spe: 0 };
    check("equal IVs are told apart by where the uuid's hash starts the count", W.rainbowColour(tied, null, 0) === "light-blue" && W.rainbowColour(tied, null, 1) === "red");
}

// PokemonEntity.getAdjustedSendoutPosition over a pool whose surface is at y 63 (water from 60 to 62)
{
    const dim = { getBlock: ({ y }) => (y < 60 ? { typeId: "minecraft:stone", isAir: false } : y <= 62 ? { typeId: "minecraft:water", isAir: false } : { typeId: "minecraft:air", isAir: true }) };
    const snorlax = W.adjustSendOut(dim, { x: 0.5, y: 61, z: 0.5 }, "cobblemon:p0143_snorlax");
    check("a walker sent into water comes up to the surface on a raft", snorlax.at.y === 63 && snorlax.raft === true);
    const fallen = W.adjustSendOut(dim, { x: 0.5, y: 70, z: 0.5 }, "cobblemon:p0143_snorlax");
    check("one sent into the air above water lands at the surface", fallen.at.y === 63 && fallen.raft === true);
    const charizard = W.adjustSendOut(dim, { x: 0.5, y: 61, z: 0.5 }, "cobblemon:p0006_charizard");
    check("a flier is set a block above the surface, no raft", SENDOUT_WATER["cobblemon:p0006_charizard"] === "f" && charizard.at.y === 64 && !charizard.raft);
    const magikarp = W.adjustSendOut(dim, { x: 0.5, y: 61, z: 0.5 }, "cobblemon:p0129_magikarp");
    check("a swimmer is set under the surface, no raft", SENDOUT_WATER["cobblemon:p0129_magikarp"] === "s" && magikarp.at.y < 63 && !magikarp.raft);
    const bidoof = W.adjustSendOut(dim, { x: 0.5, y: 61, z: 0.5 }, "cobblemon:p0399_bidoof");
    check("a water walker stands on the surface with no raft", SENDOUT_WATER["cobblemon:p0399_bidoof"] === "w" && bidoof.at.y === 63 && !bidoof.raft);
    const land = W.adjustSendOut({ getBlock: () => ({ typeId: "minecraft:grass_block", isAir: false }) }, { x: 0.5, y: 64, z: 0.5 }, "cobblemon:p0143_snorlax");
    check("on land the spot is left alone", land.at.y === 64 && !land.raft);
}

// pokemon_sleeps_on_trainer_bed.json: the species with willSleepOnBed, and the bed's foot piece under a sleeper
check("Charmander sleeps on its trainer's bed, Magikarp does not", BED_SLEEPERS.includes("cobblemon:p0004_charmander") && !BED_SLEEPERS.includes("cobblemon:p0129_magikarp"));
{
    const beds = { "0,64,0": true, "0,64,1": false };   // head piece at z 0, foot at z 1
    const dim = { getBlock: ({ x, y, z }) => { const k = `${x},${y},${z}`; return k in beds ? { typeId: "minecraft:bed", x, y, z, permutation: { getState: () => beds[k] } } : { typeId: "minecraft:air" }; } };
    const bed = W.bedOf(dim, { x: 0.5, y: 64.2, z: 0.5 });
    check("the bed under a sleeping trainer is found, its foot piece first", bed?.z === 1);
}

// PokemonEntity.thunderHit: the abilities that absorb a strike, and what each gains
check("Lightning Rod gains Strength II for a minute, Motor Drive Speed II, Volt Absorb a heal", JSON.stringify(W.lightningEffect("lightningrod")) === '["strength",1200,1]' && W.lightningEffect("motordrive")[0] === "speed" && W.lightningEffect("voltabsorb")[0] === "instant_health" && W.lightningEffect("static") === null);

// the Mooshtank's flowers (SuspiciousEffectHolder): Java 1.21's effects, and Cobblemon's Pep-Up Flower
check("an Allium stew gives Fire Resistance for 4 seconds, a Pep-Up Flower stew Levitation for 10", JSON.stringify(W.FLOWER_STEW["minecraft:allium"]) === '["fire_resistance",80]' && JSON.stringify(W.FLOWER_STEW["cobblemon:pep_up_flower"]) === '["levitation",200]');

// PokemonEntity.canSitOnShoulder: never an alpha
{
    const player = { id: "p1", getComponent: () => ({ getRiders: () => [] }) };
    const pikachu = stub("cobblemon:p0025_pikachu", { "cobblemon:owner": "p1" });
    const alpha = stub("cobblemon:p0025_pikachu", { "cobblemon:owner": "p1", "cobblemon:alpha": true });
    check("a Pikachu sits on the shoulder, an alpha Pikachu does not", M.canShoulder(pikachu, player) === true && M.canShoulder(alpha, player) === false);
}

// pokemon_non_party.json: a wild alpha retaliates (makeAlpha's event), an owned one is left to its trainer
{
    const wild = stub("cobblemon:p0143_snorlax"), owned = stub("cobblemon:p0143_snorlax", { "cobblemon:owner": "p1" });
    M.makeAlpha(wild, true); M.makeAlpha(owned, true);
    check("a wild Pokemon made an alpha turns on its retaliation", wild.events.includes("cobblemon:alpha_retaliate") && !owned.events.includes("cobblemon:alpha_retaliate"), JSON.stringify(wild.events));
}

// PokemonBrain.onCaptureFailed: a Pokemon that breaks out of a ball out of battle grows wary of players
{
    const pokemon = stub("cobblemon:p0143_snorlax"), ball = stub("cobblemon:capture_ball");
    pokemon.teleport = () => { };
    M.brokeFree(ball, { x: 0, y: 64, z: 0 }, pokemon, "cobblemon:poke_ball", false); flush();
    check("breaking free out of battle makes it wary, and ends the battle freeze", pokemon.events.includes("cobblemon:wary") && pokemon.events.includes("cobblemon:battle_end"), JSON.stringify(pokemon.events));
}

// TargetEntityTaskConfig: Pidgeotto hunts a Magikarp with air above it (passes once port.py has run)
check("Pidgeotto hunts beached Magikarp without a roll", JSON.stringify(PREDATORS["cobblemon:p0017_pidgeotto"]) === '[["cobblemon:p0129_magikarp"],24,1,"air_above"]', JSON.stringify(PREDATORS["cobblemon:p0017_pidgeotto"]));
{
    const beached = stub("cobblemon:p0129_magikarp"), swimming = stub("cobblemon:p0129_magikarp");
    beached.dimension = { getBlock: () => ({ isAir: true }) }; swimming.dimension = { getBlock: () => ({ isAir: false }) };
    check("a Magikarp with air over it is beached, one under water is not", W.airAbove(beached) === true && W.airAbove(swimming) === false);
}
