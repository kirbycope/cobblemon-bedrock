// The Restoration Tank takes every natural material Cobblemon names, its own foods among them
import { readFileSync } from "node:fs";
import { check, vanillaItemIds } from "../harness.mjs";

const js = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/blocks.js", import.meta.url), "utf-8");
const fossils = JSON.parse(js.match(/export const FOSSILS = (\{.*\});/)[1]);
check("a Roasted Leek is worth 1", fossils.materials["cobblemon:roasted_leek"]?.[0] === 1);
check("Leek and Potato Stew 4, its bowl given back", fossils.materials["cobblemon:leek_and_potato_stew"]?.[0] === 4 && fossils.materials["cobblemon:leek_and_potato_stew"][1] === "minecraft:bowl");
check("and the berries still count", fossils.materials["cobblemon:oran_berry"]?.[0] === 2);

// every material is an item Bedrock has by Bedrock's id (NaturalMaterials matches the held item's id, as main.js matches
// typeId): Mojang's item list or the catalogs, or the pack's own items and blocks
import { existsSync, readdirSync } from "node:fs";
const pack = new URL("../../../development_behavior_packs/cobblemon/", import.meta.url);
const ids = new Set();
const samples = new URL("../../../java/bedrock-samples/mojang-items.json", import.meta.url);
if (existsSync(samples)) for (const i of JSON.parse(readFileSync(samples, "utf-8")).data_items) ids.add(i.name);
for (const id of vanillaItemIds()) ids.add(id);   // loose or in a 1.26 server's __brarchive
for (const folder of ["items", "blocks"]) {
    const walk = (url) => { for (const e of readdirSync(url, { withFileTypes: true })) {
        if (e.isDirectory()) walk(new URL(`${e.name}/`, url));
        else if (e.name.endsWith(".json")) { const m = readFileSync(new URL(e.name, url), "utf-8").match(/"identifier":\s*"([^"]+)"/); if (m) ids.add(m[1]); }
    } };
    walk(new URL(`${folder}/`, pack));
}
const all = Object.entries(fossils.materials);
const unknown = all.flatMap(([id, [, back]]) => [id, back].filter((x) => x && !ids.has(x)));
check("every material and item given back is a Bedrock or pack item", ids.size > 1000 && all.length > 300 && !unknown.length, JSON.stringify(unknown.slice(0, 8)));
const m = fossils.materials;
check("Java names renamed: deadbush 1, waterlily 2, lit_pumpkin 4, melon_block 8", m["minecraft:deadbush"]?.[0] === 1 && m["minecraft:waterlily"]?.[0] === 2 && m["minecraft:lit_pumpkin"]?.[0] === 4 && m["minecraft:melon_block"]?.[0] === 8);
check("small_dripleaf_block 2, frog_spawn 8, the mushroom blocks 8, suspicious stew 4 with its bowl",
    m["minecraft:small_dripleaf_block"]?.[0] === 2 && m["minecraft:frog_spawn"]?.[0] === 8 && m["minecraft:brown_mushroom_block"]?.[0] === 8 && m["minecraft:red_mushroom_block"]?.[0] === 8
    && m["minecraft:suspicious_stew"]?.[0] === 4 && m["minecraft:suspicious_stew"][1] === "minecraft:bowl");
check("ids 1.21.1 has no item for match nothing there and are left out", ["grass", "tall_fern", "tall_seagrass", "dripleaf", "glistening_melon_slice", "rabbits_foot", "dead_bush", "lily_pad"].every((n) => !m[`minecraft:${n}`]));
// the tags: an item's own entry wins over a tag (spore_blossom 16 though #minecraft:flowers says 2), the first tag over a later one
check("tags count: a poppy 2 (#flowers), oak leaves 2, an oak sapling 2, raw beef 8, cooked cod 4", m["minecraft:poppy"]?.[0] === 2 && m["minecraft:oak_leaves"]?.[0] === 2
    && m["minecraft:oak_sapling"]?.[0] === 2 && m["minecraft:beef"]?.[0] === 8 && m["minecraft:cooked_cod"]?.[0] === 4);
check("Cobblemon's tags: a mint, a mint leaf, an apricorn, its seed, a herb, a mochi", ["adamant_mint", "red_mint_leaf", "red_apricorn", "red_apricorn_seed", "white_herb", "health_mochi", "red_mint_seeds"].every((n) => m[`cobblemon:${n}`]));
check("an item's own entry wins over its tag: spore blossom 16, torchflower 8, pitcher plant 8", m["minecraft:spore_blossom"]?.[0] === 16 && m["minecraft:torchflower"]?.[0] === 8 && m["minecraft:pitcher_plant"]?.[0] === 8);
