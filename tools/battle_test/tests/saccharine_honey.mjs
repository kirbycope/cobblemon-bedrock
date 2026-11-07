// SaccharineLeafBlock's honey: a honeyed leaf passes a stage to the first saccharine leaf below it, through air
import { M, check } from "../harness.mjs";

function world(column) {
    const blocks = new Map();
    const dimension = { getBlock: ({ y }) => blocks.get(y) };
    for (const [y, typeId, age] of column) {
        const b = { x: 0, y, z: 0, typeId, dimension, isValid: true, age,
                    permutation: { getState: (k) => (k === "cobblemon:age" ? b.age : undefined), withState: (k, v) => ({ age: v }) },
                    setPermutation(p) { b.age = p.age; } };
        blocks.set(y, b);
    }
    return blocks;
}
const random = Math.random;
Math.random = () => 0.1;
const w = world([[10, "cobblemon:saccharine_leaves", 2], [9, "minecraft:air"], [8, "minecraft:air"], [7, "cobblemon:saccharine_leaves", 0]]);
M.honeyDrip(w.get(10));
check("a dripping leaf passes a stage down through air", w.get(10).age === 1 && w.get(7).age === 1, `${w.get(10).age} ${w.get(7).age}`);
const full = world([[10, "cobblemon:saccharine_leaves", 2], [9, "cobblemon:saccharine_leaves", 2]]);
M.honeyDrip(full.get(10));
check("not into a leaf already dripping", full.get(10).age === 2 && full.get(9).age === 2);
const log = world([[10, "cobblemon:saccharine_leaves", 1], [9, "cobblemon:saccharine_log"], [8, "cobblemon:saccharine_leaves", 0]]);
M.honeyDrip(log.get(10));
check("and not past a block that is not a leaf", log.get(10).age === 1 && log.get(8).age === 0);
Math.random = () => 0.9;
const odds = world([[10, "cobblemon:saccharine_leaves", 2], [9, "cobblemon:saccharine_leaves", 0]]);
M.honeyDrip(odds.get(10));
check("one Java random tick in two, so seven in eight of Bedrock's (a third as many): not at 0.9", odds.get(10).age === 2);
Math.random = random;
