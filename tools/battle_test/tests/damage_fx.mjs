// Residual damage effects (DamageInstruction's damage_<effect>): Leech Seed and the binding moves show on the Pokemon hurt
import { M, mon, battle, move, check, flush } from "../harness.mjs";

// records what a Pokemon's dimension is asked to spawn and play
function watched(f) {
    const seen = [];
    f.entity.dimension = new Proxy({}, { get: (_, name) => (...args) => { if (name === "spawnParticle" || name === "playSound") seen.push(args[0]); return []; } });
    return seen;
}
{
    const a = mon("Snorlax"), d = mon("Snorlax"), b = battle(a, d);
    d.seeded = true;
    const seen = watched(d);
    M.endOfTurn(b); flush();
    check("Leech Seed's sapping shows on the seeded Pokemon", seen.some((x) => /leechseed/.test(x)), seen.join(", "));
}
{
    const a = mon("Snorlax"), d = mon("Snorlax", { level: 100 }), b = battle(a, d);
    const random = Math.random; Math.random = () => 0.5;
    try { M.useMove(b, a, d, move("firespin")); flush(); } finally { Math.random = random; }
    check("a binding move remembers which move it was", d.bound?.id === "firespin", JSON.stringify(d.bound && { id: d.bound.id, name: d.bound.name }));
    const seen = watched(d);
    M.endOfTurn(b); flush();
    check("and Fire Spin's flames show as it hurts", seen.some((x) => /firespin/.test(x)), seen.join(", "));
}
