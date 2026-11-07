// Alpha herds (spawn_pool_world/herds, bucket boss): their seed asks for an alpha herd, and its leader is made an alpha
// holding its gem
import { readFileSync, readdirSync } from "node:fs";
import { M, mon, check } from "../harness.mjs";

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
    // an alpha herd's seed spawns from Cobblemon's boss bucket (0.25 of 100): port.py's normalise_weights gives each of a
    // species' buckets its own total, so the seed carries the least weight a rule can, and never outweighs the species'
    // common spawn as it did when one total was split across buckets by raw weight (Tsareena's alpha herd 60, its common
    // spawn 19; issue 61's herds everywhere)
    const dir = new URL("../../../development_behavior_packs/cobblemon/spawn_rules/", import.meta.url);
    let alpha = 0, total = 0;
    const heavy = [];
    for (const name of readdirSync(dir)) {
        const rules = JSON.parse(readFileSync(new URL(name, dir), "utf-8"))["minecraft:spawn_rules"];
        if (rules.description.population_control !== "animal") continue;
        for (const c of rules.conditions) {
            const w = c["minecraft:weight"].default;
            total += w;
            if (c["minecraft:herd"]?.event?.startsWith("cobblemon:herd_seed_alpha")) { alpha += w; if (w > 1) heavy.push(`${name} ${w}`); }
        }
    }
    check("an alpha herd's seed carries weight 1", total > 0 && heavy.length === 0, heavy.slice(0, 5).join(", "));
    check("alpha herds are under half a percent of the land pool", alpha > 0 && alpha / total < 0.005, `${(100 * alpha / total).toFixed(2)}%`);
    const tsareena = JSON.parse(readFileSync(new URL("0763_tsareena.json", dir), "utf-8"))["minecraft:spawn_rules"].conditions;
    const weightOf = (test) => tsareena.find(test)?.["minecraft:weight"].default ?? 0;
    check("Tsareena's common spawn outweighs its alpha herd's seed", weightOf((c) => !c["minecraft:herd"]?.event) > weightOf((c) => c["minecraft:herd"]?.event === "cobblemon:herd_seed_alpha"));
}
