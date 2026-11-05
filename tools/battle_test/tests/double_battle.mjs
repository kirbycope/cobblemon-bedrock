// Double battles: two Pokemon a side, a move at the chosen target (or the other foe when that one is down), spread moves
// at three quarters of their damage, turn order across all four, and side conditions and end of turn for every Pokemon
import { M, mon, move, check, flush } from "../harness.mjs";

function doubles(mine, theirs) {
    const log = [];
    const player = { id: `player-${Math.random()}`, name: "Tester", isValid: true, location: { x: 0, y: 0, z: 0 }, getDynamicProperty() { }, setDynamicProperty() { }, sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { } };
    const b = { player, doubles: true, trainer: "Test", turn: 1, log, said: [], slots: { a: [null, null], b: [null, null] }, picks: [] };
    mine.forEach((f, i) => M.setSlot(b, "a", i, f));
    theirs.forEach((f, i) => M.setSlot(b, "b", i, f));
    b.ally = b.slots.a[0]; b.foe = b.slots.b[0];
    return M.holdBattle(b);
}
// one turn with the random rolls fixed: no critical hits, no extra effects, the middle damage roll
function fixedTurn(b, picks) {
    const random = Math.random;
    Math.random = () => 0.5;
    try { b.picks = picks; M.resolveDouble(b); flush(); } finally { Math.random = random; }
}
const lv = { level: 50 };
{
    const golem = mon("Golem", lv), p0 = mon("Snorlax", lv), p1 = mon("Snorlax", lv), lone = doubles([golem], [p0]);
    fixedTurn(lone, [{ f: golem, move: move("rockslide"), target: 0 }]);
    const one = p0.stats.hp - p0.hp;
    p0.hp = p0.stats.hp;
    const b = doubles([golem], [p0, p1]);
    fixedTurn(b, [{ f: golem, move: move("rockslide"), target: 0 }]);
    const d0 = p0.stats.hp - p0.hp, d1 = p1.stats.hp - p1.hp;
    check("Rock Slide hits both foes", d0 > 0 && d1 > 0, `${d0} ${d1}`);
    check("for three quarters of what it does to a lone foe", Math.abs(d0 / one - 0.75) < 0.06, `${d0} against ${one}`);
}
{
    const partner = mon("Pikachu", lv), p0 = mon("Pidgey", lv), p1 = mon("Rattata", lv), b = doubles([mon("Golem", lv), partner], [p0, p1]);
    fixedTurn(b, [{ f: b.slots.a[0], move: move("earthquake"), target: 0 }]);
    check("Earthquake hits the user's partner too", partner.hp < partner.stats.hp && p1.hp < p1.stats.hp, `${partner.hp}/${partner.stats.hp}`);
    check("but not a Flying-type foe", p0.hp === p0.stats.hp);
}
{
    const p0 = mon("Rattata", lv), p1 = mon("Rattata", lv), b = doubles([mon("Machamp", lv)], [p0, p1]);
    fixedTurn(b, [{ f: b.slots.a[0], move: move("tackle"), target: 1 }]);
    check("a one-target move hits the foe picked", p0.hp === p0.stats.hp && p1.hp < p1.stats.hp);
    p1.hp = 0;
    fixedTurn(b, [{ f: b.slots.a[0], move: move("tackle"), target: 1 }]);
    check("and the other foe once that one is down", p0.hp < p0.stats.hp);
}
{
    const fast = mon("Jolteon", lv), slow = mon("Snorlax", lv), f0 = mon("Rattata", { level: 5 }), f1 = mon("Rattata", { level: 5 }), b = doubles([slow, fast], [f0, f1]);
    fixedTurn(b, [{ f: slow, move: move("tackle"), target: 0 }, { f: fast, move: move("tackle"), target: 1 }, { f: f0, move: move("quickattack"), target: 0 }]);
    const used = b.log.filter((l) => / used /.test(l) && !l.includes("§")).map((l) => l.split(" used ")[0]);
    check("moves go by priority, then speed, across all four", used.join(",") === "Rattata,Jolteon,Snorlax", used.join(","));
}
{
    const a0 = mon("Alakazam", lv), a1 = mon("Machamp", lv), b = doubles([a0, a1], [mon("Rattata", lv), mon("Rattata", lv)]);
    fixedTurn(b, [{ f: a0, move: move("reflect"), target: 0 }]);
    check("Reflect from one guards its partner's side", M.sideOf(b, a1).reflect > 0 && !M.sideOf(b, b.slots.b[0]).reflect);
}
{
    const a0 = mon("Pikachu", lv), a1 = mon("Eevee", lv), f0 = mon("Rattata", lv), f1 = mon("Golem", lv), b = doubles([a0, a1], [f0, f1]);
    b.weather = { kind: "sand", turns: 5 };
    fixedTurn(b, []);
    check("a sandstorm buffets every Pokemon in battle but the Rock types", a0.hp < a0.stats.hp && a1.hp < a1.stats.hp && f0.hp < f0.stats.hp && f1.hp === f1.stats.hp);
}
{
    const a0 = mon("Golem", lv), b = doubles([a0], [mon("Rattata", { level: 5, hp: 1 }), mon("Rattata", { level: 5, hp: 1 })]);
    fixedTurn(b, [{ f: a0, move: move("rockslide"), target: 0 }]);
    const ended = !b.slots.b.some((f) => f.hp > 0) && b.log.some((l) => /You defeated the Trainer/.test(l));
    check("knocking out both foes of a trainer with no bench wins the battle", ended, b.log.slice(-4).join(" | "));
}
{
    // the body's fields sit where port.py's layout slices them: each side's level, the double battle's flag and the
    // log at BATTLE_LOG, in bytes
    const { readFileSync } = await import("node:fs");
    const consts = {};
    for (const [, name, expr] of readFileSync(new URL("../../../port.py", import.meta.url), "utf-8").matchAll(/^(BATTLE_[A-Z0-9_]+) = ([^#\n]+)/gm)) {
        if (/^[\w\s+*()-]+$/.test(expr)) consts[name] = Function(...Object.keys(consts), `return ${expr};`)(...Object.values(consts));
    }
    const b = doubles([mon("Pikachu", lv), mon("Eevee", lv)], [mon("Rattata", lv), mon("Pidgey", lv)]);
    b.choosing = "1"; b.log = [];
    const body = Buffer.from(M.battleBody(b));
    const at = (a, n) => body.subarray(a, a + n).toString();
    check("the body's log starts where the layout reads it", body.length === consts.BATTLE_LOG, `${body.length} against ${consts.BATTLE_LOG}`);
    check("the double battle's flag and the slot choosing", at(consts.BATTLE_DBL, 2) === "d1", at(consts.BATTLE_DBL, 2));
    check("the second slots' names in the double battle's part", at(consts.BATTLE_SIDES2, 7) === "Eevee  " && at(consts.BATTLE_SIDES2 + consts.BATTLE_SIDE, 6) === "Pidgey");
    const one = Buffer.from(M.battleBody(M.holdBattle({ ...b, doubles: false, ally: b.slots.a[0], foe: b.slots.b[0] })));
    check("a single battle's body is as long, flagged s", one.length === consts.BATTLE_LOG && one.subarray(consts.BATTLE_DBL, consts.BATTLE_DBL + 1).toString() === "s");
}
{
    const b = doubles([mon("Pikachu", lv), mon("Eevee", lv)], [mon("Rattata", lv), mon("Pidgey", lv)]);
    b.choosing = "1";
    check("a double battle's screen titles carry |d and the slot choosing", M.battleTitle(b, "moves") === "cbm:battle_moves|d1");
    check("and a single battle's are the plain ones", M.battleTitle({ ...b, doubles: false }, "menu") === "cbm:battle_menu");
}
