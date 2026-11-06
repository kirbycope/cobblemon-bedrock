// The ride behaviours past what main.js's ride tick carries on its own: the air behaviours (BirdBehaviour,
// HoverBehaviour, JetBehaviour, RocketBehaviour), the boat's jump (BoatBehaviour), the submarine rider's air
// (LivingEntityMixin), who may mount and who drives (PokemonEntity.isRideableFor, getControllingPassenger), the double
// jump that takes a flier off the ground (RidingController, LocalPlayerMixin) and the Party item's dismount
// (PartySendBinding, DismountPokemonPacketHandler). main.js hands over what it reads through setup(), as a thunk,
// since the names it needs are defined after the ride tick.
import { world } from "@minecraft/server";

let env = () => ({});
export function setup(thunk) { env = thunk; }

const velocity = (mount) => { try { return mount.getVelocity(); } catch (e) { return { x: 0, y: 0, z: 0 }; } };
// RidingBehaviour.scaleToRange: where x sits between min and max, 0 to 1
export function scaleToRange(x, min, max) { return max - min < 0.01 ? 0 : Math.max(0, Math.min(1, (x - min) / (max - min))); }

// The flight groups port.py's air_riding_groups writes a ridden flier, one on at a time: flying (no gravity, the free
// camera), on land (gravity and the ground controls), falling (the flight under gravity) and tired (gravity, no climb).
// The land and tired groups take the flying speed tiers away, so leaving them asks main.js for the tier again.
const FLIGHT = { air: "cobblemon:ride_flight", land: "cobblemon:ride_land", fall: "cobblemon:ride_fall", tired: "cobblemon:ride_tired" };
export function setFlight(st, mount, want) {
    if (st.flight === want) return false;
    const from = st.flight;
    st.flight = want;
    st.tired = want === "tired";
    if (from === "land" || from === "tired") st.tier = -1;
    try { mount.triggerEvent(FLIGHT[want]); } catch (e) { }
    return true;
}

// LocalPlayerMixin.cobblemon$updateDoubleJumping: a press of jump opens a 12 tick window, and a second press inside it
// is the double jump that takes a flier off the ground (RidingController.canTransitionToAir)
export const DOUBLE_JUMP_TICKS = 12;
export function doubleJumped(st, jumping) {
    const pressed = jumping && !st.jumpLast;
    st.jumpLast = jumping;
    let doubled = false;
    if (pressed) {
        if (st.jumpWindow > 0) { doubled = true; st.jumpWindow = 0; } else st.jumpWindow = DOUBLE_JUMP_TICKS;
    } else if (st.jumpWindow > 0) st.jumpWindow--;
    return doubled;
}

// the double tap of forward that stands in for the sprint key a Bedrock rider never passes on (main.js's RIDE_TAP_TICKS)
function doubleTapped(st, forward, window) {
    let tapped = false;
    if (!st.forwardLast && forward && st.timer === 0) st.timer = window;
    else if (!st.forwardLast && forward && st.timer !== 0) { tapped = true; st.timer = 0; }
    else if (st.timer > 0) st.timer--;
    st.forwardLast = forward;
    return tapped;
}

// One tick of a ridden flier, by its air behaviour: ctx carries the ride's state (st), the mount, the rider's input,
// the stamina drain a tick (1 / Stamina / 20), expr(stat) for the behaviour's ride_settings expressions and the flying
// speed tiers (port.py's FLY_TIERS), which the flight and fall groups fly at
export function tickAir(ctx) {
    const { st, mount, kind } = ctx;
    const top = ctx.expr("speed"), accel = top / (ctx.expr("acceleration") * 20);
    const forward = ctx.input.y > 0.1, back = ctx.input.y < -0.1, strafe = Math.abs(ctx.input.x) > 0.1;
    if (kind === "hover") tickHover(ctx, top, accel, forward, back, strafe);
    else if (kind === "jet") tickJet(ctx, top, accel, forward, back);
    else if (kind === "rocket") tickRocket(ctx, top, forward, back);
    else tickBird(ctx, top, accel, forward, back, strafe);
    if (st.flight === "air" || st.flight === "fall") {
        const want = Math.max(st.speed, 0.05);
        const tier = ctx.tiers.reduce((best, t, n) => (Math.abs(t - want) < Math.abs(ctx.tiers[best] - want) ? n : best), 0);
        if (tier !== st.tier) { st.tier = tier; try { mount.triggerEvent(`cobblemon:fly_${tier}`); } catch (e) { } }
    }
}

// BirdBehaviour: flying spends stamina over its Stamina's seconds, more the steeper the climb (stamDrainHorzMod, 1.5
// straight up or still, by the climb angle), half hovering, and a quarter gliding (no input at speed, GLIDE_ENTRY_SPEED 0.19,
// GLIDE_EXIT_SPEED 0.13), less the steeper the dive (stamDrainPerRateDive 0.25). Forward speeds it up to its Speed in
// its Acceleration's time, a dive adds 0.0332 a tick times the sine of the pitch up to the glide's top, its Speed
// times its Jump multiple (glideSpeedExpr), a climb with no input bleeds speed the same way, and the air takes 0.0015 a
// tick. With no stamina forward does nothing and the depletion force takes it down (the tired group) until it lands.
function tickBird(ctx, top, accel, forward, back, strafe) {
    const { st, mount } = ctx;
    const v = velocity(mount), horz = Math.hypot(v.x, v.z), total = Math.hypot(horz, v.y);
    const pitch = total > 1e-6 ? -v.y / total : 0;   // the sine of the pitch, nose down positive
    const horzMod = horz < 1e-6 ? 1.5 : Math.max(1 + 0.5 * Math.atan(v.y / horz), 1);
    const input = forward || back || strafe || ctx.jumping;
    const powered = input && st.stamina > 0;
    st.gliding = !powered && st.speed >= (st.gliding ? 0.13 : 0.19);
    const diveMod = (1 - Math.max(0, Math.min(1, pitch))) * 0.75 + 0.25;
    const rate = ctx.drain * horzMod;
    st.stamina = Math.max(0, st.stamina - (input ? rate : st.gliding ? rate * 0.25 * diveMod : rate * 0.5));
    const glideTop = top * ctx.expr("jump");
    if (forward && st.stamina > 0 && st.speed <= top) st.speed = Math.min(top, st.speed + accel);
    else if (back && st.stamina > 0) st.speed = Math.max(0, st.speed - accel);
    const glide = pitch * 0.25;
    if (glide > 0) st.speed = Math.min(st.speed + 0.0332 * glide, Math.max(glideTop, Math.min(st.speed, top)));
    else if (!forward && glide < 0) st.speed -= st.speed * Math.min(1, -glide * 0.0332);
    st.speed = Math.max(0, st.speed - Math.min(0.0015, st.speed));
    if (st.stamina <= 0) setFlight(st, mount, "tired");
    else if (st.flight === "tired" && mount.isOnGround) setFlight(st, mount, "air");
}

// HoverBehaviour: it may fly as high over the ground as its Jump stat allows (jumpExpr, 2 to 32 blocks, a ray straight
// down that fluids do not stop); higher than that its stamina drains over its Stamina's seconds, and under it comes
// back over stamReplenishTimeSeconds, 2. With none left it is pushed down (the tired group) until it has some again.
// It moves in any direction up to its Speed in its Acceleration's time, sideways at half the push (strafeDebuff 0.5),
// and coasts off 2 percent a tick (frictionConst 0.02).
function tickHover(ctx, top, accel, forward, back, strafe) {
    const { st, mount } = ctx;
    const limit = ctx.expr("jump");
    let tooHigh = false;
    try { tooHigh = !mount.dimension.getBlockFromRay(mount.location, { x: 0, y: -1, z: 0 }, { maxDistance: limit, includeLiquidBlocks: false, includePassableBlocks: false }); } catch (e) { }
    st.tooHigh = tooHigh;
    st.stamina = tooHigh ? Math.max(0, st.stamina - ctx.drain) : Math.min(1, st.stamina + 1 / (2 * 20));
    if (forward || back || strafe || ctx.jumping) st.speed = Math.min(top, st.speed + accel * (!forward && !back && strafe ? 0.5 : 1));
    else st.speed = Math.max(0, st.speed - st.speed * 0.02);
    if (st.stamina <= 0) setFlight(st, mount, "tired");
    else if (st.flight === "tired") setFlight(st, mount, "air");
}

// JetBehaviour: once flying it never slows under minSpeedFactor, half its Speed, speeding up to it on its own and on
// to its Speed while forward is held; back slows it deccelRate, 0.005 a tick, down to the half, and over its Speed it
// loses 2 percent a tick. The sprint key (here the double tap of forward, while forward stays held) boosts it to its
// Jump multiple (jumpExpr) of its Speed and of its push, spending stamina half again as fast. Flying spends stamina
// over its Stamina's seconds all the while, and with none left it is pushed down, up to 0.3 blocks a tick (6 a second)
// after maxDownwardForceSeconds, 7, and slowed to the half. The free camera moves nothing without input, so the half
// speed holds only while the rider flies, and its halved handling stays with the engine's steering.
function tickJet(ctx, top, accel, forward, back) {
    const { st, mount } = ctx;
    const minSpeed = top * 0.5, mult = ctx.expr("jump");
    const tapped = doubleTapped(st, forward, ctx.tap);
    if (st.stamina <= 0 || !forward) st.boosting = false;
    else if (tapped) st.boosting = true;
    st.stamina = Math.max(0, st.stamina - ctx.drain * (st.boosting ? 1.5 : 1));
    if (st.stamina <= 0) {
        st.noStam = (st.noStam ?? 0) + 1;
        const ramp = Math.min(1, st.noStam / (7 * 20));
        st.speed = Math.max(st.speed - 0.005 * ramp, minSpeed);
        // the depletion force, set rather than added so it does not pile up tick on tick
        const v = velocity(mount), want = -0.3 * ramp;
        if (v.y > want) try { mount.applyImpulse({ x: 0, y: want - v.y, z: 0 }); } catch (e) { }
    } else {
        st.noStam = 0;
        if (st.boosting && st.speed < top * mult) st.speed = Math.min(st.speed + accel * mult, top * mult);
        else if (st.speed < minSpeed || (forward && st.speed < top)) st.speed = Math.min(st.speed + accel * Math.max(1 - scaleToRange(st.speed, minSpeed, top), 0), top);
        else if (back && st.speed > minSpeed) st.speed = Math.max(st.speed - 0.005, minSpeed);
        else if (st.speed > top) st.speed *= 0.98;
    }
}

// RocketBehaviour: it falls (the fall group, gravity) unless jump is held, which lifts it (jumpExpr, three times as
// hard while it falls, up to that stat's speed); forward and back push it accelerationExpr a tick up to its Speed, and
// the sprint key while forward is held (here the double tap of forward) boosts it to boostSpeedMod, 5, times its Speed
// at boostSpeedMod / 1.5 the push, with a burst of 0.5 blocks a tick that costs 5 percent stamina. Stamina drains over
// its Stamina's seconds only while it lifts or boosts, and with none left jump drops it instead. The engine lifts at
// its one rate, and the flying speed tiers top out at 1.2 blocks a tick.
function tickRocket(ctx, top, forward, back) {
    const { st, mount } = ctx;
    const accel = ctx.expr("lift");
    const tapped = doubleTapped(st, forward, ctx.tap);
    if (st.stamina <= 0 || !forward) { st.boosting = false; st.burst = true; }
    else if (tapped) st.boosting = !st.boosting;
    if (st.boosting) {
        if (st.burst) {
            st.burst = false;
            st.stamina = Math.max(0, st.stamina - 0.05);
            st.speed += 0.5;
            try { const d = mount.getViewDirection(); mount.applyImpulse({ x: d.x * 0.5, y: 0, z: d.z * 0.5 }); } catch (e) { }
        }
        if (st.speed < top * 5) st.speed = Math.min(top * 5, st.speed + accel * (5 / 1.5));
    } else if (forward && st.speed < top) st.speed = Math.min(top, st.speed + accel);
    else if (back) st.speed = Math.max(0, st.speed - accel);
    if (st.boosting || ctx.jumping) st.stamina = Math.max(0, st.stamina - ctx.drain);
    setFlight(st, mount, st.boosting || (ctx.jumping && st.stamina > 0) ? "air" : "fall");
}

// BoatBehaviour.applyJump: a press of jump in the water adds jumpStrengthExpr (the Jump stat, 0.8 to 1.6 blocks a
// tick) upward, scaled to Bedrock's gravity against the boat's 0.098 a tick, and jumpBuffer holds the next one until
// five ticks have passed and the mount is back in the water or on the ground
export const BOAT_JUMP = Math.sqrt(0.08 / 0.098);
export function boatJump(st, mount, jumping, strength) {
    if (st.jumpBuffer === undefined) st.jumpBuffer = -1;
    if (st.jumpBuffer > 5) { if (mount.isInWater || mount.isOnGround) st.jumpBuffer = -1; }
    else if (st.jumpBuffer > -1) st.jumpBuffer++;
    if (!jumping || st.jumpBuffer !== -1 || !mount.isInWater) return false;
    st.jumpBuffer = 0;
    try { mount.applyImpulse({ x: 0, y: strength * BOAT_JUMP, z: 0 }); } catch (e) { }
    return true;
}

// LivingEntityMixin.cobblemon$conditionalWaterBreathing: a submarine's rider loses no air while the ride has stamina
export function breathe(st, player) {
    if (st.stamina <= 0) return false;
    st.breathTick = (st.breathTick ?? 0) + 1;
    if (st.breathTick % 20 !== 1) return false;
    try { player.addEffect("water_breathing", 30, { amplifier: 0, showParticles: false }); } catch (e) { }
    return true;
}

// what a mount backs up at, as a share of its top speed: HorseBehaviour a third, BoatBehaviour and DolphinBehaviour
// (reverseDriveFactor) a quarter; SubmarineBehaviour backs up at its strafe speed (jumpExpr) instead
export const REVERSE = { horse: 1 / 3, boat: 0.25, dolphin: 0.25 };

// PokemonEntity.isRideableFor: the owner alone mounts an empty Pokemon, anyone may climb on once the owner is aboard,
// and no one while the owner is in battle, the Pokemon is pastured (tethering), on its battle raft (platform), on its
// way into its ball (beamMode 3) or smaller than minimumRidingScale, 0.75, of its scale. The reason it is refused, or
// null.
export const MIN_RIDING_SCALE = 0.75;
export function ridersOf(mount) { try { return mount.getComponent("minecraft:rideable")?.getRiders() ?? []; } catch (e) { return []; } }
export function refusal(player, target) {
    const d = env();
    const owner = d.prop(target, d.OWNER);
    if (owner !== player.id && !ridersOf(target).some((r) => r.id === owner)) return "owner";
    if (d.battles.has(owner)) return "battle";
    if (d.prop(target, d.PASTURE_AT) !== undefined) return "pastured";
    if (d.rafts.has(target.id)) return "raft";
    if (d.recalling.has(target.id)) return "recall";
    if ((d.RIDES[target.typeId]?.[0]?.[3]?.scale ?? 1) * d.scaleOf(target) < MIN_RIDING_SCALE) return "scale";
    return null;
}
export function canMount(player, target) { return !refusal(player, target); }
// getControllingPassenger: the owner drives whatever seat they took (SelectDriverEvent), or nobody does
export function ownerDrives(mount, driver) { const d = env(); return d.prop(mount, d.OWNER) === driver.id; }
export function ejectAll(mount) { try { const r = mount.getComponent("minecraft:rideable"); for (const e of r?.getRiders() ?? []) r.ejectRider(e); } catch (e) { } }
export function mountOf(player) { try { const m = player.getComponent("minecraft:riding")?.entityRidingOn; return m?.isValid ? m : undefined; } catch (e) { return undefined; } }
// a right-click that would mount (the engine's own, empty handed or with a vanilla item; a Cobblemon item is its own
// handler's business, and sneaking skips the mount) is refused as isRideableFor refuses it
export function onInteract(event) {
    const { player, target, itemStack } = event;
    const d = env();
    if (!d.RIDES?.[target?.typeId] || player.isSneaking) return false;
    if (itemStack?.typeId?.startsWith("cobblemon:")) return false;
    if (!refusal(player, target)) return false;
    event.cancel = true;
    return true;
}
world.beforeEvents.playerInteractWithEntity.subscribe(onInteract);

// PartySendBinding.canAttemptDismount and DismountPokemonPacketHandler: the send-out key gets a passenger off at once,
// and the driver off the selected Pokemon, every rider with them, leaving the Pokemon out where it is; a driver in the
// air on a flier that also walks stays on (enableInFlightDismounting is off by default). True when the key was spent.
export function partyDismount(player, slot) {
    const d = env(), mount = mountOf(player);
    if (!mount || !d.RIDES[mount.typeId]) return false;
    if (ridersOf(mount)[0]?.id !== player.id) { try { mount.getComponent("minecraft:rideable").ejectRider(player); } catch (e) { } return true; }
    if (slot?.out !== mount.id) return false;
    const st = d.rideStates.get(mount.id);
    if (st?.style === "air" && d.RIDES[mount.typeId].some(([s]) => s === "land")) return true;
    ejectAll(mount);
    return true;
}
