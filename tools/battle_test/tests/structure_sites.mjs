// Spawns in Cobblemon's own structures (StructureManager.getStructureWithPieceAt): a marker's random tick notes where its
// piece stands and puts back the block it stands in for; the spawner then finds a spot inside it, and a spawn that
// needs it comes there and nowhere else
import { M, F, check } from "../harness.mjs";
import { world } from "../stub_server.mjs";
import { readFileSync } from "node:fs";

const generated = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/structure_sites.js", import.meta.url), "utf-8");
const STRUCTURE_PIECES = JSON.parse(generated.match(/STRUCTURE_PIECES = (.*);/)[1]);

// a structure placed whole by world generation (a fishing boat) is found by its markers
const gimmi = STRUCTURE_PIECES.findIndex((p) => p.s.length);
check("a placed structure's piece is marked", gimmi >= 0);
const piece = STRUCTURE_PIECES[gimmi];
check("with the block its markers stand in for and its reach", typeof piece.b === "string" && piece.r > 0 && piece.up > 0, JSON.stringify(piece));

let placed = null;
const marker = (x, y, z) => ({
    location: { x, y, z }, dimension: { id: "minecraft:overworld" },
    permutation: { getState: (k) => (k === "cobblemon:piece_hi" ? Math.floor(gimmi / 16) : gimmi % 16) },
    setPermutation: (p) => { placed = p; }, setType: () => { },
});
M.noteStructureSite(marker(1000, 64, 2000));
check("a marker's tick puts its block back", placed?.type?.id === piece.b, JSON.stringify(placed?.type));
M.noteStructureSite(marker(1001, 64, 2000));
const sites = JSON.parse(world.getDynamicProperty("cobblemon:sites_1_3") ?? "[]");
check("and notes the structure once, however many of its markers tick", sites.length === 1, JSON.stringify(sites));

const ids = piece.s;
check("a spot in the tower is in it", M.inStructure({ x: 1002, y: 66, z: 2001 }, ids));
check("a spot past its reach is not", !M.inStructure({ x: 1000 + piece.r + 3, y: 66, z: 2000 }, ids));
check("nor one above it", !M.inStructure({ x: 1000, y: 64 + piece.up + 3, z: 2000 }, ids));
check("nor another structure's spawn", !M.inStructure({ x: 1002, y: 66, z: 2001 }, ["cobblemon:ruins/sol_henge_ruins"]));

// a jigsaw structure the script grew is found by the box it noted (the Gimmighoul tower's spawns)
const generatedJigsaw = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/jigsaw.js", import.meta.url), "utf-8");
const JIGSAW_STRUCTURES = JSON.parse(generatedJigsaw.match(/JIGSAW_STRUCTURES = (.*);/)[1]);
const tower = JIGSAW_STRUCTURES.findIndex((st) => st.id === "cobblemon:ruins/temperate_gimmi_tower");
M.noteJigsawSite(tower, { x0: 5000, y0: 60, z0: 5000, x1: 5012, y1: 90, z1: 5012 });
check("a spot in a grown Gimmighoul tower is in it", M.inStructure({ x: 5006, y: 70, z: 5006 }, ["cobblemon:ruins/temperate_gimmi_tower"]));
check("one outside it is not", !M.inStructure({ x: 5030, y: 70, z: 5006 }, ["cobblemon:ruins/temperate_gimmi_tower"]));
M.noteStructureSite(marker(2046, 64, 2000));   // the last column of a region
check("a site at a region's edge is found from the next region", M.inStructure({ x: 2050, y: 66, z: 2000 }, ids));

// the spawns that need these structures are the spawner's now
const needing = F.SPECIAL_SPAWNS.filter((sp) => sp.structures);
const species = new Set(needing.map((sp) => sp.entity.split("_").pop()));
check("the ruins' and coves' spawns come from the spawner", needing.length > 100 && species.has("gimmighoul") && species.has("dhelmise") && species.has("mudkip"),
      `${needing.length} entries, ${[...species].slice(0, 12).join(" ")}`);
