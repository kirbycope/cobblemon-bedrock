// Lava surface spawns (the lava preset: Slugma and Magcargo on lava under air), which Bedrock's spawn rules cannot
// place, so the script's spawner takes a lava surface within 16 blocks up or down of the player as the position "lava"
import { M, check } from "../harness.mjs";

// a column: lava from y 30 to 40 under air, stone below
const column = (top, kind = "minecraft:lava") => ({
    getBlock: ({ y }) => (y > top ? { typeId: "minecraft:air", isAir: true } : y >= 30 ? { typeId: kind, isAir: false } : { typeId: "minecraft:stone", isAir: false }),
});
let at = M.lavaSurface(column(40), { x: 5, y: 45, z: 7 });
check("a lava pool's top block under air is a lava position", at?.pos === "lava" && at.ground.y === 40);
check("the Pokemon comes in that block", at.spot.x === 5.5 && at.spot.y === 40 && at.spot.z === 7.5);
check("flowing lava counts", M.lavaSurface(column(40, "minecraft:flowing_lava"), { x: 0, y: 45, z: 0 })?.pos === "lava");
check("lava more than 16 blocks below the player is out of reach", M.lavaSurface(column(40), { x: 0, y: 60, z: 0 }) === undefined);
check("water is not lava", M.lavaSurface(column(40, "minecraft:water"), { x: 0, y: 45, z: 0 }) === undefined);
check("the spawner takes it before the ground", M.spawnerSpot(column(40), { x: 0, y: 45, z: 0 })?.pos === "lava");
