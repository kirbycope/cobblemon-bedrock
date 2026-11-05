// Leaf decay: apricorn and saccharine leaves fall with no log within six blocks, and take their hanging apricorns
import { M, check } from "../harness.mjs";

// a small world of blocks by position; setblock ... air destroy empties a spot and notes it
function grid(blocks) {
    const at = new Map(Object.entries(blocks)), broken = [];
    const dimension = {
        getBlock({ x, y, z }) {
            const entry = at.get(`${x},${y},${z}`);
            if (!entry) return { x, y, z, typeId: "minecraft:air", dimension };
            const [typeId, states = {}] = entry;
            return { x, y, z, typeId, dimension, permutation: { getState: (k) => states[k] } };
        },
        runCommand(command) {
            const [, x, y, z] = command.match(/setblock (-?\d+) (-?\d+) (-?\d+) air destroy/);
            broken.push(at.get(`${x},${y},${z}`)?.[0]); at.delete(`${x},${y},${z}`);
        },
    };
    return { dimension, broken, block: (x, y, z) => dimension.getBlock({ x, y, z }) };
}
const leaf = ["cobblemon:apricorn_leaves"];
{
    // a log, then a row of leaves running east from it
    const row = { "0,0,0": ["cobblemon:apricorn_log"] };
    for (let x = 1; x <= 8; x++) row[`${x},0,0`] = leaf;
    const w = grid(row);
    check("a leaf six blocks from a log stays", M.leafHeld(w.block(6, 0, 0)));
    check("and one seven blocks away does not", !M.leafHeld(w.block(7, 0, 0)));
}
{
    const w = grid({ "0,0,0": leaf, "0,0,1": ["cobblemon:red_apricorn", { "cobblemon:facing": "north" }], "1,0,0": ["cobblemon:blue_apricorn", { "cobblemon:facing": "north" }] });
    M.decayLeaf(w.block(0, 0, 0));
    check("a leaf with no log falls, with the apricorn hanging from it", w.broken.join() === "cobblemon:apricorn_leaves,cobblemon:red_apricorn", w.broken.join());
}
{
    const w = grid({ "0,0,0": ["cobblemon:apricorn_leaves", { "cobblemon:persistent": true }] });
    M.decayLeaf(w.block(0, 0, 0));
    check("a placed leaf stays", w.broken.length === 0);
}
