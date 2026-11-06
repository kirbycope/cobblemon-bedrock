// The display case (DisplayCaseBlockEntity.updateItem, DisplayCaseBlock.getAnalogOutputSignal): one item in a small
// entity at the case's middle, put in, swapped and taken out by a click, and the case's comparator signal
import { M, check } from "../harness.mjs";
import { blockIds } from "../stub_server.mjs";

blockIds.add("minecraft:stone").add("cobblemon:potion_block");
check("an empty case gives 0", M.displaySignal(undefined) === 0);
check("a Poke Ball gives 3", M.displaySignal("cobblemon:great_ball") === 3);
check("a block gives 2", M.displaySignal("minecraft:stone") === 2);
check("a Cobblemon item that places a block counts as one", M.displaySignal("cobblemon:potion") === 2);
check("anything else gives 1", M.displaySignal("minecraft:diamond") === 1);

// a case, a player and the entity that holds the item, faked
const stack = (typeId, amount = 1) => ({ typeId, amount, clone() { return stack(this.typeId, this.amount); } });
function scene(handItem, caseItem, mode = "Survival") {
    const sounds = [], spawned = [];
    let holder = null, signal = 0;
    const makeHolder = (item) => {
        const slot = [item];
        holder = { yaw: null, index: 0, removed: false,
                   getComponent: () => ({ container: { getItem: () => slot[0], setItem: (n, v) => { slot[0] = v; } } }),
                   setProperty: (k, v) => { holder[k === "cobblemon:display_block" ? "block" : "index"] = v; }, setRotation: (r) => { holder.yaw = r.y; },
                   remove: () => { holder.removed = true; holder = null; } };
        return holder;
    };
    if (caseItem) makeHolder(caseItem);
    const block = {
        location: { x: 0, y: 64, z: 0 }, typeId: "cobblemon:display_case",
        permutation: { getState: (k) => (k === "cobblemon:signal" ? signal : "north"), withState: (k, v) => ({ v }) },
        setPermutation: (p) => { signal = p.v; },
        dimension: { getEntities: () => (holder ? [holder] : []), spawnEntity: () => makeHolder(undefined),
                     playSound: (id) => sounds.push(id), spawnItem: (i) => spawned.push(i.typeId) },
    };
    const inv = [handItem];
    const added = [];
    const player = { selectedSlotIndex: 0, getGameMode: () => mode, dimension: block.dimension, location: {},
                     getComponent: () => ({ container: { getItem: () => inv[0], setItem: (n, v) => { inv[0] = v; }, addItem: (i) => { added.push(i.typeId); } } }) };
    return { block, player, inv, added, sounds, spawned, holder: () => holder, signal: () => signal };
}

let s = scene(stack("minecraft:diamond", 5), null);
M.useDisplayCase(s.block, s.player, "West");
check("an item goes in: one of the stack", s.holder()?.getComponent().container.getItem(0).amount === 1 && s.inv[0].amount === 4);
check("with the add sound", s.sounds.includes("cobblemon.block.display_case.add_item"));
check("turned to the side clicked", s.holder().yaw === 90);
check("and the case's signal is 1", s.signal() === 1);
check("its icon is shown", s.holder().index > 0);
check("as its flat icon, not a cube", !s.holder().block);
// a block item is the small cube Java draws it as, its sides, top and bottom with their own textures
s = scene(stack("minecraft:oak_log", 2), null);
M.useDisplayCase(s.block, s.player, "West");
check("a block item shows as a cube, with no flat icon", s.holder().block > 0 && s.holder().index === 0);

s = scene(undefined, stack("cobblemon:poke_ball"));
M.useDisplayCase(s.block, s.player, "Up");
check("an empty hand takes the item out", s.inv[0]?.typeId === "cobblemon:poke_ball" && !s.holder());
check("with the remove sound", s.sounds.includes("cobblemon.block.display_case.remove_item"));
check("and the signal goes to 0", s.signal() === 0);

s = scene(stack("minecraft:stone", 3), stack("minecraft:diamond"));
M.useDisplayCase(s.block, s.player, "North");
check("another item swaps: the case holds the new one", s.holder().getComponent().container.getItem(0).typeId === "minecraft:stone");
check("the hand gives one", s.inv[0].amount === 2);
check("and the old item comes back", s.added.includes("minecraft:diamond"));
check("the signal follows the new item", s.signal() === 2);

s = scene(stack("minecraft:stone", 3), stack("minecraft:diamond"), "Creative");
M.useDisplayCase(s.block, s.player, "North");
check("in Creative the hand keeps its item", s.inv[0].amount === 3 && s.added.length === 0);

s = scene(stack("minecraft:diamond", 2), stack("minecraft:diamond"));
M.useDisplayCase(s.block, s.player, "North");
check("the same item does nothing", s.inv[0].amount === 2 && s.sounds.length === 0);

s = scene(undefined, null);
M.useDisplayCase(s.block, s.player, "North");
check("an empty hand on an empty case does nothing", s.sounds.length === 0 && !s.holder());
