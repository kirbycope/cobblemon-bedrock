// The PC's focus back where it was (issue 70's follow-up): each choice reopens the form, and the box name bar took the
// focus after every pick and drop, so a controller had to come back to its slot. Each slot and box arrow has a twin on
// its spot with a default_focus_precedence, shown only while the body's "focus" field names its button
import { readFileSync } from "node:fs";
import { check, mod } from "../harness.mjs";

const { PC_LAYOUT, PC_FOCUS_RETURN } = await mod("pc_layout.js");
check("the slots and the box arrows keep the focus", JSON.stringify(PC_FOCUS_RETURN) === JSON.stringify([...Array(38).keys()]));
check("the body carries the button last pressed in two characters", PC_LAYOUT.some(([k, w]) => k === "focus" && w === 2) && PC_LAYOUT.at(-1)[0] === "item");

const ui = JSON.parse(readFileSync(new URL("../../../development_resource_packs/cobblemon/ui/server_form.json", import.meta.url), "utf-8"));
const twins = [], buttons = {}, precedences = [];
(function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        if (value?.type === "button") {
            buttons[key] = value;
            if (key.endsWith("_f")) twins.push([key, value]);
            if ("default_focus_precedence" in value) precedences.push(key);
        }
        walk(value);
    }
})(ui.cobblemon_pc);
check("every slot, in both layouts, and both box arrows has a twin", twins.length === 30 * 2 + 6 + 2, `${twins.length}`);
// beside the other buttons in the collection (one nested in a panel neither took the first focus nor followed its moves)
const good = twins.every(([key, button]) => {
    const n = +key.match(/\d+/)[0], original = buttons[key.slice(0, -2)];
    const visible = button.bindings.filter((b) => b.target_property_name === "#visible");
    const shows = visible.length === 1 && visible[0].source_property_name.endsWith(`${String(n).padStart(2, "0")}')`);
    const moves = ["up", "down", "left", "right"].every((d) => button[`focus_change_${d}`] === original?.[`focus_change_${d}`]);
    return button.collection_index === n && button.default_focus_precedence === 10 && shows && moves
        && button.focus_identifier === `${original?.focus_identifier}_f`;
});
check("each shows only when the body names its button, takes the focus first, and moves as its button does", good);
check("no other PC button has a focus precedence to outrank them", precedences.every((k) => k.endsWith("_f")), precedences.filter((k) => !k.endsWith("_f")).join(", "));
