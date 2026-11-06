// A brushed suspicious block in one of Cobblemon's ruins gives from that ruin's own archaeology tables (Bedrock rolls
// none for a block a structure placed): its piece is marked, and the script rolls the piece's tables by their share
import { M, check } from "../harness.mjs";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../../../development_behavior_packs/cobblemon/scripts/${name}`, import.meta.url), "utf-8");
const STRUCTURE_PIECES = JSON.parse(read("structure_sites.js").match(/STRUCTURE_PIECES = (.*);/)[1]);
const BRUSH_LOOT = JSON.parse(read("fossil_loot.js").match(/BRUSH_LOOT = (.*);/)[1]);

const index = STRUCTURE_PIECES.findIndex((p) => p.t);
check("ruin pieces with suspicious blocks are marked with their loot tables", index >= 0);
const piece = STRUCTURE_PIECES[index];
check("and every table they name is one the script can roll", Object.keys(piece.t).every((t) => BRUSH_LOOT[t]?.length), JSON.stringify(Object.keys(piece.t)));

// a marker's tick notes the piece where it stands; a block brushed inside it rolls its tables
M.noteStructureSite({ location: { x: 3000, y: 70, z: 3000 }, dimension: { id: "minecraft:overworld" },
    permutation: { getState: (k) => (k === "cobblemon:piece_hi" ? Math.floor(index / 16) : index % 16) }, setPermutation: () => { }, setType: () => { } });
const dim = { id: "minecraft:overworld", getBiome: () => ({ id: "minecraft:plains" }), getBlocks: () => { throw new Error("none"); } };
check("a spot in the ruin is found as its piece", JSON.stringify(M.ruinPieceAt(dim, { x: 3001, y: 71, z: 3001 })) === JSON.stringify(piece));
check("a spot far from any ruin is not", M.ruinPieceAt(dim, { x: 9000, y: 71, z: 9000 }) === undefined);
const items = new Set(Object.keys(piece.t).flatMap((t) => BRUSH_LOOT[t].map((e) => e[0])));
let fromRuin = true;
for (let n = 0; n < 40; n++) { const find = M.brushLoot(dim, { x: 3001, y: 71, z: 3001 }); if (find && !items.has(find.typeId)) fromRuin = false; }
check("its finds come from the ruin's tables", fromRuin);
check("outside the Overworld there are no ruins", M.ruinPieceAt({ ...dim, id: "minecraft:nether" }, { x: 3001, y: 71, z: 3001 }) === undefined);
