// The Poke Balls' catch multipliers (PokeBalls.kt and CatchRateModifiers), in battle (ballMultiplier) and thrown in the
// world (worldBallMultiplier), the capture roll (CobblemonCaptureCalculator), the Heal Ball's FULL_RESTORE on a catch,
// the critical capture's extra step on the ground (EmptyPokeBallEntity.beginCapture) and the ancient balls' throw power
import { readFileSync } from "node:fs";
import { M, D, mon, battle, check } from "../harness.mjs";
import { world, system } from "../stub_server.mjs";

const near = (x, y) => Math.abs(x - y) < 1e-9;
const inBattle = (ball, a, f, extra = {}) => M.ballMultiplier(battle(a, f, extra), `cobblemon:${ball}`);
const thrown = (ball, f) => M.worldBallMultiplier({ id: "player", isValid: true, getDynamicProperty: () => undefined }, f, `cobblemon:${ball}`);
function withTime(time, phase, fn) {
    const [t, p] = [world.getTimeOfDay, world.getMoonPhase];
    world.getTimeOfDay = () => time; world.getMoonPhase = () => phase;
    try { return fn(); } finally { world.getTimeOfDay = t; world.getMoonPhase = p; }
}

{
    // statusBoosting(4, SLEEP): 4x on a sleeping target, in battle and out, a napping wild Pokemon's Sleep with it
    const a = mon("Charmander", { level: 10 }), f = mon("Pidgey", { level: 5, status: "slp" }), awake = mon("Pidgey", { level: 5 });
    check("Dream Ball: 4x on a sleeping foe in battle", inBattle("dream_ball", a, f) === 4);
    check("Dream Ball: 1x on an awake one", inBattle("dream_ball", a, awake) === 1);
    check("Dream Ball: 4x on a sleeping Pokemon in the world", thrown("dream_ball", f) === 4);
    const napper = mon("Pidgey", { level: 5 }).entity;
    napper.setDynamicProperty("cobblemon:status", JSON.stringify({ s: "slp", left: 200 }));   // GoToSleepTask's Sleep
    check("Dream Ball: 4x on a napping wild Pokemon", thrown("dream_ball", M.fighter(napper)) === 4);
}
{
    // WEIGHT_BASED, in hectograms: 1x under 1000, 1.5x from 1000, 2.5x from 2000, 4x from 3000
    const a = mon("Charmander"), f = mon("Snorlax");
    const at = (hg) => { f.info.weight = hg; return inBattle("heavy_ball", a, f); };
    check("Heavy Ball: 1 / 1.5 / 2.5 / 4 at 999, 1000, 2000 and 3000 hg",
        at(999) === 1 && at(1000) === 1.5 && at(1999) === 1.5 && at(2000) === 2.5 && at(2999) === 2.5 && at(3000) === 4,
        [999, 1000, 1999, 2000, 2999, 3000].map(at).join(" "));
    f.info.weight = 4600;
    check("Heavy Ball: thrown in the world too", thrown("heavy_ball", f) === 4);
}
{
    // MOON_PHASES: 1x while dayTime % 24000 < 12000; at night full 4, gibbous 2.5, quarters 1.5, the rest 1
    const a = mon("Charmander"), f = mon("Clefairy");
    const table = [0, 1, 2, 3, 4, 5, 6, 7].map((phase) => withTime(18000, phase, () => inBattle("moon_ball", a, f)));
    check("Moon Ball: the phases at night are 4, 2.5, 1.5, 1, 1, 1, 1.5, 2.5", table.join(",") === "4,2.5,1.5,1,1,1,1.5,2.5", table.join(","));
    check("Moon Ball: night begins at 12000", withTime(12000, 0, () => inBattle("moon_ball", a, f)) === 4 && withTime(11999, 0, () => inBattle("moon_ball", a, f)) === 1);
    check("Moon Ball: a full moon in the world is 4x", withTime(13000, 0, () => thrown("moon_ball", f)) === 4);
}
{
    // LOVE: 8x with an active Pokemon of the opposite gender and the same species, 2.5x any opposite gender, else 1x;
    // a BattleModifier, so 1x thrown in the world
    const foe = mon("Nidoran♀", { gender: "female" });
    check("Love Ball: 8x same species, opposite gender", inBattle("love_ball", mon("Nidoran♀", { gender: "male" }), foe) === 8);
    check("Love Ball: 2.5x another species of the opposite gender", inBattle("love_ball", mon("Pikachu", { gender: "male" }), foe) === 2.5);
    check("Love Ball: 1x the same gender", inBattle("love_ball", mon("Nidoran♀", { gender: "female" }), foe) === 1);
    check("Love Ball: 1x on a genderless foe", inBattle("love_ball", mon("Pikachu", { gender: "male" }), mon("Magnemite", { gender: "genderless" })) === 1);
    check("Love Ball: 1x out of battle", thrown("love_ball", foe) === 1);
}
{
    // LURE: 4x on a Pokemon with the fished aspect, a WorldStateModifier, so in the world too
    const a = mon("Charmander"), fished = mon("Magikarp"), wild = mon("Magikarp");
    fished.entity.setDynamicProperty("cobblemon:fished", true);
    check("Lure Ball: 4x on a fished Pokemon in battle", inBattle("lure_ball", a, fished) === 4);
    check("Lure Ball: 4x on a fished Pokemon in the world", thrown("lure_ball", fished) === 4);
    check("Lure Ball: 1x on one that was not fished", inBattle("lure_ball", a, wild) === 1);
}
{
    // LEVEL: the thrower's level strictly above the target's 4 times, 2 times, once: 4, 3, 2, else 1; 1x out of battle
    const f = mon("Pidgey", { level: 5 }), at = (level) => inBattle("level_ball", mon("Charmander", { level }), f);
    check("Level Ball: 21 / 20 / 11 / 10 / 6 / 5 against 5 is 4, 3, 3, 2, 2, 1", [21, 20, 11, 10, 6, 5].map(at).join(",") === "4,3,3,2,2,1", [21, 20, 11, 10, 6, 5].map(at).join(","));
    check("Level Ball: 1x out of battle", thrown("level_ball", f) === 1);
}
{
    // Timer: turnBased 1 + turn * 1229 / 4096, at most 4
    const a = mon("Charmander"), f = mon("Pidgey");
    check("Timer Ball: turn 1 is 1 + 1229/4096", near(inBattle("timer_ball", a, f, { turn: 1 }), 1 + 1229 / 4096));
    check("Timer Ball: turn 5 is 1 + 5 x 1229/4096", near(inBattle("timer_ball", a, f, { turn: 5 }), 1 + (5 * 1229) / 4096));
    check("Timer Ball: 4 from turn 10", inBattle("timer_ball", a, f, { turn: 10 }) === 4 && inBattle("timer_ball", a, f, { turn: 30 }) === 4);
}
{
    // NEST: (41 - level) / 10 below level 30, 1x from it
    const a = mon("Charmander");
    check("Nest Ball: level 1 is 4x, 29 is 1.2x", inBattle("nest_ball", a, mon("Pidgey", { level: 1 })) === 4 && near(inBattle("nest_ball", a, mon("Pidgey", { level: 29 })), 1.2));
    check("Nest Ball: 1x from level 30", inBattle("nest_ball", a, mon("Pidgey", { level: 30 })) === 1 && inBattle("nest_ball", a, mon("Pidgey", { level: 35 })) === 1);
}
{
    // PARK: #cobblemon:is_temperate (the forests, the cherry grove, the plains and the meadow), not any name with forest or plains
    const a = mon("Charmander"), f = mon("Pidgey");
    const at = (id) => { f.entity.dimension = { getBiome: () => ({ id }) }; return inBattle("park_ball", a, f); };
    check("Park Ball: 2.5x in a meadow, a cherry grove, a birch forest", at("minecraft:meadow") === 2.5 && at("minecraft:cherry_grove") === 2.5 && at("minecraft:birch_forest") === 2.5);
    check("Park Ball: 1x on ice plains and in a jungle", at("minecraft:ice_plains") === 1 && at("minecraft:jungle") === 1);
}
{
    // SUBMERGED_IN_WATER: isUnderWater, the block at the eyes
    const a = mon("Charmander"), f = mon("Magikarp");
    const water = { typeId: "minecraft:water" }, air = { typeId: "minecraft:air" };
    f.entity.dimension = { getBlock: () => water };
    check("Dive Ball: 3.5x with its head under water", inBattle("dive_ball", a, f) === 3.5);
    f.entity.dimension = { getBlock: (at) => (at.y >= 1 ? air : water) };
    check("Dive Ball: 1x with only its feet in water", inBattle("dive_ball", a, f) === 1);
}
{
    // LIGHT_LEVEL on getMaxLocalRawBrightness: the block light or the sky light less the sky's darkening, 0 is 3.5x, 1 to 7 3x
    const a = mon("Charmander"), f = mon("Zubat");
    const at = (time, total, sky) => { f.entity.dimension = { getLightLevel: () => total, getSkyLightLevel: () => sky, getWeather: () => "Clear" }; return withTime(time, 0, () => inBattle("dusk_ball", a, f)); };
    check("skyDarken: none at noon, 11 at midnight", M.skyDarken(6000) === 0 && M.skyDarken(18000) === 11, `${M.skyDarken(6000)} ${M.skyDarken(18000)}`);
    check("Dusk Ball: 1x in the open at noon", at(6000, 15, 15) === 1);
    check("Dusk Ball: 3x in the open at midnight (15 sky less 11)", at(18000, 15, 15) === 3);
    check("Dusk Ball: 3.5x in a dark cave", at(6000, 0, 0) === 3.5);
    check("Dusk Ball: 1x by a torch under a roof", at(18000, 14, 0) === 1 && at(6000, 5, 0) === 3);
}
{
    // the Beast Ball is 0.1x on anything but an Ultra Beast; no other ball is cut on an Ultra Beast (the main series' rule)
    const a = mon("Charmander"), ubId = Object.keys(D.POKEMON).find((id) => D.POKEMON[id].ultraBeast);
    check("Beast Ball: 5x on an Ultra Beast, 0.1x on another", inBattle("beast_ball", a, mon(ubId)) === 5 && inBattle("beast_ball", a, mon("Pidgey")) === 0.1);
    const ub = mon(ubId, { level: 50 }), b = battle(a, ub);
    const rate = (ub.info.catchRate * 1) / 3, chance = Math.round(65536 / Math.pow(255 / rate, 0.1875));
    const random = Math.random, player = { id: "p", isValid: true, getDynamicProperty: () => undefined, sendMessage() { } };
    Math.random = () => (chance - 0.5) / 65537;   // every check just inside the unpenalised chance
    let r;
    try { r = M.captureRoll(player, ub.entity, "cobblemon:poke_ball", b); } finally { Math.random = random; }
    check("a Poke Ball on an Ultra Beast is not cut to a tenth", r.caught && r.shakes === 3, JSON.stringify(r));
}
{
    // CaptureEffects.FULL_RESTORE (Pokemon.heal): a Heal Ball catch keeps neither the status nor the PP it fought with,
    // and the battle's end writes neither back; another ball keeps both
    const props = new Map();
    const player = { id: "catcher", name: "Tester", isValid: true, location: { x: 0, y: 0, z: 0 }, sendMessage() { }, playSound() { },
        getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)) };
    const run = (ballId) => {
        const a = mon("Charmander"), f = mon("Pidgey", { level: 5, status: "par" });
        f.moves[0].left = 1; f.entity.nameTag = "";
        const b = battle(a, f, { player });
        M.keepCaught(player, f.entity, ballId, f);
        try { M.endBattle(b); } catch (e) { }
        return { status: f.entity.getDynamicProperty("cobblemon:status"), pp: f.entity.getDynamicProperty("cobblemon:pp") };
    };
    const heal = run("cobblemon:heal_ball"), plain = run("cobblemon:poke_ball");
    check("Heal Ball: the status and PP are cleared on the catch", heal.status === undefined && heal.pp === undefined, JSON.stringify(heal));
    check("Poke Ball: the status and PP it fought with are kept", JSON.parse(plain.status ?? "{}").s === "par" && /:1[,}]/.test(plain.pp ?? ""), JSON.stringify(plain));
}
{
    // beginCapture: a critical capture runs numberOfShakes + 2 steps, the critical animation first, so its one shake comes
    // 2.25 s after landing and the result 3.5 s
    const dex = "2".repeat(40), props = new Map([["cobblemon:dex", dex]]);
    const player = { id: "thrower", isValid: true, getDynamicProperty: (k) => props.get(k), setDynamicProperty() { }, sendMessage() { } };
    const target = Object.keys(D.POKEMON).find((id) => D.POKEMON[id].catchRate >= 200 && M.dexStatus(player, id) === 0);
    const f = mon(target, { level: 5 }), ball = { isValid: true, dimension: {}, setProperty() { } };
    const delays = [], [timeout, random] = [system.runTimeout, Math.random];
    system.runTimeout = (fn, delay) => { delays.push(delay); return 0; };
    Math.random = () => 0;
    try { M.land(ball, { x: 0, y: 0, z: 0 }, player, f.entity, "cobblemon:poke_ball", () => { }); } finally { system.runTimeout = timeout; Math.random = random; }
    check("a critical capture's steps fall at 1, 2.25 and 3.5 s", delays.join(",") === "20,45,70", delays.join(","));
}
{
    // PokeBalls.kt throwPower: 1.25, the Feather, Wing and Jet Balls 2.5 and the Heavy, Leaden and Gigaton Balls 0.75
    const power = (name) => JSON.parse(readFileSync(new URL(`../../../development_behavior_packs/cobblemon/entities/ball_${name}.behavior.json`, import.meta.url), "utf-8"))["minecraft:entity"].components["minecraft:projectile"].power;
    const base = power("ancient_poke_ball");
    check("Feather, Wing and Jet Balls fly twice as far", ["feather", "wing", "jet"].every((n) => near(power(`ancient_${n}_ball`) / base, 2.5 / 1.25)));
    check("Heavy, Leaden and Gigaton Balls 0.6 of the throw", ["heavy", "leaden", "gigaton"].every((n) => near(power(`ancient_${n}_ball`) / base, 0.75 / 1.25)));
}
