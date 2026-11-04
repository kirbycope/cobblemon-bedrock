// Fishing spawns that need a slime chunk, a village or nearby blocks, tested where the bobber is
import { M, check } from "../harness.mjs";

const cast = { effects: [], luck: 0, lure: 0 };
const bobber = (x, z, kelp) => ({ location: { x, y: 62, z }, sky: true, dimension: { containsBlock: (_, f) => !!kelp && f.includeTypes.includes("minecraft:kelp") } });
const base = { entity: "cobblemon:p0349_feebas", bucket: "common", weight: 1, biome: null };
// a slime chunk and a chunk that is not one, found by the script's own test
let slime, plain;
for (let cx = 0; cx < 200 && (slime === undefined || plain === undefined); cx++) {
    if (M.isSlimeChunk(cx * 16 + 8, 8)) slime ??= cx; else plain ??= cx;
}
{
    const sp = { ...base, isSlimeChunk: true };
    check("a slime-chunk fishing spawn bites in a slime chunk", M.spawnAllowed(sp, cast, bobber(slime * 16 + 8, 8), []));
    check("and not outside one", !M.spawnAllowed(sp, cast, bobber(plain * 16 + 8, 8), []));
}
{
    const sp = { ...base, fishNear: ["minecraft:kelp_plant", "minecraft:kelp"] };
    check("Skrelp bites by kelp", M.spawnAllowed(sp, cast, bobber(0, 0, true), []));
    check("and not away from it", !M.spawnAllowed(sp, cast, bobber(0, 0, false), []));
}
{
    const sp = { ...base, fishVillage: true };
    check("a village fishing spawn does not bite far from any village", !M.spawnAllowed(sp, cast, bobber(5000, 5000), []));
}
