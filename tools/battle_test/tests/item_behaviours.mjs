// The item behaviours of scripts/item_behaviours.js and the item code of main.js it hooks into: containers handed back,
// the Ability Patch's way back to a standard ability, the regional foods, the apples' Leftovers, composting, type gems
// and apricorn sprouts placed on a block, the Aprijuice's boosts, and what port.py writes for the mint seeds and Hopo Berry
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { M, mon, battle, check, flush } from "../harness.mjs";

// the module as main.js loaded it: the harness's copy of the scripts (the newest cobblemon-battle-* folder, whose
// package.json makes the .js files modules), so its hooks into main.js's helpers are the registered ones
const copy = readdirSync(tmpdir()).filter((d) => d.startsWith("cobblemon-battle-")).map((d) => join(tmpdir(), d))
    .filter((d) => existsSync(join(d, "item_behaviours.js"))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const IB = await import(pathToFileURL(join(copy, "item_behaviours.js")).href);

// a Pokemon in the world for an item to be used on: the harness's entity with the name tag nicknameOf reads
function pokemon(species, ability) {
    const e = mon(species).entity;
    e.nameTag = "";
    if (ability) e.setDynamicProperty("cobblemon:ability", ability);
    return e;
}
// a player with a nine-slot inventory, the item in hand in slot 0
function player(hand) {
    const items = [hand ?? null], log = [];
    const container = { size: 9, getItem: (i) => items[i] ?? undefined, setItem: (i, it) => { items[i] = it ?? null; }, addItem: (it) => { items.push(it); return undefined; } };
    return { id: "tester", name: "Tester", isValid: true, selectedSlotIndex: 0, log, items, getGameMode: () => "Survival",
        sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { }, getComponent: () => ({ container }), dimension: { spawnItem() { } }, location: { x: 0, y: 0, z: 0 } };
}
const has = (p, id) => p.items.some((it) => it?.typeId === id);

{   // BagItem.returnItem in battle: a Potion's bottle and Berry Juice's bowl come back; a Revive leaves nothing
    check("CONTAINERS: potions, status cures, Ethers, Elixirs and the Ability Capsule hand back a glass bottle, Berry Juice a bowl",
        ["potion", "max_potion", "full_restore", "antidote", "ether", "max_elixir", "ability_capsule"].every((n) => IB.containerOf(`cobblemon:${n}`) === "minecraft:glass_bottle")
        && IB.containerOf("cobblemon:berry_juice") === "minecraft:bowl" && IB.containerOf("cobblemon:revive") === null && IB.containerOf("cobblemon:remedy") === null);
    const a = mon("Snorlax", { level: 50 }), b = battle(a, mon("Pikachu"));
    a.hp = Math.floor(a.stats.hp / 2);
    b.player = player({ typeId: "cobblemon:potion", amount: 2 });
    const used = M.useBagItem(b, "cobblemon:potion"); flush();
    check("a Potion used in battle is taken and its glass bottle handed back", used && b.player.items[0].amount === 1 && has(b.player, "minecraft:glass_bottle"), JSON.stringify(b.player.items));
    const c = mon("Snorlax", { level: 50 }), bc = battle(c, mon("Pikachu"));
    c.hp = Math.floor(c.stats.hp / 2);
    bc.player = player({ typeId: "cobblemon:berry_juice", amount: 1 });
    M.useBagItem(bc, "cobblemon:berry_juice"); flush();
    check("Berry Juice in battle leaves its bowl", bc.player.items[0] === null && has(bc.player, "minecraft:bowl"), JSON.stringify(bc.player.items));
}
{   // AbilityTypeChanger: the Patch gives the hidden ability, and on a Pokemon that has it one of the standard ones again;
    // the Capsule swaps the standard abilities and hands its bottle back, and does nothing to a hidden ability
    const e = pokemon("Snorlax", "gluttony");   // Snorlax's hidden ability
    const p = player({ typeId: "cobblemon:ability_patch", amount: 1 });
    M.useItemOn(p, e, "cobblemon:ability_patch", p.items[0]); flush();
    const after = e.getDynamicProperty("cobblemon:ability");
    check("an Ability Patch on a hidden ability turns it back to a standard one", ["immunity", "thickfat"].includes(after) && p.items[0] === null, `${after}; ${p.log.join(" / ")}`);
    const ge = pokemon("Snorlax", "immunity");
    const q = player({ typeId: "cobblemon:ability_capsule", amount: 1 });
    M.useItemOn(q, ge, "cobblemon:ability_capsule", q.items[0]); flush();
    check("an Ability Capsule swaps to the other standard ability and gives a glass bottle", ge.getDynamicProperty("cobblemon:ability") === "thickfat" && has(q, "minecraft:glass_bottle"), q.log.join(" / "));
    const he = pokemon("Snorlax", "gluttony");
    const r = player({ typeId: "cobblemon:ability_capsule", amount: 1 });
    M.useItemOn(r, he, "cobblemon:ability_capsule", r.items[0]); flush();
    check("an Ability Capsule does nothing to a hidden ability", he.getDynamicProperty("cobblemon:ability") === "gluttony" && r.items[0]?.amount === 1, r.log.join(" / "));
}
{   // PotionItem out of battle hands its bottle back too, and an Ether its own (usePpItem)
    const e = pokemon("Snorlax", "thickfat");
    const health = { currentValue: 20, effectiveMax: 100, setCurrentValue(v) { this.currentValue = v; } };
    const target = new Proxy(e, { get: (t, k) => (k === "getComponent" ? () => health : t[k]) });
    const p = player({ typeId: "cobblemon:super_potion", amount: 1 });
    M.useItemOn(p, target, "cobblemon:super_potion", p.items[0]); flush();
    check("a Super Potion used on a Pokemon in the world heals it and hands back a glass bottle", health.currentValue > 20 && p.items[0] === null && has(p, "minecraft:glass_bottle"), `${health.currentValue}; ${p.log.join(" / ")}`);
}
{   // RegionalFoodItem: the dish goes to the Pokemon when it is owned and has a status and the player is sneaking or has no
    // hunger to fill (needsFood false, not creative); otherwise it is eaten
    const id = "cobblemon:pewter_crunchies";
    check("REGIONAL_FOODS are the ten regional dishes", IB.REGIONAL_FOODS.size === 10 && IB.REGIONAL_FOODS.has("cobblemon:open_faced_sandwich") && !IB.REGIONAL_FOODS.has("cobblemon:potato_mochi"));
    check("a regional food cures an owned Pokemon's status when the player is not hungry", IB.regionalFoodTakes(id, true, "psn", false, false, false) === true);
    check("a hungry player eats it first", IB.regionalFoodTakes(id, true, "psn", false, false, true) === false);
    check("unless sneaking", IB.regionalFoodTakes(id, true, "psn", false, true, true) === true);
    check("a Pokemon with no status, a fainted one or another player's gets nothing", !IB.regionalFoodTakes(id, true, undefined, false, false, false) && !IB.regionalFoodTakes(id, true, "psn", true, false, false) && !IB.regionalFoodTakes(id, false, "psn", false, false, false));
    check("a plain food is not one", IB.regionalFoodTakes("cobblemon:potato_mochi", true, "psn", false, false, false) === false);
}
{   // PlayerMixin.onEatFood: an apple of the leaves_leftovers tag gives a Leftovers at appleLeftoversChance 0.025
    check("eating an apple, a Sweet, Tart or Syrupy Apple or a Candied Apple leaves a Leftovers one time in forty",
        ["minecraft:apple", "cobblemon:sweet_apple", "cobblemon:tart_apple", "cobblemon:syrupy_apple", "cobblemon:candied_apple"].every((id) => IB.leftoversFrom(id, 0.02) && !IB.leftoversFrom(id, 0.025))
        && !IB.leftoversFrom("minecraft:golden_apple", 0.0) && IB.APPLE_LEFTOVERS_CHANCE === 0.025);
}
{   // ComposterBlock: a compostable item raises the level one time in its chance, is taken either way, and a full composter is left alone
    check("composting raises the level on a roll under the chance", IB.compostStep(3, 0.65, 0.5) === 4 && IB.compostStep(3, 0.65, 0.7) === 3);
    check("level 7 becomes the full 8, and a full composter is not touched", IB.compostStep(7, 0.95, 0.1) === 8 && IB.compostStep(8, 0.95, 0.1) === null);
}
{   // GemItem: a type gem on a block's face becomes that type's cluster at stage 1 facing out; ApricornSeedItem: a sprout on
    // the side of apricorn leaves hangs an unripe apricorn whose FACING points at the leaves
    check("the 18 type gems", IB.TYPE_GEMS.size === 18 && IB.TYPE_GEMS.has("cobblemon:fairy_gem"));
    const gem = IB.gemClusterPermutation("cobblemon:fire_gem", "East");
    check("a Fire Gem on an east face starts a fire gem cluster at stage 1 facing east", gem.type.id === "cobblemon:fire_gem_cluster" && gem.states["minecraft:block_face"] === "east" && gem.states["cobblemon:stage"] === 1);
    const fruit = IB.sproutApricornPermutation("cobblemon:red_apricorn_seed", "East");
    check("a Red Apricorn Sprout on leaves' east side hangs an unripe red apricorn facing west, at the leaves", fruit.type.id === "cobblemon:red_apricorn" && fruit.states["cobblemon:facing"] === "west" && fruit.states["cobblemon:age"] === 0);
    check("not on the top or bottom of the leaves", IB.sproutApricornPermutation("cobblemon:red_apricorn_seed", "Up") === null && IB.sproutApricornPermutation("cobblemon:oran_berry", "East") === null);
}
{   // AprijuiceItem: a boosted juice is told by its lore, a plain one is drunk; useAprijuiceOn boosts a rideable Pokemon only
    const stack = (boosts) => ({ typeId: "cobblemon:aprijuice_red", amount: 1, nameTag: "§rPlain Red Aprijuice", getLore: () => boosts });
    check("a juice with Accel. +2 in its lore carries boosts, one without is plain", M.stackSlot(stack(["§7Quality: Low", "§7Riding Stat Boosts:", "§7Accel.: +2"]))?.[2]?.boosts?.ACCELERATION === 2
        && Object.keys(M.stackSlot(stack([]))?.[2]?.boosts ?? {}).length === 0);
    const p = player(stack(["§7Accel.: +2"]));
    const snorlax = pokemon("Snorlax");
    check("useAprijuiceOn does nothing for a Pokemon that cannot be ridden", M.useAprijuiceOn(p, snorlax, p.items[0]) === false && p.items[0]?.amount === 1, p.log.join(" / "));
}
{   // what port.py writes: the mint seeds, the Hopo Berry's medicine entry and the soul campfire pots (after a port run)
    const items = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/items.js", import.meta.url), "utf-8");
    check("after a port run: items.js gives the Hopo Berry 10 PP (MEDICINE) and the compostables their chances", /"cobblemon:hopo_berry": \{"pp": 10\}/.test(items) && /export const COMPOSTABLES = \{.*"cobblemon:oran_berry": 0\.65/.test(items));
    const root = new URL("../../../development_behavior_packs/cobblemon/", import.meta.url);
    check("after a port run: the six mint seed items and the red mint's loot naming them", ["red", "blue", "cyan", "pink", "green", "white"].every((c) => existsSync(new URL(`items/general/${c}_mint_seeds.json`, root)))
        && /red_mint_seeds/.test(readFileSync(new URL("loot_tables/blocks/red_mint_7.json", root), "utf-8")));
    check("after a port run: a soul campfire pot block a colour", ["red", "white"].every((c) => existsSync(new URL(`blocks/soul_campfire_${c}.json`, root))));
    const ball = JSON.parse(readFileSync(new URL("items/poke_ball.json", root), "utf-8")), rod = JSON.parse(readFileSync(new URL("items/rods/poke_rod.json", root), "utf-8"));
    check("after a port run: Poke Balls stack to 64 and a Poke Rod has 256 durability", ball["minecraft:item"].components["minecraft:max_stack_size"] === 64 && rod["minecraft:item"].components["minecraft:durability"].max_durability === 256);
}
