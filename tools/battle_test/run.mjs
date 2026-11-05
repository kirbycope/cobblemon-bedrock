// Runs the battle engine's tests in Node, without the game:
//     node tools/battle_test/run.mjs                 every file in tools/battle_test/tests
//     node tools/battle_test/run.mjs held_items      the files whose names contain that
// Each test file imports harness.mjs, builds Pokemon and battles, and calls check(name, ok, detail).
import { register } from "node:module";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./loader.mjs", import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { results } = await import("./harness.mjs");
const filter = process.argv[2] ?? "";
for (const file of readdirSync(join(here, "tests")).filter((f) => f.endsWith(".mjs") && f.includes(filter)).sort()) {
    try { await import(pathToFileURL(join(here, "tests", file)).href); }
    catch (e) { results.push({ name: `${file} failed to run`, ok: false, detail: e.stack?.split("\n").slice(0, 3).join(" | ") }); }
}
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "pass" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  -- ${r.detail}`}`);
console.log(`${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
