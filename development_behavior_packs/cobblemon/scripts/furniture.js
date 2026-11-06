// CobbleFurnies' furniture behaviour (by LunazStudios, credited in COBBLEFURNIES_CREDITS.txt), on the blocks port.py's
// create_furniture draws: the seats a player sits on (SeatBlock, SeatEntity), the lamps a click or redstone switches
// (LampBlock), the TV's channels (TVBlock) and the Furni Crafter, whose screen makes furniture from what the player
// carries (FurniCrafterBlock, FurniCrafterMenu, FurniCrafterScreen). port.py's create_furniture_behaviours gives the
// blocks their states and custom components, writes the seat entity and furniture_data.js.
import { world, system, EntityComponentTypes, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { FURNI_SEATS, FURNI_RECIPES } from "./furniture_data.js";

const SEAT = "cobblemon:seat";
const CRAFTER = "cobblefurnies:furnicrafter";
// Direction.toYRot: the yaw a block's facing stands for
const FACING_YAW = { south: 0, west: 90, north: 180, east: -90 };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const itemLabel = (id) => id.slice(id.indexOf(":") + 1).split("_").map(cap).join(" ");

function getState(block, name) { try { return block.permutation.getState(name); } catch (e) { return undefined; } }
function setStates(block, states) {
    try {
        let p = block.permutation;
        for (const [k, v] of Object.entries(states)) if (p.getState(k) !== v) p = p.withState(k, v);
        if (p !== block.permutation) block.setPermutation(p);
    } catch (e) { console.warn(`[cobblemon] furniture ${block?.typeId}: ${e}`); }
}

// --- Seats -----------------------------------------------------------------------------------------------------------
// SeatBlock.useWithoutItem: a click on a stool, sofa or chair sits the player on it, or a mob the player leads on a leash
// (getLeashed), unless the player is sneaking or already riding, or something solid stands on the seat (isSeatBlocked).
// A seat a mob sits on is emptied by the click (ejectSeatedExceptPlayer); one a player sits on is left alone. The sitter
// rides an invisible cobblemon:seat entity at the block's middle (SeatEntity), seatHeight up and turned the way the
// block faces, and the seat's comparator reads 15 while it is taken (getAnalogOutputSignal), through the block's
// cobblemon:signal state
function seatAt(block) {
    const at = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
    try { return block.dimension.getEntities({ type: SEAT, location: at, maxDistance: 0.6 })[0]; } catch (e) { return undefined; }
}
function seatRiders(seat) { try { return seat.getComponent("minecraft:rideable")?.getRiders() ?? []; } catch (e) { return []; } }
// SeatBlock.setRiderRotation: the sitter faces the way the block does; a sofa's corner piece turns it 45 degrees
// into the corner (SofaBlock.setRiderRotation)
function seatYaw(block) {
    const yaw = FACING_YAW[getState(block, "minecraft:cardinal_direction")] ?? 0, type = getState(block, "cobblemon:type");
    return yaw + (type === "inner_left" || type === "outer_left" ? -45 : type === "inner_right" || type === "outer_right" ? 45 : 0);
}
// SeatBlock.getLeashed and canBePickedUp: a mob within 10 blocks that the player holds on a leash sits in the player's
// place, when its kind can (CAN_SIT_IN_SEATS: Pokemon and these animals) and, for a tameable one, it is tamed
const SITTING_MOBS = new Set(["camel", "cat", "chicken", "cow", "donkey", "fox", "frog", "goat", "horse", "llama", "mooshroom", "mule", "ocelot",
                              "parrot", "pig", "rabbit", "sheep", "trader_llama", "wolf"].map((n) => `minecraft:${n}`));
function canSit(e) {
    if (/^cobblemon:p\d{4}_/.test(e.typeId)) return true;
    if (!SITTING_MOBS.has(e.typeId)) return false;
    if (["minecraft:cat", "minecraft:wolf", "minecraft:parrot"].includes(e.typeId)) { try { return !!e.getComponent("minecraft:is_tamed"); } catch (err) { return false; } }
    return true;
}
function leashedBy(player) {
    try {
        for (const e of player.dimension.getEntities({ location: player.location, maxDistance: 10, excludeTypes: ["minecraft:player"] })) {
            const leash = e.getComponent("minecraft:leashable");
            if (leash?.isLeashed && leash.leashHolder?.id === player.id && canSit(e)) return e;
        }
    } catch (e) { }
    return undefined;
}
function useSeat(block, player) {
    if (!player || player.isSneaking) return false;
    try { if (player.getComponent("minecraft:riding")?.entityRidingOn) return false; } catch (e) { }
    const above = block.above();
    if (above && !above.isAir && !above.isLiquid && above.isSolid) return false;
    let seat = seatAt(block);
    if (seat) {
        const riders = seatRiders(seat);
        if (riders.some((e) => e.typeId === "minecraft:player")) return false;
        if (riders.length) { for (const e of riders) try { seat.getComponent("minecraft:rideable").ejectRider(e); } catch (err) { } return true; }
    }
    const sitter = leashedBy(player) ?? player, height = FURNI_SEATS[block.typeId] ?? 0.35, yaw = seatYaw(block);
    if (!seat) {
        // the entity's one seat is 0.35 up (seatHeight), so a taller seat (a toilet, the Poke Ball chair) stands it higher
        const at = { x: block.location.x + 0.5, y: block.location.y + 0.001 + height - 0.35, z: block.location.z + 0.5 };
        try { seat = block.dimension.spawnEntity(SEAT, at); } catch (e) { return false; }
    }
    try { seat.setRotation({ x: 0, y: yaw }); } catch (e) { }
    let seated = false;
    try { seated = !!seat.getComponent("minecraft:rideable")?.addRider(sitter); } catch (e) { }
    if (!seated) { try { seat.remove(); } catch (e) { } return false; }
    try { sitter.setRotation({ x: 0, y: yaw }); } catch (e) { }
    setStates(block, { "cobblemon:signal": 15 });
    return true;
}
// SeatEntity.tick: a seat entity nobody sits on any more, or whose block is no longer a seat, goes away (its rider gets
// off), and the block's signal follows whether someone sits
function tickSeat(seat) {
    let block;
    try { block = seat.dimension.getBlock(seat.location); } catch (e) { return; }
    const isSeat = !!(block && FURNI_SEATS[block.typeId]);
    if (isSeat && seatRiders(seat).length) { setStates(block, { "cobblemon:signal": 15 }); return; }
    try { seat.remove(); } catch (e) { }
    if (isSeat) setStates(block, { "cobblemon:signal": 0 });
}
system.runInterval(() => {
    for (const dim of ["overworld", "nether", "the_end"]) {
        let seats = [];
        try { seats = world.getDimension(dim).getEntities({ type: SEAT }); } catch (e) { continue; }
        for (const seat of seats) tickSeat(seat);
    }
}, 10);

// --- Lamps -----------------------------------------------------------------------------------------------------------
// LampBlock.useWithoutItem: a click switches the lamp on or off with a lever's click; one redstone holds on stays lit
// (Java puts it out until the next block update lights it again). LampBlock.neighborChanged: redstone reaching the lamp
// lights it and going away puts it out, which the block's cobblemon:powered state remembers; a scripted block hears of
// no neighbour change on Bedrock, so the lamp looks at its neighbours every ten ticks (minecraft:tick)
function redstoneNear(block) {
    for (const side of ["above", "below", "north", "south", "east", "west"]) {
        try { if ((block[side]()?.getRedstonePower() ?? 0) > 0) return true; } catch (e) { }
    }
    try { return (block.getRedstonePower() ?? 0) > 0; } catch (e) { return false; }
}
function useLamp(block) {
    const lit = !!getState(block, "cobblemon:lit"), powered = !!getState(block, "cobblemon:powered");
    setStates(block, { "cobblemon:lit": powered || !lit });
    try { block.dimension.playSound("random.click", block.location); } catch (e) { }
}
function tickLamp(block) {
    const powered = redstoneNear(block);
    if (powered === !!getState(block, "cobblemon:powered")) return;
    setStates(block, { "cobblemon:powered": powered, "cobblemon:lit": powered });
}

// --- TV --------------------------------------------------------------------------------------------------------------
// TVBlock.useItemOn: a click, with or without an item, turns the channel: 1 (off), 2, 3 and round again (CHANNEL_1_3)
function useTv(block) { const channel = getState(block, "cobblemon:channel") ?? 1; setStates(block, { "cobblemon:channel": channel % 3 + 1 }); }

// --- Furni Crafter -----------------------------------------------------------------------------------------------------
// FurniCrafterBlock.useItemOn opens the Furni Crafter (FurniCrafterScreen): every furni_crafting recipe this pack can
// make, in recipe id order as FurniCrafterMenu lists them, a search over the results' names (applySearchFilter), and each
// recipe with its materials. One the player has the materials for (FurniCrafterMenu.canCraft: enough of each across the
// inventory) is made at a click, the materials taken from the first stacks that hold them (removeItemsFromInventory)
// and the result given (Java puts it in the crafter's output slot; here it goes into the inventory, or on the ground
// when that is full). One the player cannot make is greyed, and a click on it says what is short. A recipe is
// [result, count, name, icon, [[material, count], ...]] (furniture_data.js)
function countOf(inv, id) {
    let n = 0;
    for (let i = 0; inv && i < inv.size; i++) { const it = inv.getItem(i); if (it?.typeId === id) n += it.amount; }
    return n;
}
function canCraftFurni(inv, recipe) { return recipe[4].every(([id, count]) => countOf(inv, id) >= count); }
function takeFrom(inv, id, count) {
    for (let i = 0; inv && i < inv.size && count > 0; i++) {
        const it = inv.getItem(i);
        if (it?.typeId !== id) continue;
        const n = Math.min(count, it.amount);
        count -= n;
        if (it.amount > n) { it.amount -= n; inv.setItem(i, it); } else inv.setItem(i, undefined);
    }
}
function craftFurni(player, recipe) {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!inv || !canCraftFurni(inv, recipe)) {
        const short = recipe[4].filter(([id, count]) => countOf(inv, id) < count).map(([id, count]) => `${count} ${itemLabel(id)}`);
        try { player.sendMessage(`§cYou need ${short.join(", ")} to make ${recipe[2]}.`); } catch (e) { }
        return false;
    }
    for (const [id, count] of recipe[4]) takeFrom(inv, id, count);
    try {
        const left = inv.addItem(new ItemStack(recipe[0], recipe[1]));
        if (left) player.dimension.spawnItem(left, player.location);
    } catch (e) { }
    try { player.playSound("random.click"); } catch (e) { }   // UI_BUTTON_CLICK, as FurniCrafterScreen plays it
    return true;
}
function furniShown(search) {
    const q = search.trim().toLowerCase();
    return FURNI_RECIPES.filter((r) => !q || r[2].toLowerCase().includes(q));
}
function openFurniCrafter(block, player, search = "") {
    const inv = player.getComponent(EntityComponentTypes.Inventory)?.container, shown = furniShown(search);
    const form = new ActionFormData().title("Furni Crafter").body(search.trim() ? `Showing "${search.trim()}": ${shown.length} of ${FURNI_RECIPES.length}` : "Pick a piece to make it from what you carry.");
    form.button(search.trim() ? `Search: ${search.trim()}\n§7Tap to change` : "Search", "textures/ui/magnifyingGlass");
    for (const r of shown) {
        const materials = r[4].map(([id, count]) => `${count} ${itemLabel(id)}`).join(", ");
        form.button(`${canCraftFurni(inv, r) ? "" : "§8"}${r[2]}${r[1] > 1 ? ` x${r[1]}` : ""}\n§7${materials}`, r[3] || undefined);
    }
    form.show(player).then((res) => {
        if (res.canceled || res.selection === undefined) return;
        if (!block.isValid || block.typeId !== CRAFTER) return;
        if (res.selection === 0) {
            new ModalFormData().title("Search").textField("Search", "Search...", { defaultValue: search }).show(player).then((r) => {
                openFurniCrafter(block, player, r.canceled ? search : String(r.formValues?.[0] ?? ""));
            }).catch(() => { });
            return;
        }
        const recipe = shown[res.selection - 1];
        if (recipe) craftFurni(player, recipe);
        openFurniCrafter(block, player, search);
    }).catch(() => { });
}
// the crafter opens whatever is in hand, as useItemOn does, so the click never places the held block on it
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.typeId !== CRAFTER || !event.isFirstEvent) return;
    event.cancel = true;
    const { block, player } = event;
    system.run(() => openFurniCrafter(block, player));
});

export function registerFurnitureComponents(registry) {
    registry.registerCustomComponent("cobblemon:seat", { onPlayerInteract({ block, player }) { useSeat(block, player); } });
    registry.registerCustomComponent("cobblemon:lamp", { onPlayerInteract({ block }) { useLamp(block); }, onTick({ block }) { tickLamp(block); } });
    registry.registerCustomComponent("cobblemon:tv", { onPlayerInteract({ block }) { useTv(block); } });
}

export { useSeat, tickSeat, seatYaw, canSit, useLamp, tickLamp, redstoneNear, useTv, countOf, canCraftFurni, craftFurni, furniShown, openFurniCrafter };
