// Region bias (the bias forms' evolutions) and the item evolutions that depend on the biome
import { M, F, mon, check } from "../harness.mjs";

const owned = (species, opts) => { const f = mon(species, opts); f.entity.setDynamicProperty("cobblemon:owner", "player"); return f; };
// stands the Pokemon in a biome with these tags
const tagsOf = (want) => Object.entries(F.BIOME_TAGS).find(([, tags]) => want.every((t) => tags.includes(t)) && !tags.includes("taiga") && !tags.includes("extreme_hills"))?.[0];
const standIn = (f, biome) => { f.entity.dimension = { getBiome: () => ({ id: biome }) }; };
const forms = (list) => list.map((e) => e.form ?? "plain");
{
    const plain = owned("Quilava", { level: 40 }), hisui = owned("Quilava", { level: 40 });
    hisui.entity.setDynamicProperty("cobblemon:region_bias", "hisui");
    const desert = tagsOf(["desert"]);
    standIn(plain, desert); standIn(hisui, desert);
    check("away from both regions a Quilava becomes Typhlosion", forms(M.readyEvolutions(plain.entity)).join() === "plain", forms(M.readyEvolutions(plain.entity)).join());
    check("and a Hisui-biased one becomes Hisuian Typhlosion", forms(M.readyEvolutions(hisui.entity)).join() === "hisuian", forms(M.readyEvolutions(hisui.entity)).join());
    const johto = tagsOf(["plains"]);
    standIn(hisui, johto);
    check("unless it is in a Johto biome", forms(M.readyEvolutions(hisui.entity)).join() === "plain", `${johto}: ${forms(M.readyEvolutions(hisui.entity)).join()}`);
}
{
    const p = owned("Pikachu", { level: 20 });
    standIn(p, tagsOf(["desert"]));
    check("a Thunder Stone makes a Raichu away from Alola's biomes", M.itemEvolution(p.entity, undefined, "cobblemon:thunder_stone")?.form === undefined && !!M.itemEvolution(p.entity, undefined, "cobblemon:thunder_stone"));
    standIn(p, tagsOf(["beach"]));
    check("and an Alolan Raichu on a beach", M.itemEvolution(p.entity, undefined, "cobblemon:thunder_stone")?.form === "alolan", JSON.stringify(M.itemEvolution(p.entity, undefined, "cobblemon:thunder_stone")));
    p.entity.setDynamicProperty("cobblemon:region_bias", "alola");
    standIn(p, tagsOf(["desert"]));
    check("and an Alola-biased Pikachu makes an Alolan Raichu anywhere else", M.itemEvolution(p.entity, undefined, "cobblemon:thunder_stone")?.form === "alolan");
    check("another item does nothing", M.itemEvolution(p.entity, undefined, "cobblemon:fire_stone") === undefined);
}
{
    const props = M.parseProps(["cyndaquil", "region_bias", "hisui"]);
    check("the commands take region_bias", props.region_bias === "hisui", JSON.stringify(props));
}
{
    const g = mon("Goomy");
    g.entity.getProperty = (k) => (k === "cobblemon:region_bias" ? "hisui" : undefined);
    M.showScale(g.entity);
    check("a region_bias spawn keeps its bias", g.entity.getDynamicProperty("cobblemon:region_bias") === "hisui");
}
{
    // the Summary's evolution choice shows the look it becomes
    const q = owned("Quilava", { level: 40 });
    q.entity.setDynamicProperty("cobblemon:region_bias", "hisui");
    q.entity.dimension = { getBiome: () => ({ id: tagsOf(["desert"]) }) };
    const [e] = M.readyEvolutions(q.entity), look = M.evolutionLook(q.entity, e);
    check("the evolution choice shows Hisuian Typhlosion's look", look > 0, String(look));
}
