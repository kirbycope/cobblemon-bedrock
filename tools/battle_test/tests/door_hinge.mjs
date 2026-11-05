// Door hinges (DoorBlock.getHinge): a door beside a door of its kind takes the other hinge, solid blocks either side
// outvote the click, and failing both the half of the block the player clicked decides
import { M, check } from "../harness.mjs";

// a placed door facing the given way at the origin, with the given blocks round it (key "x,y,z")
function door(facing, around = {}) {
    const dimension = { getBlock: ({ x, y, z }) => { const t = around[`${x},${y},${z}`]; return t && { typeId: t, isAir: false, isLiquid: false, permutation: { getState: () => 0 } }; } };
    return { typeId: "cobblemon:apricorn_door", x: 0, y: 64, z: 0, dimension, permutation: { getState: (s) => s === "minecraft:cardinal_direction" ? facing : 0 } };
}
check("a door with a door to its left takes the right hinge, making a double door", M.doorHinge(door("north", { "-1,64,0": "cobblemon:apricorn_door" })) === "right");
check("and one with a door to its right the left", M.doorHinge(door("north", { "1,64,0": "cobblemon:apricorn_door" })) === "left");
check("walls on the right side take the hinge there", M.doorHinge(door("north", { "1,64,0": "minecraft:stone", "1,65,0": "minecraft:stone" })) === "right");
check("facing south, left and right swap round", M.doorHinge(door("south", { "1,64,0": "minecraft:stone" })) === "left");
check("with nothing either side, a click on the right half hinges right", M.doorHinge(door("north"), { x: 0.8, z: 0.5 }) === "right" && M.doorHinge(door("north"), { x: 0.2, z: 0.5 }) === "left");
