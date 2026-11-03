// Type gem growth about a crystal core: buds sprout on a joined gem block's open faces, grow, and become gem blocks
import { M, check } from "../harness.mjs";

// a small world of stand-in blocks: everything air but what is set
function grid(set) {
    const blocks = new Map();
    const dimension = { id: "minecraft:overworld", getBlock: ({ x, y, z }) => at(x, y, z) };
    function at(x, y, z) {
        const key = `${x},${y},${z}`;
        if (!blocks.has(key)) blocks.set(key, make(x, y, z, "minecraft:air"));
        return blocks.get(key);
    }
    function make(x, y, z, typeId, states = {}) {
        const b = { x, y, z, dimension, typeId, get isAir() { return this.typeId === "minecraft:air"; } };
        b.permutation = { type: { id: typeId }, states, getState: (k) => states[k], withState: (k, v) => ({ type: { id: b.typeId }, states: { ...b.permutation.states, [k]: v }, getState: (kk) => ({ ...b.permutation.states, [k]: v })[kk] }) };
        b.setPermutation = (p) => { b.typeId = p.type.id; b.permutation = { ...p, getState: (k) => p.states[k], withState: (k, v) => ({ type: { id: p.type.id }, states: { ...p.states, [k]: v } }) }; };
        return b;
    }
    for (const [pos, id, states] of set) { const [x, y, z] = pos; blocks.set(`${x},${y},${z}`, make(x, y, z, id, states)); }
    return { at, blocks };
}
{
    const w = grid([[[0, 0, 0], "cobblemon:deepslate_crystal_core"], [[1, 0, 0], "cobblemon:bug_gem_block"]]);
    const random = Math.random; Math.random = () => 0.05;
    try { M.gemCoreTick(w.at(0, 0, 0)); } finally { Math.random = random; }
    const buds = [...w.blocks.values()].filter((b) => b.typeId === "cobblemon:bug_gem_cluster");
    check("a crystal core sprouts buds of the gem's type on its open faces", buds.length >= 4, buds.length);
}
{
    const w = grid([[[0, 0, 0], "cobblemon:deepslate_crystal_core"], [[1, 0, 0], "cobblemon:bug_gem_block"], [[1, 1, 0], "cobblemon:bug_gem_cluster", { "minecraft:block_face": "up", "cobblemon:stage": 3 }]]);
    const random = Math.random; Math.random = () => 0.05;
    try { M.gemCoreTick(w.at(0, 0, 0)); } finally { Math.random = random; }
    check("a full grown bud becomes a gem block", w.at(1, 1, 0).typeId === "cobblemon:bug_gem_block", w.at(1, 1, 0).typeId);
}
