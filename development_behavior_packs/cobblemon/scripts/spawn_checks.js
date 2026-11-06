// Spawning and fishing checks kept apart from main.js: the parts of Cobblemon's spawner and Poke Rod bobber that a
// Bedrock spawn rule cannot make and that stand on their own (SpawningCondition, PokemonHerdSpawnDetail,
// PokeRodFishingBobberEntity, fishing/pokerod.json), each testable without the game.
import { world } from "@minecraft/server";

// A spawn entry's own drop table (PokemonSpawnDetail.drops: the Nether's Gastly drops ghast tears and spell tags, the
// End's Elgyem ender pearls and chorus fruit; a herd member's dropTable), kept on the Pokemon it spawned as data.js keeps
// a species' table, so that one drops instead (PokemonServerDelegate: entity.drops ?: form.drops)
export const ENTRY_DROPS = "cobblemon:drops";
export function markEntryDrops(entity, spawn) {
    if (!spawn?.drops) return;
    try { entity.setDynamicProperty(ENTRY_DROPS, JSON.stringify(spawn.drops)); } catch (e) { }
}
export function entryDrops(entity) {
    try { const table = entity.getDynamicProperty(ENTRY_DROPS); return table ? JSON.parse(table) : undefined; } catch (e) { return undefined; }
}

// A moonPhase condition ("0", "1-3", "0,4"; MoonPhaseRange, 0 the full moon) against the moon now: Basculin's stripes
// come by it, Clefable and Jellicent alphas under a full moon
export function moonPhaseOk(spec, phase) {
    if (spec === undefined || spec === null) return true;
    return String(spec).split(",").some((part) => { const [a, b] = part.split("-").map(Number); return b === undefined ? phase === a : phase >= a && phase <= b; });
}
export function currentMoonPhase() { try { return world.getMoonPhase(); } catch (e) { return 0; } }

// a value against [min, max], either bound open when null: minX and maxX (Shellos' East Sea from x 0, the West Sea west
// of it), minLight and maxLight (Venonat by a light at night, Misdreavus in the dark)
export function inBounds(value, bounds) {
    const [min, max] = bounds ?? [];
    return !(min !== null && min !== undefined && value < min) && !(max !== null && max !== undefined && value > max);
}

// PokeRodFishingBobberEntity.tickFishingLogic: the wait for a bite and the fish's approach run down by one a tick, by two
// on a quarter of the ticks it is raining on the bobber, and not at all on half the ticks the bobber cannot see the sky
export function fishStep(raining, sky, random = Math.random) {
    let i = 1;
    if (raining && random() < 0.25) i++;
    if (!sky && random() < 0.5) i--;
    return i;
}
// the bite when the roll said Pokemon but nothing in the pool can bite here (calculateMinMaxCountdown at the 50 weight
// it falls back to): a 17 to 30 tick window, and reeling in brings fishing.no_bite and nothing else
export const NO_BITE_HOOK = [17, 30], NO_BITE_TEXT = "Not even a nibble.";

// fishing/pokerod.json: junk 66, Cobblemon's treasure 17 and vanilla's treasure 17, the two treasure tables only with the
// bobber in open water (in_open_water); the roll is 0 to 100. Luck of the Sea changes none of it: the bobber builds its
// loot context without the luck parameter the tables' quality would read
export function rodLoot(open, roll) {
    if (!open) return "junk";
    return roll < 66 ? "junk" : roll < 83 ? "cobblemon" : "vanilla";
}
// FishingHook.isOpenOrWaterAround: the 5 by 5 columns about the bobber, from one block under it to two above, each layer
// wholly water (still, nothing standing in it) or wholly open (air or a lily pad), the layer under the bobber water and
// never water over open; a block the script cannot read counts as open water, as the hook starts out
const isWaterBlock = (b) => b.typeId === "minecraft:water" || b.typeId === "minecraft:kelp" || b.typeId === "minecraft:seagrass" || b.isWaterlogged === true;
export function isOpenWater(dim, at) {
    const x = Math.floor(at.x), y = Math.floor(at.y), z = Math.floor(at.z);
    let last = "none";
    for (let dy = -1; dy <= 2; dy++) {
        let layer;
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
            let b;
            try { b = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz }); } catch (e) { return true; }
            if (!b) return true;
            const kind = b.isAir || b.typeId === "minecraft:waterlily" ? "open" : isWaterBlock(b) ? "water" : "invalid";
            if (kind === "invalid" || (layer && layer !== kind)) return false;
            layer = kind;
        }
        if (layer === "open" && last === "none") return false;
        if (layer === "water" && last === "open") return false;
        last = layer;
    }
    return true;
}

// Spawner.calculateSpawnActionsForArea for a Poke Snack's spawner: it waits while the 3 by 3 chunks about it hold
// pokeSnackPokemonPerChunk (2) Pokemon a chunk, eighteen in all
export const SNACK_PER_AREA = 18;
