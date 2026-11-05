// An ancient ball hops once in place of its shakes, the hop chosen by the checks passed (EmptyPokeBallEntity.shakeBall)
import { M, check } from "../harness.mjs";

check("one check passed is the weird hop", M.ancientHops({ shakes: 1, caught: false }) === 1);
check("three checks the middle hop", M.ancientHops({ shakes: 3, caught: false }) === 3);
check("a catch, four checks, the small hop", M.ancientHops({ shakes: 3, caught: true }) === 4);
check("a critical capture counts one check", M.ancientHops({ shakes: 1, caught: true, critical: true }) === 1);
check("no check passed, no hop", M.ancientHops({ shakes: 0, caught: false }) === 0);
