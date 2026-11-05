// Double battles: two Pokemon a side, a move at the chosen target (or the other foe when that one is down), spread moves
// at three quarters of their damage, turn order across all four, and side conditions and end of turn for every Pokemon
import { readFileSync } from "node:fs";
import { M, mon, move, check, flush, battle } from "../harness.mjs";

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
{
    const gyarados = mon("Gyarados", { ...lv, ability: "intimidate" }), r0 = mon("Rattata", lv), r1 = mon("Rattata", lv);
    const b = doubles([gyarados], [r0, r1]);
    M.focus(b, gyarados); M.enter(b, gyarados, r0);
    check("Intimidate lowers both foes' Attack", r0.stages.atk === -1 && r1.stages.atk === -1, `${r0.stages.atk} ${r1.stages.atk}`);
}
{
    const helper = mon("Clefairy", lv), hitter = mon("Machamp", lv), t0 = mon("Snorlax", lv), t1 = mon("Snorlax", lv);
    const plain = doubles([mon("Clefairy", lv), hitter], [t0, mon("Snorlax", lv)]);
    fixedTurn(plain, [{ f: hitter, move: move("tackle"), target: 0 }]);
    const alone = t0.stats.hp - t0.hp;
    t0.hp = t0.stats.hp;
    const b = doubles([helper, hitter], [t0, t1]);
    fixedTurn(b, [{ f: helper, move: move("helpinghand"), target: 1, ally: true }, { f: hitter, move: move("tackle"), target: 0 }]);
    const helped = t0.stats.hp - t0.hp;
    check("Helping Hand goes first and powers up the partner's move by half", Math.abs(helped / alone - 1.5) < 0.12, `${helped} against ${alone}`);
    const s = battle(mon("Clefairy", lv), mon("Rattata", lv));
    M.useMove(s, s.ally, s.foe, move("aromaticmist"));
    check("a partner move fails in a single battle rather than boosting the foe", !s.foe.stages.spd && s.log.some((l) => /But it failed/.test(l)));
}
{
    const howler = mon("Growlithe", lv), partner = mon("Machamp", lv), b = doubles([howler, partner], [mon("Rattata", lv), mon("Rattata", lv)]);
    fixedTurn(b, [{ f: howler, move: move("howl"), target: 0 }]);
    check("Howl raises the user's and its partner's Attack", howler.stages.atk === 1 && partner.stages.atk === 1, `${howler.stages.atk} ${partner.stages.atk}`);
}
{
    const lure = mon("Clefairy", lv), partner = mon("Pikachu", lv), foe = mon("Machamp", lv), b = doubles([lure, partner], [foe, mon("Rattata", lv)]);
    fixedTurn(b, [{ f: lure, move: move("followme"), target: 0 }, { f: foe, move: move("tackle"), target: 1 }]);
    check("Follow Me goes first and draws a foe's move aimed at the partner", lure.hp < lure.stats.hp && partner.hp === partner.stats.hp, `${lure.hp} ${partner.hp}`);
    const s = battle(mon("Clefairy", lv), mon("Rattata", lv));
    M.useMove(s, s.ally, s.foe, move("followme"));
    check("and fails in a single battle", s.log.some((l) => /But it failed/.test(l)));
}
{
    const lure = mon("Paras", lv), partner = mon("Pikachu", lv), grass = mon("Bulbasaur", lv), other = mon("Machamp", lv);
    const b = doubles([lure, partner], [grass, other]);
    fixedTurn(b, [{ f: lure, move: move("ragepowder"), target: 0 }, { f: grass, move: move("tackle"), target: 1 }]);
    check("Rage Powder does not draw a Grass-type's move", partner.hp < partner.stats.hp && lure.hp === lure.stats.hp, `${lure.hp} ${partner.hp}`);
    partner.hp = partner.stats.hp; b.turn = lure.spotlit.turn + 1;
    fixedTurn(b, [{ f: lure, move: move("ragepowder"), target: 0 }, { f: other, move: move("tackle"), target: 1 }]);
    check("but does draw another's", lure.hp < lure.stats.hp && partner.hp === partner.stats.hp, `${lure.hp} ${partner.hp}`);
}
{
    const lure = mon("Clefairy", lv), partner = mon("Pikachu", lv), foe = mon("Duraludon", { ...lv, ability: "stalwart" }), b = doubles([lure, partner], [foe, mon("Rattata", lv)]);
    fixedTurn(b, [{ f: lure, move: move("followme"), target: 0 }, { f: foe, move: move("tackle"), target: 1 }]);
    check("Stalwart keeps a move on the Pokemon it was aimed at", partner.hp < partner.stats.hp && lure.hp === lure.stats.hp, `${lure.hp} ${partner.hp}`);
}
{
    const a0 = mon("Abra", lv), a1 = mon("Snorlax", lv), foe = mon("Machamp", lv), b = doubles([a0, a1], [foe, mon("Rattata", lv)]);
    const first = b.turn;
    fixedTurn(b, [{ f: a0, move: move("allyswitch"), target: 0 }, { f: foe, move: move("tackle"), target: 0 }]);
    check("Ally Switch trades the partners' places", b.slots.a[0] === a1 && b.slots.a[1] === a0 && a0.slot === 1 && a1.slot === 0);
    check("so a move aimed at the user's old place hits its partner", a1.hp < a1.stats.hp && a0.hp === a0.stats.hp, `${a0.hp} ${a1.hp}`);
    b.turn = first + 1; b.log.length = 0;
    fixedTurn(b, [{ f: a0, move: move("allyswitch"), target: 0 }]);
    check("and used again the next turn it can fail (one time in three works)", b.slots.a[1] === a0 && b.log.some((l) => /But it failed/.test(l)));
    const s = battle(mon("Abra", lv), mon("Rattata", lv));
    M.useMove(s, s.ally, s.foe, move("allyswitch"));
    check("Ally Switch fails in a single battle", s.log.some((l) => /But it failed/.test(l)));
}
{
    const text = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/rct_trainers.js", import.meta.url), "utf-8");
    const marked = (text.match(/"doubles":\s*true/g) ?? []).length;
    const from = text.indexOf('"elite_four_lorelei_004e":{"name"'), flag = text.indexOf('"doubles":true', from);
    check("Lorelei is the gym trainer who fights a Double Battle (RCT's GEN_9_DOUBLES)", marked === 1 && from > 0 && !/"\w+":\{"name"/.test(text.slice(from + 10, flag)), String(marked));
}
