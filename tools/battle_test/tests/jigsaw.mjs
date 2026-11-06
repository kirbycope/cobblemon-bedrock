// Cobblemon's jigsaw structures grown by the script (JigsawPlacement): a start piece and the pieces its jigsaws lead
// to, each joined jigsaw to jigsaw, inside the structure's reach and clear of the others
import { M, check } from "../harness.mjs";
import { readFileSync } from "node:fs";

const generated = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/jigsaw.js", import.meta.url), "utf-8");
const read = (name) => JSON.parse(generated.match(new RegExp(`JIGSAW_${name} = (.*);`))[1]);
const STRUCTURES = read("STRUCTURES"), POOLS = read("POOLS"), PIECES = read("PIECES");
check("the habitats and ruins are jigsaw structures", STRUCTURES.length > 40 && STRUCTURES.some((s) => s.id === "cobblemon:ruins/ancient_dais_ruins"));
check("every pool's pieces are known", Object.values(POOLS).every((p) => p.e.every(([key]) => key === null || PIECES[key])));

// a quarter turn clockwise: north becomes east, and a piece's corner stays at 0
const turned = M.turnedPiece({ size: [3, 1, 5], j: [[0, 0, 0, "north", "up", "a", "b", "p", 1, 0]] }, 1);
check("a turned piece swaps its width and depth", turned.size.join() === "5,1,3");
check("and its jigsaws turn with it", turned.jigsaws[0].front === "east" && turned.jigsaws[0].at.join() === "4,0,0");
check("a jigsaw fits one facing back at it whose name is its target",
      M.jigsawFits({ front: "up", target: "t", rollable: 1, top: "north" }, { front: "down", name: "t", top: "east" }));
check("an aligned joint needs the same top", !M.jigsawFits({ front: "up", target: "t", rollable: 0, top: "north" }, { front: "down", name: "t", top: "east" }));

// flat ground at y 64, every column loaded
const ground = { location: { y: 64 }, isAir: false, typeId: "minecraft:grass_block", below() { return this; } };
const dim = { getTopmostBlock: () => ground, getBlock: () => ground };
const dais = STRUCTURES.find((s) => s.id === "cobblemon:ruins/ancient_dais_ruins");
let grew = 0, clean = true, joined = true;
for (let n = 0; n < 20; n++) {
    const pieces = M.layoutJigsaw(dim, 100, 200, dais);
    grew = Math.max(grew, pieces.length);
    for (const p of pieces) {
        if (p.box.x0 < 100 - dais.dist || p.box.x1 > 100 + dais.dist) clean = false;
        for (const o of pieces) if (o !== p && o.parent !== p && p.parent !== o && !(o.inside && o.parent === p.parent && false) && M.boxesMeet(o.box, p.box) && !(p.inside || o.inside)) clean = false;
        // a child's box touches its parent's jigsaw target
        if (p.parent && !M.boxesMeet({ ...p.box, x0: p.box.x0 - 1, x1: p.box.x1 + 1, y0: p.box.y0 - 1, y1: p.box.y1 + 1, z0: p.box.z0 - 1, z1: p.box.z1 + 1 }, p.parent.box)) joined = false;
    }
}
check("the dais grows past its start piece", grew > 1, `${grew} pieces`);
check("its pieces stay in reach and clear of each other", clean);
check("each piece joins its parent", joined);
check("its start sits on the ground", M.layoutJigsaw(dim, 100, 200, dais)[0].box.y0 === 64 + dais.h[0]);
check("an unloaded column waits", M.layoutJigsaw({ getTopmostBlock: () => undefined, getBlock: () => undefined }, 0, 0, dais) === null);

// fitting the ground: a terrain-matching piece follows it column by column, and a rigid piece of a structure Java
// adapts the terrain to has the ground raised under it
import { world } from "../stub_server.mjs";
const blocks = new Map(), at = (x, y, z) => `${x},${y},${z}`;
const fake = { setBlockType: (p, id) => blocks.set(at(p.x, p.y, p.z), id),
    getBlock: (p) => ({ get permutation() { return blocks.get(at(p.x, p.y, p.z)); }, setPermutation: (v) => blocks.set(at(p.x, p.y, p.z), v) }),
    fillBlocks: (volume, id) => { for (let y = volume.from.y; y <= volume.to.y; y++) blocks.set(at(volume.from.x, y, volume.from.z), id); } };
world.structureManager = { get: () => ({ size: { x: 3, y: 1, z: 1 }, getBlockPermutation: () => "path" }) };
const box = { x0: 0, y0: 64, z0: 0, x1: 2, y1: 64, z1: 0 };
for (let x = 0; x <= 2; x++) blocks.set(at(x, 64, 0), "path");   // as placed, flat at the jigsaw's height
M.followGround(fake, "path", 0, box, new Map([["0,0", [64, "minecraft:dirt"]], ["1,0", [66, "minecraft:dirt"]], ["2,0", [61, "minecraft:dirt"]]]));
check("a column on level ground stays", blocks.get(at(0, 64, 0)) === "path");
check("one where the ground is higher goes up to it, and the ground fills where it was",
      blocks.get(at(1, 66, 0)) === "path" && blocks.get(at(1, 64, 0)) === "minecraft:dirt");
check("one where the ground falls away goes down, leaving air", blocks.get(at(2, 61, 0)) === "path" && blocks.get(at(2, 64, 0)) === "minecraft:air");
// fillBlocks takes a BlockVolume, which the stand-in keeps as from and to
blocks.clear();
const beard = { fillBlocks: (v, id) => { for (let y = v.from.y; y <= v.to.y; y++) blocks.set(at(v.from.x, y, v.from.z), id); } };
M.beardUnder(beard, { x0: 0, y0: 70, z0: 0, x1: 0, y1: 75, z1: 0 }, new Map([["0,0", [60, "minecraft:stone"]]]));
check("the ground is raised under a rigid piece to its floor", blocks.get(at(0, 69, 0)) === "minecraft:stone" && blocks.get(at(0, 61, 0)) === "minecraft:stone" && !blocks.has(at(0, 60, 0)));
blocks.clear();
M.beardUnder(beard, { x0: 0, y0: 70, z0: 0, x1: 0, y1: 75, z1: 0 }, new Map([["0,0", [40, "minecraft:stone"]]]));
check("at most 12 blocks deep", blocks.has(at(0, 58, 0)) && !blocks.has(at(0, 57, 0)));
const adapted = JSON.parse(generated.match(/JIGSAW_STRUCTURES = (.*);/)[1]).filter((s) => s.adapt);
check("the structures that adapt the terrain say how", adapted.length > 20 && adapted.every((s) => ["beard_thin", "beard_box", "bury"].includes(s.adapt)), `${adapted.length}`);

// the beard's skirt: the ground round a raised piece rises toward its floor, a block lower for each block out
blocks.clear();
const flat = { getTopmostBlock: () => ({ location: { y: 60 }, isAir: false, typeId: "minecraft:stone", below() { return this; } }),
               getBlock: () => ({ typeId: "minecraft:stone" }), ...beard };
M.beardSkirt(flat, { x0: 0, y0: 70, z0: 0, x1: 2, y1: 75, z1: 2 });
const skirtTop = (x, z) => Math.max(...[...blocks.keys()].filter((k) => k.startsWith(`${x},`) && k.endsWith(`,${z}`)).map((k) => Number(k.split(",")[1])));
check("one block out the ground comes up to a block under the floor", skirtTop(3, 1) === 68);
check("four out, four lower", skirtTop(6, 1) === 65 && !blocks.has(at(7, 64, 1)));
check("nothing is filled inside the footprint", ![...blocks.keys()].some((k) => k === at(1, 69, 1)));
// beard_box's carving: ground left inside a piece where its template keeps the world's block is cut away
const carved = new Map([[at(0, 71, 0), "minecraft:dirt"], [at(0, 72, 0), "minecraft:oak_planks"]]);
world.structureManager = { get: () => ({ size: { x: 1, y: 3, z: 1 }, getBlockPermutation: ({ y }) => (y === 0 ? "floor" : undefined) }) };
M.carveBox({ getBlock: (p) => ({ get typeId() { return carved.get(at(p.x, p.y, p.z)) ?? "minecraft:air"; }, get isAir() { return !carved.has(at(p.x, p.y, p.z)); },
                                setType: (id) => carved.set(at(p.x, p.y, p.z), id) }) }, "piece", 0, { x0: 0, y0: 70, z0: 0, x1: 0, y1: 72, z1: 0 });
check("the hill inside a piece's voids is cut away", carved.get(at(0, 71, 0)) === "minecraft:air");
check("a block that is not ground stays", carved.get(at(0, 72, 0)) === "minecraft:oak_planks");
