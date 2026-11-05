// Triple Battles: three a side, moves reaching only the Pokemon beside and across (Showdown's isAdjacent), Ally Switch
// trading the edges, Shift moving an edge Pokemon to the middle, and the last two moved to the center when out of reach
import { readFileSync } from "node:fs";
import { M, mon, move, check, flush } from "../harness.mjs";

function triples(mine, theirs) {
    const log = [];
    const player = { id: `player-${Math.random()}`, name: "Tester", isValid: true, location: { x: 0, y: 0, z: 0 }, getDynamicProperty() { }, setDynamicProperty() { }, sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { } };
    const b = { player, doubles: true, triples: true, trainer: "Test", turn: 1, log, said: [], slots: { a: [null, null, null], b: [null, null, null] }, picks: [] };
    mine.forEach((f, i) => { if (f) M.setSlot(b, "a", i, f); });
    theirs.forEach((f, i) => { if (f) M.setSlot(b, "b", i, f); });
    b.ally = b.slots.a.find(Boolean); b.foe = b.slots.b.find(Boolean);
    return M.holdBattle(b);
}
function fixedTurn(b, picks) {
    const random = Math.random;
    Math.random = () => 0.5;
    try { b.picks = picks; M.resolveDouble(b); flush(); } finally { Math.random = random; }
}
const lv = { level: 50 };
{
    const [a0, a1, a2] = [mon("Machamp", lv), mon("Snorlax", lv), mon("Snorlax", lv)], [b0, b1, b2] = [mon("Snorlax", lv), mon("Snorlax", lv), mon("Snorlax", lv)];
    const b = triples([a0, a1, a2], [b0, b1, b2]);
    check("the left edge reaches the foe across and the middle one", M.adjacent(b, a0, b2) && M.adjacent(b, a0, b1));
    check("but not the far edge", !M.adjacent(b, a0, b0));
    check("the middle reaches all three foes", [b0, b1, b2].every((f) => M.adjacent(b, a1, f)));
    check("partners reach only the one beside them", M.adjacent(b, a0, a1) && !M.adjacent(b, a0, a2));
    const reach = M.moveTargets(b, a0, move("rockslide"), 0);
    check("a spread move hits only the foes in reach", reach.length === 2 && !reach.includes(b0), reach.map((f) => f.slot).join(","));
    const quake = M.moveTargets(b, a0, move("earthquake"), 0);
    check("Earthquake hits the adjacent foes and the partner beside", quake.length === 3 && quake.includes(a1) && !quake.includes(a2) && !quake.includes(b0));
    check("a move at any Pokemon reaches the far edge", M.moveTargets(b, a0, move("dragonpulse"), 0).includes(b0));
    b2.hp = 0; b1.hp = 0;
    check("with nothing in reach, a one-target move has no target", M.moveTargets(b, a0, move("tackle"), 2).length === 0);
}
{
    const [a0, a1, a2] = [mon("Abra", lv), mon("Snorlax", lv), mon("Machamp", lv)], b = triples([a0, a1, a2], [mon("Rattata", lv), mon("Rattata", lv), mon("Rattata", lv)]);
    fixedTurn(b, [{ f: a0, move: move("allyswitch"), target: 0 }]);
    check("Ally Switch trades a triple battle's edges", b.slots.a[0] === a2 && b.slots.a[2] === a0 && b.slots.a[1] === a1);
    const c = triples([mon("Rattata", lv), a1, mon("Rattata", lv)], [mon("Rattata", lv)]);
    c.log.length = 0;
    fixedTurn(c, [{ f: a1, move: move("allyswitch"), target: 0 }]);
    check("and fails from the middle", c.slots.a[1] === a1 && c.log.some((l) => /But it failed/.test(l)));
}
{
    const [a0, a1] = [mon("Pikachu", lv), mon("Eevee", lv)], b = triples([a0, a1, null], [mon("Rattata", lv), mon("Rattata", lv), mon("Rattata", lv)]);
    fixedTurn(b, [{ f: a0, kind: "shift" }]);
    check("Shift moves an edge Pokemon to the middle", b.slots.a[1] === a0 && b.slots.a[0] === a1 && b.log.some((l) => /moved to the center/.test(l)));
}
{
    const x = mon("Pikachu", lv), y = mon("Rattata", lv), b = triples([x, null, null], [y, null, null]);
    b.gym = { party: [{ down: false, out: true }] };
    M.autoCenter(b);
    check("the last two, out of reach at the edges, are moved to the center", b.slots.a[1] === x && b.slots.b[1] === y && b.log.some((l) => /moved to the center/.test(l)));
}
{
    const consts = {};
    for (const [, name, expr] of readFileSync(new URL("../../../port.py", import.meta.url), "utf-8").matchAll(/^(BATTLE_[A-Z0-9_]+) = ([^#\n]+)/gm)) {
        consts[name] = Function(...Object.keys(consts), `return ${expr}`)(...Object.values(consts));
    }
    const b = triples([mon("Pikachu", lv), mon("Eevee", lv), mon("Machamp", lv)], [mon("Rattata", lv), mon("Pidgey", lv), mon("Golem", lv)]);
    b.choosing = "2"; b.log = [];
    const body = Buffer.from(M.battleBody(b));
    const at = (i, n) => body.subarray(i, i + n).toString();
    check("the third slots' names in the triple battle's part", at(consts.BATTLE_SIDES3, 7) === "Machamp" && at(consts.BATTLE_SIDES3 + consts.BATTLE_SIDE, 5) === "Golem", `${at(consts.BATTLE_SIDES3, 7)}|${at(consts.BATTLE_SIDES3 + consts.BATTLE_SIDE, 5)}`);
    check("and the log starts where the layout reads it", body.length === consts.BATTLE_LOG, `${body.length} against ${consts.BATTLE_LOG}`);
    check("a triple battle's titles carry |t after the slot choosing", M.battleTitle(b, "moves") === "cbm:battle_moves|d2|t");
}
