// Furfrou wears a dye with no look of its own (Cobblemon has none), which its trim then takes off
import { M, mon, check } from "../harness.mjs";

const furfrou = mon("Furfrou").entity;
check("Furfrou can wear a dye", M.cosmeticLook(furfrou, "minecraft:pink_dye") === -1);
check("but not an item that is no cosmetic of its", M.cosmeticLook(furfrou, "minecraft:stick") === null);
