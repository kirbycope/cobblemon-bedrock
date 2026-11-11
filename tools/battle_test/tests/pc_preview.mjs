// Issue 70: StorageWidget's preview. While nothing is grabbed, Cobblemon's PC shows the Pokemon under the cursor in the
// info panel (PCGUI.setPreviewPokemon on hover); here each slot button's text carries its Pokemon (PC_SLOT_LAYOUT) and
// the slot's hover state, which a controller's focus also shows, draws it over the info panel
import { readFileSync } from "node:fs";
import { M, check, mod } from "../harness.mjs";

const { PC_SLOT_LAYOUT } = await mod("pc_layout.js");
const player = { id: "preview-tester" };
const ivs = { hp: 31, atk: 20, def: 10, spa: 5, spd: 1, spe: 0 };
const rec = { t: "cobblemon:p0001_bulbasaur", v: 0, lv: 17, xp: 0, mv: JSON.stringify(["tackle", "vinewhip"]), f: false, hp: 1, n: "Bulby",
              k: { "cobblemon:ivs": JSON.stringify(ivs), "cobblemon:evs": JSON.stringify({ hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }), "cobblemon:nature": "modest" } };

// the text read back field by field as the screen reads it: each field its width in bytes, the item what is left
function decode(text) {
    const bytes = Buffer.from(text, "utf-8"), out = {};
    let at = 0;
    for (const [key, width] of PC_SLOT_LAYOUT) {
        out[key] = (width ? bytes.subarray(at, at + width) : bytes.subarray(at)).toString("utf-8").trim();
        at += width;
    }
    return out;
}
const info = decode(M.pcSlotText(player, rec, null, "i"));
check("a slot's text carries its Pokemon's name, level and portrait", info.name === "Bulby" && info.level.includes("17") && info.portrait === "i0100", JSON.stringify(info));
check("and the page shown, with its nature and moves on the info page", info.page === "i" && info.nature.length > 0 && info.move0.length > 0, JSON.stringify(info));
const stats = decode(M.pcSlotText(player, rec, null, "v"));
check("on the IV page its IVs, HP to Speed", ["31", "20", "10", "5", "1", "0"].every((n, i) => stats[`sv${i}`].replace(/§./g, "") === n), JSON.stringify(stats));
check("the held item's texture comes last, unpadded", info.item.startsWith("textures/"), info.item);

// a Pokemon stored before it rolled IVs rolls them as the box is shown, as choosing it did
const old = [{ t: "cobblemon:p0004_charmander", v: 0, lv: 5, k: {} }, null, rec];
check("a stored Pokemon without IVs rolls them once", M.rollMissingIvs(old) && JSON.parse(old[0].k["cobblemon:ivs"]).hp >= 0 && !M.rollMissingIvs(old));

// the screen: every slot button, the box's 30 and the party's 6, draws the preview while hovered or pressed and not at rest,
// at the screen's corner, and only while its text is not empty. Pressed shows the hover child (pressed_control) rather
// than a copy of it, and the box's 30 shown with the options draw none: every control here is built for every form the
// game opens
const ui = JSON.parse(readFileSync(new URL("../../../development_resource_packs/cobblemon/ui/server_form.json", import.meta.url), "utf-8"));
const found = {};
(function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
        const m = key.match(/^button_(\d+)(_opts)?$/);
        if (m && value?.controls && +m[1] < 36 && Object.keys(node).length === 1) (found[key] ??= []).push(value);
        walk(value);
    }
})(ui.cobblemon_pc);
const slots = Object.entries(found).filter(([k]) => +k.match(/\d+/)[0] < 36);
const ok = (b) => {
    const states = Object.fromEntries(b.controls.map((s) => Object.entries(s)[0]));
    const preview = (s) => s?.controls?.find((c) => c.preview)?.preview;
    const p = preview(states.hover);
    return p && b.pressed_control === "hover" && !states.pressed && !preview(states.default) && p.offset[0] <= 0 && p.offset[1] <= 0
        && JSON.stringify(p.bindings).includes("(not (#form_button_text = ''))");
};
const plain = (b) => !b.controls.some((s) => Object.values(s)[0]?.controls?.some((c) => c.preview));
check("all 36 slots preview their Pokemon on hover", slots.filter(([k]) => !k.endsWith("_opts")).length === 36
      && slots.filter(([k]) => !k.endsWith("_opts")).every(([, list]) => list.every(ok)));
check("the 30 shown with the options draw no preview", slots.filter(([k]) => k.endsWith("_opts")).length === 30
      && slots.filter(([k]) => k.endsWith("_opts")).every(([, list]) => list.every(plain)));
