// Riding (scripts/riding.js and main.js's ride tick helpers): the air behaviours, the boat's jump, the submarine
// rider's air, who may mount and drive, the double jump, the Party item's dismount, the style changes and the hints
import { M, check } from "../harness.mjs";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// riding.js imports @minecraft/server, so like main.js it is loaded from a copy in a folder marked as ES modules
const copy = mkdtempSync(join(tmpdir(), "cobblemon-riding-"));
cpSync(fileURLToPath(new URL("../../../development_behavior_packs/cobblemon/scripts/riding.js", import.meta.url)), join(copy, "riding.js"));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const R = await import(pathToFileURL(join(copy, "riding.js")).href);

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const TIERS = Array.from({ length: 16 }, (_, n) => 0.05 * Math.pow(1.2 / 0.05, n / 15));
function mount(opts = {}) {
    const m = {
        id: opts.id ?? "mount", typeId: opts.typeId ?? "cobblemon:p0006_charizard", isValid: true, isOnGround: opts.onGround ?? false, isInWater: opts.inWater ?? false,
        location: { x: 0, y: 70, z: 0 }, vel: opts.vel ?? { x: 0, y: 0, z: 0 }, events: [], impulses: [], ejected: 0, riders: opts.riders ?? [], props: opts.props ?? {},
        getVelocity() { return this.vel; }, triggerEvent(e) { this.events.push(e); }, applyImpulse(v) { this.impulses.push(v); },
        getViewDirection() { return { x: 0, y: 0, z: 1 }; }, getHeadLocation() { return { x: 0, y: 71, z: 0 }; },
        dimension: { getBlockFromRay: () => (opts.ground === false ? undefined : { block: {} }), getBlock: () => ({ typeId: opts.headBlock ?? "minecraft:air" }) },
        getComponent(name) {
            if (name === "minecraft:rideable") return { getRiders: () => m.riders, ejectRider: (e) => { m.riders = m.riders.filter((r) => r.id !== e.id); m.ejected++; } };
            return undefined;
        },
    };
    return m;
}
const settings = { speed: 1.0, acceleration: 2.0, stamina: 20.0, jump: 2.0, lift: 0.01, leap: 1.0 };
const st0 = (extra = {}) => ({ stamina: 1, speed: 0, tier: -1, timer: 0, forwardLast: false, flight: "air", jumpWindow: 0, jumpLast: false, ...extra });
const ctx = (kind, st, m, input = {}, over = {}) => ({ st, mount: m, player: {}, kind, input: { x: 0, y: 0, ...input }, jumping: false, drain: 1 / 20 / 20, expr: (stat) => settings[stat], tiers: TIERS, tap: 12, ...over });

// HoverBehaviour: stamina only above the height limit, back in two seconds under it, pushed down at none
{
    const high = mount({ ground: false }), st = st0();
    R.tickAir(ctx("hover", st, high));
    check("hover above its height drains stamina", close(st.stamina, 1 - 1 / 400), `${st.stamina}`);
    const low = mount({ ground: true }), s2 = st0({ stamina: 0.5 });
    R.tickAir(ctx("hover", s2, low));
    check("hover under its height refills a fortieth a tick", close(s2.stamina, 0.5 + 1 / 40), `${s2.stamina}`);
    const s3 = st0({ stamina: 1 / 800 });
    R.tickAir(ctx("hover", s3, high));
    check("hover with no stamina is pushed down", s3.stamina === 0 && high.events.includes("cobblemon:ride_tired") && s3.flight === "tired");
    R.tickAir(ctx("hover", s3, low));
    check("hover under its height flies again", s3.flight === "air" && low.events.includes("cobblemon:ride_flight"));
    const s4 = st0(), s5 = st0();
    R.tickAir(ctx("hover", s4, low, { y: 1 })); R.tickAir(ctx("hover", s5, low, { x: 1 }));
    check("hover strafes at half the push", close(s5.speed, s4.speed / 2) && s4.speed > 0, `${s4.speed} ${s5.speed}`);
}
// JetBehaviour: never under half speed, boost at the Jump multiple draining 1.5x, pushed down at none over 7 seconds
{
    const m = mount(), st = st0(), slow = { drain: 1 / 4000 };   // a 200 second Stamina, so the flight outlasts the checks
    const jet = (input = {}) => R.tickAir(ctx("jet", st, m, input, slow));
    for (let n = 0; n < 100; n++) jet();
    check("jet speeds up to half its Speed on its own", st.speed >= 0.5 - 1e-6 && st.speed <= 0.5 + 0.03, `${st.speed}`);
    const before = st.stamina;
    jet();
    check("jet spends stamina the whole flight", close(before - st.stamina, 1 / 4000), `${before - st.stamina}`);
    for (let n = 0; n < 200; n++) jet({ y: 1 });
    check("jet reaches its Speed with forward held", st.speed > 0.95 && st.speed <= 1.0, `${st.speed}`);
    for (let n = 0; n < 30; n++) jet({ y: -1 });
    check("jet slows 0.005 a tick on back input", close(st.speed, Math.max(0.5, 1.0 - 30 * 0.005), 0.05), `${st.speed}`);
    // the double tap: forward, released, forward again inside 12 ticks, then held
    jet({ y: 1 }); jet(); jet({ y: 1 });
    const s1 = st.stamina;
    jet({ y: 1 });
    check("jet boost drains stamina half again as fast", st.boosting && close(s1 - st.stamina, 1.5 / 4000), `${st.boosting} ${s1 - st.stamina}`);
    for (let n = 0; n < 400; n++) jet({ y: 1 });
    // at the cap Cobblemon's branch order lets the over-Speed decay (0.98) take a bite the boost's push puts back, so it sits between 98 and 100 percent of the cap
    check("jet boost tops out at its Jump multiple of its Speed", st.speed >= 2.0 * 0.98 - 1e-9 && st.speed <= 2.0 + 1e-9, `${st.speed}`);
    const tired = st0({ stamina: 0, speed: 1.0 }), m2 = mount();
    for (let n = 0; n < 140; n++) R.tickAir(ctx("jet", tired, m2));
    const last = m2.impulses[m2.impulses.length - 1];
    check("jet with no stamina is pushed down to 0.3 a tick after seven seconds", close(last.y, -0.3, 1e-6) && tired.speed < 1.0 && tired.speed > 0.5, `${last?.y} ${tired.speed}`);
    for (let n = 0; n < 60; n++) R.tickAir(ctx("jet", tired, m2));
    check("and slowed to the half", close(tired.speed, 0.5, 1e-6), `${tired.speed}`);
    check("jet with no stamina keeps flying rather than tiring", !m2.events.includes("cobblemon:ride_tired"));
}
// RocketBehaviour: falls unless jump is held, drains only lifting or boosting, boosts 5x with a burst costing 5 percent
{
    const m = mount(), st = st0();
    R.tickAir(ctx("rocket", st, m));
    check("rocket falls without jump", st.flight === "fall" && m.events.includes("cobblemon:ride_fall") && st.stamina === 1);
    R.tickAir(ctx("rocket", st, m, {}, { jumping: true }));
    check("rocket lifts while jump is held, spending stamina", st.flight === "air" && m.events.includes("cobblemon:ride_flight") && close(st.stamina, 1 - 1 / 400));
    for (let n = 0; n < 50; n++) R.tickAir(ctx("rocket", st, m, { y: 1 }));
    check("rocket pushes forward its Acceleration a tick up to its Speed", close(st.speed, Math.min(1.0, 50 * 0.01), 1e-6), `${st.speed}`);
    // the double tap: released, forward, released, forward again inside 12 ticks
    R.tickAir(ctx("rocket", st, m)); R.tickAir(ctx("rocket", st, m, { y: 1 })); R.tickAir(ctx("rocket", st, m));
    const s1 = st.stamina, speed1 = st.speed;
    R.tickAir(ctx("rocket", st, m, { y: 1 }));
    const burst = m.impulses.find((i) => close(i.z, 0.5));
    check("rocket boost bursts half a block a tick for 5 percent stamina", st.boosting && !!burst && close(s1 - st.stamina, 0.05 + 1 / 400) && st.speed > speed1 + 0.5, `${st.boosting} ${s1 - st.stamina}`);
    for (let n = 0; n < 150; n++) R.tickAir(ctx("rocket", st, m, { y: 1 }));
    check("rocket boost tops out at five times its Speed, flying", close(st.speed, 5.0, 1e-6) && st.flight === "air", `${st.speed} ${st.flight}`);
    const dry = st0({ stamina: 0 }), m2 = mount();
    R.tickAir(ctx("rocket", dry, m2, {}, { jumping: true }));
    check("rocket with no stamina drops on jump", dry.flight === "fall");
}
// BirdBehaviour: the climb drains half again as fast, the dive adds speed to the Jump multiple, none left tires it
{
    const up = mount({ vel: { x: 0, y: 0.5, z: 0 } }), st = st0();
    R.tickAir(ctx("bird", st, up, { y: 1 }));
    check("bird climbing straight up drains 1.5x", close(1 - st.stamina, 1.5 / 400), `${1 - st.stamina}`);
    const level = mount({ vel: { x: 0, y: 0, z: 0.5 } }), s2 = st0();
    R.tickAir(ctx("bird", s2, level, { y: 1 }));
    check("bird flying level drains 1x", close(1 - s2.stamina, 1 / 400), `${1 - s2.stamina}`);
    const hover = mount(), s3 = st0();
    R.tickAir(ctx("bird", s3, hover));
    check("bird hovering still drains half, at the straight-up rate (stamDrainHorzMod with no horizontal speed)", close(1 - s3.stamina, 0.5 * 1.5 / 400), `${1 - s3.stamina}`);
    const dive = mount({ vel: { x: 0, y: -0.5, z: 0.5 } }), s4 = st0({ speed: 1.0 });
    for (let n = 0; n < 400; n++) R.tickAir(ctx("bird", s4, dive));
    check("bird diving with no input speeds up to its Jump multiple of its Speed", s4.speed > 1.5 && s4.speed <= 2.0, `${s4.speed}`);
    const s5 = st0({ speed: 0.5 });
    R.tickAir(ctx("bird", s5, dive));
    check("bird gliding (no input at speed) drains a quarter, less the steeper the dive", s5.gliding && 1 - s5.stamina < 0.25 / 400 && 1 - s5.stamina > 0, `${1 - s5.stamina}`);
    const s6 = st0({ stamina: 0 });
    R.tickAir(ctx("bird", s6, hover, { y: 1 }));
    check("bird with no stamina tires and does not speed up", s6.flight === "tired" && hover.events.includes("cobblemon:ride_tired") && s6.speed === 0);
}
// the flying speed tiers follow the speed in flight and in the fall group, not on land
{
    const m = mount(), st = st0({ speed: 0.5, flight: "fall" });
    R.tickAir(ctx("rocket", st, m, {}, { jumping: true }));
    check("the tier follows the speed", m.events.some((e) => e.startsWith("cobblemon:fly_")) && st.tier >= 0);
    const s2 = st0({ flight: "land" }), m2 = mount();
    R.setFlight(s2, m2, "air");
    check("leaving the land group asks for the tier again", s2.tier === -1 && m2.events[0] === "cobblemon:ride_flight");
    check("setFlight is a no-op when nothing changes", !R.setFlight(s2, m2, "air") && m2.events.length === 1);
}
// LocalPlayerMixin's double jump: a second press within 12 ticks
{
    const st = { jumpWindow: 0, jumpLast: false };
    const seq = (presses) => presses.map((j) => R.doubleJumped(st, j));
    const quick = seq([true, false, true]);
    check("a second jump inside the window is a double jump", quick[0] === false && quick[2] === true);
    const slow = seq([true, false, ...Array(12).fill(false), true]);
    check("a second jump after the window is a first jump again", !slow.includes(true));
    const held = seq([true, true, true, true]);
    check("holding jump is one press", !held.includes(true));
}
// BoatBehaviour.applyJump and its buffer
{
    const m = mount({ inWater: true }), st = {};
    check("a boat jumps out of the water at its Jump strength", R.boatJump(st, m, true, 1.2) && close(m.impulses[0].y, 1.2 * Math.sqrt(0.08 / 0.098)));
    check("the buffer holds the next jump", !R.boatJump(st, m, true, 1.2) && st.jumpBuffer === 1);
    for (let n = 0; n < 6; n++) R.boatJump(st, m, false, 1.2);
    check("after five ticks back in the water it may jump again", R.boatJump(st, m, true, 1.2) && m.impulses.length === 2);
    check("no jump on land", !R.boatJump({}, mount({ inWater: false }), true, 1.2));
}
// LivingEntityMixin: the submarine's rider breathes while it has stamina
{
    const effects = [], player = { addEffect: (e, d, o) => effects.push([e, d, o]) };
    const st = { stamina: 0.5 };
    for (let n = 0; n < 40; n++) R.breathe(st, player);
    check("the rider gets water breathing once a second while the ride has stamina", effects.length === 2 && effects[0][0] === "water_breathing");
    check("none without stamina", !R.breathe({ stamina: 0 }, player) && effects.length === 2);
}
// PokemonEntity.isRideableFor and getControllingPassenger
{
    const deps = { prop: (e, k) => e.props?.[k], OWNER: "cobblemon:owner", PASTURE_AT: "cobblemon:pasture", PARTY_ITEM: "cobblemon:party",
                   RIDES: { "cobblemon:p0006_charizard": [["air", 0, {}, { walk: 0.147 }], ["land", 4, {}, { walk: 0.147 }]], "cobblemon:p0047_parasect": [["land", 4, {}, { scale: 0.7 }]] },
                   battles: new Map(), recalling: new Set(), rafts: new Map(), scaleOf: (e) => e.scale ?? 1, rideStates: new Map() };
    R.setup(() => deps);
    const owner = { id: "owner" }, friend = { id: "friend" };
    const m = mount({ props: { "cobblemon:owner": "owner" } });
    check("a stranger may not mount an empty Pokemon", R.refusal(friend, m) === "owner" && R.refusal(owner, m) === null);
    m.riders = [owner];
    check("a stranger may climb on behind the owner", R.refusal(friend, m) === null);
    deps.battles.set("owner", {});
    check("no ride while the owner is in battle", R.refusal(owner, m) === "battle");
    deps.battles.clear();
    check("no ride on a pastured Pokemon", R.refusal(owner, mount({ props: { "cobblemon:owner": "owner", "cobblemon:pasture": "k" } })) === "pastured");
    deps.rafts.set("mount", {});
    check("no ride on its battle raft", R.refusal(owner, m) === "raft");
    deps.rafts.clear(); deps.recalling.add("mount");
    check("no ride mid-recall", R.refusal(owner, m) === "recall");
    deps.recalling.clear();
    const small = mount({ typeId: "cobblemon:p0047_parasect", props: { "cobblemon:owner": "owner" } }); small.scale = 1.0;
    check("no ride under 0.75 effective scale", R.refusal(owner, small) === "scale" && R.refusal(owner, Object.assign(mount({ typeId: "cobblemon:p0047_parasect", props: { "cobblemon:owner": "owner" } }), { scale: 1.1 })) === null);
    const ev = { player: friend, target: mount({ props: { "cobblemon:owner": "owner" } }), itemStack: undefined, cancel: false };
    check("a stranger's right-click is refused", R.onInteract(ev) && ev.cancel);
    const ev2 = { player: { id: "friend", isSneaking: true }, target: ev.target, cancel: false };
    check("sneaking skips the mount, so it is left alone", !R.onInteract(ev2) && !ev2.cancel);
    const ev3 = { player: owner, target: ev.target, itemStack: { typeId: "cobblemon:oran_berry" }, cancel: false };
    check("a Cobblemon item in hand is its own handler's business", !R.onInteract(ev3) && !ev3.cancel);
    check("the owner drives, a stranger does not", R.ownerDrives(m, owner) && !R.ownerDrives(m, friend));
    const full = mount({ props: { "cobblemon:owner": "owner" }, riders: [friend, owner] });
    R.ejectAll(full);
    check("ejectAll throws every rider off", full.riders.length === 0 && full.ejected === 2);
    // PartySendBinding: the Party item's dismount
    const ride = mount({ props: { "cobblemon:owner": "owner" }, riders: [owner, friend] });
    const rider = (who, on) => ({ id: who.id, getComponent: (n) => (n === "minecraft:riding" ? { entityRidingOn: on } : undefined) });
    check("a passenger gets off at once", R.partyDismount(rider(friend, ride), { out: "other" }) && ride.riders.length === 1 && ride.riders[0] === owner);
    check("the driver stays on when another Pokemon is selected", !R.partyDismount(rider(owner, ride), { out: "other" }) && ride.riders.length === 1);
    deps.rideStates.set("mount", { style: "air" });
    check("the driver stays on mid-air on a flier that also walks", R.partyDismount(rider(owner, ride), { out: "mount" }) && ride.riders.length === 1);
    deps.rideStates.set("mount", { style: "land" });
    check("the driver gets off the selected Pokemon on the ground, leaving it out", R.partyDismount(rider(owner, ride), { out: "mount" }) && ride.riders.length === 0);
    check("not riding, the key is not spent", !R.partyDismount({ id: "owner", getComponent: () => undefined }, { out: "mount" }));
    check("the reverse shares are Cobblemon's", close(R.REVERSE.horse, 1 / 3) && R.REVERSE.boat === 0.25 && R.REVERSE.dolphin === 0.25 && R.MIN_RIDING_SCALE === 0.75);
}
// RidingController.checkForNewTransition in main.js's rideStyle
{
    const ride = [["air", 0, {}, {}], ["land", 4, {}, {}], ["liquid", 7, {}, {}]];
    const grounded = mount({ onGround: true }), st = { airborne: false, styleLock: 0 };
    check("a flier on the ground rides by its land behaviour", M.rideStyle(ride, grounded, st) === "land");
    const flying = mount({ onGround: false, inWater: true, headBlock: "minecraft:air" }), air = { airborne: true, styleLock: 0, style: "air" };
    check("a flier skimming the water stays in the air until its eyes go under", M.rideStyle(ride, flying, air) === "air");
    const under = mount({ onGround: false, inWater: true, headBlock: "minecraft:water" });
    check("eyes under, it swims", M.rideStyle(ride, under, air) === "liquid");
    const swimming = mount({ onGround: false, inWater: true }), land = { airborne: false, styleLock: 0, style: "land" };
    check("a walker touching water swims at once", M.rideStyle(ride, swimming, land) === "liquid");
    const landing = mount({ onGround: true }), locked = { airborne: true, styleLock: 1000, style: "air" };
    check("the style holds for ten ticks after a change", M.rideStyle(ride, landing, locked) === "air" && locked.airborne);
    const free = { airborne: true, styleLock: 0, style: "air" };
    check("on the ground again, a flier lands", M.rideStyle(ride, landing, free) === "land" && !free.airborne);
    check("a hover with no land behaviour always flies", M.rideStyle([["air", 1, {}, {}]], grounded, { airborne: false, styleLock: 0 }) === "air");
    const walker = [["land", 4, {}, {}]];
    check("a plain walker walks", M.rideStyle(walker, mount({ onGround: false }), { airborne: true, styleLock: 0 }) === "land");
}
// RideControlsOverlay's hints name the new controls
{
    const jump = String.fromCharCode(0xE804);
    check("the boat's hint carries the jump", M.rideHintText("liquid", "boat", {}).includes(`${jump} §7jump`));
    check("a flier's land hint carries the take-off", M.rideHintText("land", "horse", {}, true).includes(`${jump}${jump} §7take off`) && !M.rideHintText("land", "horse", {}, false).includes("take off"));
    check("the hover, jet and rocket have their own hints", M.rideHintText("air", "hover", {}).includes("stay low") && M.rideHintText("air", "jet", {}).includes("boost") && M.rideHintText("air", "rocket", {}).includes("lift"));
}
