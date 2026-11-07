// Berry care: mulch on a tree, a harvest's yield, and mutations from a partner beside it
import { M, check } from "../harness.mjs";

// a stand-in berry bush at a position, in a dimension where the given blocks stand round it
function bush(typeId, around = {}, biome = "minecraft:forest") {
    const dimension = {
        id: "minecraft:overworld",
        getBlock: ({ x, z }) => ({ typeId: around[`${x},${z}`] ?? "minecraft:air" }),
        getBiome: () => ({ id: biome }), playSound() { }, spawnParticle() { },
    };
    return { typeId, x: 0, y: 64, z: 0, location: { x: 0, y: 64, z: 0 }, dimension, center: () => ({ x: 0.5, y: 64.5, z: 0.5 }) };
}
const total = (out) => out.reduce((n, [, c]) => n + c, 0);
{
    const b = bush("cobblemon:oran_berry_bush");
    const counts = Array.from({ length: 40 }, () => total(M.berryHarvest(b)));
    check("a harvest gives the base yield or the preferred biome's bonus on top", Math.min(...counts) >= 2 && Math.max(...counts) <= 4, counts.join(","));
    M.setCare(b, { mulch: "rich_mulch", uses: 5 });
    const rich = total(M.berryHarvest(b));
    check("Rich Mulch adds berries and is used up a harvest at a time", rich >= 3 && M.careOf(b).uses === 4, `${rich} ${JSON.stringify(M.careOf(b))}`);
    M.setCare(b, null);
}
{
    const b = bush("cobblemon:oran_berry_bush", { "1,0": "cobblemon:cheri_berry_bush" });
    M.setCare(b, { mulch: "surprise_mulch", uses: 3 });
    const random = Math.random; Math.random = () => 0.1;
    try { M.berryMutation(b); } finally { Math.random = random; }
    const out = M.berryHarvest(b);
    check("a ripe tree beside its partner can mutate, and the harvest gives the mutation", out.some(([item]) => item === "cobblemon:lum_berry"), JSON.stringify(out));
    check("Surprise Mulch is spent on the roll", M.careOf(b).uses === 2 || !M.careOf(b).mulch, JSON.stringify(M.careOf(b)));
}

// bone meal (BerryBlock.performBonemeal): a stage on, and a bush it brings into flower rolls its mutation as a random
// tick's step to flower does (growHelper, MATURE_AGE to FLOWER_AGE); before this the bone meal path skipped the roll, so a
// bone-mealed tree never mutated (Planet Minecraft, 6 Nov 2026)
{
    const b = bush("cobblemon:oran_berry_bush", { "1,0": "cobblemon:cheri_berry_bush" });
    M.setCare(b, null);
    const perm = (states) => ({ getState: (k) => states[k], withState: (k, v) => perm({ ...states, [k]: v }) });
    b.isValid = true; b.permutation = perm({ "cobblemon:stage": 1, "cobblemon:mulch": "none" });
    b.setPermutation = (p) => { b.permutation = p; };
    const stage = () => b.permutation.getState("cobblemon:stage");
    const random = Math.random; Math.random = () => 0.1;
    let grew;
    try { grew = M.bonemealBerry(b, null); } finally { Math.random = random; }
    check("bone meal brings a mature bush into flower", grew && stage() === 2, `${grew} ${stage()}`);
    check("and the bush beside its partner mutates", M.careOf(b).mut === "cobblemon:lum_berry", JSON.stringify(M.careOf(b)));
    b.permutation = perm({ "cobblemon:stage": 3, "cobblemon:mulch": "none" });
    check("a ripe bush takes no bone meal", !M.bonemealBerry(b, null));
    M.setCare(b, null);
}
