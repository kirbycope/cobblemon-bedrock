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
    const a = owned("Bisharp", { level: 100 }), d = mon("Bisharp", { level: 2, held: "kings_rock" }), b = battle(a, d);
    rolled(0.5, () => { M.useMove(b, a, d, move("tackle")); flush(); });
    check("and the Pokemon it knocks out, with what they held", M.defeatsOf(a.entity, "bisharp held_item=cobblemon:kings_rock") === 1, JSON.stringify(M.progressOf(a.entity)));
}
{
    const d = owned("Yamask", { level: 100 }), b = battle(mon("Snorlax", { level: 20 }), d);
    rolled(0.5, () => { M.useMove(b, b.ally, d, move("crunch")); flush(); });
    check("and the damage it lives through", (M.progressOf(d.entity).damage ?? 0) > 0, JSON.stringify(M.progressOf(d.entity)));
}
