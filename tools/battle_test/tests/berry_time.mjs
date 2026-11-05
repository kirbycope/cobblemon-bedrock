// BerryBlockEntity's growth timer: growthTime minutes (times 1.4) to flowering over two stages, refreshRate to fruit
import { M, check } from "../harness.mjs";

const oran = { grow: [36, 44], refresh: [18, 22] };
const minutes = (t) => t / 1200;
const grow = Array.from({ length: 400 }, () => M.berryPhaseTicks(oran, 0)), fruit = Array.from({ length: 400 }, () => M.berryPhaseTicks(oran, 2));
check("an Oran bush grows to flowering in 50 to 61 minutes", grow.every((t) => minutes(t) >= 50 && minutes(t) <= 61));
check("and to fruit in 25 to 30", fruit.every((t) => minutes(t) >= 25 && minutes(t) <= 30));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
check("Growth Mulch halves it", Math.abs(mean(Array.from({ length: 400 }, () => M.berryPhaseTicks(oran, 0, "growth_mulch"))) / mean(grow) - 0.5) < 0.05);
let total = 0, ok = true;
for (let n = 0; n < 200; n++) {
    let left = 60000; const a = M.berryStageTicks(left, 2); left -= a; const b = M.berryStageTicks(left, 1);
    if (a + b > 60000 || a + b < 0.8 * 60000) ok = false;
}
check("the two growing stages share the phase's time rather than taking it twice", ok);
