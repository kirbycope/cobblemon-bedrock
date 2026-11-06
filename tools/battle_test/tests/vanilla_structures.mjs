// Spawns at vanilla structures (Cobblemon 1.8.3's #cobblemon:spawns tags: swamp huts, fortresses, monuments), told by
// the structure's biome and its own blocks, as the script API cannot name a block's structure without the Beta APIs
import { M, F, check } from "../harness.mjs";

const dim = (blocks) => ({ id: "minecraft:overworld", getBlock: () => ({ typeId: "minecraft:grass_block" }),
                           containsBlock: (volume, { includeTypes }) => includeTypes.some((t) => blocks.includes(t)) });
const spot = { x: 900.5, y: 70, z: 900.5 }, ground = { x: 900, y: 69, z: 900 };
const hut = { entity: "cobblemon:p0856_hatenna", vanilla: ["minecraft:swamp_hut"] };
check("a swamp hut spawn comes by the hut's spruce planks in a swamp", M.placeTest(dim(["minecraft:spruce_planks"]), spot, ground, ["swamp"]).fits(hut));
check("not by spruce planks outside a swamp", !M.placeTest(dim(["minecraft:spruce_planks"]), spot, ground, ["taiga"]).fits(hut));
check("nor in a swamp without them", !M.placeTest(dim([]), spot, ground, ["swamp"]).fits(hut));
const fortress = { entity: "cobblemon:p0679_honedge", vanilla: ["minecraft:bastion_remnant", "minecraft:fortress"] };
check("a fortress or bastion spawn comes by either's blocks in the Nether", M.placeTest(dim(["minecraft:nether_brick"]), spot, ground, ["nether"]).fits(fortress)
      && M.placeTest(dim(["minecraft:gilded_blackstone"]), spot, ground, ["nether"]).fits(fortress));

const at = F.SPECIAL_SPAWNS.filter((sp) => sp.vanilla);
const species = new Set(at.map((sp) => sp.entity.split("_").pop()));
check("the vanilla structures' spawns are the spawner's", at.length > 50 && species.has("honedge") && species.has("hatenna") && species.has("qwilfish"),
      `${at.length} entries`);
