// CobbleFurnies' furniture (scripts/furniture.js): sitting on a seat (SeatBlock, SeatEntity) and its comparator, the
// lamps' switch and redstone (LampBlock), the TV's channels (TVBlock) and the Furni Crafter's recipes and crafting
// (FurniCrafterMenu). The module is copied beside its data table into a folder of its own, as harness.mjs copies main.js,
// so Node reads it as an ES module; the stubs stand in for @minecraft/server.
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { check } from "../harness.mjs";

const pack = fileURLToPath(new URL("../../../development_behavior_packs/cobblemon/", import.meta.url));
const copy = mkdtempSync(join(tmpdir(), "cobblemon-furniture-"));
for (const f of ["furniture.js", "furniture_data.js"]) cpSync(join(pack, "scripts", f), join(copy, f));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const Fu = await import(pathToFileURL(join(copy, "furniture.js")).href);
const { FURNI_SEATS, FURNI_RECIPES } = await import(pathToFileURL(join(copy, "furniture_data.js")).href);

// --- the data table ---
check("the seats are the pack's stools, sofas and chairs", Object.keys(FURNI_SEATS).length >= 17 && Object.keys(FURNI_SEATS).every((id) => /_(stool|sofa|chair|armchair|toilet)$/.test(id)));
check("each seat is 0.35 up (seatHeight), a toilet 0.45 and the Poke Ball chair 0.5", Object.entries(FURNI_SEATS).every(([id, h]) => h === (id.endsWith("_toilet") ? 0.45 : id === "cobblefurnies:poke_ball_chair" ? 0.5 : 0.35)));
check("the Furni Crafter lists a recipe for every piece the pack has one for", FURNI_RECIPES.length >= 50);
check("each result is a block the pack has", FURNI_RECIPES.every((r) => existsSync(join(pack, "blocks", `${r[0].split(":")[1]}.json`))));
check("each recipe is listed once (a dark stool's recipe repeats the plain stool's upstream; the repeat is dropped)", new Set(FURNI_RECIPES.map((r) => JSON.stringify([r[0], r[1], r[4]]))).size === FURNI_RECIPES.length && FURNI_RECIPES.filter((r) => r[0] === "cobblefurnies:green_stool").length === 1);
const sofa = FURNI_RECIPES.find((r) => r[0] === "cobblefurnies:red_sofa");
check("a red sofa is 1 red wool and 2 sticks (furni_crafting/red_sofa.json)", JSON.stringify(sofa?.[4]) === JSON.stringify([["minecraft:red_wool", 1], ["minecraft:stick", 2]]) && sofa[1] === 1 && sofa[2] === "Red Sofa");
check("a recipe's icon is a pack texture path", FURNI_RECIPES.every((r) => typeof r[3] === "string" && r[3].startsWith("textures/blocks/cobblefurnies/")));
check("the search matches the result's name, case blind (applySearchFilter)", Fu.furniShown("RED").every((r) => r[2].toLowerCase().includes("red")) && Fu.furniShown("red").length >= 3 && Fu.furniShown(" ").length === FURNI_RECIPES.length);

// --- a seat, a player and the entity the sitter rides, faked ---
function scene({ typeId = "cobblefurnies:red_stool", facing = "north", type, sneaking = false, riding = false, above = "minecraft:air", seat = null, leashed = [] } = {}) {
    const states = { "minecraft:cardinal_direction": facing, "cobblemon:signal": 0, ...(type ? { "cobblemon:type": type } : {}) };
    const sounds = [];
    let entity = seat, removed = false;
    const makeSeat = (at) => {
        const riders = [];
        entity = { location: at, yaw: null, riders, removed: false,
                   getComponent: (k) => (k === "minecraft:rideable" ? { getRiders: () => riders, addRider: (e) => { riders.push(e); return true; }, ejectRider: (e) => { riders.splice(riders.indexOf(e), 1); } } : undefined),
                   setRotation: (r) => { entity.yaw = r.y; }, remove: () => { entity.removed = true; removed = true; },
                   dimension: { getBlock: () => block } };
        return entity;
    };
    const block = {
        typeId, location: { x: 10, y: 64, z: -3 },
        permutation: { getState: (k) => states[k], withState(k, v) { const next = { ...states, [k]: v }; return { getState: (kk) => next[kk], withState: this.withState.bind({ ...this, states: next }), states: next }; } },
        setPermutation: (p) => { Object.assign(states, p.states); },
        above: () => ({ typeId: above, isAir: above === "minecraft:air", isLiquid: above === "minecraft:water", isSolid: above === "minecraft:stone" }),
        dimension: { getEntities: ({ type }) => (type === "cobblemon:seat" && entity && !entity.removed ? [entity] : type ? [] : leashed), spawnEntity: (id, at) => makeSeat(at), playSound: (id) => sounds.push(id) },
    };
    const player = { id: "p1", typeId: "minecraft:player", isSneaking: sneaking, yaw: null, location: { x: 10.5, y: 64, z: -2 }, dimension: block.dimension,
                     getComponent: (k) => (k === "minecraft:riding" ? (riding ? { entityRidingOn: {} } : undefined) : undefined), setRotation: (r) => { player.yaw = r.y; } };
    return { block, player, states, sounds, seat: () => entity, removed: () => removed };
}
// withState above chains through a fresh permutation; make setPermutation read the chained states
function fixPerm(s) {
    s.block.permutation.withState = function withState(k, v) {
        const next = { ...(this.states ?? s.states), [k]: v };
        return { states: next, getState: (kk) => next[kk], withState: withState.bind({ states: next }) };
    };
}

let s = scene(); fixPerm(s);
check("a click sits the player: a seat entity at the block's middle", Fu.useSeat(s.block, s.player) && s.seat() && s.seat().location.x === 10.5 && s.seat().location.z === -2.5);
check("a stool's entity stands at the block's bottom (seatHeight 0.35 is the entity's own seat)", Math.abs(s.seat().location.y - 64.001) < 1e-9);
check("the player rides it", s.seat().riders[0] === s.player);
check("turned to face the way the stool faces (setRiderRotation: north is 180)", s.seat().yaw === 180 && s.player.yaw === 180);
check("and the seat's comparator reads 15", s.states["cobblemon:signal"] === 15);
check("a click on a seat a player sits on does nothing (ejectSeatedExceptPlayer)", !Fu.useSeat(s.block, s.player) && s.seat().riders.length === 1);

s = scene({ typeId: "cobblefurnies:red_sofa", facing: "east", type: "inner_left" }); fixPerm(s);
Fu.useSeat(s.block, s.player);
check("a sofa's inner left corner turns the sitter 45 degrees (SofaBlock.setRiderRotation: east -90, less 45)", s.seat().yaw === -135);
s = scene({ typeId: "cobblefurnies:red_sofa", facing: "south", type: "outer_right" }); fixPerm(s);
Fu.useSeat(s.block, s.player);
check("and an outer right corner the other way", s.seat().yaw === 45);

s = scene({ sneaking: true }); fixPerm(s);
check("a sneaking player does not sit (isCrouching)", !Fu.useSeat(s.block, s.player) && !s.seat());
s = scene({ riding: true }); fixPerm(s);
check("nor one already riding (isPassenger)", !Fu.useSeat(s.block, s.player) && !s.seat());
s = scene({ above: "minecraft:stone" }); fixPerm(s);
check("nor with a solid block over the seat (isSeatBlocked)", !Fu.useSeat(s.block, s.player) && !s.seat());
s = scene({ above: "minecraft:water" }); fixPerm(s);
check("water over it is no block", Fu.useSeat(s.block, s.player));

// a seat a mob sits on: the click puts the mob off and seats nobody
s = scene(); fixPerm(s);
Fu.useSeat(s.block, s.player);
const pig = { id: "pig", typeId: "minecraft:pig" };
s.seat().riders.splice(0, 1, pig);
check("a click on a seat a mob sits on puts the mob off and seats nobody", Fu.useSeat(s.block, s.player) && s.seat().riders.length === 0);

// a leashed Pokemon sits in the player's place (getLeashed)
const leash = (id, typeId, holder = "p1", extra = {}) => ({ id, typeId, yaw: null, setRotation(r) { this.yaw = r.y; }, getComponent: (k) => (k === "minecraft:leashable" ? { isLeashed: true, leashHolder: { id: holder } } : k === "minecraft:is_tamed" && extra.tamed ? {} : undefined) });
s = scene({ leashed: [leash("w", "minecraft:wolf"), leash("m", "cobblemon:p0025_pikachu")] }); fixPerm(s);
Fu.useSeat(s.block, s.player);
check("a leashed Pokemon sits in the player's place", s.seat().riders[0]?.id === "m");
check("a leashed wolf that is not tamed does not (canBePickedUp)", !Fu.canSit(leash("w", "minecraft:wolf")) && Fu.canSit(leash("w", "minecraft:wolf", "p1", { tamed: true })) && Fu.canSit({ typeId: "minecraft:pig" }) && !Fu.canSit({ typeId: "minecraft:zombie" }));
s = scene({ leashed: [leash("w", "minecraft:pig", "someone_else")] }); fixPerm(s);
Fu.useSeat(s.block, s.player);
check("a mob on someone else's leash is left alone", s.seat().riders[0] === s.player);

// SeatEntity.tick: an empty seat goes, and the signal with it; a seat whose block is gone goes too
s = scene(); fixPerm(s);
Fu.useSeat(s.block, s.player);
Fu.tickSeat(s.seat());
check("a seat someone sits on stays on its tick", !s.removed() && s.states["cobblemon:signal"] === 15);
s.seat().riders.length = 0;
Fu.tickSeat(s.seat());
check("one nobody sits on goes, and the comparator falls to 0", s.removed() && s.states["cobblemon:signal"] === 0);
s = scene(); fixPerm(s);
Fu.useSeat(s.block, s.player);
s.block.typeId = "minecraft:air";
Fu.tickSeat(s.seat());
check("a seat whose block was broken goes, its rider with it", s.removed());

// --- lamps ---
function lamp({ lit = false, powered = false, power = {} } = {}) {
    const states = { "cobblemon:lit": lit, "cobblemon:powered": powered, "cobblemon:mount_type": "floor" }, sounds = [];
    const block = { typeId: "cobblefurnies:red_lamp", location: { x: 0, y: 64, z: 0 }, dimension: { playSound: (id) => sounds.push(id) },
                    getRedstonePower: () => power.self ?? 0 };
    for (const side of ["above", "below", "north", "south", "east", "west"]) block[side] = () => ({ getRedstonePower: () => power[side] ?? 0 });
    block.permutation = { states, getState: (k) => states[k], withState(k, v) { const next = { ...this.states, [k]: v }; return { ...this, states: next, getState: (kk) => next[kk] }; } };
    block.setPermutation = (p) => { Object.assign(states, p.states); };
    return { block, states, sounds };
}
let l = lamp();
Fu.useLamp(l.block);
check("a click lights a lamp, with a lever's click", l.states["cobblemon:lit"] === true && l.sounds[0] === "random.click");
Fu.useLamp(l.block);
check("and the next puts it out", l.states["cobblemon:lit"] === false);
l = lamp({ lit: true, powered: true });
Fu.useLamp(l.block);
check("a lamp redstone holds on stays lit through a click", l.states["cobblemon:lit"] === true);
l = lamp({ power: { west: 15 } });
Fu.tickLamp(l.block);
check("redstone beside an unlit lamp lights it (neighborChanged) and it remembers the power", l.states["cobblemon:lit"] === true && l.states["cobblemon:powered"] === true);
l.block.west = () => ({ getRedstonePower: () => 0 });
Fu.tickLamp(l.block);
check("the power going puts it out", l.states["cobblemon:lit"] === false && l.states["cobblemon:powered"] === false);
l = lamp({ lit: true });
Fu.tickLamp(l.block);
check("a hand-lit lamp with no redstone keeps burning on its ticks", l.states["cobblemon:lit"] === true);
check("power is read from the six neighbours and the block itself", Fu.redstoneNear(lamp({ power: { self: 3 } }).block) && Fu.redstoneNear(lamp({ power: { above: 1 } }).block) && !Fu.redstoneNear(lamp().block));

// --- the TV ---
const tv = (() => { const states = { "cobblemon:channel": 1 }; const b = { typeId: "cobblefurnies:tv", permutation: { getState: (k) => states[k], withState: (k, v) => ({ states: { ...states, [k]: v }, getState: (kk) => (kk === k ? v : states[kk]) }) }, setPermutation: (p) => Object.assign(states, p.states) }; return { b, states }; })();
Fu.useTv(tv.b); const c2 = tv.states["cobblemon:channel"];
Fu.useTv(tv.b); const c3 = tv.states["cobblemon:channel"];
Fu.useTv(tv.b);
check("a click turns the TV's channel 1 to 2 to 3 and round to 1 (CHANNEL_1_3 cycle)", c2 === 2 && c3 === 3 && tv.states["cobblemon:channel"] === 1);

// --- the Furni Crafter ---
const stack = (typeId, amount) => ({ typeId, amount });
function crafter(slots) {
    const inv = { size: 36, getItem: (i) => slots[i], setItem: (i, v) => { slots[i] = v; }, addItem: (it) => { added.push([it.typeId, it.amount]); return undefined; } };
    const added = [], said = [], sounds = [];
    const player = { getComponent: () => ({ container: inv }), sendMessage: (t) => said.push(String(t)), playSound: (id) => sounds.push(id), dimension: { spawnItem() { } }, location: {} };
    return { inv, player, slots, added, said, sounds };
}
let c = crafter([stack("minecraft:red_wool", 1), undefined, stack("minecraft:stick", 1), stack("minecraft:stick", 1)]);
check("canCraft counts a material across the inventory's stacks", Fu.canCraftFurni(c.inv, sofa));
check("crafting takes the materials, the first stacks first, and gives the result", Fu.craftFurni(c.player, sofa) && c.slots[0] === undefined && c.slots[2] === undefined && c.slots[3] === undefined && JSON.stringify(c.added) === JSON.stringify([["cobblefurnies:red_sofa", 1]]));
c = crafter([stack("minecraft:red_wool", 3), stack("minecraft:stick", 5)]);
Fu.craftFurni(c.player, sofa);
check("a stack keeps what is left", c.slots[0].amount === 2 && c.slots[1].amount === 3 && c.sounds[0] === "random.click");
c = crafter([stack("minecraft:red_wool", 1), stack("minecraft:stick", 1)]);
check("too few of a material makes nothing and says what is short", !Fu.craftFurni(c.player, sofa) && c.added.length === 0 && c.slots[0].amount === 1 && c.said[0]?.includes("2 Stick") && !c.said[0].includes("Red Wool"));
const stools = FURNI_RECIPES.find((r) => r[0] === "cobblefurnies:red_stool");
check("a stool's recipe is in the table too", !!stools && stools[4].every(([id, n]) => typeof id === "string" && n > 0));

// --- what port.py writes for them, checked once the port has run ---
const blocks = join(pack, "blocks");
const stool = JSON.parse(readFileSync(join(blocks, "red_stool.json"), "utf-8"))["minecraft:block"];
check("a seat block carries cobblemon:seat and a cobblemon:signal state with the comparator's 15 (after a port run)",
      "cobblemon:seat" in stool.components && JSON.stringify(stool.description.states?.["cobblemon:signal"]) === "[0,15]"
      && stool.permutations?.some((p) => p.condition.includes("cobblemon:signal") && p.components["minecraft:redstone_producer"]?.power === 15));
const redLamp = JSON.parse(readFileSync(join(blocks, "red_lamp.json"), "utf-8"))["minecraft:block"];
check("a lamp carries cobblemon:lamp, a cobblemon:powered state and a tick every ten (after a port run)",
      "cobblemon:lamp" in redLamp.components && JSON.stringify(redLamp.description.states?.["cobblemon:powered"]) === "[false,true]" && redLamp.components["minecraft:tick"]?.interval_range?.[0] === 10);
const tvBlock = JSON.parse(readFileSync(join(blocks, "tv.json"), "utf-8"))["minecraft:block"];
check("the TV carries cobblemon:tv (after a port run)", "cobblemon:tv" in tvBlock.components);
check("the Furni Crafter is a block of the pack (after a port run)", existsSync(join(blocks, "furnicrafter.json")));
check("the seat entity exists, rideable at 0.35 up (after a port run)", (() => {
    try { const e = JSON.parse(readFileSync(join(pack, "entities", "seat.behavior.json"), "utf-8"))["minecraft:entity"]; return e.description.identifier === "cobblemon:seat" && e.components["minecraft:rideable"].seats[0].position[1] === 0.35; } catch (e) { return false; }
})());
check("the Poke Wool carpets, and the crafter from shears and an iron axe over planks, are crafting table recipes (after a port run)", (() => {
    try {
        const carpet = JSON.parse(readFileSync(join(pack, "recipes", "cobblefurnies_red_poke_wool_carpet.json"), "utf-8"))["minecraft:recipe_shaped"];
        const crafterRecipe = JSON.parse(readFileSync(join(pack, "recipes", "cobblefurnies_furnicrafter.json"), "utf-8"))["minecraft:recipe_shaped"];
        return carpet.result.item === "cobblefurnies:red_poke_wool_carpet" && carpet.result.count === 3 && carpet.key.C.item === "cobblefurnies:red_poke_wool"
            && crafterRecipe.key.A.tag === "minecraft:planks" && crafterRecipe.key.B.item === "minecraft:shears" && crafterRecipe.key.C.item === "minecraft:iron_axe" && JSON.stringify(crafterRecipe.pattern) === '["BC","AA"]';
    } catch (e) { return false; }
})());
