// The battle engine of scripts/main.js, loaded in Node (tools/battle_test/run.mjs registers the module hook first).
// The scripts are copied to a temporary folder and the copy of main.js exports every top-level function, so a test
// can build two Pokemon, put them in a battle and call useMove, boost, endOfTurn and the rest directly; the add-on's
// own files are not changed. Battle text goes into battle.log.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { queue } from "./stub_server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "..", "development_behavior_packs", "cobblemon", "scripts");
const copy = mkdtempSync(join(tmpdir(), "cobblemon-battle-"));
cpSync(scripts, copy, { recursive: true });
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));   // the scripts are ES modules
const main = readFileSync(join(copy, "main.js"), "utf-8");
const names = [...main.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);
writeFileSync(join(copy, "main.js"), `${main}\nexport { ${[...new Set(names)].join(", ")} };\n`);
export const M = await import(pathToFileURL(join(copy, "main.js")).href);
export const D = await import(pathToFileURL(join(copy, "data.js")).href);
queue.length = 0;   // what loading queued (world setup) is not the battle's

// runs what system.run and runTimeout queued, the battle's delayed lines among them
export function flush(limit = 200) { for (let n = 0; n < limit && queue.length; n++) { try { queue.shift()(); } catch (e) { } } }

// a stand-in entity: its dynamic properties in a map, everything else accepted
function entity(typeId) {
    const store = new Map();
    return new Proxy({ typeId, id: `test-${typeId}-${Math.random()}`, isValid: true, location: { x: 0, y: 0, z: 0 },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)),
        getComponent: () => undefined, hasComponent: () => false, getProperty: () => 0, setProperty() { }, triggerEvent() { },
        addEffect() { }, removeEffect() { }, getHeadLocation: () => ({ x: 0, y: 1, z: 0 }), dimension: new Proxy({}, { get: () => () => [] }) },
        { get: (t, k) => (k in t ? t[k] : () => undefined) });
}

// a Pokemon to battle with: species by name ("Charizard") or id, then any fields to set (level, moves by id, ability,
// held as Cobblemon's id without the namespace, hp, status, stats)
export function mon(species, opts = {}) {
    const typeId = species.includes(":") ? species : Object.keys(D.POKEMON).find((id) => D.POKEMON[id].name.toLowerCase() === species.toLowerCase());
    if (!typeId) throw new Error(`no species ${species}`);
    const e = entity(typeId);
    if (opts.level) e.setDynamicProperty("cobblemon:level", opts.level);
    if (opts.moves) e.setDynamicProperty("cobblemon:moves", JSON.stringify(opts.moves));
    const f = M.fighter(e);
    if (opts.ability) f.ability = opts.ability;
    if (opts.held !== undefined) f.held = opts.held ? `cobblemon:${opts.held}` : null;
    if (opts.status !== undefined) f.status = opts.status;
    if (opts.stats) Object.assign(f.stats, opts.stats);
    if (opts.hp !== undefined) f.hp = opts.hp <= 1 && opts.hp > 0 && !Number.isInteger(opts.hp) ? Math.max(1, Math.floor(f.stats.hp * opts.hp)) : opts.hp;
    return f;
}

// a wild battle between them, the player's Pokemon first
export function battle(ally, foe, extra = {}) {
    const log = [];
    const player = { id: "player", name: "Tester", isValid: true, sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { } };
    return { player, ally, foe, log, said: [], turn: 1, pvp: false, team: [ally], foeTeam: [foe], ...extra };
}

export function move(id) { const m = D.MOVES[id]; if (!m) throw new Error(`no move ${id}`); return { id, ...m, pp: m.pp, left: m.pp }; }

// asserts, counted by run.mjs
export const results = [];
export function check(name, ok, detail = "") { results.push({ name, ok: !!ok, detail }); }
