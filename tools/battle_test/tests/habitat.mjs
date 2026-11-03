// The Habitat Block's spawn choice: the day's phase, the time of day, a bucket and a spawn by weight
import { M, check } from "../harness.mjs";
import { readFileSync } from "node:fs";
const text = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/habitats.js", import.meta.url), "utf-8");
const HABITAT_POOLS = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

const day = M.habitatPick("abandoned_village_house", 0, false), night = M.habitatPick("abandoned_village_house", 0, true);
check("a habitat pool gives a spawn by day and by night", !!day && !!night, JSON.stringify([day, night]));
let ok = true;
for (let d = 0; d < 7; d++) { const sp = M.habitatPick("abandoned_fortress", d, false); if (sp && !sp[5].includes((d % Math.max(1, ...HABITAT_POOLS.abandoned_fortress.spawns.flatMap((x) => x[5]))) + 1)) ok = false; }
check("a spawn is always one of the day's phase", ok);
