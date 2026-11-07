// The natural spawn rules port.py writes (create_spawn_rules, spawn_condition, normalise_weights): which entries become a
// rule (a preset's condition, its biomes), the light a rule asks for (Cobblemon's sky light against Bedrock's brightness),
// the weather a rule tests, and the weights, each a share of the pool at a spot as Cobblemon's bucket roll gives it
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { check } from "../harness.mjs";

const pack = (path) => new URL(`../../../development_behavior_packs/cobblemon/${path}`, import.meta.url);
const rules = (name) => existsSync(pack(`spawn_rules/${name}.json`)) ? JSON.parse(readFileSync(pack(`spawn_rules/${name}.json`), "utf-8"))["minecraft:spawn_rules"] : null;
const ALL = readdirSync(pack("spawn_rules")).filter((f) => /^\d{4}_/.test(f)).map((f) => rules(f.slice(0, -5)));
const TAGS = JSON.parse(readFileSync(new URL("../../bedrock_biome_tags.json", import.meta.url), "utf-8"));
const MULT = JSON.parse(readFileSync(pack("scripts/spawn_multipliers.js"), "utf-8").match(/SPAWN_MULTIPLIERS = (.*);/)[1]);
const event = (c) => c["minecraft:herd"]?.event ?? "";

{
    // SpawnDetailPreset.apply copies a preset's condition into the entry's: urban's concrete nearby is the script's to test
    // (special_spawns), so Lillipup (natural and urban, or a civilization structure) has no spawn rule but is drawn there
    const special = readFileSync(pack("scripts/fishing.js"), "utf-8");
    check("an urban spawn is no spawn rule", rules("0506_lillipup") === null && rules("0561_sigilyph") === null && rules("0568_trubbish") === null);
    check("but the script's spawner has it", special.includes("cobblemon:p0506_lillipup"));
    // a preset's biomes join the entry's (MergeMode.INSERT): webs' are other mods' only, so Spinarak's webs entry (no
    // biomes of its own, sky light 0 to 7) spawns nowhere, and its rules are its two others
    check("a webs spawn with no biomes of its own is none", rules("0167_spinarak")?.conditions.length === 2);
}
{
    // Cobblemon's sky light is the SKY layer's raw value, which night does not dim; Bedrock's brightness is the light now
    const rattata = rules("0019_rattata").conditions;
    check("an untimed open-sky spawn asks no brightness (Rattata, minSkyLight 8)", rattata.filter((c) => !event(c)).every((c) => !c["minecraft:brightness_filter"]));
    const night = rules("0163_hoothoot").conditions;
    check("a night spawn takes the dark, 0 to 7 (Hoothoot)", night.length > 0 && night.every((c) => JSON.stringify(c["minecraft:brightness_filter"]) === JSON.stringify({ min: 0, max: 7, adjust_for_weather: true })));
    const filters = ALL.flatMap((r) => r.conditions.map((c) => c["minecraft:brightness_filter"])).filter(Boolean);
    check("no spawn asks for a light no night spot has but a day one (minimum 8 only with the weather adjusted)", filters.every((f) => f.min < 8 || f.adjust_for_weather));
    // an untimed land spawn never under the open sky (maxSkyLight 7) spawns underground: Spinarak's 0 to 7 entry
    const under = rules("0167_spinarak").conditions.filter((c) => !c["minecraft:brightness_filter"]);
    check("an untimed spawn at sky light 0 to 7 is underground only", under.length === 1 && "minecraft:spawns_underground" in under[0] && !("minecraft:spawns_on_surface" in under[0]));
}
{
    // the Legendary Encounters datapack's "weather" key is no SpawningCondition field, so Zapdos spawns in any weather
    const zapdos = rules("0145_zapdos").conditions;
    check("Zapdos tests no weather", zapdos.length > 0 && zapdos.every((c) => !event(c).startsWith("cobblemon:spawn_weather_")));
    check("and carries the least weight, 1", zapdos.every((c) => c["minecraft:weight"].default === 1));
    // at 1 a weight under 1 would come up to 72 times as often as Cobblemon's: the condition fires cobblemon:spawn_mult_<n>
    // with a top of 1 over its share and nothing else to test, so the script keeps it that share of the time
    const keep = zapdos.map((c) => MULT["cobblemon:p0145_zapdos"]?.[+event(c).split("_").pop()]);
    check("a sub-1 condition carries its keep factor, a top over 1 with no multipliers", zapdos.every((c) => event(c).startsWith("cobblemon:spawn_mult_")) && keep.every((e) => e && e.top > 1 && e.wm.length === 0 && !e.was), JSON.stringify(keep));
}
{
    // the weights at one spot, plains at noon on grass, by the rules' own filters, a multiplier's condition thinned by its
    // top and a weather check's by the weather (clear): Rattata near Cobblemon's 9.7 percent (94 of 100 times 88 over the
    // common bucket's 856 there; 5.9 with the treetop and foliage spawns counted)
    const passes = (f, tags) => Array.isArray(f) ? f.every((x) => passes(x, tags)) : f.all_of ? f.all_of.every((x) => passes(x, tags))
        : f.any_of ? f.any_of.some((x) => passes(x, tags)) : f.none_of ? !f.none_of.some((x) => passes(x, tags))
        : f.test === "has_biome_tag" ? tags.includes(f.value) === (f.operator !== "!=") : true;
    const share = {};
    let total = 0, seeds = 0;
    for (const r of ALL) {
        if (r.description.population_control !== "animal") continue;
        for (const c of r.conditions) {
            if (!passes(c["minecraft:biome_filter"], TAGS.plains) || !("minecraft:spawns_on_surface" in c)) continue;
            const b = c["minecraft:brightness_filter"], h = c["minecraft:height_filter"], base = c["minecraft:spawns_on_block_filter"];
            if ((b && !(b.min <= 15 && 15 <= b.max)) || (h && !(h.min <= 65 && 65 <= h.max)) || (base && !base.includes("minecraft:grass_block"))) continue;
            let w = c["minecraft:weight"].default, ev = event(c);
            if (ev.startsWith("cobblemon:spawn_mult_")) { const e = MULT[r.description.identifier][+ev.split("_").pop()]; w /= e.top; ev = e.was ?? ""; }
            if (/spawn_weather_(rain|thunder)|spawn_slime_chunk/.test(ev)) continue;
            share[r.description.identifier] = (share[r.description.identifier] ?? 0) + w; total += w;
            if (ev.startsWith("cobblemon:herd_seed")) seeds += w;
        }
    }
    const rattata = share["cobblemon:p0019_rattata"] / total;
    check("Rattata is 5 to 12 percent of the plains at noon", rattata > 0.05 && rattata < 0.12, `${(100 * rattata).toFixed(2)}%`);
    check("the spot's weights come near SPAWN_POOL, 50000", total > 20000 && total < 80000, `${Math.round(total)}`);
    // Cobblemon's herds are 53 percent of the plains' noon pool by its own buckets, so the seeds are about that here
    check("the herds' seeds are their share there, about half", seeds / total > 0.4 && seeds / total < 0.65, `${(100 * seeds / total).toFixed(1)}%`);
}
{
    // over the whole land pool the herds' seeds are under 40 percent, and no weight leaves the band (1 to SPAWN_CAP, times a
    // multiplier condition's top)
    let total = 0, seeds = 0;
    const out = [];
    for (const r of ALL) {
        for (const c of r.conditions) {
            let w = c["minecraft:weight"].default, ev = event(c), top = 1;
            if (ev.startsWith("cobblemon:spawn_mult_")) { const e = MULT[r.description.identifier][+ev.split("_").pop()]; top = e.top; ev = e.was ?? ""; }
            if (!(w >= 1 && w <= Math.round(10000 * top))) out.push(`${r.description.identifier} ${w}`);
            if (r.description.population_control !== "animal") continue;
            total += w / top;
            if (ev.startsWith("cobblemon:herd_seed")) seeds += w / top;
        }
    }
    check("herd seeds are under 40 percent of the land pool", seeds / total < 0.4, `${(100 * seeds / total).toFixed(1)}%`);
    check("every weight is 1 to 10000 times its top", out.length === 0, out.slice(0, 5).join(", "));
    // a species' conditions under 1 in one bucket are one condition at 1 where only their biomes differ: Garchomp's rare
    // caves in the badlands and mountains (garchomp-1) and the thermal biomes (garchomp-5) are one, its ultra-rare cave
    // spawn anywhere (garchomp-3, another bucket) another
    const keepOnly = (r, c) => { const e = MULT[r.description.identifier]?.[+event(c).split("_").pop()]; return event(c).startsWith("cobblemon:spawn_mult_") && Object.keys(e).join() === "top,wm" && !e.wm.length; };
    const garchomp = rules("0445_garchomp"), caves = garchomp.conditions.filter((c) => !event(c) || keepOnly(garchomp, c));
    check("a species' sub-1 conditions of a bucket are one at weight 1", caves.length === 2 && caves.every((c) => c["minecraft:weight"].default === 1) && caves.some((c) => c["minecraft:biome_filter"].any_of?.length === 2), JSON.stringify(caves.map((c) => c["minecraft:weight"].default)));
    // a keep's top carries the event the condition fired before, so a herd's seed under 1 still fills its herd and a
    // form's still sets its form, the entity's spawn_mult event doing what the old one did
    const kept = ALL.flatMap((r) => r.conditions.map((c) => [r, c])).filter(([r, c]) => event(c).startsWith("cobblemon:spawn_mult_") && MULT[r.description.identifier][+event(c).split("_").pop()].wm.length === 0 && MULT[r.description.identifier][+event(c).split("_").pop()].top > 1);
    const seed = kept.find(([r, c]) => MULT[r.description.identifier][+event(c).split("_").pop()].was?.startsWith("cobblemon:herd_seed_"));
    const ent = seed && JSON.parse(readFileSync(pack(`entities/${seed[0].description.identifier.split(":p")[1]}.behavior.json`), "utf-8"))["minecraft:entity"].events;
    const was = seed && MULT[seed[0].description.identifier][+event(seed[1]).split("_").pop()].was;
    check("a kept herd seed passes its own event on", seed && JSON.stringify(ent[event(seed[1])]) === JSON.stringify(ent[was]), `${seed?.[0].description.identifier} ${was}`);
}
{
    // Zapdos' kept share in the savanna at noon (rules there by their filters, each thinned by its top as the script thins
    // it) against Cobblemon's: the ultra-rare bucket's 0.2 percent times its 0.6 over the 121.6 of the bucket there
    // (compare.py legendary: 0.0010 percent), within a factor of 3 where the floor at 1 made it 4.2 times that
    const passes = (f, tags) => Array.isArray(f) ? f.every((x) => passes(x, tags)) : f.all_of ? f.all_of.every((x) => passes(x, tags))
        : f.any_of ? f.any_of.some((x) => passes(x, tags)) : f.none_of ? !f.none_of.some((x) => passes(x, tags))
        : f.test === "has_biome_tag" ? tags.includes(f.value) === (f.operator !== "!=") : true;
    let total = 0, zapdos = 0;
    for (const r of ALL) {
        if (r.description.population_control !== "animal") continue;
        for (const c of r.conditions) {
            if (!passes(c["minecraft:biome_filter"], TAGS.savanna) || !("minecraft:spawns_on_surface" in c)) continue;
            const b = c["minecraft:brightness_filter"], h = c["minecraft:height_filter"], base = c["minecraft:spawns_on_block_filter"];
            if ((b && !(b.min <= 15 && 15 <= b.max)) || (h && !(h.min <= 70 && 70 <= h.max)) || (base && !base.includes("minecraft:grass_block"))) continue;
            let w = c["minecraft:weight"].default, ev = event(c);
            if (ev.startsWith("cobblemon:spawn_mult_")) { const e = MULT[r.description.identifier][+ev.split("_").pop()]; w /= e.top; ev = e.was ?? ""; }
            if (/spawn_weather_(rain|thunder)|spawn_slime_chunk/.test(ev)) continue;
            total += w; if (r.description.identifier === "cobblemon:p0145_zapdos") zapdos += w;
        }
    }
    const ratio = (zapdos / total) / (0.002 * 0.6 / 121.6);
    check("Zapdos' kept share in the savanna is Cobblemon's within a factor of 3", ratio > 1 / 3 && ratio < 3, `${ratio.toFixed(2)} times, ${(100 * zapdos / total).toFixed(5)}%`);
}
