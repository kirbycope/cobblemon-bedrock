// A brushed suspicious block in one of Cobblemon's ruins gives from that ruin's own archaeology tables (Bedrock rolls
// none for a block a structure placed): a grown jigsaw ruin notes its box and its pieces' tables, a ruin placed whole
// marks its piece, and the script rolls those tables by their share of the suspicious blocks
import { M, check } from "../harness.mjs";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../../../development_behavior_packs/cobblemon/scripts/${name}`, import.meta.url), "utf-8");
const JIGSAW_STRUCTURES = JSON.parse(read("jigsaw.js").match(/JIGSAW_STRUCTURES = (.*);/)[1]);
const BRUSH_LOOT = JSON.parse(read("fossil_loot.js").match(/BRUSH_LOOT = (.*);/)[1]);

const index = JIGSAW_STRUCTURES.findIndex((st) => st.t);
check("ruins with suspicious blocks carry their loot tables", index >= 0);
const ruin = JIGSAW_STRUCTURES[index];
check("and every table they name is one the script can roll", Object.keys(ruin.t).every((t) => BRUSH_LOOT[t]?.length), JSON.stringify(Object.keys(ruin.t)));

M.noteJigsawSite(index, { x0: 3000, y0: 70, z0: 3000, x1: 3020, y1: 80, z1: 3020 });
const dim = { id: "minecraft:overworld", getBiome: () => ({ id: "minecraft:plains" }), getBlocks: () => { throw new Error("none"); } };
check("a spot in the ruin is found as it", M.jigsawAt({ x: 3001, y: 71, z: 3001 })?.id === ruin.id);
check("a spot far from any ruin is not", M.jigsawAt({ x: 9000, y: 71, z: 9000 }) === undefined && M.ruinPieceAt(dim, { x: 9000, y: 71, z: 9000 }) === undefined);
const items = new Set(Object.keys(ruin.t).flatMap((t) => BRUSH_LOOT[t].map((e) => e[0])));
let fromRuin = true, any = false;
for (let n = 0; n < 40; n++) { const find = M.brushLoot(dim, { x: 3001, y: 71, z: 3001 }); if (find) any = true; if (find && !items.has(find.typeId)) fromRuin = false; }
check("its finds come from the ruin's tables", fromRuin && any);
check("outside the Overworld there are no ruins", M.ruinPieceAt({ ...dim, id: "minecraft:nether" }, { x: 3001, y: 71, z: 3001 }) === undefined);
