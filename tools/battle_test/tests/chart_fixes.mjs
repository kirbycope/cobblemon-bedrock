// Behaviours the port chart check found differing from Cobblemon's code: the Mini and Jumbo marks on spawn
// (pokemon_entity_spawn/apply_marks), potential marks worked out at spawn, and Burmy keeping its cloak outside the
// plant, sandy and trash biomes (battle_ended/burmy_cloak_change)
import { M, mon, check } from "../harness.mjs";

const spawned = (scale, alpha = false) => {
    const e = mon("Pidgey").entity;
    e.setDynamicProperty("cobblemon:scale", scale);
    if (alpha) e.setDynamicProperty("cobblemon:alpha", true);
    M.spawnMarks(e);
    return JSON.parse(e.getDynamicProperty("cobblemon:marks") ?? "[]");
};
check("a wild Pokemon spawning XS takes the Mini Mark", spawned(0.951).includes("cobblemon:mark_mini"));
check("one spawning XL the Jumbo Mark", spawned(1.049).includes("cobblemon:mark_jumbo"));
check("an alpha the Jumbo Mark and not the Mini", (() => { const m = spawned(0.951, true); return m.includes("cobblemon:mark_jumbo") && !m.includes("cobblemon:mark_mini"); })());
check("one of middling size neither", spawned(1.0).length === 0);
const owned = mon("Pidgey").entity;
owned.setDynamicProperty("cobblemon:owner", "someone"); owned.setDynamicProperty("cobblemon:scale", 0.951);
M.spawnMarks(owned);
check("an owned Pokemon sent out takes none", owned.getDynamicProperty("cobblemon:marks") === undefined);

const noted = mon("Pidgey").entity;
M.spawnMarks(noted);
check("its potential marks are noted when it spawns", Array.isArray(JSON.parse(noted.getDynamicProperty("cobblemon:potential_marks") ?? "null")));

check("Burmy takes the plant cloak in a forest", M.cloakFor("minecraft:birch_forest") === null);
check("the sandy cloak in a desert", M.cloakFor("minecraft:desert") === "sandy-cloak");
check("the trash cloak in a taiga", M.cloakFor("minecraft:taiga") === "trash-cloak");
check("and keeps its cloak in an ocean or a savanna", M.cloakFor("minecraft:ocean") === undefined && M.cloakFor("minecraft:savanna") === undefined);
