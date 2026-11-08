// A Poke Snack or Poke Cake takes its seasonings' colour (PokeSnackBlockEntity's tint: getColourMixFromColors over
// their dye colours, the first 70%), drawn as the nearest of a palette of pre-tinted textures, as Bedrock tints a
// block from no data
import { M, check } from "../harness.mjs";
import { existsSync, readFileSync } from "node:fs";

const pack = (path) => new URL(`../../../${path}`, import.meta.url);
const pot = readFileSync(pack("development_behavior_packs/cobblemon/scripts/pot.js"), "utf-8");
const read = (name) => JSON.parse(pot.match(new RegExp(`export const ${name} = (.*);`))[1]);
const PALETTE = read("SNACK_PALETTE"), DYES = read("DYE_COLOURS"), SEASONINGS = read("SEASONINGS");
const same = (a, b) => a.join() === b.join();
const byColour = (colour) => Object.keys(SEASONINGS).find((id) => SEASONINGS[id].colour === colour);

check("the palette is 64 colours, white first", PALETTE.length === 64 && same(PALETTE[0], [255, 255, 255]));
check("an unseasoned snack is untinted", M.snackTint([]) === 0 && M.snackTint(undefined) === 0);
const lime = byColour("LIME");
check("one seasoning gives its own dye's colour", same(PALETTE[M.snackTint([lime])], DYES.LIME), `${lime} -> ${PALETTE[M.snackTint([lime])]}`);
// red then blue: 70% red, 30% blue, nearer that mix than red or blue alone
const red = byColour("RED"), blue = byColour("BLUE"), mix = [0, 1, 2].map((i) => Math.trunc(DYES.RED[i] * 0.7 + DYES.BLUE[i] * 0.3));
const d = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0), chosen = PALETTE[M.snackTint([red, blue])];
check("two mix with the first at 70%", d(chosen, mix) <= d(DYES.RED, mix) && d(chosen, mix) <= d(DYES.BLUE, mix), `${chosen} for ${mix}`);
check("a non-seasoning counts for nothing", M.snackTint(["minecraft:dirt", lime]) === M.snackTint([lime]));

// Bedrock gives a block 16 bits of states. The cake is not tinted: a 16-colour tint made it 36,864 permutations, which
// with the rest of 1.0.556 left phones unable to load their worlds (tools/check_block_permutations.py)
const bits = (states) => Object.values(states).reduce((n, v) => n + Math.ceil(Math.log2(Array.isArray(v) ? v.length : v.values.max - v.values.min + 1)), 0);
{
    const cake = JSON.parse(readFileSync(pack("development_behavior_packs/cobblemon/blocks/poke_cake.json"), "utf-8"))["minecraft:block"];
    check("poke_cake has no tint state or tint permutations", !("cobblemon:tint_lo" in cake.description.states) && !cake.permutations.some((p) => p.condition.includes("tint")));
}
for (const [name, colours] of [["poke_snack", 64]]) {
    const block = JSON.parse(readFileSync(pack(`development_behavior_packs/cobblemon/blocks/${name}.json`), "utf-8"))["minecraft:block"];
    const tints = block.permutations.filter((p) => p.condition.includes("cobblemon:tint_lo"));
    const states = { ...block.description.states, ...(block.description.traits?.["minecraft:placement_direction"] ? { direction: [0, 1, 2, 3] } : {}) };
    check(`${name} has ${colours} colours, a permutation for each but white`, tints.length === colours - 1);
    check(`${name}'s states fit in 16 bits`, bits(states) <= 16, `${bits(states)}`);
    const textures = Object.values(tints[0].components["minecraft:material_instances"]).map((m) => m.texture);
    check(`${name}'s tinted faces have their own textures, its overlays and candles not`,
          textures.some((t) => /poke_snack_\w+_1$/.test(t)) && textures.filter((t) => t.includes("overlay")).every((t) => !/_\d+$/.test(t)));
}
check("a tinted texture is in the pack", existsSync(pack("development_resource_packs/cobblemon/textures/blocks/cobblemon/block/food/tint/poke_snack_side_1.png")));
