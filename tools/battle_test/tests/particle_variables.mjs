// The client's content log gets "unhandled request for unknown variable" each time a particle reads a variable nothing
// on Bedrock has set, where Cobblemon's Molang reads 0 without a word: Ember's fire, started by ember_actor's timeline,
// read the target deltas the script gives only the aimed parent (Bedrock hands an emitter's variables on to none of the
// emitters its events start), hundreds of times a battle, and Fire Blast's burstarc and Draco Meteor's motion did the
// same. port.py's guard_unset_variables gives each such read Cobblemon's value as a fallback through ??.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { M, check, mod, flush, mon } from "../harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "development_resource_packs", "cobblemon", "particles");
const files = [];
(function walk(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".particle.json")) files.push(p); } })(root);
const particles = Object.fromEntries(files.map((p) => { const d = JSON.parse(readFileSync(p, "utf-8")); return [d.particle_effect.description.identifier, d]; }));

const TARGET = new Set(["target_deltax", "target_deltay", "target_deltaz", "target_distance"]);
const scripts = join(here, "..", "..", "..", "development_behavior_packs", "cobblemon", "scripts");
const passed = new Set();   // what the scripts hand a particle, other than the target deltas only some spawns get
for (const n of readdirSync(scripts).filter((n) => n.endsWith(".js")))
    for (const m of readFileSync(join(scripts, n), "utf-8").matchAll(/set(?:Float|Vector3|ColorRGBA?|SpeedAndDirection)\(\s*[`"']variable\.(\w+)/g)) if (!TARGET.has(m[1])) passed.add(m[1]);
const builtin = new Set(["emitter", "particle"].flatMap((a) => ["age", "lifetime", "random_1", "random_2", "random_3", "random_4"].map((b) => `${a}_${b}`)));

// every read: set by the particle's own expressions or curves (a curve not in an emitter rate, which reads it before
// the curve's first evaluation), built in, passed by a script, or carrying a fallback
const loose = [];
for (const [id, d] of Object.entries(particles)) {
    const e = d.particle_effect, curves = new Set(Object.keys(e.curves ?? {}).map((k) => k.split(".")[1])), own = new Set();
    for (const m of JSON.stringify(e).matchAll(/(?<![\w.])(?:v|variable)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi)) own.add(m[1]);
    for (const [name, comp] of Object.entries(e.components ?? {})) {
        const text = JSON.stringify(comp), inRate = name.startsWith("minecraft:emitter_rate");
        for (const m of text.matchAll(/(?<![\w.])(?:v|variable)\.([a-z_][a-z0-9_]*)(?![\w])(?!\s*\.)/gi)) {
            const v = m[1], after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
            if (builtin.has(v) || passed.has(v) || own.has(v) || /^\s*\?\?/.test(after) || /^\s*=(?!=)/.test(after)) continue;
            if (curves.has(v) && !inRate) continue;
            loose.push(`${id} ${name}: ${m[0]}`);
        }
    }
}
check("every variable a particle reads is set, built in, passed by a script or given a fallback", loose.length === 0, [...new Set(loose)].slice(0, 6).join("; "));

const fire = JSON.stringify(particles["cobblemon:ember_fire"]);
check("Ember's fire falls back to its parent's preview deltaz, 5, when nothing passes it", /\(v\.target_deltaz \?\? 5(\.0)?\)/.test(fire));
check("Draco Meteor's emitter rate reads its curve with the curve's start", /\(v\.motion \?\? 0\.13\)/.test(JSON.stringify(particles["cobblemon:dracometeor_meteortrail1"].particle_effect.components["minecraft:emitter_rate_steady"])));
check("Greninja's fading cloud falls back to its parent's own expression", /\(v\.smoke_color \?\? \(v\.particle_random_3\)\)/.test(JSON.stringify(particles["cobblemon:greninja_cloud_fade"])));

// Cobblemon's frame: ember_actor's fire and sparks are started by the script, which passes them the frame and target
const { FX_FORWARD, MOVE_FX } = await mod("move_fx.js");
check("ember_actor's fire and sparks are started by the script after 0.05 s",
      JSON.stringify(FX_FORWARD["cobblemon:ember_actor"]?.map(([t, c]) => [t, c])) === JSON.stringify([[0.05, "cobblemon:ember_fire"], [0.05, "cobblemon:ember_firesparks"]]));
check("and ember_actor no longer starts them without the target", !JSON.stringify(particles["cobblemon:ember_actor"].particle_effect.components["minecraft:emitter_lifetime_events"] ?? {}).includes("fire"));
const stillThere = [];
for (const [parent, list] of Object.entries(FX_FORWARD)) {
    const life = JSON.stringify(particles[parent]?.particle_effect.components["minecraft:emitter_lifetime_events"] ?? {});
    for (const [, child] of list) {
        const names = Object.entries(particles[parent].particle_effect.events ?? {}).filter(([, ev]) => ev.particle_effect?.effect === child).map(([n]) => n);
        if (names.some((n) => life.includes(`"${n}"`))) stillThere.push(`${parent} -> ${child}`);
    }
}
check("no child the script starts is also started by its particle", stillThere.length === 0, stillThere.join("; "));

// the geometry, by evaluating the particle's own Molang: ParticleStorm's deltas in the frame the script passes put Ember's
// fire at the target when its emitter's life runs out, for a target off the world's axes
function molang(expr, vars) {
    const js = String(expr).replace(/(?<![\w.])(?:v|variable)\.(\w+)/g, "V.$1").replace(/math\./g, "M.");
    const deg = (d) => (d * Math.PI) / 180;
    const M = { clamp: (x, a, b) => Math.min(Math.max(x, a), b), random: (a, b) => (a + b) / 2, sin: (d) => Math.sin(deg(d)), cos: (d) => Math.cos(deg(d)),
                abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, min: Math.min, max: Math.max, pi: Math.PI };
    return new Function("V", "M", `return (${js});`)(vars, M);
}
{
    const at = { x: 6.5, y: 152, z: 51.5 }, to = { x: 10.5, y: 151.6, z: 55.5 };
    const frame = M.fxFrame({}, at, to), deltas = M.fxDeltas(frame, at, to);
    check("a target straight ahead is deltax 0 and deltaz its level distance", Math.abs(deltas.target_deltax) < 1e-9 && Math.abs(deltas.target_deltaz - Math.hypot(4, 4)) < 1e-9, JSON.stringify(deltas));
    const shape = particles["cobblemon:ember_fire"].particle_effect.components["minecraft:emitter_shape_sphere"];
    const V = { ...frame, ...deltas, emitter_age: 1, emitter_lifetime: 1, particle_random_1: 0.5, particle_random_2: 0.5 };
    const end = shape.offset.map((c) => molang(c, V)), want = [to.x - at.x, to.y - at.y, to.z - at.z];
    check("Ember's fire ends at the target", end.every((v, i) => Math.abs(v - want[i]) < 0.4), `${end.map((v) => v.toFixed(2))} want ${want.map((v) => v.toFixed(2))}`);
    // and with nothing passed (a particle the script fires unaimed, as before) its vectors read as they always did: north
    const none = shape.offset.map((c) => molang(c, { emitter_age: 1, emitter_lifetime: 1 }));
    check("with no frame passed the turn is none: the preview's 5 blocks north", Math.abs(none[0]) < 1e-9 && Math.abs(none[2] - (-0.25 + 0.25 - 5)) < 1e-9, none.map((v) => v.toFixed(2)).join(", "));
}

// the aimed particle itself still gets the deltas from the battle's effect event: Charmander's Ember at a Bulbasaur
{
    const user = mon("Charmander"), target = mon("Bulbasaur");
    target.entity.location = { x: 0, y: 0, z: 3 };
    const seen = [];
    const record = { spawnParticle: (id, at, vars) => seen.push({ id, vars: { ...vars.values } }), playSound() { } };
    user.entity.dimension = record; target.entity.dimension = record;
    flush();
    M.fxEvent(MOVE_FX.ember.e.find((e) => e.k === "p" && e.aim), user, target, { id: "ember", name: "Ember", type: "fire", category: "Special" }, { missed: false });
    flush();
    const actor = seen.find((s) => s.id === "cobblemon:ember_actor"), fire = seen.find((s) => s.id === "cobblemon:ember_fire");
    check("Ember's effect event spawns its actor with the frame and the target deltas", actor && typeof actor.vars["variable.target_deltaz"] === "number" && typeof actor.vars["variable.fx_fx"] === "number", JSON.stringify(seen));
    check("and then its fire with the same", fire && fire.vars["variable.target_deltaz"] === actor.vars["variable.target_deltaz"] && fire.vars["variable.fx_fz"] === actor.vars["variable.fx_fz"], JSON.stringify(seen));
}
