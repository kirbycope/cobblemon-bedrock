// Every action form the game opens builds all of Cobblemon's screens (server_form.json's cobblemon_forms: the battle, the
// PC, the Pokedex and the rest, each hidden by its title), so every control on any of them is paid for on every form.
// 1.0.562 and 1.0.563 doubled the count with the PC's hover preview, and each form then opened about half a second later
// on a phone (November 2026). The ceiling sits a little above today's count, so growth is a choice made on purpose.
import { readFileSync } from "node:fs";
import { check } from "../harness.mjs";

const CEILING = 10500;   // counted as below: 7,715 in 1.0.561, 18,283 in 1.0.563, 10,147 in 1.0.564
const ui = JSON.parse(readFileSync(new URL("../../../development_resource_packs/cobblemon/ui/server_form.json", import.meta.url), "utf-8"));
const count = (node) => {
    if (Array.isArray(node)) return node.reduce((n, v) => n + count(v), 0);
    if (!node || typeof node !== "object") return 0;
    return Object.entries(node).reduce((n, [k, v]) => n + (k === "controls" && Array.isArray(v) ? v.length : 0) + count(v), 0);
};
const screens = (ui.cobblemon_forms.controls ?? []).map((c) => Object.keys(c)[0].split("@server_form.")[1]);
const total = screens.reduce((n, s) => n + count(ui[s]), 0);
check(`the screens every form builds hold at most ${CEILING} controls`, screens.length >= 12 && total <= CEILING, `${total} controls over ${screens.length} screens`);
