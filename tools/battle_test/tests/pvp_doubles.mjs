// Double Battles between players: the second player's view sees its own side first, a turn plays out for both, and
// the side left with nothing loses
import { M, mon, move, check, flush } from "../harness.mjs";

function player(name) {
    const log = [];
    return { id: `${name}-${Math.random()}`, name, isValid: true, location: { x: 0, y: 0, z: 0 }, log, getDynamicProperty() { }, setDynamicProperty() { },
             sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { }, onScreenDisplay: { setActionBar() { } } };
}
function pvpDoubles(mine, theirs) {
    const p1 = player("Ash"), p2 = player("Gary");
    const b = { pvp: true, doubles: true, side: 0, player: p1, opponent: p2, trainer: p2.name, adjustLevel: 0, turn: 1, log: [], opponentLog: [], said: [],
                kept: {}, down: new Set(), choices: [], slots: { a: [null, null], b: [null, null] }, picks: [] };
    mine.forEach((f, i) => M.setSlot(b, "a", i, f));
    theirs.forEach((f, i) => M.setSlot(b, "b", i, f));
    b.ally = b.slots.a[0]; b.foe = b.slots.b[0];
    const m = M.mirrorOf(b);
    M.holdBattle(b); M.holdBattle(m);
    return { b, m, p1, p2 };
}
const lv = { level: 50 };
{
    const { b, m } = pvpDoubles([mon("Pikachu", lv), mon("Eevee", lv)], [mon("Rattata", lv), mon("Pidgey", lv)]);
    const own = Buffer.from(M.battleBody(b)).toString(), theirs = Buffer.from(M.battleBody(m)).toString();
    check("the first player's screen shows its own Pikachu first", own.slice(1, 8) === "Pikachu");
    check("and the second player's its own Rattata first, Ash's Pikachu across", theirs.slice(1, 8) === "Rattata" && theirs.slice(34, 41) === "Pikachu", theirs.slice(0, 50));
    m.choosing = "1"; b.choosing = "0";
    check("each player's screen title marks its own Pokemon choosing", M.battleTitle(m, "menu") === "cbm:battle_menu|d1" && M.battleTitle(b, "menu") === "cbm:battle_menu|d0");
}
{
    const a0 = mon("Snorlax", lv), a1 = mon("Snorlax", lv), b0 = mon("Snorlax", lv), b1 = mon("Snorlax", lv);
    const { b, p1, p2 } = pvpDoubles([a0, a1], [b0, b1]);
    const random = Math.random; Math.random = () => 0.5;
    try {
        b.picks = [{ f: a0, move: move("tackle"), target: 1 }, { f: b0, move: move("tackle"), target: 0 }];
        M.resolveDouble(b); flush();
    } finally { Math.random = random; }
    check("Ash's Snorlax hit Gary's second, and Gary's first hit Ash's first", b1.hp < b1.stats.hp && a0.hp < a0.stats.hp && b0.hp === b0.stats.hp && a1.hp === a1.stats.hp);
    check("both players are told the turn", p1.log.some((l) => / used Tackle/.test(l)) && p2.log.some((l) => / used Tackle/.test(l)));
}
{
    const { b, m, p1, p2 } = pvpDoubles([mon("Snorlax", lv), mon("Snorlax", lv)], [mon("Rattata", { level: 5, hp: 0 }), mon("Pidgey", { level: 5, hp: 0 })]);
    M.pvpDoubleAfterTurn(b); flush();
    check("the side with both Pokemon down and none to send loses", p1.log.some((l) => /Gary is out of usable/.test(l)) && p1.log.some((l) => /Ash won/.test(l)), p1.log.slice(-3).join(" | "));
    check("and the battle is over for both players", !M.battleOf(b.slots.a[0].entity));
}
{
    const { b, m } = pvpDoubles([mon("Pikachu", lv)], [mon("Rattata", lv), mon("Pidgey", lv)]);
    check("a side with no one on the bench has nothing to switch to", M.benchFor(m).length === 0 && M.benchFor(b).length === 0);
}
{
    // Pokemon.addExperience: a Pokemon at the top level gains nothing and nothing is said (canLevelUpFurther)
    const top = mon("Venusaur", { level: 100 }), foe = mon("Rattata", { level: 50 });
    const { battle } = await import("../harness.mjs");
    const b = battle(top, foe);
    M.gainExperience(b, top, foe);
    check("a level 100 Pokemon gains no experience and no message", !b.log.some((l) => /Exp\. Points/.test(l)), b.log.join(" | "));
    const low = mon("Venusaur", { level: 30 }), b2 = battle(low, mon("Rattata", { level: 50 }));
    M.gainExperience(b2, low, b2.foe);
    check("one below it still does", b2.log.some((l) => /gained \d+ Exp\. Points/.test(l)), b2.log.join(" | "));
}
