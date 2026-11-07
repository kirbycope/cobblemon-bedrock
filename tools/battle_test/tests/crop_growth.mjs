// Growing blocks: the crops' random-tick chances (Java's one in n per random tick, tripled for Bedrock's third as many),
// bone meal on the crops and bushes, Hearty Grains' two halves, saplings' two stages, apricorns, berry bushes broken
// ripe, mulch only before flowering, honey drips, and the wild berry groves' rates and ages
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { M, check } from "../harness.mjs";

const near = (a, b) => Math.abs(a - b) < 1e-9;
function withRandom(value, fn) { const random = Math.random; Math.random = () => value; try { return fn(); } finally { Math.random = random; } }
// a permutation of a block type, which a block set to it becomes (Block.setPermutation)
const perm = (states, id) => ({ type: { id }, getState: (k) => states[k], withState: (k, v) => perm({ ...states, [k]: v }, id) });

// a small world of blocks by position, lit as asked (block light, sky light)
function makeWorld(light = [15, 15]) {
    const blocks = new Map(), spawned = [];
    const dimension = {
        id: "minecraft:overworld",
        getBlock: ({ x, y, z }) => blocks.get(`${x},${y},${z}`) ?? put(x, y, z, "minecraft:air"),
        getLightLevel: () => light[0], getSkyLightLevel: () => light[1], getBiome: () => ({ id: "minecraft:plains" }),
        spawnItem: (item) => spawned.push([item.typeId, item.amount]), spawnParticle() { }, playSound() { },
    };
    function put(x, y, z, typeId, states = {}) {
        const b = { x, y, z, typeId, location: { x, y, z }, dimension, isValid: true, permutation: perm(states, typeId),
                    get isAir() { return b.typeId === "minecraft:air"; },
                    setPermutation(p) { b.permutation = p; if (p.type?.id) b.typeId = p.type.id; }, setType(t) { b.typeId = t; b.permutation = perm({}, t); },
                    above: () => dimension.getBlock({ x, y: y + 1, z }), below: () => dimension.getBlock({ x, y: y - 1, z }),
                    center: () => ({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }) };
        blocks.set(`${x},${y},${z}`, b);
        return b;
    }
    return { put, dimension, spawned, light };
}
const age = (b) => b.permutation.getState("cobblemon:age");
const keyOf = (b) => `${b.dimension.id}|${b.x}|${b.y}|${b.z}`;   // careKey, the position a sapling's stage is kept by

// the chances: Leek 3 in 4 with no light check (MedicinalLeekBlock), mints 3 in 8 with light 9 (MintBlock), Hearty
// Grains 3 in 16 with light 9 (HeartyGrainsBlock), Vivichoke and the Revival Herb the farmland formula with light 9
{
    const w = makeWorld();
    w.put(0, 63, 0, "minecraft:farmland", { moisturized_amount: 0 });
    const leek = w.put(5, 64, 5, "cobblemon:medicinal_leek_block", { "cobblemon:age": 0 });
    const mint = w.put(0, 64, 0, "cobblemon:red_mint", { "cobblemon:age": 0 });
    check("the Medicinal Leek grows 3 in 4 of Bedrock's random ticks (Java's 1 in 4)", near(M.cropGrowthChance(leek), 0.75), M.cropGrowthChance(leek));
    check("a mint grows 3 in 8 in the light (Java's 1 in 8)", near(M.cropGrowthChance(mint), 0.375), M.cropGrowthChance(mint));
    const grains = w.put(9, 64, 9, "cobblemon:hearty_grains_block", { "cobblemon:age": 0, "cobblemon:half": "lower" });
    check("Hearty Grains grow 3 in 16 (Java's 1 in 16)", near(M.cropGrowthChance(grains), 3 / 16), M.cropGrowthChance(grains));
    const herb = w.put(20, 64, 0, "cobblemon:revival_herb", { "cobblemon:age": 0 });
    w.put(20, 63, 0, "minecraft:farmland", { moisturized_amount: 0 });
    check("a Revival Herb on dry farmland grows 3 in 13 (Java's 1 in 25 / 2 + 1)", near(M.cropGrowthChance(herb), 3 / 13), M.cropGrowthChance(herb));
    w.put(20, 63, 0, "minecraft:farmland", { moisturized_amount: 7 });
    check("and on hydrated farmland 3 in 7 (1 in 25 / 4 + 1)", near(M.cropGrowthChance(herb), 3 / 7), M.cropGrowthChance(herb));
    const vivi = w.put(30, 64, 0, "cobblemon:vivichoke_seeds_block", { "cobblemon:age": 0 });
    w.put(30, 63, 0, "minecraft:farmland", { moisturized_amount: 7 });
    check("Vivichoke grows by the same formula (CropBlock): 3 in 7 on hydrated farmland", near(M.cropGrowthChance(vivi), 3 / 7), M.cropGrowthChance(vivi));
    w.put(31, 64, 0, "cobblemon:vivichoke_seeds_block", { "cobblemon:age": 0 }); w.put(30, 64, 1, "cobblemon:vivichoke_seeds_block", { "cobblemon:age": 0 });
    check("halved with the same crop beside it on both axes (1 in 25 / 2 + 1)", near(M.cropGrowthChance(vivi), 3 / 13), M.cropGrowthChance(vivi));
    w.light[0] = 4; w.light[1] = 8;
    check("in the dark (light under 9) the mints, Vivichoke and the herb do not grow", M.cropGrowthChance(mint) === 0 && M.cropGrowthChance(herb) === 0 && M.cropGrowthChance(vivi) === 0);
    check("but the Leek does", near(M.cropGrowthChance(leek), 0.75));
    w.light[1] = 9;
    check("sky light of 9 is light enough (getRawBrightness, the brighter of the two)", near(M.cropGrowthChance(mint), 0.375));
}

// cobblemon:grows, the registered component: an age on at the crop's chance, from the lower half of a tall crop
{
    const registered = {};
    M.registerModelBlockComponents({ registerCustomComponent: (name, c) => { registered[name] = c; } });
    const w = makeWorld();
    const leek = w.put(0, 64, 0, "cobblemon:medicinal_leek_block", { "cobblemon:age": 0 });
    withRandom(0.74, () => registered["cobblemon:grows"].onRandomTick({ block: leek }));
    withRandom(0.76, () => registered["cobblemon:grows"].onRandomTick({ block: leek }));
    check("the grows component ages a Leek at 0.74 and not at 0.76", age(leek) === 1, age(leek));
    const mint = w.put(2, 64, 0, "cobblemon:red_mint", { "cobblemon:age": 7 });
    withRandom(0, () => registered["cobblemon:grows"].onRandomTick({ block: mint }));
    check("a mint stops at age 7", age(mint) === 7);
}

// Hearty Grains (HeartyGrainsBlock.grow, canGrow, updateShape): two blocks from age 4, stopping at 3 with no room above;
// the upper broken sets the lower to 3, the lower broken takes the upper
{
    const w = makeWorld();
    const lower = w.put(0, 64, 0, "cobblemon:hearty_grains_block", { "cobblemon:age": 3, "cobblemon:half": "lower" });
    check("grains at age 3 grow to 4", M.growCrop(lower, 1) && age(lower) === 4);
    const upper = w.dimension.getBlock({ x: 0, y: 65, z: 0 });
    check("and stand two blocks tall, the upper half at the same age", upper.typeId === "cobblemon:hearty_grains_block" && upper.permutation.getState("cobblemon:half") === "upper" && age(upper) === 4);
    check("bone meal's three ages stop at the mature 6", M.growCrop(lower, 3) && age(lower) === 6 && age(upper) === 6);
    const broken = upper.permutation;
    upper.setType("minecraft:air");
    M.breakHeartyGrains(upper, broken);
    check("the ripe upper broken sets the lower back to age 3", age(lower) === 3, age(lower));
    const blocked = w.put(4, 64, 0, "cobblemon:hearty_grains_block", { "cobblemon:age": 3, "cobblemon:half": "lower" });
    w.put(4, 65, 0, "minecraft:stone");
    check("with no room above, grains at age 3 do not grow", !M.growCrop(blocked, 1) && age(blocked) === 3);
    const low2 = w.put(8, 64, 0, "cobblemon:hearty_grains_block", { "cobblemon:age": 5, "cobblemon:half": "lower" });
    const up2 = w.put(8, 65, 0, "cobblemon:hearty_grains_block", { "cobblemon:age": 5, "cobblemon:half": "upper" });
    const lowPerm = low2.permutation;
    low2.setType("minecraft:air");
    M.breakHeartyGrains(low2, lowPerm);
    check("the lower broken takes the upper with it", up2.typeId === "minecraft:air");
}

// apricorns ripen 3 in 5 of Bedrock's random ticks (ApricornBlock's 1 in 5); a sapling takes two successes, each 3 in 7
// with light 9 above it (SaplingBlock.advanceTree)
{
    const registered = {};
    M.registerApricornComponents({ registerCustomComponent: (name, c) => { registered[name] = c; } });
    const w = makeWorld();
    const fruit = w.put(0, 70, 0, "cobblemon:red_apricorn", { "cobblemon:age": 0 });
    withRandom(0.59, () => registered["cobblemon:apricorn"].onRandomTick({ block: fruit }));
    withRandom(0.61, () => registered["cobblemon:apricorn"].onRandomTick({ block: fruit }));
    check("an apricorn ripens at 0.59 and not at 0.61", age(fruit) === 1, age(fruit));
    let grown = 0;
    const sapling = w.put(3, 64, 3, "cobblemon:red_apricorn_sapling");
    check("a sapling's first success is its second stage", !M.advanceSapling(sapling, () => grown++) && grown === 0);
    check("and the next grows the tree", M.advanceSapling(sapling, () => grown++) && grown === 1);
    const dark = makeWorld([0, 0]), shaded = dark.put(0, 64, 0, "cobblemon:red_apricorn_sapling");
    withRandom(0, () => registered["cobblemon:apricorn_sapling"].onRandomTick({ block: shaded }));
    check("a sapling in the dark does not advance", !M.saplingStages().includes(keyOf(shaded)));
    const lit = makeWorld(), open = lit.put(10, 64, 0, "cobblemon:red_apricorn_sapling");
    withRandom(0.42, () => registered["cobblemon:apricorn_sapling"].onRandomTick({ block: open }));
    check("one in the light advances at 0.42 (under 3 in 7)", M.saplingStages().includes(keyOf(open)));
    M.setSaplingStaged(open, false);
    withRandom(0.43, () => registered["cobblemon:apricorn_sapling"].onRandomTick({ block: open }));
    check("and not at 0.43", !M.saplingStages().includes(keyOf(open)));
}

// berry bushes: bone meal at three fifths of the berry's chance (five Java ages in three stages), its mutation rolled
// as it comes into flower (stage 1 to 2), mulch only short of flowering, a ripe bush broken dropping its harvest
{
    check("bone meal on a bush is the berry's boneMealChance times 0.6", near(M.berryBoneMealChance({ boneMeal: 0.5 }), 0.3));
    const w = makeWorld();
    w.put(1, 64, 0, "cobblemon:cheri_berry_bush", { "cobblemon:stage": 0 });
    const bush = w.put(0, 64, 0, "cobblemon:oran_berry_bush", { "cobblemon:stage": 1, "cobblemon:mulch": "none" });
    M.setCare(bush, null);
    const grew = withRandom(0.01, () => M.bonemealBerry(bush, null));
    check("bone meal brings a bush into flower", grew && bush.permutation.getState("cobblemon:stage") === 2);
    check("and the flowering bush beside its partner rolls its mutation", M.careOf(bush).mut === "cobblemon:lum_berry", JSON.stringify(M.careOf(bush)));
    M.setCare(bush, null);
    const player = { onScreenDisplay: { setActionBar() { } }, getGameMode: () => "Survival", getComponent: () => undefined };
    for (const stage of [2, 3]) {
        bush.permutation = perm({ "cobblemon:stage": stage, "cobblemon:mulch": "none" });
        check(`mulch is refused at stage ${stage}`, !M.applyMulch(bush, player, "cobblemon:growth_mulch") && !M.careOf(bush).mulch);
    }
    bush.permutation = perm({ "cobblemon:stage": 1, "cobblemon:mulch": "none" });
    check("and taken before flowering", M.applyMulch(bush, player, "cobblemon:growth_mulch") && M.careOf(bush).mulch === "growth_mulch");
    M.setCare(bush, null);
    const ripe = perm({ "cobblemon:stage": 3, "cobblemon:mulch": "none" });
    w.spawned.length = 0;
    M.breakBerryBush(bush, { type: { id: "cobblemon:oran_berry_bush" }, getState: ripe.getState }, player);
    const dropped = w.spawned.reduce((n, [, c]) => n + c, 0);
    check("a ripe bush broken drops its harvest (the yield, 2 to 4 Oran Berries)", dropped >= 2 && dropped <= 4 && w.spawned.every(([id]) => id === "cobblemon:oran_berry"), JSON.stringify(w.spawned));
    w.spawned.length = 0;
    M.breakBerryBush(bush, { type: { id: "cobblemon:oran_berry_bush" }, getState: ripe.getState }, { getGameMode: () => "Creative" });
    check("but not in Creative", w.spawned.length === 0);
    const flowering = perm({ "cobblemon:stage": 2 });
    M.breakBerryBush(bush, { type: { id: "cobblemon:oran_berry_bush" }, getState: flowering.getState }, player);
    check("nor short of ripe", w.spawned.length === 0);
}
// the bush's own loot table gives the berry only at stage 0 (loot_table/blocks/<berry>.json, age 0)
const pack = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "development_behavior_packs", "cobblemon");
{
    const bush = JSON.parse(readFileSync(join(pack, "blocks", "oran_berry_bush.json"), "utf-8"))["minecraft:block"];
    const loot = bush.permutations.map((p) => p.components["minecraft:loot"]);
    check("a bush's table drops the berry at stage 0 and nothing after", loot[0].endsWith("oran_berry_bush.json") && loot.slice(1).every((l) => l === "loot_tables/empty.json"), loot.join());
}

// honey: SaccharineLeafBlock's one in two a Java random tick is 1 - 0.5^3 a Bedrock one
{
    const blocks = new Map(), dimension = { getBlock: ({ y }) => blocks.get(y) };
    const leaf = (y, a) => { const b = { x: 0, y, z: 0, typeId: "cobblemon:saccharine_leaves", dimension, isValid: true, age: a,
        permutation: { getState: () => b.age, withState: (k, v) => ({ age: v }) }, setPermutation(p) { b.age = p.age; } }; blocks.set(y, b); return b; };
    const top = leaf(10, 2), under = leaf(9, 0);
    withRandom(0.87, () => M.honeyDrip(top));
    check("a honeyed leaf drips at 0.87 (under 0.875)", top.age === 1 && under.age === 1);
    withRandom(0.88, () => M.honeyDrip(top));
    check("and not at 0.88", top.age === 1 && under.age === 1);
}

// wild groves: every overworld biome a berry grows in has one rule at one chunk in 25 picking a grove by weight, and a
// bush comes up at stages 1, 2 and 3 about 50:34:16 (ClampedNormalInt.of(4, 1, 3, 5), truncated)
{
    const tags = JSON.parse(readFileSync(join(pack, "..", "..", "tools", "bedrock_biome_tags.json"), "utf-8"));
    const holds = (r, t) => r.any_of ? r.any_of.some((x) => holds(x, t)) : r.all_of ? r.all_of.every((x) => holds(x, t)) : (t.includes(r.value) === (r.operator !== "!="));
    const rules = readdirSync(join(pack, "feature_rules")).filter((f) => f.startsWith("berry_grove")).map((f) => JSON.parse(readFileSync(join(pack, "feature_rules", f), "utf-8"))["minecraft:feature_rules"]);
    const overworld = Object.entries(tags).filter(([, t]) => t.includes("overworld"));
    const counts = overworld.map(([b, t]) => [b, rules.filter((r) => holds(r.conditions["minecraft:biome_filter"], t))]);
    check("each overworld biome has exactly one grove rule", counts.every(([, rs]) => rs.length === 1), counts.filter(([, rs]) => rs.length !== 1).map(([b, rs]) => `${b}:${rs.length}`).join());
    check("at one chunk in 25", rules.every((r) => r.distribution.scatter_chance.numerator === 1 && r.distribution.scatter_chance.denominator === 25));
    const plains = counts.find(([b]) => b === "plains")[1][0];
    const pick = JSON.parse(readFileSync(join(pack, "features", `${plains.description.places_feature.split(":")[1]}.json`), "utf-8"))["minecraft:weighted_random_feature"].features;
    check("the plains pick Cheri and Wepear among their berries by weight (20 and 15)", pick.some(([f, wt]) => f === "cobblemon:berry_grove_cheri_berry" && wt === 20) && pick.some(([f, wt]) => f === "cobblemon:berry_grove_wepear_berry" && wt === 15), JSON.stringify(pick));
    const ages = JSON.parse(readFileSync(join(pack, "features", "berry_cheri_berry.json"), "utf-8"))["minecraft:weighted_random_feature"].features;
    check("a wild bush is mature, flowering or ripe at 50:34:16", JSON.stringify(ages) === JSON.stringify([["cobblemon:berry_cheri_berry_1", 50], ["cobblemon:berry_cheri_berry_2", 34], ["cobblemon:berry_cheri_berry_3", 16]]), JSON.stringify(ages));
}
