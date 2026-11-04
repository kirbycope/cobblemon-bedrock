// Spawn entries naming a species feature's choice ("flabebe flower=blue") spawn that look: the spawn rule's event is the
// form event of the feature's aspect (port.py's spawn_form)
import { readFileSync, existsSync } from "node:fs";
import { check } from "../harness.mjs";

const tables = ["fishing.js", "herds.js"].map((f) => readFileSync(new URL(`../../../development_behavior_packs/cobblemon/scripts/${f}`, import.meta.url), "utf-8")).join(" ");

const rules = (name) => {
    const path = new URL(`../../../development_behavior_packs/cobblemon/spawn_rules/${name}.json`, import.meta.url);
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8"))["minecraft:spawn_rules"].conditions : [];
};
const events = (name) => new Set(rules(name).map((c) => c["minecraft:herd"]?.event).filter(Boolean));
const vivillon = events("0666_vivillon");
// Flabebe needs flowers nearby, so the script's spawner draws it (port.py's special_spawns)
const flowers = new Set(tables.match(/cobblemon:spawn_form_flower-[a-z]+/g) ?? []);
check("Flabebe spawns as its entries' flower colours", flowers.size >= 5, JSON.stringify([...flowers]));
check("Vivillon by its wing patterns", [...vivillon].filter((e) => /vivillon-wings-/.test(e)).length >= 3, JSON.stringify([...vivillon]));
