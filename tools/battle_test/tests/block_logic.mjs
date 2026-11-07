// block_logic.js: the Monitor on its own (FossilMultiblockEntity), the Disc Shelf's slots (DiscShelfBlockEntity),
// the fossil machine's comparators and breaking (FossilMultiblockStructure) and the gilded chest's shut lid
import { check, mod } from "../harness.mjs";
const B = await mod("block_logic.js");

B.initBlockLogic({
    TM_INDEX: new Map([["cobblemon:tm_flamethrower", 0], ["cobblemon:tm_darkpulse", 1], ["cobblemon:tm_tackle", 2]]),
    MOVES: { flamethrower: { type: "fire" }, darkpulse: { type: "dark" }, tackle: { type: "normal" } },
    FOSSILS: { materialToStart: 128, reviveSeconds: 720 },
    setProp: (e, k, v) => e.props.set(k, v), LEVEL: "cobblemon:level", rollAlpha() { },
});

// the disc screens: a music disc the MUSIC screen, a TM its type's, over the two disc states
check("no disc: the screen off", B.discScreen(undefined).join() === "off,none,none");
check("a music disc shows the music screen", B.discScreen("minecraft:music_disc_cat").join() === "music,none,none");
check("a Fire TM shows TM_FIRE", B.discScreen("cobblemon:tm_flamethrower").join() === "off,fire,none");
check("a Dark TM shows TM_DARK from the second state", B.discScreen("cobblemon:tm_darkpulse").join() === "off,none,dark");
check("a Normal TM shows TM_NORMAL", B.discScreen("cobblemon:tm_tackle").join() === "off,normal,none");
check("every type has a screen, 15 and 3 beside none", B.DISC_A.length === 16 && B.DISC_B.length === 4);
check("a TM, a music disc, the Upgrade and the Dubious Disc are known", B.isTm("cobblemon:tm_tackle") && B.isMusicDisc("minecraft:music_disc_13") && B.isPorygonItem("cobblemon:upgrade") && B.isPorygonItem("cobblemon:dubious_disc") && !B.isTm("minecraft:diamond"));

// FossilMultiblockEntity.spawnPorygon: an Upgrade gives a Porygon at 20, one in five a Porygon2 at 25; a Dubious Disc
// a Porygon-Z at 35 half the time, else nothing
check("an Upgrade gives a Porygon at level 20", B.porygonFor("upgrade", 0.5)?.join() === "cobblemon:p0137_porygon,20");
check("one in five a Porygon2 at 25", B.porygonFor("upgrade", 0.1)?.join() === "cobblemon:p0233_porygon2,25");
check("a Dubious Disc gives a Porygon-Z at 35 half the time", B.porygonFor("dubious", 0.3)?.join() === "cobblemon:p0474_porygonz,35" && B.porygonFor("dubious", 0.7) === null);

// DiscShelfBlockEntity.getHitSlot: two columns of seven on the front face, each row two pixels tall
check("the top left slot is 0", B.shelfSlot("south", { x: 0.2, y: 0.9, z: 1 }) === 0);
check("the bottom right slot is 13", B.shelfSlot("south", { x: 0.8, y: 0.1, z: 1 }) === 13);
check("the second row's right slot is 3", B.shelfSlot("south", { x: 0.8, y: 0.8, z: 1 }) === 3);
check("the gap between the columns is no slot", B.shelfSlot("south", { x: 0.5, y: 0.5, z: 1 }) === -1);
check("the edge is no slot", B.shelfSlot("south", { x: 0.2, y: 0.02, z: 1 }) === -1);
check("a north front reads its left from the other side", B.shelfSlot("north", { x: 0.8, y: 0.9, z: 0 }) === 0);
check("an east front reads along z", B.shelfSlot("east", { x: 1, y: 0.9, z: 0.2 }) === 1 && B.shelfSlot("west", { x: 0, y: 0.9, z: 0.2 }) === 0);
check("the face location may carry the block's position", B.shelfSlot("south", { x: 12.2, y: 64.9, z: -3 }) === 0);
check("TMs, Blank TMs, Upgrades, Dubious Discs and music discs go on the shelf", ["cobblemon:tm_tackle", "cobblemon:blank_tm", "cobblemon:upgrade", "cobblemon:dubious_disc", "minecraft:music_disc_wait"].every(B.shelfAccepts) && !B.shelfAccepts("minecraft:diamond") && !B.shelfAccepts(undefined));

// FossilMultiblockStructure.getAnalogOutputSignal
check("an empty idle machine reads 0 and 0", JSON.stringify(B.fossilSignals({ material: 0, left: -1, done: false })) === JSON.stringify({ tank: 0, monitor: 0 }));
check("half the material reads 7 on the tank", B.fossilSignals({ material: 64, left: -1, done: false }).tank === 7);
check("a full tank reads 15", B.fossilSignals({ material: 128, left: -1, done: false }).tank === 15);
check("a machine just started reads 1 on the monitor", B.fossilSignals({ material: 128, left: 720, done: false }).monitor === 1);
check("halfway reads 8", B.fossilSignals({ material: 128, left: 360, done: false }).monitor === 8);
check("a finished machine reads 15", B.fossilSignals({ material: 128, left: -1, done: true }).monitor === 15);
// playerWillDestroy: the fossils drop from a machine not started or with a second and more to go
check("the fossils drop from an idle machine", B.fossilsDropOnBreak({ left: -1 }));
check("and from one with time to go", B.fossilsDropOnBreak({ left: 5 }));
check("but not from one about to finish", !B.fossilsDropOnBreak({ left: 0.5 }));

// a finished machine broken (or pulsed) lets its Pokemon out wild at level 1: the fossil's result names no level, and
// PokemonProperties.create starts from Pokemon.level's 1
{
    const spawned = [];
    const dimension = {
        getBlock: ({ x, y, z }) => ({ x, y, z, isAir: y >= 64, above: () => ({ isAir: y + 1 >= 64 }), below: () => ({ isAir: y - 1 >= 64 }) }),
        spawnEntity: (typeId, at) => { const e = { typeId, at, isValid: true, props: new Map() }; spawned.push(e); return e; },
        playSound() { }, spawnItem() { }, getEntities: () => [],
    };
    const tank = { typeId: "cobblemon:restoration_tank", x: 0, y: 64, z: 0, location: { x: 0, y: 64, z: 0 }, dimension, permutation: { getState: () => "north" } };
    B.fossilBroken(tank, tank, { done: true, result: "cobblemon:p0142_aerodactyl", fossils: [], left: -1 });
    check("the revived level is 1", B.REVIVED_LEVEL === 1);
    check("a finished machine broken lets its Pokemon out at level 1, before the wild level roll", spawned.length === 1 && spawned[0].typeId === "cobblemon:p0142_aerodactyl" && spawned[0].props.get("cobblemon:level") === 1, JSON.stringify([...(spawned[0]?.props ?? [])]));
}

// findSafeSpawnPos: the nearest standing place forward of the front
{
    const air = (y) => y >= 64;
    const dimension = { getBlock: ({ x, y, z }) => ({ x, y, z, isAir: air(y), above: () => ({ isAir: air(y + 1) }), below: () => ({ isAir: air(y - 1) }) }) };
    const block = { x: 0, y: 64, z: 0, dimension };
    const at = B.spawnSpot(block, "south");
    check("a Pokemon comes out one block in front, on the ground", at.x === 0.5 && at.y === 64 && at.z === 1.5, JSON.stringify(at));
    const east = B.spawnSpot(block, "east");
    check("facing east, to the east", east.x === 1.5 && east.z === 0.5, JSON.stringify(east));
}

// GildedChestBlock.useWithoutItem: a solid block over the chest keeps it shut
{
    const chest = (solid) => ({ location: { x: 3.5, y: 64, z: -2.5 }, dimension: { getBlock: ({ y }) => ({ isSolid: y === 65 && solid }) } });
    check("a solid block above shuts the chest", B.chestBlocked(chest(true)));
    check("air above lets it open", !B.chestBlocked(chest(false)));
}
