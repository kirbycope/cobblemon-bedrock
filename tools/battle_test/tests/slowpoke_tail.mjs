// SlowpokeTailsMechanic: a sheared tail grows back segment by segment over 1200 seconds of world time
import { M, mon, check } from "../harness.mjs";
import { clock } from "../stub_server.mjs";

const slowpoke = mon("Slowpoke").entity;
check("an unsheared Slowpoke has its whole tail", M.tailSegments(slowpoke) === 3);
clock.ticks = 100000;
slowpoke.setDynamicProperty("cobblemon:tail_cut", clock.ticks);
check("a freshly sheared one has none of it", M.tailSegments(slowpoke) === 0);
clock.ticks += 501 * 20;
check("the first segment is back with under 700 seconds left", M.tailSegments(slowpoke) === 1);
clock.ticks += 500 * 20;
check("the second with under 200", M.tailSegments(slowpoke) === 2);
clock.ticks += 200 * 20;
check("and all of it after 1200 seconds", M.tailSegments(slowpoke) === 3);
