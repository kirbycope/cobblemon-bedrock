// ChangePCBoxesCommand: a PC grows by empty boxes at the end and shrinks by its empty boxes, the last first, the boxes
// after each moving down with their names; it will not drop a box holding Pokemon
import { M, check } from "../harness.mjs";

function player() {
    const props = new Map();
    return { id: `p-${Math.random()}`, name: "Tester", getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)), props };
}
const p = player();
check("a PC starts with Cobblemon's 40 boxes", M.pcBoxes(p) === 40);
check("adding grows it", M.resizePc(p, 45) && M.pcBoxes(p) === 45);
const rec = { t: "cobblemon:p0025_pikachu", lv: 5 };
M.saveBox(p, 2, [rec]); M.saveBox(p, 44, [rec]);
p.setDynamicProperty("cobblemon:pc_names", JSON.stringify({ 2: "Sparky", 44: "Last" }));
check("shrinking removes the last empty boxes first", M.resizePc(p, 43) && M.pcBoxes(p) === 43);
check("and the boxes after them move down, names and all", M.box(p, 42)[0]?.t === rec.t && JSON.parse(p.getDynamicProperty("cobblemon:pc_names"))[42] === "Last"
      && M.box(p, 2)[0]?.t === rec.t, JSON.stringify(JSON.parse(p.getDynamicProperty("cobblemon:pc_names"))));
check("it will not drop a box holding Pokemon", M.resizePc(p, 1) === false && M.pcBoxes(p) === 43);
check("down to the boxes in use it will", M.resizePc(p, 2) && M.box(p, 0)[0]?.t === rec.t && M.box(p, 1)[0]?.t === rec.t);
