// A wild Pokemon's rolls: its level (PokemonSpawnAction.createEntity), its look by its species features
// (ChoiceSpeciesFeatureProvider, port.py's add_variants) and the mark it takes when caught (Pokemon.applyPotentialMarks)
import { readFileSync } from "node:fs";
import { M, D, mon, mod, check } from "../harness.mjs";

const rolled = (roll, fn) => { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } };

// createEntity sets props.level = levelRange.random() after PlayerLevelRangeInfluence has set it, so the party never
// narrows a wild level: it is even over the spawn range, a level 100 party or none
{
    const typeId = Object.keys(D.POKEMON).find((id) => { const r = D.POKEMON[id].range; return r && r[1] - r[0] >= 8; });
    const [lo, hi] = D.POKEMON[typeId].range, e = mon(typeId).entity;
    check("a wild level rolls the whole spawn range, its lowest", rolled(0, () => M.wildLevel(e)) === lo, `${typeId} ${lo}-${hi}`);
    check("and its highest", rolled(0.99999, () => M.wildLevel(e)) === hi);
    check("and the middle of it, not the quarter the party influence would pick", rolled(0.5, () => M.wildLevel(e)) === lo + Math.floor((hi - lo + 1) / 2));
}

// add_variants: each look's share of the spawn roll, from the entity's minecraft:entity_spawned randomize and
// variants.js's VARIANT_LOOKS ([form aspect, female, shiny] per variant); these read the generated entity files, so
// they pass once port.py has written them again
{
    const { VARIANT_LOOKS } = await mod("variants.js");
    const shares = (file, typeId) => {
        const events = JSON.parse(readFileSync(new URL(`../../../development_behavior_packs/cobblemon/entities/${file}.behavior.json`, import.meta.url), "utf-8"))["minecraft:entity"].events;
        const spawned = events["minecraft:entity_spawned"], roll = (spawned.sequence ?? [spawned]).find((s) => s.randomize?.some((r) => /variant_/.test(r.add?.component_groups?.[0] ?? "")))?.randomize ?? [];
        const total = roll.reduce((s, r) => s + r.weight, 0), out = {};
        for (const r of roll) { const n = Number(r.add.component_groups[0].split("_").pop()), form = VARIANT_LOOKS[typeId]?.[n]?.[0] ?? "base"; out[form] = (out[form] ?? 0) + r.weight / total; }
        return out;
    };
    const near = (a, b) => Math.abs((a ?? 0) - b) < 0.001;
    const tox = shares("0849_toxtricity", "cobblemon:p0849_toxtricity");
    check("Toxtricity spawns amped and low key evenly (punk_form, two choices at random)", near(tox.base, 0.5) && near(tox["low_key-form"], 0.5), JSON.stringify(tox));
    const dudun = shares("0982_dudunsparce", "cobblemon:p0982_dudunsparce");
    check("Dudunsparce spawns two-segment 99 in 100 (landsnake_form's weights)", near(dudun.base, 0.99) && near(dudun["three-segment-form"], 0.01), JSON.stringify(dudun));
    const gyarados = shares("0130_gyarados", "cobblemon:p0130_gyarados");
    check("Gyarados has red and purple eyes evenly", near(gyarados.base, 0.5) && near(gyarados["gyarados-eye-color-purple"], 0.5), JSON.stringify(gyarados));
    const minior = shares("0774_minior", "cobblemon:p0774_minior");
    check("Minior always spawns in its meteor shell (meteor_shield's default), the core colours not splitting it", near(minior["meteor-form"], 1), JSON.stringify(minior));
    const pumpkaboo = shares("0710_pumpkaboo", "cobblemon:p0710_pumpkaboo");
    check("Pumpkaboo's four sizes a quarter each, average the base look", ["base", "pumpkin-size-small", "pumpkin-size-large", "pumpkin-size-super"].every((k) => near(pumpkaboo[k], 0.25)), JSON.stringify(pumpkaboo));
}

// applyPotentialMarks: toSortedMap(compareBy { chance }) keeps one group per chance, the last put, so of the 0.02
// groups (weather, time, uncommon) the Uncommon Mark rolls; the time mark only once it has that, the weather one last
{
    const { MARKS } = await mod("marks.js");
    const wild = ["cobblemon:mark_weather_rainy", "cobblemon:mark_time_dawn", ...Object.keys(MARKS).filter((id) => ["rare", "uncommon", "personality"].includes(MARKS[id][5]))];
    const roll = (potentials, owned = []) => {
        const e = mon("Rattata").entity;
        e.setDynamicProperty("cobblemon:potential_marks", JSON.stringify(potentials));
        e.setDynamicProperty("cobblemon:marks", JSON.stringify(owned));
        return rolled(0.015, () => M.applyPotentialMarks(e));   // 1.5 in 100: past the rare and personality chances, under 0.02
    };
    check("of the groups at 0.02 only the Uncommon Mark rolls", roll(wild) === "cobblemon:mark_uncommon", String(roll(wild)));
    check("the time mark is the 0.02 group once it has the Uncommon Mark", roll(wild, ["cobblemon:mark_uncommon"]) === "cobblemon:mark_time_dawn");
    check("the weather mark only with no time or uncommon mark to roll", roll(wild.filter((id) => id !== "cobblemon:mark_time_dawn"), ["cobblemon:mark_uncommon"]) === "cobblemon:mark_weather_rainy");
}
