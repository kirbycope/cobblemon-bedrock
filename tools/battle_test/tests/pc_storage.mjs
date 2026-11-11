// Issue #68: a PC box was one string dynamic property, and Bedrock refuses one over 32767 characters, so a box of large
// records stopped taking Pokemon with slots still free; a catch with a full party left the Pokemon out, a move from
// the party closed the PC and a move from another box lost the Pokemon. A box is now written in pieces.
import { M, check, checkProperty } from "../harness.mjs";

function player() {
    const props = new Map();
    return { id: `p-${Math.random()}`, name: "Tester", props, getDynamicProperty: (k) => props.get(k),
             setDynamicProperty: (k, v) => (checkProperty(k, v), v === undefined ? props.delete(k) : props.set(k, v)) };
}
// a record the size a well-travelled Pokemon's is: partySnapshot keeps every property its entity had
function bigRecord(i) {
    const k = { "cobblemon:ivs": JSON.stringify({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }),
                "cobblemon:evs": JSON.stringify({ hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 }) };
    for (let n = 0; n < 23; n++) k[`cobblemon:extra_${n}`] = `value-${i}-${n}`.padEnd(24, "x");
    return { t: "cobblemon:p0025_pikachu", v: 0, lv: 50, xp: 125000, mv: JSON.stringify(["thunderbolt", "quick_attack"]), f: false, hp: 1, n: `Pika ${i}`, k };
}
const size = JSON.stringify(bigRecord(0)).length;
check("a test record is as large as the issue's (a box of 24 passes the limit)", size * 24 > 32767 && size * 20 < 32767, `${size} characters`);

const p = player();
const full = Array.from({ length: 30 }, (_, i) => bigRecord(i));
let threw = null;
try { M.saveBox(p, 0, full); } catch (e) { threw = e; }
check("a box of 30 large records saves", !threw, String(threw));
check("and reads back whole", M.box(p, 0).filter(Boolean).length === 30 && M.box(p, 0)[29].n === "Pika 29");
check("in pieces under the limit", [...p.props.entries()].filter(([key]) => key.startsWith("cobblemon:pc_0")).every(([, v]) => v.length <= 32767)
      && p.getDynamicProperty("cobblemon:pc_0_1") !== undefined);

// a box that shrinks leaves no stale piece behind for the next read to join on
M.saveBox(p, 0, [bigRecord(0)]);
check("a box that shrinks drops its extra pieces", p.getDynamicProperty("cobblemon:pc_0_1") === undefined && M.box(p, 0).filter(Boolean).length === 1);

// a box saved whole by an earlier version still reads
p.setDynamicProperty("cobblemon:pc_3", JSON.stringify([{ t: "cobblemon:p0001_bulbasaur", lv: 5 }]));
check("a box saved before pieces still reads", M.box(p, 3)[0]?.t === "cobblemon:p0001_bulbasaur");

// a move from another box into a nearly full one keeps the Pokemon (it used to vanish)
const q = player();
M.saveBox(q, 0, Array.from({ length: 29 }, (_, i) => bigRecord(i)));
M.saveBox(q, 1, [bigRecord(99)]);
M.pcMove(q, { kind: "box", box: 1, slot: 0 }, { kind: "box", box: 0, slot: 29 });
check("a move between boxes into a big box keeps the Pokemon", M.box(q, 0)[29]?.n === "Pika 99" && !M.box(q, 1)[0]);

// a catch with a full party goes to the first box with a slot, however large its records
const r = player();
const slots = M.partyOf(r.id);
for (let n = 0; n < 6; n++) slots.push({ pid: `pid${n}`, rec: bigRecord(n), out: null });
M.saveBox(r, 0, Array.from({ length: 25 }, (_, i) => bigRecord(i)));
let placed = null;
try { placed = M.addRecord(r, bigRecord(50)); } catch (e) { placed = e; }
check("a catch with a full party goes into a big box with room", placed?.box === 0 && M.box(r, 0)[25]?.n === "Pika 50", String(placed?.message ?? JSON.stringify(placed)));

// a box that cannot be written is passed over rather than stopping the catch halfway
const s = player();
const sSlots = M.partyOf(s.id);
for (let n = 0; n < 6; n++) sSlots.push({ pid: `pid${n}`, rec: bigRecord(n), out: null });
const set = s.setDynamicProperty;
s.setDynamicProperty = (k, v) => { if (k.startsWith("cobblemon:pc_0")) throw new Error("refused"); return set(k, v); };
let next = null;
try { next = M.addRecord(s, bigRecord(7)); } catch (e) { next = e; }
check("a box that refuses the write is passed over", next?.box === 1 && M.box(s, 1)[0]?.n === "Pika 7", String(next?.message ?? JSON.stringify(next)));

// a piece never ends between the halves of a surrogate pair, so a nickname of emoji or rare script survives
const text = "a".repeat(7999) + "\u{1F600}" + "b".repeat(10);
const pieces = M.textPieces(text);
check("a piece does not split a surrogate pair", pieces.join("") === text && pieces.every((piece) => !/[\ud800-\udbff]$/.test(piece)));

// shrinking the PC clears every piece of a dropped box
const t = player();
M.resizePc(t, 42);
M.saveBox(t, 41, []);
t.setDynamicProperty("cobblemon:pc_41_1", "stale");
M.resizePc(t, 40);
check("a dropped box leaves none of its pieces", t.getDynamicProperty("cobblemon:pc_41") === undefined && t.getDynamicProperty("cobblemon:pc_41_1") === undefined);

// the limit counts bytes, not characters: a box of nicknames in a three-byte script is under 32767 characters and
// over 32767 bytes, which a box kept whole could not save; in pieces each stays under it
const u = player();
const wide = Array.from({ length: 30 }, (_, i) => ({ t: "cobblemon:p0025_pikachu", lv: 5, n: "ピカチュウ".repeat(80) + i }));
const wideText = JSON.stringify(wide);
let wideError = null;
try { M.saveBox(u, 0, wide); } catch (e) { wideError = e; }
check("a box over the limit in bytes though not in characters saves in pieces",
      wideText.length < 32767 && Buffer.byteLength(wideText) > 32767 && !wideError && M.box(u, 0)[29]?.n === wide[29].n, String(wideError));
