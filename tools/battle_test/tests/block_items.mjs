// Issue 76: a Saccharine Sapling could not be planted. An item named as a block takes the block's own item's place in
// the inventory, so it places nothing unless it says which block it places. Cobblemon registers the Saccharine Sapling
// and the Pep-Up Flower as block items (compostableBlockItem), so each places its block, on dirt and farmland
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { check } from "../harness.mjs";

const bp = new URL("../../../development_behavior_packs/cobblemon/", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
function files(dir) { return readdirSync(dir).flatMap((n) => statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]); }
const items = Object.fromEntries(files(join(bp, "items")).filter((f) => f.endsWith(".json")).map((f) => {
    const d = JSON.parse(readFileSync(f, "utf-8"));
    return [d["minecraft:item"].description.identifier, d];
}));
const blocks = new Set(files(join(bp, "blocks")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(f, "utf-8"))["minecraft:block"].description.identifier));

for (const id of ["cobblemon:saccharine_sapling", "cobblemon:pep_up_flower"]) {
    const placer = items[id]?.["minecraft:item"].components["minecraft:block_placer"];
    check(`${id} is a block and an item`, blocks.has(id) && !!items[id]);
    check(`${id} places its own block`, placer?.block === id && placer.replace_block_item === true, JSON.stringify(placer));
    check(`${id} plants on grass, dirt and farmland`, ["minecraft:grass_block", "minecraft:dirt", "minecraft:farmland"].every((b) => placer?.use_on?.includes(b)), JSON.stringify(placer?.use_on));
}
