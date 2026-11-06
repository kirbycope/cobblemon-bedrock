// The item behaviours of CobblemonItems.kt's item classes that the generated items and main.js's item use did not
// carry: the containers medicine hands back (BagItem.returnItem), the regional foods (RegionalFoodItem), the apples'
// Leftovers (PlayerMixin.onEatFood), Vivichoke Dip's effects, the Aprijuice drunk plain or picked for a party member
// (AprijuiceItem), a type gem (GemItem) or an apricorn sprout (ApricornSeedItem) placed on a block, and composting
// (CobblemonImplementation.registerCompostable). main.js hands this module its helpers through registerItemBehaviours
// and calls handBack and regionalFoodInteract from its own item code.
import { world, system, BlockPermutation } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { POKEMON } from "./data.js";
import * as ITEMS from "./items.js";

const COMPOSTABLES = ITEMS.COMPOSTABLES ?? {};   // item id -> chance of raising the composter a level (written by port.py)
let api = {};
export function registerItemBehaviours(given) { api = given; }
const creative = (player) => player.getGameMode?.() === "Creative";
const itemName = (id) => id.slice(id.indexOf(":") + 1).split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// What a medicine hands back when it is used, in battle or out: PotionItem, StatusCureItem, EtherItem and ElixirItem
// their glass bottle, BerryJuiceItem its bowl, and the Ability Capsule (AbilityChangeItem) a glass bottle; the
// vitamins and PP Up hand theirs back in main.js already
const BOTTLE = "minecraft:glass_bottle";
export const CONTAINERS = {
    ...Object.fromEntries(["potion", "super_potion", "hyper_potion", "max_potion", "full_restore", "full_heal", "antidote", "burn_heal", "ice_heal",
        "paralyze_heal", "awakening", "ether", "max_ether", "elixir", "max_elixir", "ability_capsule"].map((n) => [`cobblemon:${n}`, BOTTLE])),
    "cobblemon:berry_juice": "minecraft:bowl",
};
export function containerOf(id) { return CONTAINERS[id] ?? null; }
export function handBack(player, id) {
    const back = CONTAINERS[id];
    if (!back || !player || creative(player)) return;
    api.giveOrDrop(player, back);
}

// RegionalFoodItem: Pewter Crunchies and the other regional dishes cure any status of an owned Pokemon they are used
// on, and are eaten; the player eats them first when hungry (or in creative) unless sneaking, and in the air with no
// hunger to fill they ask which party member is for (PartySelectGUI)
export const REGIONAL_FOODS = new Set(["pewter_crunchies", "rage_candy_bar", "lava_cookie", "old_gateau", "casteliacone", "lumiose_galette", "big_malasada",
    "smoked_tail_curry", "jubilife_muffin", "open_faced_sandwich"].map((n) => `cobblemon:${n}`));
function hungry(player) {
    try { const h = player.getComponent("minecraft:player.hunger"); return !!h && h.currentValue < h.effectiveMax; } catch (e) { return false; }
}
// whether a regional food used on this Pokemon is the Pokemon's rather than the player's meal
export function regionalFoodTakes(id, owned, status, fainted, sneaking, eats) {
    if (!REGIONAL_FOODS.has(id) || !owned || !status || fainted) return false;
    return sneaking || !eats;
}
// the interact handler's first question: true when the food went to the Pokemon (the event is cancelled)
export function regionalFoodInteract(event) {
    const { player, target, itemStack } = event, id = itemStack?.typeId;
    if (!id || !REGIONAL_FOODS.has(id) || !target || !POKEMON[target.typeId]) return false;
    const owned = api.prop(target, api.OWNER) === player.id;
    if (!regionalFoodTakes(id, owned, api.statusOf(target), !!api.prop(target, api.FAINTED), player.isSneaking, hungry(player) || creative(player))) return false;
    event.cancel = true;
    system.run(() => { if (target.isValid) cureWithFood(player, target, id); });
    return true;
}
export function cureWithFood(player, target, id) {
    if (!target?.isValid || !api.statusOf(target) || api.prop(target, api.FAINTED)) { player.sendMessage("§7It won't have any effect."); return false; }
    api.setProp(target, api.STATUS, undefined);
    try { target.dimension.playSound("random.eat", target.location); } catch (e) { }
    api.consumeHand(player);
    player.sendMessage(`§a${api.nicknameOf(target) || POKEMON[target.typeId].name} ate the ${itemName(id)} and was cured of its status.`);
    return true;
}
// a party member for an item used in the air, as main.js's PartySelectGUI form lists them
function partySelect(player, id, title, keep, apply) {
    const slots = api.partyOf(player.id).filter(keep);
    if (!slots.length) { player.sendMessage("§7You have no Pokemon to use it on."); return; }
    const form = new ActionFormData().title(title).body("§7Use it on which Pokemon?");
    for (const slot of slots) form.button(`${slot.rec.n || POKEMON[slot.rec.t]?.name || "Pokemon"} §8Lv ${slot.rec.lv}\n${slot.rec.f ? "§cFainted" : `§7HP ${Math.round((slot.rec.hp ?? 1) * 100)}%`}`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === undefined || !player.isValid) return;
        const slot = slots[r.selection], held = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
        if (!slot || held?.typeId !== id) return;
        apply(api.partyMember(player, slot), held);
    }).catch(() => { });
}
world.beforeEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event, id = itemStack?.typeId;
    if (player?.typeId !== "minecraft:player" || !id || !REGIONAL_FOODS.has(id) || api.inBattle?.(player.id)) return;
    if (hungry(player) || creative(player)) return;   // the player eats it
    event.cancel = true;   // with no hunger to fill the food is not eaten; a party member takes it instead
    system.run(() => partySelect(player, id, itemName(id), () => true, (member) => cureWithFood(player, member, id)));
});

// Eating an apple, a Sweet, Tart or Syrupy Apple or a Candied Apple (held/leaves_leftovers) leaves a Leftovers one
// time in forty (config appleLeftoversChance 0.025, PlayerMixin.onEatFood)
export const LEAVES_LEFTOVERS = new Set(["minecraft:apple", "cobblemon:sweet_apple", "cobblemon:tart_apple", "cobblemon:syrupy_apple", "cobblemon:candied_apple"]);
export const APPLE_LEFTOVERS_CHANCE = 0.025;
export function leftoversFrom(id, roll = Math.random()) { return LEAVES_LEFTOVERS.has(id) && roll < APPLE_LEFTOVERS_CHANCE; }
// Vivichoke Dip (CobblemonItems.VIVICHOKE_DIP): finishing it clears every effect, as milk does, and then its own
// Absorption I for 900 ticks goes on; the bowl comes back through the item's using_converts_to
export function vivichokeDip(player) {
    try { for (const effect of player.getEffects()) player.removeEffect(effect.typeId); } catch (e) { }
    try { player.addEffect("absorption", 900, { amplifier: 0, showParticles: true }); } catch (e) { }
}
world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
    const id = itemStack?.typeId;
    if (source?.typeId !== "minecraft:player" || !id) return;
    if (leftoversFrom(id)) api.giveOrDrop(source, "cobblemon:leftovers");
    if (id === "cobblemon:vivichoke_dip") vivichokeDip(source);
});

// AprijuiceItem.use: a juice with no ride boosts is drunk (its item's food, 4 hunger at 1.2); one with boosts used in
// the air asks which party member, a rideable one, is for (PartySelectGUI) rather than being drunk
const APRIJUICE = /^cobblemon:aprijuice_[a-z]+(_tasty|_delicious)?$/;
export function aprijuiceBoosted(itemStack) {
    if (!APRIJUICE.test(itemStack?.typeId ?? "")) return false;
    return Object.keys(api.stackSlot?.(itemStack)?.[2]?.boosts ?? {}).length > 0;
}
world.beforeEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;
    if (player?.typeId !== "minecraft:player" || !aprijuiceBoosted(itemStack)) return;
    event.cancel = true;
    const id = itemStack.typeId;
    system.run(() => partySelect(player, id, itemStack.nameTag?.replace(/§./g, "") || "Aprijuice", (slot) => !!api.RIDES?.[slot.rec.t],
        (member, held) => api.useAprijuiceOn(player, member, held)));
});

// GemItem.useOn: a type gem used on a solid block's face with air beyond puts that type's cluster there, at its first
// stage, facing out, and plays the cluster's place sound. ApricornSeedItem.getPlacementState: a sprout used on the
// side of apricorn leaves hangs an unripe apricorn of its colour there (ApricornBlock's FACING points at the leaves);
// elsewhere it plants its sapling, as the item's block placer does
export const TYPE_GEMS = new Set(["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
    "dragon", "dark", "steel", "fairy"].map((t) => `cobblemon:${t}_gem`));
const FACE_OFFSET = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
export function gemClusterPermutation(gemId, face) {
    return BlockPermutation.resolve(`${gemId}_cluster`, { "minecraft:block_face": String(face).toLowerCase(), "cobblemon:stage": 1 });
}
export function sproutApricornPermutation(seedId, face) {
    const colour = /^cobblemon:([a-z]+)_apricorn_seed$/.exec(seedId)?.[1], f = String(face).toLowerCase();
    if (!colour || !OPPOSITE[f]) return null;
    return BlockPermutation.resolve(`cobblemon:${colour}_apricorn`, { "cobblemon:age": 0, "cobblemon:facing": OPPOSITE[f] });
}
function beyond(block, face) {
    const [dx, dy, dz] = FACE_OFFSET[face] ?? [0, 0, 0];
    try { return block.dimension.getBlock({ x: block.location.x + dx, y: block.location.y + dy, z: block.location.z + dz }); } catch (e) { return undefined; }
}
const centre = (block) => ({ x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 });

// Composting (registerCompostable): a compostable Cobblemon item used on a composter is taken, and raises its level
// one time in its chance, as ComposterBlock does; a full composter is left to Bedrock, which hands out the bone meal
export function compostStep(level, chance, roll = Math.random()) {
    if (level >= 8) return null;
    return roll < chance ? Math.min(8, level + 1) : level;
}
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { player, block, itemStack, blockFace, isFirstEvent } = event, id = itemStack?.typeId;
    if (!id || !player || !block) return;
    if (TYPE_GEMS.has(id)) {
        const spot = beyond(block, blockFace);
        if (!block.isSolid || !spot?.isAir) return;
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => {
            try { spot.setPermutation(gemClusterPermutation(id, blockFace)); } catch (e) { return; }
            api.consumeHand(player);
            try { block.dimension.playSound("cobblemon.block.type_gem_block.place", centre(spot)); } catch (e) { }
        });
        return;
    }
    if (/^cobblemon:[a-z]+_apricorn_seed$/.test(id) && block.typeId === "cobblemon:apricorn_leaves") {
        const permutation = sproutApricornPermutation(id, blockFace), spot = beyond(block, blockFace);
        if (!permutation || !spot?.isAir) return;
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => {
            try { spot.setPermutation(permutation); } catch (e) { return; }
            api.consumeHand(player);
            try { block.dimension.playSound("dig.wood", centre(spot)); } catch (e) { }
        });
        return;
    }
    if (block.typeId === "minecraft:composter" && COMPOSTABLES[id] !== undefined) {
        let level = 0;
        try { level = Number(block.permutation.getState("composter_fill_level") ?? 0); } catch (e) { }
        if (level >= 8) return;
        event.cancel = true;
        if (!isFirstEvent) return;
        system.run(() => {
            const next = compostStep(level, COMPOSTABLES[id]);
            if (next === null) return;
            if (next !== level) try { block.setPermutation(block.permutation.withState("composter_fill_level", next)); } catch (e) { return; }
            api.consumeHand(player);
            try { block.dimension.playSound(next !== level ? "block.composter.fill_success" : "block.composter.fill", centre(block)); } catch (e) { }
        });
    }
});
