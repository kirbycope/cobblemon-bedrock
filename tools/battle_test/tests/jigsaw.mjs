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
