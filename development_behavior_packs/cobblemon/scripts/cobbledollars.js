// CobbleDollars by Harmex (https://modrinth.com/mod/cobbledollars, All Rights Reserved, used with credit; see
// COBBLEDOLLARS_CREDITS.txt): money, the Cobble Merchant who sells for it and buys items for it, and the commands
// around it, read from the mod's own code (2.0.0 Beta-6.1, decompiled into the git-ignored java_cobbledollars/).
// The balance is a player's (PlayerMixin's CobbleDollars tag, kept through death by ServerPlayerMixin.restoreFrom), here
// a dynamic property on the player, which a death leaves alone too. main.js hands the functions it needs to init, so
// this module holds no copy of its data.
import { world, system, BlockVolume, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, EntityComponentTypes, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { DEFAULT_SHOP, DEFAULT_BANK, POKE_MART_SHOP } from "./cobbledollars_data.js";
import { GYM_LEAGUE } from "./gyms.js";

// CommonConfig's defaults: money from beating NPC trainers and wild Pokemon, and the multiplier on both
export const EARN_FROM_NPC = true, EARN_FROM_WILD = true, INCOME_MULTIPLIER = "1.0";
export const MERCHANT = "cobbledollars:cobble_merchant";
const BALANCE = "cobbledollars:balance", ACCOUNTS = "cobbledollars:accounts";
const SHOP_PROP = "cobbledollars:shop", BANK_PROP = "cobbledollars:bank", JOB_PROP = "cobbledollars:job";
const MAX_AMOUNT = 9999;   // ShopScreen: the amount box's ceiling, and getMaxAmountPurchasable's
// CobbleDollarsStructures: the merchant joins each village's villagers pool at weight 1, beside the nitwit (1), the baby
// (1) and the unemployed villager (10), so one villager spot in 13 holds a merchant
export const VILLAGE_MERCHANT_CHANCE = 1 / 13;

let api = { itemName: (id) => id, itemIcon: () => undefined };
export function init(given) { api = { ...api, ...given }; }

// --- money -------------------------------------------------------------------------------------------------------

// MiscUtils.calculateAndAwardCobbleDollars: the levels of the losers' Pokemon summed (s), s * 5 * (s / 50) rounded, at
// least 1, plus RandomSource.nextInt(amount / 2, amount * 2) (the upper bound left out)
export function battlePayout(levels, random = Math.random) {
    const sum = levels.reduce((a, b) => a + b, 0);
    const amount = Math.max(Math.round(sum * 5 * (sum / 50)), 1);
    const low = Math.trunc(amount / 2), high = amount * 2;
    return amount + low + Math.floor(random() * (high - low));
}

// BigInteger.format: the amount in at most three digits, with K, M, B and the rest after it, rounded down
const SUFFIXES = ["", "K", "M", "B", "T", "Q", "Qi", "Sx", "Sp", "O", "N", "D", "UD", "DD", "TD", "QD", "QiD", "SxD", "SpD", "OcD", "ND", "Vg"];
export function formatMoney(value, dollarSign = true) {
    value = BigInt(value);
    const abs = value < 0n ? -value : value;
    let magnitude = 0, unit = 1n;
    while (abs / unit >= 1000n && magnitude < SUFFIXES.length - 1) { magnitude++; unit *= 1000n; }
    const whole = value / unit;   // BigDecimal.toBigInteger, toward zero
    const scale = 3 - String(whole).length - (SUFFIXES[magnitude].length - 1);
    let text;
    if (scale >= 0) {
        const scaled = (value * 10n ** BigInt(scale)) / unit, sign = scaled < 0n ? "-" : "", digits = String(scaled < 0n ? -scaled : scaled).padStart(scale + 1, "0");
        text = scale ? `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : `${sign}${digits}`;
    } else {
        const step = unit * 10n ** BigInt(-scale);
        text = String((value / step) * 10n ** BigInt(-scale));
    }
    return `${dollarSign ? "$ " : ""}${text}${SUFFIXES[magnitude]}`;
}
// BigInteger.formatFull: every digit, in groups of three
export function formatFull(value, dollarSign = true) {
    return `${dollarSign ? "$ " : ""}${String(BigInt(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
// String.parseBigIntegerOrNull: a number, whole or not, and one of the suffixes after it (any case); null if not
export function parseMoney(text) {
    const s = String(text ?? "").trim();
    const cut = s.search(/[^0-9.]/), number = cut < 0 ? s : s.slice(0, cut), suffix = (cut < 0 ? "" : s.slice(cut)).toUpperCase();
    if (!/^(\d+\.?\d*|\.\d+)$/.test(number)) return null;
    const power = suffix === "" ? 0 : SUFFIXES.slice(1).map((x) => x.toUpperCase()).indexOf(suffix) + 1;
    if (suffix && power === 0) return null;
    const [whole, fraction = ""] = number.split("."), digits = 3 * power;
    return BigInt(whole || "0") * 10n ** BigInt(digits) + BigInt((fraction + "0".repeat(digits)).slice(0, digits) || "0");
}
// a decimal times a whole amount, rounded down (earnCobbleDollars' BigDecimal multiply, then toBigInteger)
function times(amount, factor) {
    const [w, f = ""] = String(factor).split(".");
    return (amount * BigInt(w + f)) / 10n ** BigInt(f.length);
}

export function balanceOf(player) {
    try { return BigInt(player.getDynamicProperty(BALANCE) ?? "0"); } catch (e) { return 0n; }
}
export function setBalance(player, value) {
    value = BigInt(value);
    if (value < 0n) value = 0n;
    const before = balanceOf(player);
    try { player.setDynamicProperty(BALANCE, value ? String(value) : undefined); } catch (e) { return; }
    noteAccount(player, value);
    if (value !== before) moneyChanged(player, value - before);
}
// earnCobbleDollars: a negative amount is refused, and the multiplier applies to battle money only
export function earn(player, amount, applyMultiplier = false) {
    amount = BigInt(amount);
    if (amount < 0n) return false;
    setBalance(player, balanceOf(player) + (applyMultiplier ? times(amount, INCOME_MULTIPLIER) : amount));
    return true;
}
// the money for a battle won, from the levels of the losing side's Pokemon (CobbleDollarsEvents.battleVictory)
export function payForBattle(player, levels, npc) {
    if (!player?.isValid || !levels.length || !(npc ? EARN_FROM_NPC : EARN_FROM_WILD)) return 0;
    const amount = battlePayout(levels);
    earn(player, amount, true);
    return amount;
}

// every player's last balance by id, for the leaderboard (the cobbledollarsplayerdata folder's name and cobbledollars)
function accounts() { try { return JSON.parse(world.getDynamicProperty(ACCOUNTS) ?? "{}"); } catch (e) { return {}; } }
function noteAccount(player, value) {
    const all = accounts();
    all[player.id] = [player.name, String(value)];
    try { world.setDynamicProperty(ACCOUNTS, JSON.stringify(all)); } catch (e) { }
}
export function leaderboard() {
    return Object.values(accounts()).map(([name, value]) => [name, BigInt(value)]).sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
}

// --- the money overlay -------------------------------------------------------------------------------------------

// CobbleDollarsOverlay at its default bottom_right: the 54 by 14 box with the balance, and for 30 ticks after it changes
// the difference above it, green with a "+" for a gain and red for a loss (renderAnimation). ui/hud_screen.json reads a
// title starting MONEY_MARKER: two fields of 13 bytes, the balance and the difference, each spaces then "§r" (so the
// layout never reads it as a number) then the text, which the right-aligned label shows flush right; then "y" while the
// difference shows and "g" or "r" for its colour
export const MONEY_MARKER = "cbm:money";
const shownDelta = new Map();
export function moneyTitle(balance, delta) {
    const field = (text) => `§r${text.slice(-10)}`.padStart(12, " ");
    const d = delta ? `${delta > 0n ? "+" : ""}${formatMoney(delta, false)}` : "";
    return `${MONEY_MARKER}${field(formatMoney(balance, false))}${field(d)}${delta ? "y" : "n"}${delta < 0n ? "r" : "g"}`;
}
export function sendMoney(player) {
    if (!player?.isValid) return;
    const delta = shownDelta.get(player.id);
    const live = delta && system.currentTick < delta.until ? delta.amount : 0n;
    try { player.onScreenDisplay.setTitle(moneyTitle(balanceOf(player), live), { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }); } catch (e) { }
}
function moneyChanged(player, difference) {
    const before = shownDelta.get(player.id);
    const amount = (before && system.currentTick < before.until ? before.amount : 0n) + difference;
    shownDelta.set(player.id, { amount, until: system.currentTick + 30 });
    sendMoney(player);
    system.runTimeout(() => sendMoney(player), 31);
}
// every five seconds too, for a HUD that has just come back (a rejoin, a dimension change)
system.runInterval(() => { for (const p of world.getAllPlayers()) sendMoney(p); }, 100);

// --- the shop ----------------------------------------------------------------------------------------------------

function storedJson(entity, key) { try { const v = entity?.getDynamicProperty(key); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } }
// a holder's shop: its own when it has one, else the default shop (BuyHandler: a shop with no categories is the default
// one). The Poke Mart clerks have theirs: the League's Shopkeeper (marked cobblemon:shop when the League was built, which
// in a world from before CobbleDollars holds its old emerald list) sells Radical Gyms' merchant's stock, the hub's clerk
// its own list at those prices
export function shopOf(holder) {
    const own = storedJson(holder, SHOP_PROP);
    if (own?.length) return own;
    if (holder?.typeId === "cobblemon:poke_mart_clerk") {
        let league = false;
        try { league = !!holder.getDynamicProperty("cobblemon:shop"); } catch (e) { }
        return league && GYM_LEAGUE.shop?.length ? GYM_LEAGUE.shop : POKE_MART_SHOP;
    }
    return DEFAULT_SHOP;
}
export function bankOf(holder) {
    const own = storedJson(holder, BANK_PROP);
    return own?.length ? own : DEFAULT_BANK;
}
export function setShop(holder, shop) { try { holder.setDynamicProperty(SHOP_PROP, shop ? JSON.stringify(shop) : undefined); } catch (e) { } }

function inventoryOf(player) { return player.getComponent(EntityComponentTypes.Inventory)?.container; }
function maxStack(id) { try { return new ItemStack(id, 1).maxAmount || 64; } catch (e) { return 64; } }
// getMaxAmountObtainable: room for the item in the inventory, empty slots and the stacks of it not yet full
export function roomFor(player, id) {
    const inv = inventoryOf(player), max = maxStack(id);
    let room = 0;
    for (let i = 0; i < (inv?.size ?? 0); i++) {
        const it = inv.getItem(i);
        if (!it) room += max;
        else if (it.typeId === id) room += Math.max(0, max - it.amount);
    }
    return room;
}
// getMaxAmountPurchasable: as many as the balance pays for, at most 9999 (all 9999 for a free offer)
export function affordable(balance, price) {
    price = BigInt(price);
    if (price === 0n) return MAX_AMOUNT;
    const n = BigInt(balance) / price;
    return Number(n > BigInt(MAX_AMOUNT) ? BigInt(MAX_AMOUNT) : n);
}

const priceText = (player, price) => `${balanceOf(player) >= BigInt(price) ? "§2" : "§c"}${formatMoney(price)}`;
// the merchant's shop: Right Click opens it (CobbleMerchant.mobInteract), a list of the categories when there are several,
// then the category's offers with their prices, red where the balance cannot pay for one
export function openShop(player, holder) {
    const shop = shopOf(holder);
    if (shop.length === 1) return openCategory(player, holder, shop, 0);
    const form = new ActionFormData().title("Shop").body(`§7You have §a${formatMoney(balanceOf(player))}§7.`);
    for (const c of shop) form.button(c.name, api.itemIcon(c.offers[0]?.item));
    form.show(player).then((r) => { if (!r.canceled && r.selection !== undefined) openCategory(player, holder, shop, r.selection); }).catch(() => { });
}
function openCategory(player, holder, shop, index) {
    const category = shop[index];
    if (!category) return;
    const form = new ActionFormData().title(category.name).body(`§7You have §a${formatMoney(balanceOf(player))}§7.`);
    for (const o of category.offers) form.button(`${api.itemName(o.item)}\n${priceText(player, o.price)}`, api.itemIcon(o.item));
    if (shop.length > 1) form.button("Back");
    form.show(player).then((r) => {
        if (r.canceled || r.selection === undefined) return;
        if (r.selection >= category.offers.length) return openShop(player, holder);
        chooseAmount(player, holder, shop, index, category.offers[r.selection]);
    }).catch(() => { });
}
// the amount box: 1 to what the balance pays for (at most 9999); BuyHandler then gives no more than the inventory holds
function chooseAmount(player, holder, shop, index, offer) {
    const max = affordable(balanceOf(player), offer.price), name = api.itemName(offer.item);
    if (max < 1) { player.sendMessage("§cNot enough CobbleDollars"); return openCategory(player, holder, shop, index); }
    const form = new ModalFormData().title(name).textField(`${name}, ${formatMoney(offer.price)} each.\nHow many? (1 to ${max})`, "1", { defaultValue: "1" });
    form.show(player).then((r) => {
        if (r.canceled || !r.formValues) return openCategory(player, holder, shop, index);
        const amount = Math.min(Math.max(1, Math.floor(Number(r.formValues[0]) || 0)), max);
        buy(player, offer, amount);
        openCategory(player, holder, shop, index);
    }).catch(() => { });
}
// BuyHandler: the amount cut to the room in the inventory, the price times it taken if the balance covers it, the items
// given, and the pickup sound
export function buy(player, offer, amount) {
    amount = Math.min(amount, roomFor(player, offer.item));
    if (amount <= 0) { player.sendMessage("§cThere is no room in your inventory."); return false; }
    const total = BigInt(offer.price) * BigInt(amount);
    if (balanceOf(player) < total) { player.sendMessage("§cNot enough CobbleDollars"); return false; }
    setBalance(player, balanceOf(player) - total);
    const inv = inventoryOf(player), max = maxStack(offer.item);
    for (let left = amount; left > 0; left -= max) {
        const rest = inv?.addItem(new ItemStack(offer.item, Math.min(max, left)));
        if (rest) player.dimension.spawnItem(rest, player.location);
    }
    try { player.playSound("random.pop", { volume: 0.2, pitch: ((Math.random() - Math.random()) * 0.7 + 1) * 2 }); } catch (e) { }
    return true;
}

// --- the bank ----------------------------------------------------------------------------------------------------

// Bank.getPrice: the price of the first offer an item matches, an offer naming one item or several (a tag's items)
export function bankPrice(bank, id) {
    const offer = bank.find((o) => o.item === id || o.items?.includes(id));
    return offer ? BigInt(offer.price) : null;
}
// what the inventory holds that the bank buys: each item, how many, and what they fetch (calculateBankValue)
export function bankable(player, bank) {
    const inv = inventoryOf(player), found = new Map();
    for (let i = 0; i < (inv?.size ?? 0); i++) {
        const it = inv.getItem(i);
        if (!it || bankPrice(bank, it.typeId) === null) continue;
        found.set(it.typeId, (found.get(it.typeId) ?? 0) + it.amount);
    }
    return [...found].map(([id, count]) => ({ id, count, value: bankPrice(bank, id) * BigInt(count) }));
}
function takeItems(player, id, count) {
    const inv = inventoryOf(player);
    for (let i = 0; i < (inv?.size ?? 0) && count > 0; i++) {
        const it = inv.getItem(i);
        if (it?.typeId !== id) continue;
        const take = Math.min(count, it.amount); count -= take;
        if (take === it.amount) inv.setItem(i, undefined); else { it.amount -= take; inv.setItem(i, it); }
    }
}
// SellHandler: the items given to the bank are taken and their price paid
export function sell(player, bank, id, count) {
    const price = bankPrice(bank, id), have = bankable(player, bank).find((b) => b.id === id)?.count ?? 0;
    count = Math.min(count, have);
    if (price === null || count <= 0) return 0n;
    takeItems(player, id, count);
    const paid = price * BigInt(count);
    setBalance(player, balanceOf(player) + paid);
    return paid;
}
// the merchant's bank: Shift + Right Click opens it. Java's is a container the player moves items into, its value shown
// on the Sell button; here each item the bank takes is listed with how many the player has and what they fetch, and
// Sell All sells every one
export function openBank(player, holder) {
    const bank = bankOf(holder), items = bankable(player, bank);
    const wants = bank.map((o) => `§7${o.item ? api.itemName(o.item) : o.name ?? "Items"}: §2${formatMoney(o.price)}`).join("\n");
    const total = items.reduce((a, b) => a + b.value, 0n);
    const form = new ActionFormData().title("Bank").body(`§7You have §a${formatMoney(balanceOf(player))}§7.\n\n§7The merchant buys:\n${wants}`);
    for (const b of items) form.button(`${api.itemName(b.id)} x${b.count}\n§2+${formatMoney(b.value)}`, api.itemIcon(b.id));
    if (items.length > 1) form.button(`Sell All\n§2+${formatMoney(total)}`);
    form.show(player).then((r) => {
        if (r.canceled || r.selection === undefined) return;
        if (r.selection >= items.length) { for (const b of items) sell(player, bank, b.id, b.count); return openBank(player, holder); }
        const b = items[r.selection];
        if (b.count === 1) { sell(player, bank, b.id, 1); return openBank(player, holder); }
        new ModalFormData().title(api.itemName(b.id)).slider(`Sell how many? (${formatMoney(bankPrice(bank, b.id))} each)`, 1, b.count, { defaultValue: b.count, valueStep: 1 })
            .show(player).then((s) => {
                if (!s.canceled && s.formValues) sell(player, bank, b.id, Math.round(Number(s.formValues[0])));
                openBank(player, holder);
            }).catch(() => { });
    }).catch(() => { });
}

// --- the Cobble Merchant -----------------------------------------------------------------------------------------

// CobbleMerchant.mobInteract and VillagerMixin.cobbleMerchantInteract: Right Click the shop, Shift + Right Click the bank
export function interactMerchant(player, holder, sneaking = player.isSneaking) {
    if (sneaking) openBank(player, holder); else openShop(player, holder);
}

// a villager's look as the merchant's (Bedrock's minecraft:mark_variant, the biome type), set through the entity's events
function markOf(entity) { try { return entity.getComponent("minecraft:mark_variant")?.value ?? 0; } catch (e) { return 0; } }
function becomeMerchant(villager, job) {
    if (!villager?.isValid) return undefined;
    const { dimension, location } = villager, mark = markOf(villager), name = villager.nameTag;
    let merchant;
    try { merchant = dimension.spawnEntity(MERCHANT, location); } catch (e) { return undefined; }
    try { merchant.triggerEvent(`cobbledollars:type_${mark}`); } catch (e) { }
    try { merchant.setRotation(villager.getRotation()); } catch (e) { }
    if (name) merchant.nameTag = name;
    if (job) merchant.setDynamicProperty(JOB_PROP, job);
    villager.remove();
    return merchant;
}
// a merchant with a job site that lost it goes back to being a villager without a profession (a level 1 villager with
// no experience loses its profession with its job site), in its biome's look
function becomeVillager(merchant) {
    const { dimension, location } = merchant, name = merchant.nameTag;
    try {
        const villager = dimension.spawnEntity("minecraft:villager_v2", location);
        villager.triggerEvent("minecraft:become_unskilled");
        if (name) villager.nameTag = name;
    } catch (e) { return; }
    merchant.remove();
}

// CobbleDollarsStructures: a village's villager spots hold a merchant one time in 13. Bedrock fires
// minecraft:spawn_from_village on the villagers a village generates with, so each of those is the spot's roll
world.afterEvents.dataDrivenEntityTrigger.subscribe(({ entity }) => {
    if (Math.random() >= VILLAGE_MERCHANT_CHANCE) return;
    system.run(() => { if (entity?.isValid) becomeMerchant(entity); });
}, { entityTypes: ["minecraft:villager_v2"], eventTypes: ["minecraft:spawn_from_village"] });

// CobbleDollarsPoiTypes: the Display Case is the merchant's job site, so a villager without a profession takes the
// profession at a Display Case no merchant has claimed. Bedrock's villagers take only their own job sites, so every
// five seconds each adult villager without a profession near a player looks for an unclaimed case within 16 blocks
const JOB_RANGE = 16;
const jobKey = (dim, b) => `${dim.id}|${b.x},${b.y},${b.z}`;
function claimed(dim) {
    const out = new Set();
    for (const m of dim.getEntities({ type: MERCHANT })) { const j = m.getDynamicProperty(JOB_PROP); if (j) out.add(j); }
    return out;
}
system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        const dim = player.dimension;
        let taken;
        for (const v of dim.getEntities({ type: "minecraft:villager_v2", location: player.location, maxDistance: 64 })) {
            try {
                if (v.getComponent("minecraft:is_baby") || v.getComponent("minecraft:variant")?.value !== 0) continue;
                taken ??= claimed(dim);
                const at = v.location, near = [];
                const volume = new BlockVolume({ x: Math.floor(at.x) - JOB_RANGE, y: Math.floor(at.y) - 4, z: Math.floor(at.z) - JOB_RANGE },
                    { x: Math.floor(at.x) + JOB_RANGE, y: Math.floor(at.y) + 4, z: Math.floor(at.z) + JOB_RANGE });
                for (const b of dim.getBlocks(volume, { includeTypes: ["cobblemon:display_case"] }, true).getBlockLocationIterator()) {
                    if ((b.x - at.x) ** 2 + (b.z - at.z) ** 2 <= JOB_RANGE * JOB_RANGE && !taken.has(jobKey(dim, b))) near.push(b);
                }
                if (!near.length) continue;
                near.sort((a, b) => (a.x - at.x) ** 2 + (a.z - at.z) ** 2 - (b.x - at.x) ** 2 - (b.z - at.z) ** 2);
                const key = jobKey(dim, near[0]);
                if (becomeMerchant(v, key)) taken.add(key);
            } catch (e) { }
        }
        // and a merchant whose case is gone loses the profession
        for (const m of dim.getEntities({ type: MERCHANT, location: player.location, maxDistance: 64 })) {
            const job = m.getDynamicProperty(JOB_PROP);
            if (!job) continue;
            const [, pos] = job.split("|"), [x, y, z] = pos.split(",").map(Number);
            try {
                const b = dim.getBlock({ x, y, z });
                if (b && b.typeId !== "cobblemon:display_case") becomeVillager(m);
            } catch (e) { }
        }
    }
}, 100);

// --- commands ----------------------------------------------------------------------------------------------------

const ok = (message) => ({ status: CustomCommandStatus.Success, message });
const bad = (message) => ({ status: CustomCommandStatus.Failure, message });
const later = (fn) => system.run(() => { try { fn(); } catch (e) { console.warn(`[cobbledollars] command: ${e}`); } });
function sourcePlayer(origin) { const s = origin.sourceEntity ?? origin.initiator; return s?.typeId === "minecraft:player" ? s : undefined; }
// CobbleDollarsPermissions: pay, query and the leaderboard for everyone, the rest at the cheat level (operators,
// command blocks and the server)
function mayCheat(origin) {
    const s = origin.sourceEntity ?? origin.initiator;
    if (s?.typeId !== "minecraft:player") return true;
    try { if ((s.commandPermissionLevel ?? 0) >= CommandPermissionLevel.GameDirectors) return true; } catch (e) { }
    try { return (s.playerPermissionLevel ?? 0) >= 2; } catch (e) { return false; }
}
// CobbleDollarsCommand's leaderboard: ten a page, highest first
export function leaderboardLines(page = 1) {
    const all = leaderboard(), pages = Math.max(1, Math.ceil(all.length / 10));
    page = Math.min(Math.max(1, page), pages);
    const lines = [`CobbleDollars Leaderboard${pages > 1 ? ` §a(${page}/${pages})` : ""}§a:`];
    all.slice((page - 1) * 10, page * 10).forEach(([name, value], i) => lines.push(`${(page - 1) * 10 + i + 1}. ${name} §a${formatMoney(value)}`));
    return lines;
}

export function registerCommands(registry) {
    const P = CustomCommandParamType, any = CommandPermissionLevel.Any;
    registry.registerEnum("cobblemon:cdaction", ["pay", "query", "give", "remove", "set", "leaderboard", "reload"]);
    registry.registerEnum("cobblemon:cdmenu", ["shop", "bank"]);
    // CobbleDollarsCommand (alias cd): pay, query, give, remove, set, leaderboard and reload. The amount is a whole
    // number: Bedrock's parser takes no bare number as a string, so the mod's suffixes (1.5K) cannot be typed. For the
    // leaderboard the number is the page (/cd leaderboard @s 2)
    const money = (origin, action, targets, amount) => {
        const self = sourcePlayer(origin), cheat = ["give", "remove", "set", "reload"].includes(action);
        if (cheat && !mayCheat(origin)) return bad("You don't have the permission to use: /cobbledollars " + action);
        if (action === "reload") return ok("Reloaded CobbleDollars config!");
        if (action === "leaderboard") { later(() => (self ?? world).sendMessage(leaderboardLines(amount ?? 1).join("\n"))); return ok(); }
        const list = targets ?? [];
        if (!list.length) return bad("Name a player.");
        if (action === "query") return ok(`${list[0].name} has ${formatMoney(balanceOf(list[0]))}`);
        if (amount === undefined || amount < (action === "set" ? 0 : 1)) return bad(`Name an amount of ${action === "set" ? 0 : 1} or more.`);
        const value = BigInt(amount);
        if (action === "pay") {
            if (!self) return bad("Run this as a player.");
            if (value > balanceOf(self)) return bad("Not enough CobbleDollars");
            const to = list[0];
            later(() => {
                setBalance(self, balanceOf(self) - value); setBalance(to, balanceOf(to) + value);
                to.sendMessage(`${self.name} sent you ${formatMoney(value)}`);
            });
            return ok(`Sent ${formatMoney(value)} to ${to.name}`);
        }
        later(() => {
            for (const p of list) {
                if (action === "give") earn(p, value);
                else if (action === "remove") setBalance(p, balanceOf(p) - (value < balanceOf(p) ? value : balanceOf(p)));
                else setBalance(p, value);
            }
        });
        const verb = { give: "Gave %s to %s", remove: "Removed %s from %s", set: "Set %s for %s" }[action];
        return ok(verb.replace("%s", formatMoney(value)).replace("%s", list.length === 1 ? list[0].name : `${list.length} players`));
    };
    for (const name of ["cobbledollars", "cd"]) {
        registry.registerCommand({ name: `cobblemon:${name}`, description: "CobbleDollars: pay, query, give, remove, set, leaderboard", permissionLevel: any,
            mandatoryParameters: [{ type: P.Enum, name: "cobblemon:cdaction" }],
            optionalParameters: [{ type: P.PlayerSelector, name: "target" }, { type: P.Integer, name: "amount" }] },
        (origin, action, targets, amount) => money(origin, action, targets, amount));
    }
    // CobbleMerchantCommand (alias cm): open the default shop or bank for a player, at the cheat level
    for (const name of ["cobblemerchant", "cm"]) {
        registry.registerCommand({ name: `cobblemon:${name}`, description: "Opens the CobbleDollars shop or bank", permissionLevel: CommandPermissionLevel.GameDirectors,
            mandatoryParameters: [{ type: P.Enum, name: "cobblemon:cdmenu" }], optionalParameters: [{ type: P.PlayerSelector, name: "target" }] },
        (origin, menu, targets) => {
            const player = targets?.[0] ?? sourcePlayer(origin);
            if (!player) return bad("Name a player.");
            later(() => (menu === "bank" ? openBank(player, undefined) : openShop(player, undefined)));
            return ok();
        });
    }
}
