// CobbleDollars (scripts/cobbledollars.js): the battle payout, the money's formatting and parsing, the overlay's title,
// the shop's limits and the bank, as the mod's decompiled code has them (java_cobbledollars/)
import { M, mon, battle, check, flush, mod } from "../harness.mjs";

const C = await mod("cobbledollars.js");
const fixed = (value, fn) => { const random = Math.random; Math.random = () => value; try { return fn(); } finally { Math.random = random; } };

// MiscUtils.calculateAndAwardCobbleDollars: s = the levels summed, round(s * 5 * s / 50) at least 1, plus nextInt(a / 2, a * 2)
check("a level 10 wild Pokemon pays 10, plus 5 to 19", C.battlePayout([10], () => 0) === 15 && C.battlePayout([10], () => 0.9999) === 29,
    [C.battlePayout([10], () => 0), C.battlePayout([10], () => 0.9999)].join());
check("a level 50 one pays 250, plus 125 to 499", C.battlePayout([50], () => 0) === 375 && C.battlePayout([50], () => 0.9999) === 749);
check("a team's levels are summed first, so a team of two level 25s pays as one level 50", C.battlePayout([25, 25], () => 0) === C.battlePayout([50], () => 0));
check("a level 1 Pokemon pays at least 1", C.battlePayout([1], () => 0) === 1, String(C.battlePayout([1], () => 0)));

// BigInteger.format and formatFull
const cases = [[0n, "$ 0"], [7n, "$ 7"], [999n, "$ 999"], [1000n, "$ 1K"], [1234n, "$ 1.23K"], [12345n, "$ 12.3K"], [123456n, "$ 123K"],
    [1500000n, "$ 1.5M"], [999999n, "$ 999K"], [-1234n, "$ -1.2K"], [10n ** 18n * 123n, "$ 120Qi"]];
for (const [value, text] of cases) check(`${value} reads ${text}`, C.formatMoney(value) === text, C.formatMoney(value));
check("formatFull groups every digit", C.formatFull(1234567n) === "$ 1,234,567" && C.formatFull(12n, false) === "12");

// parseBigIntegerOrNull
check("amounts take the suffixes", C.parseMoney("1.5K") === 1500n && C.parseMoney("2m") === 2000000n && C.parseMoney("100") === 100n && C.parseMoney("1.23456K") === 1234n,
    [C.parseMoney("1.5K"), C.parseMoney("2m"), C.parseMoney("100"), C.parseMoney("1.23456K")].join());
check("and refuse what is not an amount", C.parseMoney("abc") === null && C.parseMoney("1.5X") === null && C.parseMoney("") === null);

// the overlay's title: two 13-byte fields after the marker, then the flag and the colour, cut by bytes as '%.Ns' cuts
{
    const title = C.moneyTitle(1234n, -500n), bytes = Buffer.from(title, "utf8");
    const at = (a, b) => bytes.subarray(9 + a, 9 + b).toString("utf8");
    check("the title starts cbm:money", title.startsWith("cbm:money"));
    check("the balance field ends in the amount", at(0, 13).endsWith("§r1.23K") && Buffer.byteLength(at(0, 13)) === 13, JSON.stringify(at(0, 13)));
    check("the difference field holds the loss", at(13, 26).endsWith("§r-500"), JSON.stringify(at(13, 26)));
    check("then shown, in red", at(26, 27) === "y" && at(27, 28) === "r", at(26, 28));
    const quiet = Buffer.from(C.moneyTitle(5n, 0n), "utf8");
    check("with no difference it is hidden", quiet.subarray(35, 36).toString() === "n", quiet.toString());
}

// getMaxAmountPurchasable: what the balance pays for, at most 9999, and 9999 of a free offer
check("the amount a balance buys", C.affordable(5000n, "2000") === 2 && C.affordable(0n, "1") === 0 && C.affordable(10n ** 9n, "1") === 9999 && C.affordable(0n, "0") === 9999);

// a player with an inventory and dynamic properties
function player(items = []) {
    const store = new Map(), slots = Array.from({ length: 36 }, (_, i) => items[i] ?? undefined);
    const inv = { size: 36, getItem: (i) => slots[i], setItem: (i, it) => { slots[i] = it; },
        addItem: (it) => { const i = slots.findIndex((s) => !s); if (i < 0) return it; slots[i] = it; return undefined; } };
    return { id: `p${Math.random()}`, name: "Tester", isValid: true, slots, getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)),
        getComponent: (c) => (String(c).toLowerCase() === "inventory" ? { container: inv } : undefined), sendMessage() { }, playSound() { }, onScreenDisplay: { setTitle() { } },
        dimension: { spawnItem() { } }, location: { x: 0, y: 0, z: 0 } };
}
const stack = (typeId, amount) => ({ typeId, amount, maxAmount: 64 });

// the bank: CobbleDollars' default buys an emerald for 750
{
    const p = player([stack("minecraft:emerald", 10), stack("minecraft:dirt", 5), stack("minecraft:emerald", 3)]);
    const bank = C.bankOf(undefined);
    check("the default bank buys emeralds for 750", C.bankPrice(bank, "minecraft:emerald") === 750n && C.bankPrice(bank, "minecraft:dirt") === null);
    const found = C.bankable(p, bank);
    check("the bank sees every emerald and nothing else", found.length === 1 && found[0].count === 13 && found[0].value === 9750n, JSON.stringify(found, (k, v) => (typeof v === "bigint" ? String(v) : v)));
    C.sell(p, bank, "minecraft:emerald", 11);
    check("selling takes them and pays", C.balanceOf(p) === 8250n && C.bankable(p, bank)[0].count === 2, String(C.balanceOf(p)));
}

// the shop: BuyHandler takes the price times the amount, no more than the inventory holds
{
    const p = player();
    C.setBalance(p, 5000n);
    const ball = { item: "cobblemon:poke_ball", price: "2000" };
    check("buying two balls costs 4000", C.buy(p, ball, 2) && C.balanceOf(p) === 1000n, String(C.balanceOf(p)));
    check("and a third is refused", !C.buy(p, ball, 1) && C.balanceOf(p) === 1000n);
}
check("the default shop is CobbleDollars' two categories", C.shopOf(undefined).length === 2 && C.shopOf(undefined)[0].offers[0].item === "cobblemon:poke_ball");
{
    const clerk = { typeId: "cobblemon:poke_mart_clerk", getDynamicProperty: () => undefined }, league = { typeId: "cobblemon:poke_mart_clerk", getDynamicProperty: (k) => (k === "cobblemon:shop" ? "league" : undefined) };
    const old = { typeId: "cobblemon:poke_mart_clerk", getDynamicProperty: (k) => (k === "cobblemon:shop" ? "[[\"cobblemon:potion\",2]]" : undefined) };
    const price = (shop, id) => shop.flatMap((c) => c.offers).find((o) => o.item === id)?.price;
    check("the hub clerk sells a Potion at the League's 300", price(C.shopOf(clerk), "cobblemon:potion") === "300", JSON.stringify(C.shopOf(clerk)).slice(0, 200));
    check("and the Poke Rod, which the League does not", price(C.shopOf(clerk), "cobblemon:poke_rod") === "1250");
    check("the League's Shopkeeper sells Radical Gyms' stock, Max Revive at 5000", price(C.shopOf(league), "cobblemon:max_revive") === "5000" && price(C.shopOf(old), "cobblemon:max_revive") === "5000");
}

// the battle's money (payCobbleDollars on CobbleDollarsEvents.battleVictory)
fixed(0, () => {
    const won = battle(mon("Pikachu", { level: 30 }), mon("Rattata", { level: 30 }), { player: player() });
    won.wipedSides = new Set(["foe"]); won.pendingExp = [{ foe: won.foe, loser: "foe" }];
    M.payCobbleDollars(won); M.payCobbleDollars(won); flush();
    check("beating a level 30 wild Pokemon pays 90 plus 45, once", C.balanceOf(won.player) === 135n, String(C.balanceOf(won.player)));

    const caught = battle(mon("Pikachu", { level: 30 }), mon("Rattata", { level: 20 }), { player: player() });
    caught.captured = true;
    M.payCobbleDollars(caught);
    check("catching a level 20 one in battle pays 40 plus 20", C.balanceOf(caught.player) === 60n, String(C.balanceOf(caught.player)));

    const trainer = battle(mon("Pikachu", { level: 30 }), mon("Geodude", { level: 14 }), { player: player(), trainer: "Brock" });
    trainer.wipedSides = new Set(["foe"]); trainer.pendingExp = [{ foe: mon("Onix", { level: 12 }), loser: "foe" }, { foe: trainer.foe, loser: "foe" }];
    M.payCobbleDollars(trainer);
    check("a trainer's team pays for its levels summed (12 + 14)", C.balanceOf(trainer.player) === 102n, String(C.balanceOf(trainer.player)));

    const fled = battle(mon("Pikachu", { level: 30 }), mon("Rattata", { level: 30 }), { player: player() });
    M.payCobbleDollars(fled);
    const lost = battle(mon("Pikachu", { level: 30 }), mon("Rattata", { level: 30 }), { player: player() });
    lost.wipedSides = new Set(["ally"]); lost.pendingExp = [{ foe: lost.ally, loser: "ally" }];
    M.payCobbleDollars(lost);
    check("fleeing or losing pays nothing", C.balanceOf(fled.player) === 0n && C.balanceOf(lost.player) === 0n);
});

// the leaderboard: every balance set, highest first
{
    const lines = C.leaderboardLines(1);
    check("the leaderboard lists the balances highest first", lines[0].startsWith("CobbleDollars Leaderboard") && lines.length > 2, lines.join(" | "));
}
