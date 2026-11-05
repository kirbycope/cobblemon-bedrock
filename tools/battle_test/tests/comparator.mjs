// Comparators by the machines (getAnalogOutputSignal): the Healing Machine's charge in whole tenths up to 10, and the
// TM Machine's burn progress in fifteenths, 15 or 0 by whether it is ready, and 8 or 4 while it makes TMs on its own
import { M, check } from "../harness.mjs";

check("an unrecorded Healing Machine (from a structure) counts as full and gives 10", M.healerSignal(null, 0) === 10);
check("an infinite one gives its charge, as updateRedstoneSignal overwrites its 10", M.healerSignal({ c: 0, t: 0, inf: true }, 0) === 0);
check("an empty one gives 0", M.healerSignal({ c: 0, t: 0 }, 0) === 0);
check("a half-charged one gives 5", M.healerSignal({ c: 3, t: 0 }, 0) === 5);
check("its charge's whole tenths, rounded down", M.healerSignal({ c: 6 * 0.39, t: 0 }, 0) === 3);
check("a full one gives 10, not 15", M.healerSignal({ c: 6, t: 0 }, 0) === 10);

check("a burning TM Machine starts at 0", M.tmSignal({ m: "tackle", s: [] }, false, 114) === 0);
check("and climbs with its progress", M.tmSignal({ m: "tackle", s: [] }, false, 57) === 7);
check("to 14 at its last tick", M.tmSignal({ m: "tackle", s: [] }, false, 1) === 14);
check("an idle unpowered one with nothing to make gives 0", M.tmSignal({ m: null, s: Array(5).fill(null) }, false) === 0);
check("a powered one making TMs gives 4", M.tmSignal({ m: "tackle", s: Array(5).fill(null) }, true) === 4);
check("and 8 when its result slot is full", M.tmSignal({ m: "tackle", s: [["cobblemon:tm_tackle", 64], null, null, null, null] }, true) === 8);
check("or holds another TM", M.tmSignal({ m: "tackle", s: [["cobblemon:tm_ember", 1], null, null, null, null] }, true) === 8);
