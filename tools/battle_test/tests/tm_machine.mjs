// The TM Machine's slots for automation: which slot an item goes in, and when the slots hold the recipe
import { M, check } from "../harness.mjs";

// Acid Spray: two Poison Gems and two Pink Mint Leaves
const move = "acidspray";
check("a Blank TM goes in the blank slot", M.tmSlotFor(move, "cobblemon:blank_tm") === 1);
check("the recipe's items go in their own slots", M.tmSlotFor(move, "cobblemon:poison_gem") === 2 && M.tmSlotFor(move, "cobblemon:pink_mint_leaf") === 3);
check("anything else stays in the hopper", M.tmSlotFor(move, "minecraft:dirt") === -1);
const full = { m: move, s: [null, ["cobblemon:blank_tm", 1], ["cobblemon:poison_gem", 2], ["cobblemon:pink_mint_leaf", 2], null] };
check("it is ready with a blank and the recipe", M.tmReady(move, full));
check("not one gem short", !M.tmReady(move, { ...full, s: [null, full.s[1], ["cobblemon:poison_gem", 1], full.s[3], null] }));
check("nor with another TM in its result slot", !M.tmReady(move, { ...full, s: [["cobblemon:tm_tackle", 1], ...full.s.slice(1)] }));
check("but with its own TMs there", M.tmReady(move, { ...full, s: [["cobblemon:tm_acidspray", 3], ...full.s.slice(1)] }));
