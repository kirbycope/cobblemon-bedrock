// Evolution progress: the counts a player's Pokemon keeps for Cobblemon's progress evolutions, and the checks on them
import { M, mon, battle, move, check, flush } from "../harness.mjs";

const owned = (species, opts) => { const f = mon(species, opts); f.entity.setDynamicProperty("cobblemon:owner", "player"); return f; };
function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
{
    const a = owned("Primeape", { moves: ["ragefist"] }), b = battle(a, mon("Snorlax", { level: 100 }));
    for (let n = 0; n < 3; n++) rolled(0.5, () => { M.useMove(b, a, b.foe, move("ragefist")); flush(); });
    check("a Pokemon counts the times it uses a move", M.progressOf(a.entity).used?.ragefist === 3 && M.meets(a.entity, a, { t: "used", move: "ragefist", min: 3 }));
}
{
    // credited when the battle ends (PokemonBattle.end), to the party's Pokemon that faced it (evolution_rules.mjs)
    const a = owned("Bisharp", { level: 100 }), d = mon("Bisharp", { level: 2, held: "kings_rock" }), b = battle(a, d);
    b.player = { ...b.player, id: "defeats" };
    M.partyOf("defeats").push({ pid: "pid-a", rec: { t: a.entity.typeId, v: 0, lv: 100, k: {} }, out: null });
    const kept = M.summaryParty(b.player)[0];
    rolled(0.5, () => { M.useMove(b, a, d, move("tackle")); flush(); });
    b.pendingExp = [{ foe: d, loser: "foe", winners: b, faced: new Set(["pid-a"]) }];
    M.creditDefeats(b);
    check("and the Pokemon it knocks out, with what they held", M.defeatsOf(kept, "bisharp held_item=cobblemon:kings_rock") === 1, JSON.stringify(M.progressOf(kept)));
}
{
    const d = owned("Yamask", { level: 100 }), b = battle(mon("Snorlax", { level: 20 }), d);
    rolled(0.5, () => { M.useMove(b, b.ally, d, move("crunch")); flush(); });
    check("and the damage it lives through", (M.progressOf(d.entity).damage ?? 0) > 0, JSON.stringify(M.progressOf(d.entity)));
}
