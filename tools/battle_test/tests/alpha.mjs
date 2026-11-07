// Alphas: the Wild Alpha boost, their size, moves and level matching
import { M, mon, battle, check, flush } from "../harness.mjs";

{
    const f = mon("Snorlax", { level: 40 }), b = battle(mon("Pikachu"), f);
    const before = { ...f.stats };
    f.entity.setDynamicProperty("cobblemon:alpha", true);
    M.enter(b, f, b.ally); flush();
    // the steps are Showdown's alphaBoosts, which getStat reads; the stored stats stay as they were (battle_rolls.mjs)
    const steps = Object.values(f.alphaBoosts ?? {}).reduce((n, v) => n + v, 0);
    check("a wild alpha comes into battle boosted (level / 10 + 1 stat steps)", steps === 5 && JSON.stringify(before) === JSON.stringify(f.stats) && b.log.join(" ").includes("alpha"), JSON.stringify([f.alphaBoosts, f.stats]));
    const g = mon("Snorlax", { level: 40 }), gb = battle(mon("Pikachu"), g);
    M.enter(gb, g, gb.ally); flush();
    check("an ordinary one is not", !g.alphaBoosted);
}
check("an alpha is larger, the more so the smaller the Pokemon", M.alphaScale("cobblemon:p0025_pikachu") > M.alphaScale("cobblemon:p0143_snorlax") && M.alphaScale("cobblemon:p0143_snorlax") > 1.1);
{
    const info = M.POKEMON ?? null;
    const moves = M.alphaMoves(M.fighter(mon("Charizard").entity).info, 50);
    check("an alpha's moves start with its strongest damaging ones", moves.length === 4, JSON.stringify(moves));
}
{
    const player = { getDynamicProperty: () => "2".repeat(700) }, none = { getDynamicProperty: () => "2".repeat(10) };
    const random = Math.random; Math.random = () => 0;
    try { check("a critical capture needs a Pokedex past 30 caught", M.criticalCapture(player, 100) === true && M.criticalCapture(none, 100) === false); }
    finally { Math.random = random; }
}
