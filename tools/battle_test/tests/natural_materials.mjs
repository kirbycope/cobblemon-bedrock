// The Restoration Tank takes every natural material Cobblemon names, its own foods among them
import { readFileSync } from "node:fs";
import { check } from "../harness.mjs";

const js = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/blocks.js", import.meta.url), "utf-8");
const fossils = JSON.parse(js.match(/export const FOSSILS = (\{.*\});/)[1]);
check("a Roasted Leek is worth 1", fossils.materials["cobblemon:roasted_leek"]?.[0] === 1);
check("Leek and Potato Stew 4, its bowl given back", fossils.materials["cobblemon:leek_and_potato_stew"]?.[0] === 4 && fossils.materials["cobblemon:leek_and_potato_stew"][1] === "minecraft:bowl");
check("and the berries still count", fossils.materials["cobblemon:oran_berry"]?.[0] === 2);
