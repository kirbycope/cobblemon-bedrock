// Drop and loot item ids by Bedrock's names: a species' drops (DropTable), the pack's loot tables converted from Cobblemon's
// (the fossil formations' archaeology, the ruins' and coves' chests and barrels) and an interaction's drop, with what
// their item functions carry (enchant_with_levels, set_potion as set_data, set_damage)
import { D, check } from "../harness.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const pack = new URL("../../../development_behavior_packs/cobblemon/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, pack), "utf-8");
const loot = (rel) => JSON.parse(read(`loot_tables/${rel}`));
const entries = (table) => table.pools.flatMap((p) => p.entries);

// every drop id is one Bedrock has: the game's item catalogs, or the pack's own items and blocks
const ids = new Set();
const server = "C:/GitHub/bedrock-server/behavior_packs";
if (existsSync(server)) for (const dir of readdirSync(server).filter((d) => d.startsWith("vanilla"))) {
    const catalog = `${server}/${dir}/item_catalog`;
    if (existsSync(catalog)) for (const f of readdirSync(catalog)) for (const m of readFileSync(`${catalog}/${f}`, "utf-8").matchAll(/"(minecraft:[a-z0-9_]+)"/g)) ids.add(m[1]);
}
for (const folder of ["items", "blocks"]) {
    const walk = (url) => { for (const e of readdirSync(url, { withFileTypes: true })) {
        if (e.isDirectory()) walk(new URL(`${e.name}/`, url));
        else if (e.name.endsWith(".json")) { const m = readFileSync(new URL(e.name, url), "utf-8").match(/"identifier":\s*"([^"]+)"/); if (m) ids.add(m[1]); }
    } };
    walk(new URL(`${folder}/`, pack));
}
const drops = Object.entries(D.POKEMON).flatMap(([id, p]) => (p.drops?.[2] ?? []).map((e) => [id, e[0]]));
const unknown = drops.filter(([, item]) => !ids.has(item));
check("every species drop is an item Bedrock has", ids.size > 1000 && drops.length > 1000 && !unknown.length, JSON.stringify(unknown.slice(0, 5)));
const dropOf = (name) => Object.values(D.POKEMON).find((p) => p.name === name)?.drops?.[2]?.[0]?.[0];
check("Lotad drops a lily pad, Bedrock's waterlily", dropOf("Lotad") === "minecraft:waterlily");
check("Dwebble terracotta, hardened_clay", dropOf("Dwebble") === "minecraft:hardened_clay");
check("Phantump a jack o'lantern, lit_pumpkin", dropOf("Phantump") === "minecraft:lit_pumpkin");
check("Bramblin a dead bush, deadbush", dropOf("Bramblin") === "minecraft:deadbush");
check("Lotad's interaction drop is a waterlily too", entries(loot("interactions/0270_lotad_0.json"))[0].name === "minecraft:waterlily");

// the fossil formations' common tables give a Big Root (weight 6 of 39 in the birch tree's), a block of the pack's
const birch = entries(loot("fossils/common/prehistoric_birch_tree.json"));
check("a common fossil table has its Big Root at weight 6", birch.find((e) => e.name === "cobblemon:big_root")?.weight === 6 && birch.length === 10);
const common = readdirSync(new URL("loot_tables/fossils/common/", pack));
check("all 18 common tables that name one keep it", common.filter((f) => entries(loot(`fossils/common/${f}`)).some((e) => e.name === "cobblemon:big_root")).length === 18);
const BRUSH_LOOT = JSON.parse(read("scripts/fossil_loot.js").match(/BRUSH_LOOT = (.*);/)[1]);
check("and the brush rolls it from the same table", BRUSH_LOOT["loot_tables/fossils/common/prehistoric_birch_tree.json"].some(([item, weight]) => item === "cobblemon:big_root" && weight === 6));

// the ruins' vanilla loot: a book enchanted at level 30 from the treasure pool (EnchantWithLevelsFunction, no options)
const book = entries(loot("ruins/vanilla_loot/vanilla_loot.json")).find((e) => e.name === "minecraft:book");
check("the ruins' book is enchanted with 30 levels, treasure included", JSON.stringify(book?.functions) === JSON.stringify([{ function: "enchant_with_levels", levels: 30, treasure: true }]));
// the coves' barrels: water breathing potions (set_potion as Bedrock's data 19 and 20), a bow with set_damage
const potions = entries(loot("shipwreck_coves/vanilla_chests/cove1_barrel.json")).filter((e) => e.name === "minecraft:potion");
check("cove 1's potions are water breathing, 19, and the long one, 20", potions.map((e) => e.functions.find((f) => f.function === "set_data")?.data).join() === "19,20");
const cove2 = entries(loot("shipwreck_coves/vanilla_chests/cove2_barrel.json"));
const bow = cove2.find((e) => e.name === "minecraft:bow");
check("cove 2's bow carries set_damage, 10 to 38 clamped to whole as SetItemDamageFunction does", JSON.stringify(bow?.functions?.find((f) => f.function === "set_damage")?.damage) === JSON.stringify({ min: 1, max: 1 }));
check("cove 2's cobweb is Bedrock's web", cove2.some((e) => e.name === "minecraft:web") && !cove2.some((e) => e.name === "minecraft:cobweb"));
