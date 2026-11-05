// The recipe book's known recipes: learnt by holding an item the recipe's advancement names
import { readFileSync } from "node:fs";
import { M, check } from "../harness.mjs";

const pot = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/pot.js", import.meta.url), "utf-8");
const shaped = JSON.parse(pot.match(/export const POT_SHAPED = (\[.*\]);/)[1]), shapeless = JSON.parse(pot.match(/export const POT_SHAPELESS = (\[.*\]);/)[1]);
const antidote = [...shaped, ...shapeless].find((r) => r.id === "antidote_in_campfire_pot");
check("an Antidote is learnt from a Pecha Berry", antidote?.unlock?.includes("cobblemon:pecha_berry"), JSON.stringify(antidote?.unlock));
const props = new Map(), items = [{ typeId: "cobblemon:pecha_berry", amount: 1 }];
const player = { getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => props.set(k, v),
                 getComponent: () => ({ container: { size: items.length, getItem: (n) => items[n] } }) };
check("a player who has held none knows nothing yet", M.rbKnown(player).size === 0);
M.learnRecipes(player);
check("holding a Pecha Berry teaches the Antidote", M.rbKnown(player).has("antidote_in_campfire_pot"));
