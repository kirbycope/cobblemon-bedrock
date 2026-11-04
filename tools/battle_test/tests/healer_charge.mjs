// HealingMachineBlockEntity's charge: empty when placed, full after 900 seconds, a heal spending the party's missing HP
import { M, mon, check } from "../harness.mjs";

const placed = { c: 0, t: 1000 };
check("a newly placed machine is empty", M.healerCharge(placed, 1000) === 0);
check("half full after 450 seconds", Math.abs(M.healerCharge(placed, 1000 + 450 * 20) - 3) < 1e-9);
check("and full, at 6, after 900", M.healerCharge(placed, 1000 + 2000 * 20) === 6);
check("a machine with no record counts as full", M.healerCharge(undefined, 0) === 6);
const healthy = mon("Pikachu").entity, fainted = mon("Eevee").entity;
fainted.setDynamicProperty("cobblemon:fainted", true);
check("a fainted Pokemon needs a whole charge", M.missingShare(fainted) === 1 && M.missingShare(healthy) === 0);
