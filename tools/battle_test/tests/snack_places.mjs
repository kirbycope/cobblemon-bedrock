// A Poke Snack draws the spawns that need a place (PokeSnackSpawnerFactory runs the world spawner's conditions): blocks
// nearby, the block beneath, a mansion, one of Cobblemon's structures, tested at the snack's spot as the spawner does
import { M, F, check } from "../harness.mjs";

const dim = (base, around) => ({
    id: "minecraft:overworld",
    getBlock: () => ({ typeId: base }),
    containsBlock: (volume, { includeTypes }) => includeTypes.some((t) => around.includes(t)),
});
const spot = { x: 5000.5, y: 70, z: 5000.5 }, ground = { x: 5000, y: 69, z: 5000 };

const mansion = { entity: "cobblemon:p0132_ditto", mansion: true, base: ["minecraft:dark_oak_planks"] };
check("a mansion spawn fits on its floor in a dark forest", M.placeTest(dim("minecraft:dark_oak_planks", []), spot, ground, ["roofed"]).fits(mansion));
check("not outside one", !M.placeTest(dim("minecraft:dark_oak_planks", []), spot, ground, ["forest"]).fits(mansion));
check("nor on another floor", !M.placeTest(dim("minecraft:grass_block", []), spot, ground, ["roofed"]).fits(mansion));

const ore = { entity: "cobblemon:p0074_geodude", near: ["minecraft:iron_ore"] };
check("a nearby-block spawn fits by its blocks", M.placeTest(dim("minecraft:stone", ["minecraft:iron_ore"]), spot, ground, []).fits(ore));
check("and not without them", !M.placeTest(dim("minecraft:stone", []), spot, ground, []).fits(ore));

const tower = { entity: "cobblemon:p0999_gimmighoul", structures: ["cobblemon:ruins/temperate_gimmi_tower"] };
check("a structure spawn does not fit where no structure stands", !M.placeTest(dim("minecraft:stone", []), spot, ground, []).fits(tower));
check("a spawn that needs nothing fits anywhere", M.placeTest(dim("minecraft:stone", []), spot, ground, []).fits({ entity: "cobblemon:p0016_pidgey" }));

// the pool itself, once port.py has written the places into it
const placed = F.SNACK_SPAWNS.filter((sp) => sp.near || sp.base || sp.mansion || sp.structures);
check("the snack pool carries the spawns that need a place", placed.length > 0 && F.SNACK_SPAWNS.some((sp) => sp.entity.endsWith("ditto") && sp.mansion),
      `${placed.length} of ${F.SNACK_SPAWNS.length}`);
