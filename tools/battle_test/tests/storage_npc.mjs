// scripts/storage_npc.js: Nurse Joy's name check, the pasture lamp's viewer range and the tether's box and landing spot,
// the trainer's hurt memory and dialogue hooks, Professor Sacchi's landing page
import { M, check } from "../harness.mjs";
import { system } from "../stub_server.mjs";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// the module is a .js ES module in a folder without a package.json, so it is read from a copy that has one, as main.js is
const copy = mkdtempSync(join(tmpdir(), "cobblemon-storage-npc-"));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
copyFileSync(fileURLToPath(new URL("../../../development_behavior_packs/cobblemon/scripts/storage_npc.js", import.meta.url)), join(copy, "storage_npc.js"));
const S = await import(pathToFileURL(join(copy, "storage_npc.js")).href);

// Nurse Joy: CobblemonVillagerProfessions.getNameTagOverride's names, matched on the end of the stripped name
check("a Nurse named Joy, Joelle or a listed name becomes Nurse Joy", S.isNurseJoyName("Nurse Joy") && S.isNurseJoyName("§bJoelle") && S.isNurseJoyName("Joëlle") && S.isNurseJoyName("Джой"));
check("but a plain Nurse, or a name that only contains Joy, does not", !S.isNurseJoyName("Nurse") && !S.isNurseJoyName("Joyful") && !S.isNurseJoyName(undefined));

// the pasture lamp follows a viewer within 5 blocks (getInRangeViewerCount's box, the block to its far corner plus 5)
const dim = { id: "minecraft:overworld" };
const pasture = { location: { x: 10, y: 64, z: 10 }, dimension: dim };
const at = (x, y, z, d = dim) => ({ location: { x, y, z }, dimension: d });
check("a viewer 4 blocks from the pasture keeps its lamp lit", S.viewerNear(at(14.5, 64, 10.5), pasture) && S.viewerNear(at(5.2, 66, 12), pasture));
check("one 7 blocks off, or in another dimension, puts it out", !S.viewerNear(at(18, 64, 10), pasture) && !S.viewerNear(at(10.5, 64, 10.5, { id: "minecraft:nether" }), pasture));

// the tether: 32 blocks each way of the pasture (pastureMaxWanderDistance), the key main.js writes
const home = S.parsePastureKey("minecraft:overworld|10,64,10");
check("the pasture key reads back as its dimension and position", home.dim === "minecraft:overworld" && home.x === 10 && home.y === 64 && home.z === 10 && S.parsePastureKey("junk") === null);
check("32 blocks out is still inside the box, 33 outside", !S.outsideTether({ x: 42, y: 64, z: 10 }, home) && S.outsideTether({ x: 43, y: 64, z: 10 }, home) && S.outsideTether({ x: 10, y: 97, z: 10 }, home));
// a world of grass at y 63 with air above, and a pillar in the way at the spot a wide Pokemon would take
function ground(solid = {}) {
    return { getBlock: ({ x, y, z }) => { const t = solid[`${x},${y},${z}`] ?? (y <= 63 ? "minecraft:grass_block" : "minecraft:air"); return { typeId: t, isAir: t === "minecraft:air", isLiquid: t === "minecraft:water" }; } };
}
const spot = S.tetherSpot(ground(), home, "south", 0.6);
check("a Pokemon under a block wide lands two blocks behind a south-facing pasture, on the ground", spot && spot.x === 10.5 && spot.z === 12.5 && spot.y === 64);
const wide = S.tetherSpot(ground(), home, "east", 2.3);
check("a wider one goes ceil(width) + 1 blocks out along the facing", wide && wide.x === 14.5 && wide.z === 10.5);
check("a spot walled up to 4 blocks above the pasture gives none, so the Pokemon is recalled", S.tetherSpot(ground(Object.fromEntries([...Array(12)].map((_, i) => [`10,${61 + i},12`, "minecraft:stone"]))), home, "south", 0.6) === null);
check("water counts as standing room, the way isSafeFloor lets a swimmer stand", S.tetherSpot(ground({ "10,64,12": "minecraft:water" }), home, "south", 0.6)?.y === 64);

// the standard trainer: a name from its class and the 400-tick hurt memory behind npc-example's refusal
check("the trainer takes one of its class's names", S.pickName(["Red", "Green", "Blue", "Yellow"], 0.3) === "Green" && S.pickName(undefined) === "Trainer");
S.noteNpcHurt("npc-1", "player-1", 100);
check("a trainer hit by a player remembers it for 20 seconds", S.wasHurtBy("npc-1", "player-1", 400) && !S.wasHurtBy("npc-1", "player-2", 400) && !S.wasHurtBy("npc-1", "player-1", 500));
system.currentTick = 120;
check("the greeting hook lands on the refusal while it remembers, the chat otherwise", S.sceneNext({ id: "player-1" }, { id: "npc-1" }, { next: "@trainer_greeting" }) === "cobblemon:npc_trainer.hurt"
    && S.sceneNext({ id: "player-2" }, { id: "npc-1" }, { next: "@trainer_greeting" }) === "cobblemon:npc_trainer.chat");
check("a plain next goes to that page, and a page without one closes", S.sceneNext({}, {}, { next: "cobblemon:npc_sacchi.okbye" }) === "cobblemon:npc_sacchi.okbye" && S.sceneNext({}, {}, {}) === undefined);

// Professor Sacchi's landing page, with main.js's pieces stood in: a machine within 10 blocks, the party's needs, the charge
const healers = [];
const npcDim = { id: "minecraft:overworld", getBlocks: () => ({ getBlockLocationIterator: () => healers[Symbol.iterator]() }), getBlock: (p) => ({ typeId: "cobblemon:healing_machine", location: p, dimension: npcDim }) };
const npc = { id: "npc-1", location: { x: 0.5, y: 64, z: 0.5 }, dimension: npcDim };
let party = [], records = {}, busy = new Set(), charge = 6;
S.initStorageNpc({ summaryParty: () => party, missingShare: (m) => m.missing ?? 0, prop: (m, k) => m[k], healerRecords: () => records, healerCharge: () => charge, healingAt: busy,
                   STATUS: "cobblemon:status", PP_LEFT: "cobblemon:pp" });
check("with no healing machine in reach she cannot find her machine", S.sacchiLanding({}, npc) === "no_healer");
healers.push({ x: 3, y: 64, z: 0 });
party = [{ missing: 0 }];
check("with the party healthy she says so", S.sacchiLanding({}, npc) === "full_health");
party = [{ missing: 0, "cobblemon:status": "{\"s\":\"psn\",\"left\":3}" }];
check("a status counts as needing her (Pokemon.canBeHealed)", S.sacchiLanding({}, npc) === "has_charge");
records = { "minecraft:overworld|3,64,0": { c: 1, t: 0 } }; charge = 0.5; party = [{ missing: 1 }];
check("a machine short of the charge for the party is busy", S.sacchiLanding({}, npc) === "no_charge");
charge = 6; busy.add("minecraft:overworld|3,64,0");
check("and so is one with a party already in it", S.sacchiLanding({}, npc) === "no_charge");
busy.clear();
check("otherwise she offers the heal", S.sacchiLanding({}, npc) === "has_charge");

// main.js took the hooks: the scene display, the starter path and the pasture screen still load
check("main.js loads with the storage and NPC hooks in it", typeof M.showScene === "function" && typeof M.openPasture === "function" && typeof M.startNpcBattle === "function" && typeof M.usePartyItem === "function");
