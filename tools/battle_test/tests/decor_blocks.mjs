// Decor and redstone blocks (scripts/decor_blocks.js): a Terrain Seed's growth into its plant, the plants' glow by
// weather, moon and company, the Ring Target's power by where it is struck, Wistensu's and Pauvillea's placement and
// growth, the honeyed log's washing, the campfire pot's lid under redstone and the Revival Herb's mutation; and what
// port.py gives the blocks (create_terrain_seeds, add_decor_components, add_waterlogging, add_light_levels)
import { check, mod } from "../harness.mjs";
const DB = await mod("decor_blocks.js");
import { readFileSync, existsSync } from "node:fs";

// a permutation as the stub's BlockPermutation.resolve makes one, its withState chaining
const permutationOf = (id, states) => ({ type: { id }, states, getState: (k) => states[k], withState: (k, v) => permutationOf(id, { ...states, [k]: v }) });
// a small world of blocks by position, each with its states, reading and writing the same map
function grid(blocks) {
    const at = new Map(Object.entries(blocks).map(([k, [typeId, states = {}]]) => [k, { typeId, states }]));
    const dimension = { id: "minecraft:overworld", getBlock: ({ x, y, z }) => blockAt(x, y, z), getLightLevel: () => 15, getSkyLightLevel: () => 15,
                        getEntities: () => [], playSound() { }, spawnParticle() { }, runCommand() { }, spawnItem() { } };
    function blockAt(x, y, z) {
        const key = `${x},${y},${z}`, entry = at.get(key) ?? { typeId: "minecraft:air", states: {} };
        return {
            x, y, z, location: { x, y, z }, dimension, typeId: entry.typeId, isAir: entry.typeId === "minecraft:air", isLiquid: /water|lava/.test(entry.typeId), isValid: true,
            permutation: permutationOf(entry.typeId, entry.states),
            setPermutation(p) { at.set(key, { typeId: p.type.id, states: { ...p.states } }); },
            setType(id) { at.set(key, { typeId: id, states: {} }); },
            above() { return blockAt(x, y + 1, z); }, below() { return blockAt(x, y - 1, z); },
            center: () => ({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }), getRedstonePower: () => entry.states.power ?? 0,
        };
    }
    return { block: blockAt, at, state: (x, y, z, k) => at.get(`${x},${y},${z}`)?.states[k], type: (x, y, z) => at.get(`${x},${y},${z}`)?.typeId ?? "minecraft:air" };
}
const registered = [];
let unslathered = 0;
DB.registerDecorComponents({ registerCustomComponent: (name, c) => registered.push([name, c]) }, { weatherIn: (dim) => dim.weather ?? "Clear", unslather: () => unslathered++ });
check("the decor components are registered", ["cobblemon:terrain_seed", "cobblemon:terrain_plant", "cobblemon:activatable", "cobblemon:eject_button", "cobblemon:damaged_monitor",
      "cobblemon:wistensu", "cobblemon:pauvillea", "cobblemon:slathered_log", "cobblemon:campfire_pot", "cobblemon:herb_mutation"].every((n) => registered.some(([r]) => r === n)), registered.map(([r]) => r).join());

// TerrainSeedBlock.grow: a seed on farmland ages, stands two tall from age 2 and becomes its plant at age 4
{
    const w = grid({ "0,0,0": ["minecraft:farmland"], "0,1,0": ["cobblemon:electric_seed", { "cobblemon:age": 0, "cobblemon:half": "lower" }] });
    check("a seed grows an age", DB.growTerrainSeed(w.block(0, 1, 0)) && w.state(0, 1, 0, "cobblemon:age") === 1 && w.type(0, 2, 0) === "minecraft:air");
    check("and from age 2 stands its upper half", DB.growTerrainSeed(w.block(0, 1, 0)) && w.type(0, 2, 0) === "cobblemon:electric_seed" && w.state(0, 2, 0, "cobblemon:half") === "upper" && w.state(0, 2, 0, "cobblemon:age") === 2);
    check("the upper half grows the lower", DB.growTerrainSeed(w.block(0, 2, 0)) && w.state(0, 1, 0, "cobblemon:age") === 3 && w.state(0, 2, 0, "cobblemon:age") === 3);
    check("at age 4 it is Voltaconia, both halves", DB.growTerrainSeed(w.block(0, 1, 0)) && w.type(0, 1, 0) === "cobblemon:voltaconia" && w.type(0, 2, 0) === "cobblemon:voltaconia"
          && w.state(0, 1, 0, "cobblemon:half") === "lower" && w.state(0, 2, 0, "cobblemon:half") === "upper");
    check("a grown plant grows no further", !DB.growTerrainSeed(w.block(0, 1, 0)));
}
{
    const w = grid({ "0,0,0": ["minecraft:dirt"], "0,1,0": ["cobblemon:grassy_seed", { "cobblemon:age": 1, "cobblemon:half": "lower" }] });
    check("a seed off farmland does not grow", !DB.growTerrainSeed(w.block(0, 1, 0)) && w.state(0, 1, 0, "cobblemon:age") === 1);
    const blocked = grid({ "0,0,0": ["minecraft:farmland"], "0,1,0": ["cobblemon:misty_seed", { "cobblemon:age": 3, "cobblemon:half": "lower" }], "0,2,0": ["minecraft:stone"] });
    check("and one with no room above stays short of its plant", !DB.growTerrainSeed(blocked.block(0, 1, 0)) && blocked.type(0, 1, 0) === "cobblemon:misty_seed");
    check("bone meal's one age caps at the plant", DB.growTerrainSeed(grid({ "0,0,0": ["minecraft:farmland"], "0,1,0": ["cobblemon:psychic_seed", { "cobblemon:age": 3, "cobblemon:half": "lower" }] }).block(0, 1, 0), 5));
}

// the plants' glow
check("Voltaconia glows in a thunderstorm", DB.terrainPlantGlow({ typeId: "cobblemon:voltaconia", dimension: { weather: "Thunder" } }) === true && DB.terrainPlantGlow({ typeId: "cobblemon:voltaconia", dimension: { weather: "Rain" } }) === false);
check("Verdroot in rain that is not a storm", DB.terrainPlantGlow({ typeId: "cobblemon:verdroot", dimension: { weather: "Rain" } }) === true && DB.terrainPlantGlow({ typeId: "cobblemon:verdroot", dimension: { weather: "Thunder" } }) === false);
{
    const inside = { x: 0, y: 0, z: 0, typeId: "cobblemon:lucibell", dimension: { getEntities: () => [{ location: { x: 0.5, y: 0.2, z: 0.5 } }] } };
    const beside = { x: 0, y: 0, z: 0, typeId: "cobblemon:lucibell", dimension: { getEntities: () => [{ location: { x: 2.5, y: 0.2, z: 0.5 } }] } };
    check("Lucibell glows with something standing in it", DB.terrainPlantGlow(inside) === true && DB.terrainPlantGlow(beside) === false);
}
check("Mistleaf is dark by day", DB.mistleafGlow(6000, 0) === 0 && DB.mistleafGlow(12541, 0) === 0 && DB.mistleafGlow(23460, 0) === 0);
check("and at night glows 1 at the new moon through 8 at the full", DB.mistleafGlow(18000, 4) === 1 && DB.mistleafGlow(18000, 5) === 3 && DB.mistleafGlow(18000, 6) === 5 && DB.mistleafGlow(18000, 7) === 7 && DB.mistleafGlow(18000, 0) === 8);
check("falling through the evens after it", DB.mistleafGlow(12542, 1) === 6 && DB.mistleafGlow(23459, 2) === 4 && DB.mistleafGlow(20000, 3) === 2);

// TargetBlock.getRedstoneStrength
check("a hit on the Ring Target's centre gives 15", DB.targetPower({ x: 3.5, y: 4.5, z: 6 }, "North") === 15);
check("a quarter out gives 8", DB.targetPower({ x: 3.5, y: 4.75, z: 6 }, "north") === 8);
check("and the edge 1", DB.targetPower({ x: 3.02, y: 4.5, z: 6 }, "North") === 1 && DB.targetPower({ x: 7, y: 4.5, z: 6.98 }, "East") === 1);
check("a hit from above measures across x and z", DB.targetPower({ x: 3.5, y: 5, z: 6.5 }, "Up") === 15);

// Wistensu
{
    const w = grid({ "0,6,0": ["minecraft:stone"], "0,5,0": ["cobblemon:wistensu", { "cobblemon:facing": "down", "cobblemon:root": true }] });
    check("a Wistensu under a ceiling roots on it", JSON.stringify(DB.wistensuPlacement(w.block(0, 5, 0), "Down")) === JSON.stringify({ facing: "down", root: true }) && DB.wistensuSurvives(w.block(0, 5, 0), "down", true));
    check("one placed on a floor hangs from the block above, or cannot be placed", !DB.wistensuSurvives(w.block(0, 3, 0), "down", true) && DB.wistensuPlacement(w.block(0, 3, 0), "Up").facing === "down");
    check("under another Wistensu it is the next link", JSON.stringify(DB.wistensuPlacement(w.block(0, 4, 0), "Down")) === JSON.stringify({ facing: "down", root: false }) && DB.wistensuSurvives(w.block(0, 4, 0), "down", false));
    check("the head grows a link down and becomes the vine", DB.growWistensu(w.block(0, 5, 0)) && w.type(0, 5, 0) === "cobblemon:wistensu_vine" && w.state(0, 5, 0, "cobblemon:root") === true
          && w.type(0, 4, 0) === "cobblemon:wistensu" && w.state(0, 4, 0, "cobblemon:root") === false && w.state(0, 4, 0, "cobblemon:facing") === "down");
    check("a vine does not grow", !DB.growWistensu(w.block(0, 5, 0)));
    w.at.set("0,3,0", { typeId: "minecraft:stone", states: {} });
    check("nor a head with no room below", !DB.growWistensu(w.block(0, 4, 0)));
    const wall = grid({ "0,5,1": ["minecraft:stone"] });
    check("on a wall it faces away from it", DB.wistensuPlacement(wall.block(0, 5, 0), "North").facing === "north" && DB.wistensuSurvives(wall.block(0, 5, 0), "north", true) && !DB.wistensuSurvives(wall.block(0, 5, 0), "east", true));
}
{
    const rolls = [0.5, 0.5, 0.9];
    check("bone meal grows links with the 0.826 falloff", DB.bonemealLinks(() => rolls.shift()) === 2 && DB.bonemealLinks(() => 0.95) === 1);
}
// Pauvillea
{
    const w = grid({ "0,6,0": ["minecraft:stone"], "1,5,0": ["minecraft:stone"] });
    check("Pauvillea sits on the face clicked when a block is behind it", DB.pauvilleaPlacement(w.block(0, 5, 0), "Down") === "down" && DB.pauvilleaPlacement(w.block(0, 5, 0), "West") === "west");
    check("and not on air", DB.pauvilleaPlacement(w.block(0, 5, 0), "Up") === undefined && DB.pauvilleaPlacement(w.block(0, 5, 0), "East") === undefined);
}
// the honeyed log washed
{
    const w = grid({ "0,0,0": ["cobblemon:saccharine_log_slathered", { "minecraft:cardinal_direction": "east", "cobblemon:honey_type": 2 }] });
    check("washing a honeyed log leaves a plain log and forgets it", DB.washSlathered(w.block(0, 0, 0)) && w.type(0, 0, 0) === "cobblemon:saccharine_log" && unslathered === 1);
}
// CampfireBlock.neighborChanged
{
    // the pot's last power is the script's, not a cobblemon:powered state (which doubled the pots' permutations)
    const w = grid({ "0,0,0": ["cobblemon:campfire_red", { "cobblemon:lid": false }], "1,0,0": ["minecraft:air", {}] });
    check("a pot first seen only notes its power", !DB.potRedstone(w.block(0, 0, 0)) && w.state(0, 0, 0, "cobblemon:lid") === false);
    w.at.set("1,0,0", { typeId: "minecraft:redstone_block", states: { power: 15 } });
    check("redstone power shuts the pot's lid", DB.potRedstone(w.block(0, 0, 0)) && w.state(0, 0, 0, "cobblemon:lid") === true && w.state(0, 0, 0, "cobblemon:powered") === undefined);
    check("and nothing changes while it stays", !DB.potRedstone(w.block(0, 0, 0)));
    w.at.set("1,0,0", { typeId: "minecraft:air", states: {} });
    check("its loss opens the lid", DB.potRedstone(w.block(0, 0, 0)) && w.state(0, 0, 0, "cobblemon:lid") === false);
}
// RevivalHerbBlock.applyMulch
{
    const w = grid({ "0,0,0": ["cobblemon:revival_herb", { "cobblemon:age": 6, "cobblemon:mutation": "none" }], "1,0,0": ["cobblemon:revival_herb", { "cobblemon:age": 7, "cobblemon:mutation": "none" }] });
    check("Surprise Mulch mutates a herb at age 6", DB.mutateHerb(w.block(0, 0, 0), () => 0.3) && w.state(0, 0, 0, "cobblemon:mutation") === "power");
    check("once", !DB.mutateHerb(w.block(0, 0, 0)));
    check("and not past age 6", !DB.mutateHerb(w.block(1, 0, 0)) && w.state(1, 0, 0, "cobblemon:mutation") === "none");
}

// what port.py writes for them (after a port run)
const pack = new URL("../../../development_behavior_packs/cobblemon/", import.meta.url);
const block = (name) => { const p = new URL(`blocks/${name}.json`, pack); return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8"))["minecraft:block"] : undefined; };
const hasPerm = (b, cond, component) => !!b?.permutations?.some((p) => p.condition.includes(cond) && component in p.components);
{
    const seed = block("electric_seed"), plant = block("voltaconia"), moon = block("mistleaf");
    check("the Electric Seed is a crop of ages 0 to 3 in two halves", seed?.description.states["cobblemon:age"]?.length === 4 && seed?.description.states["cobblemon:half"]?.length === 2 && "cobblemon:terrain_seed" in (seed?.components ?? {}));
    check("its upper half drops nothing", hasPerm(seed, "'upper'", "minecraft:loot") && seed?.permutations.find((p) => p.condition.includes("'upper'")).components["minecraft:loot"] === "loot_tables/empty.json");
    const item = new URL("items/general/electric_seed.json", pack);
    check("the seed item plants it on farmland", existsSync(item) && JSON.parse(readFileSync(item, "utf-8"))["minecraft:item"].components["minecraft:block_placer"]?.block === "cobblemon:electric_seed");
    check("Voltaconia glows at light 8", plant?.description.states["cobblemon:glowing"]?.length === 2 && plant?.permutations.some((p) => p.condition.includes("glowing') == true") && p.components["minecraft:light_emission"] === 8));
    check("Mistleaf glows 0 to 8, light glowing + 2, comparator glowing", moon?.description.states["cobblemon:glowing"]?.length === 9
          && moon?.permutations.some((p) => p.condition.includes("glowing') == 8") && p.components["minecraft:light_emission"] === 10 && p.components["minecraft:redstone_producer"]?.power === 8));
}
{
    const metronome = block("metronome_block"), eject = block("eject_button_block"), ring = block("ring_target_block"), monitor = block("damaged_monitor");
    check("the Metronome gives 4 while active", hasPerm(metronome, "cobblemon:active", "minecraft:redstone_producer") && "cobblemon:activatable" in (metronome?.components ?? {}));
    check("the Eject Button powers 15 pressed", eject?.permutations.some((p) => p.condition.includes("cobblemon:powered") && p.components["minecraft:redstone_producer"]?.power === 15));
    check("the Ring Target has power 0 to 15", ring?.description.states["cobblemon:power"]?.length === 16 && hasPerm(ring, "power') == 15", "minecraft:redstone_producer"));
    check("the Damaged Monitor starts off and glitches at light 10", monitor?.description.states["cobblemon:screen"]?.[0] === "off" && hasPerm(monitor, "glitching", "minecraft:light_emission") && "cobblemon:damaged_monitor" in (monitor?.components ?? {}));
    check("the honeyed log and Wistensu have their components", "cobblemon:slathered_log" in (block("saccharine_log_slathered")?.components ?? {}) && "cobblemon:wistensu" in (block("wistensu")?.components ?? {}) && "cobblemon:pauvillea" in (block("pauvillea")?.components ?? {}));
    // no powered or cooking state: each doubled the 14 pots' permutations and neither is drawn (potRedstone keeps the power)
    check("the campfire pot has its component and no powered or cooking state", !("cobblemon:powered" in (block("campfire_red")?.description.states ?? {}))
          && !("cobblemon:cooking" in (block("campfire_red")?.description.states ?? {})) && "cobblemon:campfire_pot" in (block("campfire_red")?.components ?? {}));
}
{
    const herb = block("revival_herb");
    check("the Revival Herb has its mutation and drops the herb for it", herb?.description.states["cobblemon:mutation"]?.join() === "none,mental,power,white,mirror"
          && hasPerm(herb, "mutation') == 'mental'", "minecraft:loot") && existsSync(new URL("loot_tables/blocks/revival_herb_8_mental.json", pack)));
}
{
    const wet = ["pc", "pasture", "tm_machine", "red_plaque", "flame_orb_block", "magnet_block", "galarica_wreath_block", "potion_block", "eject_button_block", "ring_target_block", "metronome_block",
                 "luminous_moss_block", "relic_coin_pouch", "small_budding_tumblestone", "campfire_pot_red", "lobaila", "saccharine_leaves"];
    const dry = wet.filter((n) => !("minecraft:liquid_detection" in (block(n)?.components ?? {})));
    check("the waterloggable blocks stand in water", dry.length === 0, dry.join());
    const lights = { flame_orb_block: 15, light_ball_block: 13, life_orb_block: 7, luminous_moss_block: 5, wistensu: 11, fire_stone_block: 13, thunder_stone_block: 8, sun_stone_block: 5, shiny_stone_block: 15, dawn_stone_block: 15,
                     dawn_stone_ore: 7, fire_stone_ore: 10, shiny_stone_ore: 12, sun_stone_ore: 2, thunder_stone_ore: 6, nether_fire_stone_ore: 10, terracotta_sun_stone_ore: 2, deepslate_shiny_stone_ore: 12 };
    const unlit = Object.entries(lights).filter(([n, l]) => block(n)?.components["minecraft:light_emission"] !== l).map(([n]) => n);
    check("the blocks CobblemonBlocks.kt lights are lit", unlit.length === 0, unlit.join());
}
