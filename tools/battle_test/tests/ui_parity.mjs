// The UI parity build: the Pokedex Moves tab's learnset, sorting, filter and move details (MovesLearnsetWidget), the Size
// tab's height step (SizeWidget), the PC info panel's shiny icon and status (PCGUI), the scanner's name frame extras
// (PokedexScannerRenderer), the HUD toast (CobblemonToast) and the request icon's fade (ClientPlayerIcon)
import { M, D, check, flush, mon } from "../harness.mjs";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// the pack's own modules, read from a copy that is an ES module package as the harness reads main.js (the scripts
// folder has no package.json, so Node would take a .js there for CommonJS)
const here = dirname(fileURLToPath(import.meta.url)), scripts = join(here, "..", "..", "..", "development_behavior_packs", "cobblemon", "scripts");
const copy = mkdtempSync(join(tmpdir(), "cobblemon-ui-"));
for (const name of ["request_icons.js", "variants.js"]) cpSync(join(scripts, name), join(copy, name));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const { requestIconAlpha } = await import(pathToFileURL(join(copy, "request_icons.js")).href);
const { SHINY_VARIANTS } = await import(pathToFileURL(join(copy, "variants.js")).href);

const charmander = Object.keys(D.POKEMON).find((id) => D.POKEMON[id].name === "Charmander");
const species = D.POKEMON[charmander];

// the learnset and what is discovered
const none = M.dexLearnset(species, charmander, new Set(), 0);
check("the learnset lists every level-up, TM and egg move once", none.length > 10 && new Set(none.map((e) => e.id)).size === none.length);
check("a level-up move above the level met is undiscovered", none.some((e) => e.source === "Level" && !e.discovered));
check("egg moves are always discovered", none.some((e) => e.source === "Egg") && none.filter((e) => e.source === "Egg").every((e) => e.discovered));
const all = M.dexLearnset(species, charmander, new Set(), 100);
check("every level-up move is discovered once a kept Pokemon of the species reached its level", all.filter((e) => e.source === "Level").every((e) => e.discovered));
const lockedTm = none.find((e) => e.source === "TM" && !e.tmUnlocked);
check("a TM move whose TM is not unlocked is undiscovered, its disc the undiscovered one", !!lockedTm && !lockedTm.discovered && lockedTm.tm !== undefined);
const unlocked = lockedTm && M.dexLearnset(species, charmander, new Set([lockedTm.id]), 0).find((e) => e.id === lockedTm.id);
check("and discovered once that TM is learned", !!unlocked && unlocked.discovered && unlocked.tmUnlocked);

// LearnsetSort
const byName = M.dexSortMoves(all, "name").map((e) => D.MOVES[e.id].name);
check("sort by name is alphabetical", byName.every((n, i) => i === 0 || byName[i - 1].localeCompare(n) <= 0));
const byLevel = M.dexSortMoves(all, "level");
check("sort by level runs the level-up moves up, then the TM and egg moves", byLevel[0].source === "Level" && byLevel.every((e, i) => i === 0 || (byLevel[i - 1].level ?? 1000) <= (e.level ?? 1000)));
const byDisc = M.dexSortMoves(none, "discovered"), firstHidden = byDisc.findIndex((e) => !e.discovered);
check("sort by discovered puts the discovered moves first", firstHidden > 0 && byDisc.slice(firstHidden).every((e) => !e.discovered));
const byType = M.dexSortMoves(all, "type").map((e) => D.MOVES[e.id].type);
check("sort by type groups the types", byType.every((t, i) => i === 0 || byType[i - 1].localeCompare(t) <= 0));

// the Moves tab's fields
const v = {}, state = { tab: "m" };
const page = M.dexMoves(v, state, species, charmander, new Set(), 0);
check("the Moves tab fills four rows a page under All", v.mcat === "§lAll" && page.pages >= 2 && page.page.length === 4 && v.r3name !== undefined);
check("an undiscovered row reads ???", [0, 1, 2, 3].some((r) => v[`r${r}name`] === "§l???"));
check("nothing chosen shows a dash, no category icon and no description", v.mname === "-" && v.mdesc === "" && v.mcatc === "c--");
state.msel = "scratch";
M.dexMoves(v, state, species, charmander, new Set(), 5);
check("the chosen discovered move shows its PP, power, accuracy, category and description",
      v.mname === "Scratch" && v.mpp.includes("35 PP") && v.mpow.includes("40") && v.macc.includes("100%%") && v.mcatc === "cph" && v.mdesc.length > 0, JSON.stringify([v.mname, v.mpp, v.mpow, v.macc, v.mcatc]));
check("the chosen row is marked selected", [0, 1, 2, 3].some((r) => v[`r${r}sel`] === "y"));
state.msel = null; state.mfilter = 2;
check("the TM filter keeps the TM moves only", M.dexMoves(v, state, species, charmander, new Set(), 5).page.every((e) => e.source === "TM") && v.mcat === "§lTM");
state.mfilter = 3;
check("and the Egg filter the egg moves", M.dexMoves(v, state, species, charmander, new Set(), 5).page.every((e) => e.source === "Egg"));

// SizeWidget's grid step
check("the height grid's step: Charmander 0.6 m lowest, Charizard 1.7 m higher, Wailord capped", M.dexHeightStep(6) === "a" && M.dexHeightStep(17) === "c" && M.dexHeightStep(145) === "l");

// PCGUI's shiny icon and status
const pikachu = Object.keys(D.POKEMON).find((id) => D.POKEMON[id].name === "Pikachu");
const pv = { page: "i" };
M.pcInfo(pv, { t: pikachu, lv: 5, v: 0, k: { "cobblemon:status": JSON.stringify({ s: "brn", left: 100 }) } }, null);
check("the PC's info panel carries the status bar's code and no shiny icon for a plain one", pv.status === "brn" && pv.shiny === "n");
const shinyV = (SHINY_VARIANTS[pikachu] ?? [])[0], sv = { page: "i" };
M.pcInfo(sv, { t: pikachu, lv: 5, v: shinyV, k: { "cobblemon:fainted": true } }, null);
check("a shiny shows the shiny icon, a fainted one the fnt bar", shinyV !== undefined && sv.shiny === "y" && sv.status === "fnt");
const nv = { page: "i" };
M.pcInfo(nv, null, null);
check("no Pokemon chosen, no status and no shiny icon", nv.status === "non" && nv.shiny === "n");

// PokedexScannerRenderer's name frame
const closed = M.scanRecord({ open: false });
check("a closed scan record spans the layout's 189 bytes", Buffer.byteLength(closed) === 189, String(Buffer.byteLength(closed)));
const e = mon("Charmander", { level: 12, gender: "male" }).entity;
const st = { open: true, target: e, focus: 9, progress: 0, registered: 0, usage: 0, inner: 0, sides: ["l", "r", "l", "r"], caught: true, player: { id: "player" }, regText: "" };
const rec = M.scanRecord(st), bytes = Buffer.from(rec);
check("an open record keeps the width, names the species with its gender symbol and marks it caught",
      bytes.length === 189 && rec.includes("Charmander§b♂") && bytes[188] === "y".charCodeAt(0), `${bytes.length} ${rec.slice(12, 60)}`);
check("your own or a wild Pokemon is not Trainer Owned", !rec.includes("Trainer Owned") && rec.includes("Size:"));
e.setDynamicProperty("cobblemon:owner", "someone-else");
check("another trainer's Pokemon reads Trainer Owned", M.scanRecord(st).includes("Trainer Owned"));
e.setDynamicProperty("cobblemon:alpha", true);
check("an alpha's size frame reads Alpha", M.scanRecord(st).includes("Alpha") && !M.scanRecord(st).includes("Size:"));

// CobblemonToast on the HUD
const titles = [];
const player = { id: "p", isValid: true, getDynamicProperty: () => true, onScreenDisplay: { setTitle: (t) => titles.push(t) }, getComponent: () => undefined, dimension: { getEntities: () => [] } };
M.hudToast(player, "textures/items/tms/blank_disc", "New TMs Learned!", "Check the TM Machine", 80);
check("a HUD toast sends the frame's record: shown, the icon, the title and the description",
      titles[0]?.startsWith("cbm:toasty") && titles[0].includes("New TMs Learned!") && titles[0].endsWith("Check the TM Machine"), titles[0]);
flush();
check("and takes it down again afterwards for a player with a starter", titles.length >= 2 && titles[titles.length - 1].startsWith("cbm:toastn"), titles[titles.length - 1]);

// ClientPlayerIcon's fade
check("the request icon is full until the request's last quarter", requestIconAlpha(0, 400) === 1 && requestIconAlpha(299, 400) === 1);
check("then fades to 0.15 over 30 ticks and back", Math.abs(requestIconAlpha(330, 400) - 0.15) < 1e-9 && requestIconAlpha(360, 400) === 1 && Math.abs(requestIconAlpha(315, 400) - 0.575) < 1e-9);
