// ClientPlayerIcon: the exclamation icon over the head of a player who has a battle challenge or trade offer pending
// for you (BattleChallengeNotificationHandler, TradeOfferNotificationHandler), Y_OFFSET 1.5 up, SCALE 0.75 of a block,
// and once the request is in its last quarter (FADE_RATIO 0.25) fading out and back in by turns (fadeDuration 30
// ticks, between MAX_ALPHA 1 and MIN_ALPHA 0.15). Java draws it on the receiver's client alone; here it is the
// cobblemon:request_icon particle (port.py's create_request_icon_particle) the receiver alone is shown, every other
// tick (Player.spawnParticle), its alpha passed in as variable.alpha.
import { system, MolangVariableMap } from "@minecraft/server";

const ICON = "cobblemon:request_icon", Y_OFFSET = 1.5, FADE_RATIO = 0.25, FADE_TICKS = 30, MIN_ALPHA = 0.15, EVERY = 2;

// the icon's alpha at age ticks of a request lasting expiry ticks: full, then fading out and back in by turns
export function requestIconAlpha(age, expiry) {
    const fadeFrom = expiry * (1 - FADE_RATIO);
    if (age < fadeFrom) return 1;
    const t = ((age - fadeFrom) % (FADE_TICKS * 2)) / FADE_TICKS;   // 0 to 2: out, then back in
    const k = t <= 1 ? t : 2 - t;
    return 1 - (1 - MIN_ALPHA) * k;
}

// pending: () => [{ from: Entity, to: Player, at: tick, expiry: ticks }], read every other tick; an icon is shown to
// the receiver over the sender's head while both are about
export function registerRequestIcons(pending) {
    system.runInterval(() => {
        let list;
        try { list = pending(); } catch (e) { return; }
        for (const r of list) {
            if (!r.from?.isValid || !r.to?.isValid || typeof r.to.spawnParticle !== "function") continue;
            try {
                const vars = new MolangVariableMap();
                vars.setFloat("variable.alpha", requestIconAlpha(system.currentTick - r.at, r.expiry));
                const at = r.from.location;
                r.to.spawnParticle(ICON, { x: at.x, y: at.y + Y_OFFSET, z: at.z }, vars);
            } catch (e) { }
        }
    }, EVERY);
}
