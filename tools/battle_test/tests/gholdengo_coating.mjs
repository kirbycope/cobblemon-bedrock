// Gimmighoul's Scrap Stash: with 999 coins it evolves into Gholdengo, coated in netherite by how much scrap it holds
// (PropertyRangeRequirement on gimmighoul_netherite: 32 to 63 stage 1, up to 224 to 255 stage 7, 256 the full coat)
import { M, mon, check } from "../harness.mjs";

function evolveWith(netherite) {
    const g = mon("Gimmighoul", { level: 30 });
    g.entity.setDynamicProperty("cobblemon:gimmighoul_coins", 999);
    if (netherite) g.entity.setDynamicProperty("cobblemon:gimmighoul_netherite", netherite);
    return M.readyEvolutions(g.entity)[0];
}
check("999 coins and no scrap: a plain Gholdengo", evolveWith(0)?.to === "cobblemon:p1000_gholdengo" && !evolveWith(0).form);
check("31 scrap is still plain", !evolveWith(31)?.form);
check("32 scrap: the first stage of the coat", evolveWith(32)?.form === "netherite-coating-stage1", evolveWith(32)?.form);
check("100 scrap: stage 3", evolveWith(100)?.form === "netherite-coating-stage3", evolveWith(100)?.form);
check("a full stash of 256: fully coated", evolveWith(256)?.form === "netherite-coating-full", evolveWith(256)?.form);
const g = mon("Gimmighoul", { level: 30 });
g.entity.setDynamicProperty("cobblemon:gimmighoul_coins", 998);
g.entity.setDynamicProperty("cobblemon:gimmighoul_netherite", 256);
check("without its 999 coins it does not evolve at all", !M.readyEvolutions(g.entity).length);
