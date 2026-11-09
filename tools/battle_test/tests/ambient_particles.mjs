// An ambient effect (Gastly's gas, Slugma's bubbles) is Cobblemon's pose particle: one emitter while the pose plays
// (PosableState.poseParticles). Here it is fired once a second with /particle from the behavior pack, so the resource
// pack must not fire it too: a controller state's particle drew a second copy on a local world, and the looping
// animation's time-0 keyframe started two endless emitters on every loop (issue #64, "too much purple particles")
import { check } from "../harness.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const pack = (path) => new URL(`../../../${path}`, import.meta.url);
const json = (path) => JSON.parse(readFileSync(pack(path), "utf-8"));
const served = json("development_behavior_packs/cobblemon/animation_controllers/ambient.animation_controllers.json").animation_controllers;
const species = [...new Set(Object.keys(served).map((k) => k.split(".")[2]))];
check("Gastly's gas is fired server side", species.includes("0092_gastly"), species.join());

for (const pokemon of species) {
    const effects = new Set(Object.entries(served).filter(([k]) => k.split(".")[2] === pokemon)
        .flatMap(([, c]) => c.states.a.on_entry.map((cmd) => cmd.match(/cobblemon:(\w+)_ambient/)[1])));
    const controllers = json(`development_resource_packs/cobblemon/animation_controllers/${pokemon}.animation_controllers.json`).animation_controllers;
    const inStates = Object.values(controllers).flatMap((c) => Object.values(c.states)).flatMap((s) => s.particle_effects ?? []).filter((e) => effects.has(e.effect));
    check(`${pokemon}: no controller state fires what the behavior pack fires`, inStates.length === 0, JSON.stringify(inStates));
    const folder = `development_resource_packs/cobblemon/animations/${pokemon}`;
    const looping = existsSync(pack(folder)) ? readdirSync(pack(folder)).filter((f) => f.endsWith(".animation.json"))
        .flatMap((f) => Object.entries(json(`${folder}/${f}`).animations)).filter(([, a]) => a.loop)
        .flatMap(([name, a]) => [a.particle_effects?.["0.0"] ?? []].flat().filter((e) => effects.has(e.effect)).map(() => name)) : [];
    check(`${pokemon}: no looping animation starts it again each loop`, looping.length === 0, looping.join());
}
