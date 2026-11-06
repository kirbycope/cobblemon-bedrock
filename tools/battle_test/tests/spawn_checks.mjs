// Spawning and fishing checks (scripts/spawn_checks.js and main.js): a spawn entry's own drops, the anticondition, light
// and x checks a spawn rule cannot make, herd moon phases, the fishing wait in rain and shade, the no-bite reel, the open
// water the treasure needs, and the Poke Snack's cap
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { M, check } from "../harness.mjs";

// the module is an ES module in a folder with no package.json, which this Node reads as CommonJS: a copy beside one that
// says so loads it, as the harness loads main.js
const copy = mkdtempSync(join(tmpdir(), "cobblemon-spawn-checks-"));
cpSync(new URL("../../../development_behavior_packs/cobblemon/scripts/spawn_checks.js", import.meta.url), join(copy, "spawn_checks.js"));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const { ENTRY_DROPS, markEntryDrops, entryDrops, moonPhaseOk, inBounds, fishStep, NO_BITE_HOOK, NO_BITE_TEXT, rodLoot, isOpenWater, SNACK_PER_AREA } =
    await import(pathToFileURL(join(copy, "spawn_checks.js")).href);

const store = () => { const m = new Map(); return { getDynamicProperty: (k) => m.get(k), setDynamicProperty: (k, v) => (v === undefined ? m.delete(k) : m.set(k, v)) }; };
{
    const e = store(), table = [1, 3, [["minecraft:ghast_tear", 5.0, 1, 1, 1, 1], ["cobblemon:spell_tag", 2.5, 1, 1, 1, 1]]];
    markEntryDrops(e, { drops: table });
    check("an entry's drop table is kept on the Pokemon", JSON.stringify(entryDrops(e)) === JSON.stringify(table));
    check("under cobblemon:drops", typeof e.getDynamicProperty(ENTRY_DROPS) === "string");
    const plain = store();
    markEntryDrops(plain, { entity: "cobblemon:p0092_gastly" });
    check("an entry without one leaves nothing", entryDrops(plain) === undefined);
    // getDrops rolls the entry's table as it rolls a species' (DropTable.getDrops): every drop comes from the table
    const random = Math.random; Math.random = () => 0.01;
    try { check("and the table rolls as a species' does", M.getDrops(table).every((d) => d[0] === "minecraft:ghast_tear" || d[0] === "cobblemon:spell_tag")); }
    finally { Math.random = random; }
}
{
    check("a full moon herd fits phase 0", moonPhaseOk("0", 0) && !moonPhaseOk("0", 3));
    check("a range fits its phases", moonPhaseOk("1-3", 2) && !moonPhaseOk("1-3", 5));
    check("a list fits any of them", moonPhaseOk("0,4", 4) && !moonPhaseOk("0,4", 1));
    check("no moon phase fits every moon", moonPhaseOk(undefined, 6));
}
{
    check("Shellos' East Sea from x 0", inBounds(5, [0, null]) && !inBounds(-5, [0, null]));
    check("the West Sea west of it", inBounds(-5, [null, -1]) && !inBounds(5, [null, -1]));
    check("a light range", inBounds(7, [null, 7]) && !inBounds(8, [null, 7]) && inBounds(9, [8, null]));
}
{
    // the dimension the spawn-event checks read: x bounds and a cove-floor anticondition (minY, maxY), nothing else set
    const dim = { getWeather: () => { throw new Error("stub"); }, getLightLevel: () => { throw new Error("stub"); } };
    check("Shellos east of x 0 stays", M.entryHolds({ top: 1, wm: [], x: [0, null] }, dim, { x: 12, y: 64, z: 3 }));
    check("and goes west of it", !M.entryHolds({ top: 1, wm: [], x: [0, null] }, dim, { x: -12, y: 64, z: 3 }));
    const cove = { top: 1, wm: [], anti: [{ minY: -41, maxY: 9 }] };
    check("an anticondition holding whole takes the spawn away", !M.entryHolds(cove, dim, { x: 0, y: 0, z: 0 }));
    check("and not where a field of it fails", M.entryHolds(cove, dim, { x: 0, y: 40, z: 0 }));
    check("a light the dimension cannot tell keeps the spawn", M.entryHolds({ top: 1, wm: [], light: [8, null] }, dim, { x: 0, y: 64, z: 0 }));
    const lit = { ...dim, getLightLevel: () => 3 };
    check("Venonat's minLight 8 fails in the dark", !M.entryHolds({ top: 1, wm: [], light: [8, null] }, lit, { x: 0, y: 64, z: 0 }));
    check("Misdreavus' maxLight 7 holds there", M.entryHolds({ top: 1, wm: [], light: [null, 7] }, lit, { x: 0, y: 64, z: 0 }));
}
{
    // the spawner's and snack's draws test minX and maxX too (spawnAllowed)
    const cast = { effects: [], luck: 0, lure: 0 }, bobber = (x) => ({ location: { x, y: 63, z: 0 }, sky: true, dimension: {} });
    const east = { entity: "cobblemon:p0422_shellos", bucket: "common", weight: 1, biome: null, minX: 0 };
    check("the spawner keeps East Sea Shellos east", M.spawnAllowed(east, cast, bobber(40), []) && !M.spawnAllowed(east, cast, bobber(-40), []));
}
{
    const always = (v) => () => v;
    check("a dry tick steps the wait by one", fishStep(false, true, always(0.9)) === 1);
    check("rain on the bobber steps it by two a quarter of the time", fishStep(true, true, always(0.1)) === 2 && fishStep(true, true, always(0.5)) === 1);
    check("no sky holds it half the time", fishStep(false, false, always(0.1)) === 0 && fishStep(false, false, always(0.7)) === 1);
    check("rain under cover cancels out", fishStep(true, false, always(0.1)) === 1);
    check("the no-bite window is 17 to 30 ticks", NO_BITE_HOOK[0] === 17 && NO_BITE_HOOK[1] === 30 && NO_BITE_TEXT === "Not even a nibble.");
}
{
    check("junk 66, Cobblemon's treasure 17, vanilla's 17", rodLoot(true, 10) === "junk" && rodLoot(true, 65.9) === "junk" && rodLoot(true, 70) === "cobblemon" && rodLoot(true, 90) === "vanilla");
    check("out of open water only junk", rodLoot(false, 90) === "junk" && rodLoot(false, 70) === "junk");
    const water = { typeId: "minecraft:water", isAir: false }, air = { typeId: "minecraft:air", isAir: true }, stone = { typeId: "minecraft:stone", isAir: false }, lily = { typeId: "minecraft:waterlily", isAir: false };
    const sea = (blockAt) => ({ getBlock: (p) => blockAt(p) });
    check("water under open air is open water", isOpenWater(sea((p) => (p.y <= 63 ? water : air)), { x: 0.5, y: 63.2, z: 0.5 }));
    check("a lily pad on it counts as open", isOpenWater(sea((p) => (p.y <= 63 ? water : p.y === 64 && p.x === 2 ? lily : air)), { x: 0.5, y: 63.2, z: 0.5 }));
    check("a block in the 5 by 5 about it is not", !isOpenWater(sea((p) => (p.y <= 63 ? (p.x === 2 && p.z === 2 ? stone : water) : air)), { x: 0.5, y: 63.2, z: 0.5 }));
    check("nor air under the bobber", !isOpenWater(sea((p) => (p.y === 62 ? air : p.y === 63 ? water : air)), { x: 0.5, y: 63.2, z: 0.5 }));
    check("a block the script cannot read counts as open", isOpenWater(sea(() => { throw new Error("unloaded"); }), { x: 0, y: 63, z: 0 }));
}
{
    check("a snack waits at eighteen Pokemon in its 3 by 3 chunks (pokeSnackPokemonPerChunk 2)", SNACK_PER_AREA === 18);
}
{
    // generated by the next port run (create_spawn_rules): the wild preset's anticondition on the natural spawns, a herd
    // member's dropTable in herds.js, and spawn tables carrying an entry's drops and Shellos' minX
    const scripts = "../../../development_behavior_packs/cobblemon/scripts/";
    const read = (name) => readFileSync(new URL(scripts + name, import.meta.url), "utf-8");
    const table = (text) => JSON.parse(text.slice(text.indexOf("= ") + 2).trim().replace(/;$/, ""));
    let mults = {}, herds = [];
    try { mults = table(read("spawn_multipliers.js")); herds = table(read("herds.js")); } catch (e) { }
    const pinsir = mults["cobblemon:p0127_pinsir"] ?? [];
    check("after the port: Pinsir's wild anticondition (a village with concrete about) rides its spawn event", pinsir.some((e) => e.anti?.some((a) => a.village && a.near)), "needs a port run");
    check("after the port: Gastly's Nether entry carries its own drops", (mults["cobblemon:p0092_gastly"] ?? []).some((e) => e.drops), "needs a port run");
    check("after the port: the Ponyta herd's members carry their dropTable", herds.some((h) => h.members.some((m) => m.entity === "cobblemon:p0077_ponyta" && m.drops)), "needs a port run");
    check("after the port: Shellos' East Sea entries carry minX", (mults["cobblemon:p0422_shellos"] ?? []).some((e) => e.x && e.x[0] === 0), "needs a port run");
}
