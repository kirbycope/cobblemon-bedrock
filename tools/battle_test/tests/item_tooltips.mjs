// Issue 74: a missed Poke Ball picked up again made a stack of its own beside the thrower's. The script gives Cobblemon's
// tooltip lines to an item as lore once it is in an inventory, and lore keeps two stacks apart, so the dropped ball
// (no lore yet) could not join the stack that already had it. The dropped ball now carries its tooltip, and an item
// that gets its lore late joins any stack of the same item with room
import { readFileSync } from "node:fs";
import { M, check } from "../harness.mjs";

class Stack {
    constructor(typeId, amount = 1, lore = []) { this.typeId = typeId; this.amount = amount; this.lore = lore; this.maxAmount = 64; }
    getLore() { return [...this.lore]; }
    setLore(lines) { this.lore = [...lines]; }
    isStackableWith(other) { return other.typeId === this.typeId && JSON.stringify(other.lore) === JSON.stringify(this.lore); }
}
function inventory(slots) {
    const items = [...slots];
    return { size: items.length, items, getItem: (i) => items[i], setItem: (i, item) => { items[i] = item; } };
}
const BALL = "cobblemon:poke_ball";
const lore = M.withTooltip(new Stack(BALL)).getLore();

check("a Poke Ball gets Cobblemon's tooltip as lore", lore.length > 0 && lore[0].includes("catch rate"), JSON.stringify(lore));
check("an item that already has lore keeps it", M.withTooltip(new Stack(BALL, 1, ["mine"])).getLore()[0] === "mine");

// a ball picked up into slot 0 with no lore joins the 10 in slot 3 once it has its tooltip
let inv = inventory([M.withTooltip(new Stack(BALL)), undefined, undefined, new Stack(BALL, 10, lore)]);
M.mergeInto(inv, 0, inv.items[0]);
check("a picked-up ball joins the stack it belongs to", !inv.items[0] && inv.items[3].amount === 11, inv.items.map((s) => s?.amount));

// only as many as fit: the rest keeps its own slot
inv = inventory([new Stack(BALL, 3, lore), new Stack(BALL, 63, lore)]);
M.mergeInto(inv, 0, inv.items[0]);
check("the rest stays where it was once the stack is full", inv.items[0].amount === 2 && inv.items[1].amount === 64, inv.items.map((s) => s?.amount));

// nothing to join: it stays put, and another ball (a Great Ball) is never joined
inv = inventory([new Stack(BALL, 1, lore), new Stack("cobblemon:great_ball", 5, lore)]);
M.mergeInto(inv, 0, inv.items[0]);
check("with no stack of its own kind it keeps its slot", inv.items[0]?.amount === 1 && inv.items[1].amount === 5);

// the ball a miss drops is spawned with its tooltip already on
const spawned = [];
M.dropBall({ spawnItem: (item) => spawned.push(item) }, BALL, { x: 0, y: 0, z: 0 }, null);
check("a missed ball drops with its tooltip", spawned.length === 1 && spawned[0].typeId === BALL, JSON.stringify(spawned));

// the PC's Release button draws its text (ReleaseButton's "Release", bold) on every state of its face
const ui = JSON.parse(readFileSync(new URL("../../../development_resource_packs/cobblemon/ui/server_form.json", import.meta.url), "utf-8"));
let release;
(function walk(node) {
    if (release || !node || typeof node !== "object") return;
    if (node.button_38 && node.button_38.offset?.[0] === 279) { release = node.button_38; return; }
    for (const value of Object.values(node)) walk(value);
})(ui.cobblemon_pc);
const labelled = release?.controls.every((state) => Object.values(state)[0].controls?.some((c) => c.text?.text === "#form_button_text"));
check("the PC's Release button shows its text in every state", labelled, JSON.stringify(release?.controls).slice(0, 200));
