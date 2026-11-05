// Alpha herds (spawn_pool_world/herds, bucket boss): their seed asks for an alpha herd, and its leader is made an alpha
// holding its gem
import { readFileSync } from "node:fs";
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
