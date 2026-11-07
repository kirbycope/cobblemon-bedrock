// Alpha herds (spawn_pool_world/herds, bucket boss): their seed asks for an alpha herd, and its leader is made an alpha
// holding its gem; an alpha's level near a player (AlphaLevelMatchingSensor), and how a herd is filled (its members'
// spots, the seed that cannot start one, the roles) and followed (HerdBehaviour's alpha leaders, the follow distance)
import { readFileSync, readdirSync } from "node:fs";
import { M, mon, check, flush } from "../harness.mjs";

const herdsJs = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/herds.js", import.meta.url), "utf-8");
const HERDS = JSON.parse(herdsJs.slice(herdsJs.indexOf("[")).trim().replace(/;$/, ""));

{
    const plain = M.herdSeedOf("cobblemon:herd_seed"), form = M.herdSeedOf("cobblemon:herd_seed_alolan");
    const alpha = M.herdSeedOf("cobblemon:herd_seed_alpha"), alphaForm = M.herdSeedOf("cobblemon:herd_seed_alpha_hisuian");
    check("a plain seed asks for a plain herd", !plain.alpha && plain.form === null);
    check("a form's seed keeps its form", !form.alpha && form.form === "cobblemon:spawn_form_alolan");
    check("an alpha seed asks for an alpha herd", alpha.alpha && alpha.form === null);
    check("and keeps a form too", alphaForm.alpha && alphaForm.form === "cobblemon:spawn_form_hisuian");
}
{
    const leader = mon("Venusaur", { level: 40 }), follower = mon("Bulbasaur", { level: 12 });
    M.dressHerdMember(leader.entity, { alpha: true, held: "cobblemon:grass_gem" });
    M.dressHerdMember(follower.entity, {});
    check("the alpha leader is an alpha", M.isAlpha(leader.entity));
    check("holding its gem", leader.entity.getDynamicProperty("cobblemon:held") === "cobblemon:grass_gem");
    check("a follower is neither", !M.isAlpha(follower.entity) && !follower.entity.getDynamicProperty("cobblemon:held"));
}
{
    const alphas = HERDS.filter((h) => h.boss);
    check("the alpha herds are carried", alphas.length > 900, String(alphas.length));
    check("each with an alpha among its members", alphas.every((h) => h.members.some((m) => m.alpha)));
    check("and the plain herds have none", HERDS.filter((h) => !h.boss).every((h) => !h.members.some((m) => m.alpha)));
}
{
    // an alpha herd's seed spawns from Cobblemon's boss bucket (best-spawner-config's 0.3 of 100): port.py's
    // normalise_weights gives it that share of a spot's pool (SPAWN_POOL 50000, so at most 150) over the boss entries of
    // its biomes, and it never outweighs the species' common spawn as it did when one total was split across buckets by
    // raw weight (Tsareena's alpha herd 60, its common spawn 19; issue 61's herds everywhere). In the jungle the two come
    // out alike in Cobblemon too: 0.3 times 100 over the boss bucket's raw weights, 94 times 0.1 over the common ones
    const dir = new URL("../../../development_behavior_packs/cobblemon/spawn_rules/", import.meta.url);
    let alpha = 0, total = 0;
    const heavy = [];
    for (const name of readdirSync(dir)) {
        const rules = JSON.parse(readFileSync(new URL(name, dir), "utf-8"))["minecraft:spawn_rules"];
        if (rules.description.population_control !== "animal") continue;
        for (const c of rules.conditions) {
            const w = c["minecraft:weight"].default;
            total += w;
            if (c["minecraft:herd"]?.event?.startsWith("cobblemon:herd_seed_alpha")) { alpha += w; if (w > 150) heavy.push(`${name} ${w}`); }
        }
    }
    check("an alpha herd's seed carries at most the boss bucket's 150 of a spot's 50000", total > 0 && heavy.length === 0, heavy.slice(0, 5).join(", "));
    check("alpha herds are under half a percent of the land pool", alpha > 0 && alpha / total < 0.005, `${(100 * alpha / total).toFixed(2)}%`);
    const tsareena = JSON.parse(readFileSync(new URL("0763_tsareena.json", dir), "utf-8"))["minecraft:spawn_rules"].conditions;
    const weightOf = (test) => tsareena.find(test)?.["minecraft:weight"].default ?? 0;
    check("Tsareena's alpha herd's seed is no heavier than its common spawn", weightOf((c) => !c["minecraft:herd"]?.event) >= weightOf((c) => c["minecraft:herd"]?.event === "cobblemon:herd_seed_alpha"));
}
{
    // AlphaLevelMatchingSensor.getTargetLevel: the strongest party Pokemon's level plus 4 to 20 by band, at most 100 and
    // at least minimumEvolutionLevel, the level its pre-evolution evolves into it at
    const venusaur = mon("Venusaur").entity, ivysaur = mon("Ivysaur").entity, bulbasaur = mon("Bulbasaur").entity;
    check("an alpha's floor is the level it evolves at: Venusaur 32, Ivysaur 16, Bulbasaur 1", M.alphaFloor(venusaur) === 32 && M.alphaFloor(ivysaur) === 16 && M.alphaFloor(bulbasaur) === 1, [M.alphaFloor(venusaur), M.alphaFloor(ivysaur), M.alphaFloor(bulbasaur)].join());
    const store = new Map();
    const player = { id: "alpha-matcher", name: "Matcher", typeId: "minecraft:player", isValid: true, location: { x: 0, y: 64, z: 0 }, dimension: { spawnItem() { }, spawnEntity() { return undefined; } },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), sendMessage() { }, playSound() { }, getComponent: () => undefined, onScreenDisplay: { setActionBar() { } } };
    check("with no party there is no level to match", M.alphaLevelFor(player, venusaur) === null);
    M.addRecord(player, M.recordFor("cobblemon:p0001_bulbasaur", { level: 10 })); flush();
    check("a level 10 party makes a Bulbasaur alpha 14 and a Venusaur alpha 32, never under its evolution", M.alphaLevelFor(player, bulbasaur) === 14 && M.alphaLevelFor(player, venusaur) === 32, `${M.alphaLevelFor(player, bulbasaur)} ${M.alphaLevelFor(player, venusaur)}`);
    const main = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/main.js", import.meta.url), "utf-8");
    check("the level is applied again whenever it differs (applyLevelMatching), for the nearest player", main.includes("if (!level || prop(e, LEVEL) === level) continue;") && main.includes("nearest(e)?.id !== player.id"));
}
// a stand-in world for a herd: grass at y 63 under air, in one biome (or another one away from the seed's block)
const block = (typeId) => ({ typeId, isAir: typeId === "minecraft:air", isLiquid: typeId === "minecraft:water" });
const tracked = (e) => { const events = []; e.events = events; e.triggerEvent = (ev) => events.push(ev); return e; };
const meadow = (biomeAt) => {
    const spawned = [];
    return { spawned, id: "minecraft:overworld", getEntities: () => [], getBiome: (p) => ({ id: biomeAt(p) }), getSkyLightLevel: () => 15, getLightLevel: () => 15, getTopmostBlock: () => undefined,
        getBlock: ({ y }) => block(y === 63 ? "minecraft:grass_block" : y > 63 ? "minecraft:air" : "minecraft:stone"),
        spawnEntity: (id, at) => { const e = tracked(mon(id).entity); e.location = at; spawned.push(e); return e; } };
};
const seedIn = (dim, typeId) => { const e = tracked(mon(typeId).entity); e.location = { x: 0.5, y: 64, z: 0.5 }; e.dimension = dim; e.remove = () => { e.removed = true; }; return e; };
{
    // PokemonHerdSpawnDetail: a herd that cannot spawn where its seed stands is no herd, and the seed goes as the moon's does
    const dim = meadow(() => "minecraft:desert"), seed = seedIn(dim, "cobblemon:p0001_bulbasaur");
    M.fillHerd(seed, "cobblemon:herd_seed"); flush();
    check("a seed whose herds are all outside their biome is taken away", seed.removed === true && dim.spawned.length === 0, `${seed.removed} ${dim.spawned.length}`);
}
{
    // in the jungle the herd fills: each member on a block of its own (minDistanceBetweenSpawns), the seed leading and
    // the rest following it
    const dim = meadow(() => "minecraft:jungle"), seed = seedIn(dim, "cobblemon:p0001_bulbasaur");
    M.fillHerd(seed, "cobblemon:herd_seed"); flush();
    const blocks = new Set([seed, ...dim.spawned].map((e) => `${Math.floor(e.location.x)},${Math.floor(e.location.y)},${Math.floor(e.location.z)}`));
    check("the herd fills about its seed", seed.removed !== true && dim.spawned.length >= 1 && dim.spawned.length <= 3, String(dim.spawned.length));
    check("each member on a block of its own", blocks.size === dim.spawned.length + 1);
    check("each standing on the grass", dim.spawned.every((e) => e.location.y === 64));
    check("the seed leads and the members follow", seed.events.includes("cobblemon:herd_lead") && dim.spawned.every((e) => e.events.includes("cobblemon:herd_follow")));
    // a member's spot must pass the herd's own conditions too: jungle under the seed, desert everywhere else
    const edge = meadow((p) => (Math.floor(p.x) === 0 && Math.floor(p.z) === 0 ? "minecraft:jungle" : "minecraft:desert")), lone = seedIn(edge, "cobblemon:p0001_bulbasaur");
    M.fillHerd(lone, "cobblemon:herd_seed"); flush();
    check("no member is put where the herd's biome is not", lone.removed !== true && edge.spawned.length === 0, String(edge.spawned.length));
}
{
    // the spawnable position types as Cobblemon's calculators tell them, on a column of stone to y 54, water to 62, air
    const column = { getBlock: ({ y }) => block(y > 62 ? "minecraft:air" : y >= 55 ? "minecraft:water" : "minecraft:stone") };
    const at = (pos) => M.spawnSpot(column, { x: 0, y: 60, z: 0 }, 6, pos)?.y;
    check("surface is the air on the water, submerged water between water, seafloor the water on the stone", at("surface") === 63 && at("submerged") === 61 && at("seafloor") === 55, [at("surface"), at("submerged"), at("seafloor")].join());
    check("and any water is the first water with room", at("water") === 62 && at("grounded") === undefined);
}
{
    // HerdBehaviour.toleratedLeaders "<species> alpha" (abra alpha, kadabra alpha...): followed only while an alpha, and
    // the follower stops 6 off (FollowHerdLeaderTask.getRandomOffset's far edge)
    const entity = (name) => JSON.parse(readFileSync(new URL(`../../../development_behavior_packs/cobblemon/entities/${name}.behavior.json`, import.meta.url), "utf-8"))["minecraft:entity"];
    const abra = entity("0063_abra"), follow = abra.component_groups["cobblemon:herd_follower"]?.["minecraft:behavior.follow_mob"];
    const leaders = JSON.stringify(follow?.filters ?? {});
    check("Abra follows an alpha Kadabra", leaders.includes("species_kadabra") && leaders.includes('"domain":"cobblemon:alpha"'));
    check("a follower stops 6 blocks off", follow?.stop_distance === 6);
    const bulbasaur = entity("0001_bulbasaur");
    check("a plain leader needs no alpha", !JSON.stringify(bulbasaur.component_groups["cobblemon:herd_follower"]).includes("cobblemon:alpha"));
    check("the herd's role events are there", !!bulbasaur.events["cobblemon:herd_lead"] && !!bulbasaur.events["cobblemon:herd_follow"]);
}
