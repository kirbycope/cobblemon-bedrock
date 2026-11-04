// SpawnDetail.weightMultipliers: a spawn's weight times each multiplier whose condition holds where it is drawn
import { M, check } from "../harness.mjs";

const at = { dimension: { id: "minecraft:overworld" }, location: { x: 0, y: 64, z: 0 } };
const cast = (lure) => ({ effects: [], luck: 0, lure });
const snackSpawn = { wm: [[2, { isPokeSnack: true }]] };
check("a Poke Snack's draw doubles a snack-favoured spawn", M.weightMultiplier(snackSpawn, cast(0), at, [], true) === 2);
check("which the wild spawner leaves alone", M.weightMultiplier(snackSpawn, cast(0), at, [], false) === 1);
const lured = { wm: [[0.6, { minLureLevel: 0, maxLureLevel: 1 }], [5, { minLureLevel: 3 }]] };
check("a rod without lure weighs a lure-favoured fish down", M.weightMultiplier(lured, cast(0), at, [], false) === 0.6);
check("and a lure III rod up five times", M.weightMultiplier(lured, cast(3), at, [], false) === 5);
