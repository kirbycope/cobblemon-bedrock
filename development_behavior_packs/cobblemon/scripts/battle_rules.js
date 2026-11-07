// Rules around a battle, from Cobblemon's battles/ package, beside the engine in main.js: the experience and EVs paid when
// a battle ends (PokemonBattle.end), the Poke Ball refusals (EmptyPokeBallEntity.onHitEntity), the forced tie of a player
// who leaves (BattleRegistry.onPlayerDisconnect) and the spectator's read-only battle screen (BattleGUI with
// ClientBattle.spectating). main.js hands each function the engine pieces it needs in a ctx, so nothing here imports it.
import { system, world } from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";

// CobblemonConfig.awardExperienceOnBattleLoss (false): the experience for a knocked-out foe is paid only once its whole
// team is knocked out, so a forfeit, a loss, a flight or a player leaving pays none; the EVs are paid either way
export const AWARD_EXPERIENCE_ON_BATTLE_LOSS = false;
// CobblemonConfig.experienceShareMultiplier: the share of an Exp. Share holder that did not face the foe
export const EXPERIENCE_SHARE_MULTIPLIER = 0.5;

// a foe knocked out: whose it was (a view of the battle, or "foe" for a wild Pokemon or a trainer), whose party is paid
// (the view across from it, whose party findParty reads) and which of theirs faced it (BattlePokemon.facedOpponents: the
// pairs main.js keeps per Pokemon, so one that fought an earlier foe and sat this one out is not among them)
export function recordFaint(real, foe, loser, winners, facing = []) {
    (real.pendingExp ??= []).push({ foe, loser, winners, faced: new Set(facing) });
}
// the side whose Pokemon have all been knocked out (PokemonBattle.end's enemyTeamWiped)
export function teamWiped(real, loser) { (real.wipedSides ??= new Set()).add(loser); }

// PokemonBattle.end: for each foe knocked out, each of the other side's party Pokemon with HP left (a fainted one gets
// nothing, awardExperienceToFaintedPokemon false) gets its EVs (Generation8EvCalculator, a power item adding 8 to its stat)
// and its experience: in full having faced it, half holding an Exp. Share, else nothing. Each foe is paid on its own, in
// the order they fell (end goes by the loser's party order, the same for a team sent out in turn), at the level the
// earlier awards brought the Pokemon to (the loop over faintedPokemons in end), and only once the foe's team is wiped. A
// level rule's clones keep nothing (BattlePokemon.effectedPokemon is not the original). Returns what was paid, for the tests
export function payExperience(real, ctx) {
    const pending = real.pendingExp ?? [];
    real.pendingExp = [];
    if (!pending.length || real.adjustLevel > 0) return [];
    const paid = [];
    for (const view of new Set(pending.map((p) => p.winners))) {
        if (!view?.player?.isValid) continue;
        let party = [];
        try { party = ctx.partyOf(view); } catch (e) { continue; }
        for (const e of party) {
            if (!e?.isValid || ctx.prop(e, ctx.FAINTED)) continue;
            const live = ctx.allActives(real).find((f) => f?.entity?.id === e.id), f = live ?? ctx.fighter(e);
            if (!f || f.clone || f.hp <= 0) continue;
            const key = ctx.memberKey(e);
            let total = 0;
            for (const p of pending) {
                if (p.winners !== view) continue;
                const share = p.faced.has(key) ? 1 : ctx.held(f) === "exp_share" ? EXPERIENCE_SHARE_MULTIPLIER : 0;
                if (!share) continue;
                for (const [stat, n] of Object.entries(p.foe.info?.evYield ?? {})) ctx.addEvs(e, stat, n);
                const power = ctx.POWER_ITEMS[ctx.held(f)];
                if (power) ctx.addEvs(e, power, 8);
                if (!real.wipedSides?.has(p.loser) && !AWARD_EXPERIENCE_ON_BATTLE_LOSS) continue;
                const exp = ctx.battleExperience(view, f, p.foe, share);   // at the level the earlier foes' awards left it
                if (exp <= 0) continue;
                try { ctx.gainExperience(view, f, null, exp); } catch (err) { console.warn(`[cobblemon] experience not paid: ${err}`); }
                total += exp;
            }
            if (total > 0) paid.push({ entity: e, exp: total });
        }
    }
    return paid;
}

// EmptyPokeBallEntity.onHitEntity, in its order: why a thrown ball drops instead of trying, as the thrower is told (the
// lang's capture.not_wild, capture.not_your_turn, capture.busy, capture.not_single, capture.in_battle, you_in_battle), or
// null when the catch may go ahead. `mine` is the thrower's own battle, if any
export function captureRefusal(s) {
    if (!s.wild) return `That ${s.name} is not a wild Pokémon.`;
    if (s.mine?.foe) {
        if (s.mine.trainer) return `That ${s.name} is not a wild Pokémon.`;
        if (!s.asked && !s.mine.minimised) return "It's not your turn to act.";
        return s.capturing ? `The ${s.name} is busy!` : null;
    }
    if (s.inBattle && s.mine?.doubles) return "You can only capture wild Pokémon in a 1v1 battle.";
    if (s.inBattle) return `That ${s.name} is in a battle and cannot be caught by you.`;
    if (s.capturing) return `The ${s.name} is busy!`;
    if (s.mine && !s.asked) return "You can't do that while in a battle!";
    return null;
}

// BattleRegistry.onPlayerDisconnect: the battle of a player who leaves stops as Showdown's forcetie: no one wins and
// nothing is won or said of it, the other player's screen closes, and PokemonBattle.end with no winners does the rest (the
// wild Pokemon healed and freed, the trainer resting), so no foe is left frozen behind the leaver
export function forcedTie(view, leaverId, ctx) {
    const real = ctx.realBattle(view);
    real.tied = true;
    if (real.pvp) {
        const other = real.player?.id === leaverId ? real.opponent : real.player;
        if (other?.isValid) {
            try { uiManager.closeAllForms(other); } catch (e) { }
            try { other.sendMessage("§7The battle ended."); } catch (e) { }
        }
    }
    try { ctx.endBattle(real); } catch (e) { console.warn(`[cobblemon] a leaving player's battle did not end cleanly: ${e}`); }
}

// BattleGUI as a spectator (ClientBattle.spectating, BattleInitializeHandler): the battle screen as its player sees it,
// the tiles, health bars and message pane on the battle form, with Leave in place of the actions; drawn again as the
// battle moves (sayNow), and closed when it ends. ctx: battleBody, battleTitle, UI and the battles map
const spectating = new Map();   // spectator id -> { real, refreshing (its form is closing to be drawn again), pending }
export function startSpectating(real, viewer, ctx) {
    (real.spectators ??= new Set()).add(viewer.id);
    spectating.set(viewer.id, { real, refreshing: false, pending: false });
    system.run(() => spectatorScreen(real, viewer, ctx));
}
function spectatorScreen(real, viewer, ctx) {
    const rec = spectating.get(viewer.id);
    if (!rec || rec.real !== real || !viewer.isValid || !ctx.battles.has(real.player.id)) return;
    rec.refreshing = false;
    let form;
    try { form = new ActionFormData().title(ctx.battleTitle(real, "menu")).body(ctx.battleBody(real)).button("Leave", `${ctx.UI}/battle/menu_forfeit`); } catch (e) { return; }
    form.show(viewer).then(() => {
        const now = spectating.get(viewer.id);
        if (!now || now.real !== real || now.refreshing) return;   // closed to be drawn again, or by the battle's end
        stopSpectating(viewer.id, real, "§7You stopped spectating.");   // Leave, or the screen closed
    }).catch(() => { });
}
export function refreshSpectators(real, ctx) {
    for (const id of real.spectators ?? []) {
        const rec = spectating.get(id);
        if (!rec || rec.pending) continue;
        rec.pending = true;
        // half a second on, so a turn's lines come as one redraw
        system.runTimeout(() => {
            rec.pending = false;
            let viewer;
            try { viewer = world.getEntity(id); } catch (e) { }
            if (!viewer?.isValid) { stopSpectating(id, real); return; }
            if (!ctx.battles.has(real.player.id)) return;
            rec.refreshing = true;
            try { uiManager.closeAllForms(viewer); } catch (e) { }
            system.run(() => spectatorScreen(real, viewer, ctx));
        }, 10);
    }
}
function stopSpectating(id, real, text) {
    real.spectators?.delete(id);
    spectating.delete(id);
    if (text) try { world.getEntity(id)?.sendMessage(text); } catch (e) { }
}
export function endSpectating(real) {
    for (const id of [...(real.spectators ?? [])]) {
        const rec = spectating.get(id);
        if (rec) rec.refreshing = true;   // the screen closing is the battle's end, not the viewer leaving
        try { const viewer = world.getEntity(id); if (viewer?.isValid) { uiManager.closeAllForms(viewer); viewer.sendMessage("§7The battle ended."); } } catch (e) { }
        stopSpectating(id, real);
    }
}
export function spectatorCount() { return spectating.size; }
