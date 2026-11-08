// Decor and redstone blocks: the Terrain Seeds and the plants they grow into (TerrainSeedBlock, TerrainPlantBlock,
// TerrainPlantBlockEntity, MistleafFlowerBlockEntity), the Metronome, Eject Button and Ring Target
// (ActivatableDecorationBlock, EjectButtonBlock, RingTargetBlock), the Damaged Monitor's screen (DamagedMonitorBlock),
// the Galarica nut bush's tangle (NutBushBlock.entityInside), Wistensu and Pauvillea (WistensuFlowerHeadBlock,
// PauvilleaFlowerBlock), the washing of a honeyed Saccharine log (SaccharineLogSlatheredBlock), the campfire pot's lid
// under redstone (CampfireBlock.neighborChanged) and the Revival Herb's mutation (RevivalHerbBlock.applyMulch).
// port.py gives each block its states and components (create_terrain_seeds, add_decor_components); main.js registers
// these with registerDecorComponents and lends the hand helpers it already has.
import { world, system, BlockPermutation, EntityComponentTypes, ItemStack } from "@minecraft/server";

let H = {};   // main.js's helpers: consumeHand, damageHeld, giveOrDrop, pickApricorn, weatherIn, unslather
const STEPS = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
function handId(player) { try { return player?.getComponent(EntityComponentTypes.Inventory)?.container?.getItem(player.selectedSlotIndex)?.typeId; } catch (e) { return undefined; } }
function state(block, name) { try { return block.permutation.getState(name); } catch (e) { return undefined; } }
function neighbour(block, direction) { const [dx, dy, dz] = STEPS[direction] ?? [0, 0, 0]; try { return block.dimension.getBlock({ x: block.x + dx, y: block.y + dy, z: block.z + dz }); } catch (e) { return undefined; } }
function playAt(block, sound) { try { block.dimension.playSound(sound, { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }); } catch (e) { } }
function growthPuff(block) { try { block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center()); } catch (e) { } }
// a solid block to hang from or stand against: not air, not a liquid
function solid(block) { return !!block && !block.isAir && !block.isLiquid; }
// hasNeighborSignal: redstone power reaching the block from any side
function redstonePowered(block) {
    for (const b of [block, ...Object.keys(STEPS).map((d) => neighbour(block, d))]) {
        try { if ((b?.getRedstonePower() ?? 0) > 0) return true; } catch (e) { }
    }
    return false;
}
// a block destroyed with its drops, as Level.destroyBlock(pos, true) does
function destroy(block) { try { block.dimension.runCommand(`setblock ${block.x} ${block.y} ${block.z} air destroy`); } catch (e) { } }

// ---------------------------------------------------------------------------
// Terrain Seeds (TerrainSeedBlock): an Electric, Psychic, Misty or Grassy Seed planted on farmland grows through ages 0
// to 3 and at 4 becomes Voltaconia, Lucibell, Mistleaf or Verdroot; from age 2 it stands two blocks tall, the lower
// half carrying the upper along. A random tick grows it one age one time in 32 where the light is 9 or more (Bedrock's
// random ticks come a third as often as Java's, so three in 32 here), and bone meal one age (getBonemealAgeIncrease).
// ---------------------------------------------------------------------------
export const TERRAIN_SEEDS = { "cobblemon:electric_seed": "cobblemon:voltaconia", "cobblemon:psychic_seed": "cobblemon:lucibell", "cobblemon:misty_seed": "cobblemon:mistleaf", "cobblemon:grassy_seed": "cobblemon:verdroot" };
export const TERRAIN_PLANTS = new Set(Object.values(TERRAIN_SEEDS));
const SEED_MATURE_AGE = 4;
// the lower half of a seed crop or a terrain plant: the block itself, or the one under an upper half
export function lowerHalf(block) {
    if (state(block, "cobblemon:half") !== "upper") return block;
    const below = block.below();
    return below?.typeId === block.typeId && state(below, "cobblemon:half") === "lower" ? below : undefined;
}
// TerrainSeedBlock.grow: steps ages on, to the plant at the mature age; false when it cannot grow (canGrow: short of
// the mature age, on farmland, and for the swap to the plant with air or its own upper half above)
export function growTerrainSeed(block, steps = 1) {
    const plant = TERRAIN_SEEDS[block?.typeId], lower = plant && lowerHalf(block);
    if (!lower || (lower.below()?.typeId ?? "") !== "minecraft:farmland") return false;
    const age = state(lower, "cobblemon:age") ?? 0;
    if (age >= SEED_MATURE_AGE) return false;
    const next = Math.min(age + steps, SEED_MATURE_AGE), above = lower.above();
    const room = !!above && (above.isAir || above.typeId === lower.typeId);
    if (next >= SEED_MATURE_AGE) {
        if (!room) return false;
        lower.setPermutation(BlockPermutation.resolve(plant, { "cobblemon:half": "lower" }));
        above.setPermutation(BlockPermutation.resolve(plant, { "cobblemon:half": "upper" }));
        return true;
    }
    lower.setPermutation(lower.permutation.withState("cobblemon:age", next));
    if (next >= 2 && room) above.setPermutation(BlockPermutation.resolve(lower.typeId, { "cobblemon:age": next, "cobblemon:half": "upper" }));
    return true;
}
// CropBlock.hasSufficientLight: the brightest of sky and block light at the crop, 9 or more
export function litEnough(block) {
    let light = 0;
    try { light = Math.max(block.dimension.getLightLevel(block.location), block.dimension.getSkyLightLevel(block.location)); } catch (e) { light = 15; }
    return light >= 9;
}
// a seed crop or terrain plant broken by a player takes its other half with it: the lower broken, the upper goes with
// no drop (its loot is empty); the upper broken, the lower is destroyed with its drops (updateShape's destroyBlock),
// or in Creative removed quietly (preventDropFromBottomPart)
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation, player }) => {
    const id = brokenBlockPermutation?.type?.id;
    if (!TERRAIN_SEEDS[id] && !TERRAIN_PLANTS.has(id)) return;
    let half; try { half = brokenBlockPermutation.getState("cobblemon:half"); } catch (e) { return; }
    const other = half === "lower" ? block.above() : block.below();
    if (other?.typeId !== id || state(other, "cobblemon:half") === half) return;
    if (half === "lower" || player?.getGameMode?.() === "Creative") other.setType("minecraft:air"); else destroy(other);
});
// a terrain plant placed by a player stands up its upper half (DoublePlantBlock.setPlacedBy)
world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (!TERRAIN_PLANTS.has(block.typeId) || state(block, "cobblemon:half") !== "lower") return;
    const above = block.above();
    if (above?.isAir) try { above.setPermutation(BlockPermutation.resolve(block.typeId, { "cobblemon:half": "upper" })); } catch (e) { }
});

// ---------------------------------------------------------------------------
// The terrain plants' glow (TerrainPlantBlockEntity.serverTick, MistleafFlowerBlockEntity.serverTick): Voltaconia glows
// (light 8) in a thunderstorm, Verdroot (light 5) in rain that is not a thunderstorm, Lucibell (light 8) while an entity
// stands in it, and Mistleaf at night by the moon's phase, glowing 1 at the new moon rising through the odd numbers
// to 8 at the full moon and falling through the evens back to 2, its light glowing + 2 and a comparator reading
// glowing. The lower half decides and the upper follows.
// ---------------------------------------------------------------------------
const MISTLEAF_BY_PHASE = [8, 6, 4, 2, 1, 3, 5, 7];   // by Minecraft's moon phase number, the full moon 0 to the waxing gibbous 7
export function mistleafGlow(time, phase) {
    const t = ((time % 24000) + 24000) % 24000;
    return t >= 12542 && t <= 23459 ? MISTLEAF_BY_PHASE[phase] ?? 0 : 0;
}
// Lucibell: anything standing in the plant's two blocks (TerrainPlantBlock.checkInside over its shape, a 12 by 12
// column), by where its feet are
function entityInside(lower) {
    let entities = [];
    try { entities = lower.dimension.getEntities({ location: { x: lower.x + 0.5, y: lower.y + 1, z: lower.z + 0.5 }, maxDistance: 2.5 }); } catch (e) { return false; }
    return entities.some((e) => {
        const p = e.location;
        return p.x > lower.x - 0.2 && p.x < lower.x + 1.2 && p.z > lower.z - 0.2 && p.z < lower.z + 1.2 && p.y > lower.y - 0.4 && p.y < lower.y + 2;
    });
}
export function terrainPlantGlow(lower) {
    switch (lower.typeId) {
        case "cobblemon:voltaconia": return H.weatherIn?.(lower.dimension) === "Thunder";
        case "cobblemon:verdroot": return H.weatherIn?.(lower.dimension) === "Rain";
        case "cobblemon:lucibell": return entityInside(lower);
        case "cobblemon:mistleaf": { let time = 0, phase = 0; try { time = world.getTimeOfDay(); phase = world.getMoonPhase(); } catch (e) { } return mistleafGlow(time, phase); }
    }
    return false;
}
function terrainPlantTick(block) {
    if (state(block, "cobblemon:half") !== "lower") return;
    const wanted = terrainPlantGlow(block);
    if (wanted === state(block, "cobblemon:glowing")) return;
    const above = block.above();
    try { block.setPermutation(block.permutation.withState("cobblemon:glowing", wanted)); } catch (e) { return; }
    if (above?.typeId === block.typeId) try { above.setPermutation(above.permutation.withState("cobblemon:glowing", wanted)); } catch (e) { }
}

// ---------------------------------------------------------------------------
// Redstone decorations. The Metronome (ActivatableDecorationBlock) swings when clicked and stops when clicked again, and
// a comparator reads 4 while it swings. The Eject Button (EjectButtonBlock, an iron button) stays pressed 40 ticks. The
// Ring Target (RingTargetBlock, a TargetBlock) powers 1 to 15 by how near its centre a projectile strikes, for 8 ticks
// (an arrow's 20), and takes no new hit meanwhile.
// ---------------------------------------------------------------------------
const EJECT_PRESSED_TICKS = 40;
export function pressEjectButton(block) {
    if (state(block, "cobblemon:powered")) return false;
    const type = block.typeId, where = block.location, dim = block.dimension;
    block.setPermutation(block.permutation.withState("cobblemon:powered", true));
    playAt(block, "random.click");
    system.runTimeout(() => {
        let b; try { b = dim.getBlock(where); } catch (e) { return; }
        if (b?.typeId !== type) return;
        try { b.setPermutation(b.permutation.withState("cobblemon:powered", false)); } catch (e) { }
        playAt(b, "random.click");
    }, EJECT_PRESSED_TICKS);
    return true;
}
// TargetBlock.getRedstoneStrength: the hit's distance from the face's centre on the two axes across it, 15 at the
// middle down to 1 at the edge
export function targetPower(hit, face) {
    const d = (v) => Math.abs(v - Math.floor(v) - 0.5);
    const axis = { up: "y", down: "y", north: "z", south: "z", east: "x", west: "x" }[String(face).toLowerCase()] ?? "z";
    const far = axis === "y" ? Math.max(d(hit.x), d(hit.z)) : axis === "z" ? Math.max(d(hit.x), d(hit.y)) : Math.max(d(hit.y), d(hit.z));
    return Math.max(1, Math.ceil(15 * Math.min(1, Math.max(0, (0.5 - far) / 0.5))));
}
const targetResets = new Set();   // ring targets powered now, by position
world.afterEvents.projectileHitBlock.subscribe((event) => {
    let hit; try { hit = event.getBlockHit(); } catch (e) { return; }
    const block = hit?.block;
    if (block?.typeId !== "cobblemon:ring_target_block") return;
    const key = `${event.dimension?.id}|${block.x},${block.y},${block.z}`;
    if (targetResets.has(key)) return;
    const power = targetPower(event.location ?? { x: 0.5, y: 0.5, z: 0.5 }, hit.face);
    try { block.setPermutation(block.permutation.withState("cobblemon:power", power)); } catch (e) { return; }
    targetResets.add(key);
    const where = block.location, dim = block.dimension;
    system.runTimeout(() => {
        targetResets.delete(key);
        let b; try { b = dim.getBlock(where); } catch (e) { return; }
        if (b?.typeId === "cobblemon:ring_target_block") try { b.setPermutation(b.permutation.withState("cobblemon:power", 0)); } catch (e) { }
    }, event.projectile?.typeId === "minecraft:arrow" ? 20 : 8);
});

// DamagedMonitorBlock.neighborChanged: redstone power turns the screen to glitching (light 10), its loss turns it off
function damagedMonitorTick(block) {
    const wanted = redstonePowered(block) ? "glitching" : "off";
    if (state(block, "cobblemon:screen") !== wanted) try { block.setPermutation(block.permutation.withState("cobblemon:screen", wanted)); } catch (e) { }
}

// NutBushBlock.entityInside: a living thing in the bush is slowed (makeStuckInBlock at 0.8 of its speed), but not a
// fox or a bee. Bedrock cannot slow by block, so Slowness I for the moment it stands in it, checked every half second
export function tangleInBush(block) {
    let entities = [];
    try { entities = block.dimension.getEntities({ location: { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }, maxDistance: 1.5 }); } catch (e) { return; }
    for (const e of entities) {
        if (e.typeId === "minecraft:fox" || e.typeId === "minecraft:bee") continue;
        const p = e.location;
        if (p.x < block.x - 0.3 || p.x > block.x + 1.3 || p.z < block.z - 0.3 || p.z > block.z + 1.3 || p.y < block.y - 0.5 || p.y > block.y + 1) continue;
        try { if (!e.getComponent(EntityComponentTypes.Health)) continue; e.addEffect("slowness", 12, { amplifier: 0, showParticles: false }); } catch (err) { }
    }
}

// ---------------------------------------------------------------------------
// Wistensu (WistensuFlowerHeadBlock, a GrowingPlantHeadBlock growing down): placed under a ceiling or on a wall it is
// the root (facing the way it hangs from, a floor placement hanging from the block above), or under another Wistensu
// its next link. The head grows a block down one random tick in ten (three in ten of Bedrock's), the old head becoming
// the vine (WISTENSU_VINE), to Java's 25 links; bone meal grows several at once with a 0.826 falloff
// (getBlocksToGrowWhenBonemealed). A link broken takes the hanging part below with it.
// ---------------------------------------------------------------------------
const WISTENSU = "cobblemon:wistensu", WISTENSU_VINE = "cobblemon:wistensu_vine", WISTENSU_MAX_AGE = 25;
const isWistensu = (block) => block?.typeId === WISTENSU || block?.typeId === WISTENSU_VINE;
export function wistensuSurvives(block, facing, root) {
    if (root) return solid(neighbour(block, OPPOSITE[facing] ?? "up"));
    return isWistensu(block.above());
}
// WistensuFlowerBlock.adjustStateForPlacement: under a Wistensu it hangs from it; else it roots on the face clicked, a
// floor placement hanging from the block above
export function wistensuPlacement(block, face) {
    if (isWistensu(block.above())) return { facing: "down", root: false };
    let facing = String(face ?? "down").toLowerCase();
    if (facing === "up") facing = "down";
    return { facing, root: true };
}
export function growWistensu(block) {
    if (block?.typeId !== WISTENSU) return false;
    const below = block.below();
    if (!below?.isAir) return false;
    let links = 0;
    for (let b = block.above(); b?.typeId === WISTENSU_VINE && links < WISTENSU_MAX_AGE; b = b.above()) links++;
    if (links >= WISTENSU_MAX_AGE) return false;
    const facing = state(block, "cobblemon:facing") ?? "down", root = !!state(block, "cobblemon:root");
    try {
        below.setPermutation(BlockPermutation.resolve(WISTENSU, { "cobblemon:facing": "down", "cobblemon:root": false }));
        block.setPermutation(BlockPermutation.resolve(WISTENSU_VINE, { "cobblemon:facing": facing, "cobblemon:root": root }));
    } catch (e) { return false; }
    return true;
}
export function bonemealLinks(random = Math.random) {
    let d = 1, n = 0;
    while (random() < d) { d *= 0.826; n++; }
    return n;
}
world.afterEvents.playerBreakBlock.subscribe(({ block, brokenBlockPermutation }) => {
    const id = brokenBlockPermutation?.type?.id;
    if (id !== WISTENSU && id !== WISTENSU_VINE) return;
    for (let b = block.below(); isWistensu(b) && !state(b, "cobblemon:root"); b = b.below()) destroy(b);
});

// PauvilleaFlowerBlock: placed on the face clicked (a ceiling, a wall or a floor), it needs a full block behind it;
// bone meal pops a copy of it (performBonemeal)
export function pauvilleaPlacement(block, face) {
    const facing = String(face ?? "down").toLowerCase();
    return solid(neighbour(block, OPPOSITE[facing] ?? "up")) ? facing : undefined;
}

// ---------------------------------------------------------------------------
// A honeyed Saccharine log (SaccharineLogSlatheredBlock): a water bottle used on its honeyed side washes it back to a
// plain log, the bottle handed back empty, with a swim sound and a splash on that side; water touching that side does
// the same (neighborChanged, checked every second or two)
// ---------------------------------------------------------------------------
const SLATHERED = "cobblemon:saccharine_log_slathered";
export function washSlathered(block) {
    const facing = state(block, "minecraft:cardinal_direction") ?? "north";
    try { block.setPermutation(BlockPermutation.resolve("cobblemon:saccharine_log")); } catch (e) { return false; }
    playAt(block, "random.swim");
    const [sx, , sz] = STEPS[facing] ?? [0, 0, -1];
    for (let n = 0; n < 12; n++) {
        try { block.dimension.spawnParticle("minecraft:water_splash_particle_manual", { x: block.x + 0.5 + sx * 0.55 + (sx ? 0 : Math.random() - 0.5), y: block.y + Math.random(), z: block.z + 0.5 + sz * 0.55 + (sz ? 0 : Math.random() - 0.5) }); } catch (e) { }
    }
    H.unslather?.(block);
    return true;
}
function slatheredTick(block) {
    const front = neighbour(block, state(block, "minecraft:cardinal_direction") ?? "north");
    if (front?.isLiquid && /water/.test(front.typeId)) washSlathered(block);
}
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { block, player, itemStack, blockFace, isFirstEvent } = event;
    // a Bedrock script cannot tell a water bottle from another drinkable potion, so any potion washes it
    if (block?.typeId !== SLATHERED || itemStack?.typeId !== "minecraft:potion") return;
    if (String(blockFace ?? "").toLowerCase() !== (state(block, "minecraft:cardinal_direction") ?? "north")) return;
    event.cancel = true;
    if (!isFirstEvent) return;
    system.run(() => {
        if (!block.isValid || block.typeId !== SLATHERED || !washSlathered(block)) return;
        if (player.getGameMode?.() === "Creative") return;
        H.consumeHand?.(player); H.giveOrDrop?.(player, "minecraft:glass_bottle");
    });
});

// ApricornBlock.attack: a left-click on a ripe apricorn harvests it as a right-click does
world.afterEvents.entityHitBlock.subscribe(({ damagingEntity, hitBlock }) => {
    if (damagingEntity?.typeId !== "minecraft:player" || !/^cobblemon:[a-z]+_apricorn$/.test(hitBlock?.typeId ?? "") || state(hitBlock, "cobblemon:age") !== 3) return;
    try { H.pickApricorn?.(hitBlock, hitBlock.dimension); hitBlock.setPermutation(hitBlock.permutation.withState("cobblemon:age", 0)); } catch (e) { return; }
    playAt(hitBlock, "cobblemon.block.apricorn.harvest");
});

// CampfireBlock.neighborChanged: redstone power shuts the pot's lid and its loss opens it again (toggleLid(!isPowered)),
// each with the lid's sound; checked every half second, since a block gets no word of its neighbours. The power last
// seen is kept here rather than in a block state, which would double the pots' permutations; a pot first seen (placed,
// or the world just loaded) only has its power noted, so the lid moves on a change, as neighborChanged does
const potPower = new Map();   // "dimension|x,y,z" -> powered
export function potRedstone(block) {
    const key = `${block.dimension.id}|${block.x},${block.y},${block.z}`, powered = redstonePowered(block), was = potPower.get(key);
    potPower.set(key, powered);
    if (was === undefined || powered === was) return false;
    try { block.setPermutation(block.permutation.withState("cobblemon:lid", powered)); } catch (e) { return false; }
    playAt(block, powered ? "cobblemon.block.campfire_pot.close" : "cobblemon.block.campfire_pot.open");
    return true;
}

// RevivalHerbBlock.applyMulch: Surprise Mulch on a herb at age 6 or under with no mutation yet gives it one, Mental,
// Power, White or Mirror, and the grown herb drops that herb (loot_table/blocks/revival_herb.json)
export const HERB_MUTATIONS = ["mental", "power", "white", "mirror"], HERB_MUTABLE_MAX_AGE = 6;
export function mutateHerb(block, random = Math.random) {
    if ((state(block, "cobblemon:age") ?? 0) > HERB_MUTABLE_MAX_AGE || (state(block, "cobblemon:mutation") ?? "none") !== "none") return false;
    try { block.setPermutation(block.permutation.withState("cobblemon:mutation", HERB_MUTATIONS[Math.floor(random() * HERB_MUTATIONS.length)])); } catch (e) { return false; }
    return true;
}

export function registerDecorComponents(registry, helpers = {}) {
    H = helpers;
    registry.registerCustomComponent("cobblemon:terrain_seed", {
        onRandomTick({ block }) { if (state(block, "cobblemon:half") === "lower" && litEnough(block) && Math.random() < 3 / 32) growTerrainSeed(block); },
        onPlayerInteract({ block, player }) {
            if (handId(player) !== "minecraft:bone_meal" || !growTerrainSeed(block, 1)) return;
            H.consumeHand?.(player); growthPuff(block);
        }
    });
    registry.registerCustomComponent("cobblemon:terrain_plant", {
        beforeOnPlayerPlace(event) { if (!event.block.above()?.isAir) event.cancel = true; },
        onTick({ block }) { terrainPlantTick(block); }
    });
    registry.registerCustomComponent("cobblemon:activatable", {
        onPlayerInteract({ block }) { try { block.setPermutation(block.permutation.withState("cobblemon:active", !state(block, "cobblemon:active"))); } catch (e) { } }
    });
    registry.registerCustomComponent("cobblemon:eject_button", { onPlayerInteract({ block }) { pressEjectButton(block); } });
    registry.registerCustomComponent("cobblemon:damaged_monitor", { onTick({ block }) { damagedMonitorTick(block); } });
    registry.registerCustomComponent("cobblemon:wistensu", {
        beforeOnPlayerPlace(event) {
            const { facing, root } = wistensuPlacement(event.block, event.face);
            if (!wistensuSurvives(event.block, facing, root)) { event.cancel = true; return; }
            try { event.permutationToPlace = event.permutationToPlace.withState("cobblemon:facing", facing).withState("cobblemon:root", root); } catch (e) { }
        },
        onRandomTick({ block }) { if (Math.random() < 0.3) growWistensu(block); },
        onPlayerInteract({ block, player }) {
            if (handId(player) !== "minecraft:bone_meal") return;
            let head = block, grown = 0;
            for (let n = bonemealLinks(); n > 0 && head && growWistensu(head); n--) { head = head.below(); grown++; }
            if (!grown) return;
            H.consumeHand?.(player); growthPuff(block);
        }
    });
    registry.registerCustomComponent("cobblemon:pauvillea", {
        beforeOnPlayerPlace(event) {
            const facing = pauvilleaPlacement(event.block, event.face);
            if (!facing) { event.cancel = true; return; }
            try { event.permutationToPlace = event.permutationToPlace.withState("cobblemon:facing", facing); } catch (e) { }
        },
        onPlayerInteract({ block, player }) {
            if (handId(player) !== "minecraft:bone_meal") return;
            try { block.dimension.spawnItem(new ItemStack("cobblemon:pauvillea", 1), block.center()); } catch (e) { return; }
            H.consumeHand?.(player); growthPuff(block);
        }
    });
    registry.registerCustomComponent("cobblemon:slathered_log", { onTick({ block }) { slatheredTick(block); } });
    registry.registerCustomComponent("cobblemon:campfire_pot", { onTick({ block }) { potRedstone(block); } });
    registry.registerCustomComponent("cobblemon:herb_mutation", {
        onPlayerInteract({ block, player }) {
            if (handId(player) !== "cobblemon:surprise_mulch" || !mutateHerb(block)) return;
            H.consumeHand?.(player);
            playAt(block, "cobblemon.block.mulch.place"); growthPuff(block);
        }
    });
}
