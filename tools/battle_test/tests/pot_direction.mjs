// CampfirePotItem's item direction (the side toward the player who set the pot on) and CampfireBlockEntity's leftovers:
// into a container on that side, else dropped 0.7 blocks out that way
import { M, check } from "../harness.mjs";
import { world } from "../stub_server.mjs";

check("a player facing south sets the pot's item direction north, back at them", M.potItemDirection(0) === "north");
check("facing west (90), east", M.potItemDirection(90) === "east");
check("facing north (180 or -180), south", M.potItemDirection(180) === "south" && M.potItemDirection(-180) === "south");
check("facing east (-90), west", M.potItemDirection(-90) === "west");

const pot = (dir, container) => {
    const block = { location: { x: 10, y: 64, z: 10 }, dimension: { id: "minecraft:overworld", spawned: [],
        getBlock: (at) => (at.x === 10 && at.z === 9 && container ? { getComponent: () => ({ container }) } : undefined),
        spawnItem(item, at) { this.spawned.push({ item, at }); return { clearVelocity() { }, applyImpulse() { } }; } } };
    world.setDynamicProperty(`cobblemon:pot|minecraft:overworld|10,64,10|d`, dir);   // potKey|d
    return block;
};
const stored = [];
const chest = pot("north", { addItem: (item) => { stored.push(item.typeId); return undefined; } });
M.potLeftover(chest, "minecraft:bucket");
check("a leftover goes into the container on the item direction's side", stored[0] === "minecraft:bucket" && chest.dimension.spawned.length === 0);
const bare = pot("north", null);
M.potLeftover(bare, "minecraft:glass_bottle");
const drop = bare.dimension.spawned[0];
check("with none there it drops 0.7 blocks out that way", drop?.item.typeId === "minecraft:glass_bottle" && Math.abs(drop.at.z - (10 + 0.5 - 0.7)) < 1e-9 && drop.at.x === 10.5);
