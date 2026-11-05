// HeartyGrainsBlock.canSurvive: planted in a water source on dirt, sand, gravel or farmland, on land on mud, muddy
// mangrove roots or farmland
import { M, check } from "../harness.mjs";

check("in water on dirt or sand", M.heartyGrainsSurvive(true, "minecraft:dirt") && M.heartyGrainsSurvive(true, "minecraft:sand"));
check("in water on gravel or farmland", M.heartyGrainsSurvive(true, "minecraft:gravel") && M.heartyGrainsSurvive(true, "minecraft:farmland"));
check("not in water on stone", !M.heartyGrainsSurvive(true, "minecraft:stone"));
check("on land on mud or farmland", M.heartyGrainsSurvive(false, "minecraft:mud") && M.heartyGrainsSurvive(false, "minecraft:farmland"));
check("but not on land on dirt or sand", !M.heartyGrainsSurvive(false, "minecraft:dirt") && !M.heartyGrainsSurvive(false, "minecraft:sand"));
