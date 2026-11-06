// Worldgen helpers for scripts/main.js, from Cobblemon's world package: the height range a jigsaw piece must stand in
// (HeightRangeStructureProcessor, which StructureMixin tests on every piece of a start), a gravity processor's offset
// to the ground (GravityProcessor on a rigid piece), and how many Pokemon Centers a village draws
// (CobblemonStructures.addPokecenters: weight 35 in each village's houses pool).
import { BlockVolume } from "@minecraft/server";

export const SEA_LEVEL = 63;   // the Overworld's sea level, the height_range processors' reference

// true when the piece carries no height range, or its bottom lies within sea level plus [min, max] (StructureMixin tests
// the piece's bounding box minY); a start with a piece outside is discarded (INVALID_START). Java's start stands on the
// heightmap, the air over the top block, where the port's box starts on the top block itself, so the box is a block low
export function heightRangeOk(piece, box) {
    const hr = piece?.hr;
    if (!hr || !box) return true;
    const bottom = box.y0 + 1;
    return bottom >= SEA_LEVEL + hr[0] && bottom <= SEA_LEVEL + hr[1];
}

// a pool entry's third field (jigsaw.js): 1 for a terrain_matching piece, which Java drapes with a GravityProcessor on
// the surface heightmap at offset -1 (its bottom layer on the top block); a negative number for a rigid piece whose own
// gravity processor names another offset (a sandpit clearing's -6 sinks its dip into the ground); the offset to the
// heightmap (the air over the top block) where the piece's bottom layer goes
export function groundOffset(flag) { return typeof flag === "number" && flag < 0 ? flag : -1; }

// vanilla's village/<type>/houses pools, about, which Cobblemon adds its center to at 35 and its two berry farms at 1 each
export const VILLAGE_HOUSES_WEIGHT = { plains: 86, desert: 71, savanna: 86, snowy: 66, taiga: 69 }, POKECENTER_WEIGHT = 35;

// how many centers a village gets beyond the one placed anyway: for each of its other houses, Java's chance that the
// house drawn from the pool is a center, at most four more
export function pokecenterRolls(kind, houses, rng = Math.random) {
    const share = POKECENTER_WEIGHT / ((VILLAGE_HOUSES_WEIGHT[kind] ?? VILLAGE_HOUSES_WEIGHT.plains) + POKECENTER_WEIGHT + 2);
    let more = 0;
    for (let n = 1; n < houses; n++) if (rng() < share) more++;
    return Math.min(more, 4);
}

// the village's houses, counted by its beds within 40 blocks of the bell (a bed is two blocks), 4 to 24
export function villageHouses(dim, bell) {
    let beds = 0;
    try {
        const volume = new BlockVolume({ x: bell.x - 40, y: bell.y - 12, z: bell.z - 40 }, { x: bell.x + 40, y: bell.y + 12, z: bell.z + 40 });
        for (const _ of dim.getBlocks(volume, { includeTypes: ["minecraft:bed"] }, true).getBlockLocationIterator()) beds++;
    } catch (e) { return 4; }
    return Math.max(4, Math.min(24, Math.round(beds / 2)));
}
