// RCT's battle loot: a gym trainer's table rolled as Minecraft rolls a loot table, items the pack defines only, and the
// series bonus luck raising the rarer entries
import { readFileSync } from "node:fs";
import { M, D, check } from "../harness.mjs";

const text = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/rct_trainers.js", import.meta.url), "utf-8");
const items = new Set([...readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/rct_trainers.js", import.meta.url), "utf-8").matchAll(/"i":"([^"]+)"/g)].map((m) => m[1]));
const picks = text.match(/"trainers":\{([^}]*)\}/)?.[1] ?? "";
check("every gym trainer has a loot table, among RCT's", (picks.match(/":"rctmod:/g) ?? []).length >= 14 && picks.includes('"leader_brock_019e":"rctmod:trainers/single/leader_brock_019e"'));
const random = Math.random;
const drops = [];
for (let n = 0; n < 400; n++) drops.push(...M.rollRctLoot("rctmod:trainers/single/leader_brock_019e", 30, 0));
check("Brock's table drops something across many wins", drops.length > 50, String(drops.length));
check("only items with a count of one or more", drops.every(([id, c]) => typeof id === "string" && id.includes(":") && c >= 1));
const tms = drops.filter(([id]) => id.startsWith("cobblemon:tm_"));
check("TMs come as the pack's own cobblemon:tm_<move> items", tms.every(([id]) => items.has(id)), tms.slice(0, 3).join(" "));
Math.random = random;
const player = { getDynamicProperty: (k) => (k === "cobblemon:rct_completed" ? JSON.stringify({ radicalred: 1 }) : undefined) };
const none = M.rctLuck({ getDynamicProperty: () => undefined }), one = M.rctLuck(player);
check("no luck until a series is completed, then some", none === 0 && one > 0 && one < 1, `${none} ${one}`);
