// SpawnDetail.weightMultipliers on the natural spawns: a condition whose multipliers follow the time, the weather or
// the moon spawns as often as they can make it, fires cobblemon:spawn_mult_<n>, and the script keeps it in the share
// the multipliers that hold now give
import { M, F, check } from "../harness.mjs";
import { readFileSync } from "node:fs";

const pack = (path) => new URL(`../../../development_behavior_packs/cobblemon/${path}`, import.meta.url);
const TABLE = JSON.parse(readFileSync(pack("scripts/spawn_multipliers.js"), "utf-8").match(/SPAWN_MULTIPLIERS = (.*);/)[1]);
check("species with timed multipliers are listed", Object.keys(TABLE).length > 100, `${Object.keys(TABLE).length}`);
const [id, entries] = Object.entries(TABLE).find(([, list]) => list.some((e) => e.wm.some(([, c]) => c.timeRange)));
const n = entries.findIndex((e) => e.wm.some(([, c]) => c.timeRange)), entry = entries[n];
check("a time multiplier's top is its multipliers over 1 together", entry.top === entry.wm.reduce((t, [m]) => (m > 1 ? t * m : t), 1), `${id} ${JSON.stringify(entry)}`);
const folder = id.split(":p")[1];
const rule = JSON.parse(readFileSync(pack(`spawn_rules/${folder}.json`), "utf-8"))["minecraft:spawn_rules"].conditions;
check("its spawn rule fires the event", rule.some((c) => c["minecraft:herd"]?.event === `cobblemon:spawn_mult_${n}`));
const entity = JSON.parse(readFileSync(pack(`entities/${folder}.behavior.json`), "utf-8"))["minecraft:entity"];
check("and the entity has the event", `cobblemon:spawn_mult_${n}` in entity.events);
check("no multiplier for a Poke Snack or a lure is timed", Object.values(TABLE).flat().every((e) => e.wm.every(([, c]) => !("isPokeSnack" in c) && !("minLureLevel" in c))));

// the weather where it stands decides the share
const raining = { id: "test:rain", getWeather: () => "Rain" }, clear = { id: "test:clear", getWeather: () => "Clear" }, thunder = { id: "test:thunder", getWeather: () => "Thunder" };
const wet = { top: 2, wm: [[2, { isRaining: true }]] };
check("in the rain a rain multiplier keeps every spawn", M.multipliedSpawn(wet, raining) === 1);
check("out of it, half", M.multipliedSpawn(wet, clear) === 0.5);
const dry = { top: 1, wm: [[0.25, { isThundering: true }]] };
check("a multiplier under 1 thins its spawns when it holds", M.multipliedSpawn(dry, thunder) === 0.25 && M.multipliedSpawn(dry, clear) === 1);
check("thunder counts as rain", M.timedHolds({ isRaining: true }, thunder) && !M.timedHolds({ isRaining: false }, thunder));

// the multipliers on biomes and on a condition that fires its own event (a herd's seed, a weather check)
const all = Object.values(TABLE).flat();
check("light and nearby-block multipliers are tested too", all.some((e) => e.wm.some(([, c]) => c.minLight !== undefined)) && all.some((e) => e.wm.some(([, c]) => c.near)));
check("a herd's seed keeps its own event to pass on", all.some((e) => e.was?.startsWith("cobblemon:herd_seed")));
const plains = { id: "test:plains", getWeather: () => "Clear", getBiome: () => ({ id: "minecraft:plains" }) };
const tags = F.BIOME_TAGS["minecraft:plains"] ?? [];
const inPlains = { top: 3, wm: [[3, { biome: { test: "has_biome_tag", operator: "==", value: tags[0] } }]] };
check("in the biome a biome multiplier keeps every spawn", tags.length && M.multipliedSpawn(inPlains, plains, { x: 0, y: 64, z: 0 }) === 1);
check("without a place it does not hold", M.multipliedSpawn(inPlains, plains) === 1 / 3);
