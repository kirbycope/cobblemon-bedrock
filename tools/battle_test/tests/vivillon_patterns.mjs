// Vivillon's last two patterns: Modern, which Spewpa evolves into inside a village (StructureRequirement on
// #minecraft:village, every other pattern needing to be outside one), and Poke Ball, which needs every pattern
// collect_all_vivillon names caught (an advancement, which the script keeps as the player's caught looks)
import { M, D, check } from "../harness.mjs";
import { world } from "../stub_server.mjs";
import { readFileSync } from "node:fs";

const LOOKS = JSON.parse(readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/variants.js", import.meta.url), "utf-8")
    .match(/VARIANT_LOOKS = (.*);/)[1])["cobblemon:p0666_vivillon"];
const evolution = (form) => D.POKEMON["cobblemon:p0665_spewpa"].evolutions.find((e) => e.form === form);
check("Modern Vivillon needs a village", evolution("vivillon-wings-modern")?.req.some((r) => r.t === "village"));
check("a biome's pattern needs to be outside one", evolution("vivillon-wings-meadow")?.req.some((r) => r.t === "not" && r.r.t === "village"));
const ball = evolution("vivillon-wings-poke-ball")?.req.find((r) => r.t === "collected");
check("Poke Ball Vivillon needs collect_all_vivillon's patterns", ball?.species === "cobblemon:p0666_vivillon" && ball.aspects.length === 19 && ball.default === "vivillon-wings-meadow",
      JSON.stringify(ball)?.slice(0, 120));

// a village: within 48 blocks of one the script found, in the Overworld only
world.setDynamicProperty("cobblemon:pokecenters", JSON.stringify([[100, 100]]));
const overworld = { id: "minecraft:overworld", getBlocks: () => ({ getCapacity: () => 0 }) };
check("a spot by a found village is in it", M.villageAt(overworld, { x: 120, y: 64, z: 110 }));
check("one far from it is not", !M.villageAt(overworld, { x: 400, y: 64, z: 400 }));
check("a village bell nearby counts too", M.villageAt({ ...overworld, getBlocks: () => ({ getCapacity: () => 1 }) }, { x: 400, y: 64, z: 400 }));
check("nothing in the Nether is a village", !M.villageAt({ ...overworld, id: "minecraft:the_nether" }, { x: 120, y: 64, z: 110 }));

// the caught patterns, kept as the player catches them
const store = new Map();
const player = { isValid: true, getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => store.set(k, v), sendMessage() { } };
const look = (aspect) => LOOKS.findIndex((l) => l[0] === aspect);
for (const aspect of ball.aspects.slice(1)) M.register(player, "cobblemon:p0666_vivillon", 2, look(aspect));
check("one pattern short is not all", !M.collectedAll(player, ball.species, ball.aspects, ball.default));
M.register(player, "cobblemon:p0666_vivillon", 2, look(ball.aspects[0]));
check("every pattern caught is all", M.collectedAll(player, ball.species, ball.aspects, ball.default));
store.clear();
for (const aspect of ball.aspects.filter((a) => a !== "vivillon-wings-meadow")) M.register(player, "cobblemon:p0666_vivillon", 2, look(aspect));
M.register(player, "cobblemon:p0666_vivillon", 2, 0);
check("a Vivillon with no pattern of its own counts as Meadow", M.collectedAll(player, ball.species, ball.aspects, ball.default));
store.clear();
M.register(player, "cobblemon:p0666_vivillon", 1, look(ball.aspects[0]));
check("a pattern only seen is not caught", !JSON.parse(store.get("cobblemon:dex_caught") ?? "{}")["cobblemon:p0666_vivillon"]);
