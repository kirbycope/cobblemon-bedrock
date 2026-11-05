// Abilities that change turn order (batch D) and act at the end of a turn or when an item goes (batch E)
import { M, mon, battle, move, check, flush } from "../harness.mjs";

// with every random roll at `roll`
function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const slow = (opts) => mon("Snorlax", { stats: { spe: 10 }, ...opts }), fast = (opts) => mon("Snorlax", { stats: { spe: 300 }, ...opts });

{
    const a = slow({ ability: "prankster" }), d = fast(), b = battle(a, d);
    check("Prankster puts a status move ahead of a faster foe", M.allyGoesFirst(b, a, d, move("thunderwave"), move("tackle")) === true);
    check("but not a damaging one", M.allyGoesFirst(b, a, d, move("tackle"), move("tackle")) === false);
    const t = mon("Snorlax"), dark = mon("Umbreon"), tb = battle(t, dark);
    t.ability = "prankster";
    M.useMove(tb, t, dark, move("thunderwave")); flush();
    check("Prankster's status moves do not affect Dark types", !dark.status, tb.log.join(" / "));
}
{
    const a = slow({ ability: "galewings" }), d = fast(), b = battle(a, d);
    const full = M.allyGoesFirst(b, a, d, move("wingattack"), move("tackle"));
    a.hp -= 1;
    check("Gale Wings puts Flying moves first at full HP only", full === true && M.allyGoesFirst(b, a, d, move("wingattack"), move("tackle")) === false);
    const t = slow({ ability: "triage" });
    check("Triage puts healing moves ahead of priority moves", M.allyGoesFirst(battle(t, d), t, d, move("drainingkiss"), move("quickattack")) === true);
}
{
    const a = fast({ ability: "stall" }), d = slow(), b = battle(a, d);
    check("Stall moves last in its bracket", M.allyGoesFirst(b, a, d, move("tackle"), move("tackle")) === false);
    const m = fast({ ability: "myceliummight" });
    check("Mycelium Might's status moves go last", M.allyGoesFirst(battle(m, d), m, d, move("spore"), move("tackle")) === false
        && M.allyGoesFirst(battle(m, d), m, d, move("tackle"), move("tackle")) === true);
    const q = slow({ ability: "quickdraw" });
    check("Quick Draw goes first three times in ten", rolled(0.1, () => M.allyGoesFirst(battle(q, d), q, fast(), move("tackle"), move("tackle"))) === true);
}
{
    const a = mon("Snorlax"), d = mon("Bruxish", { ability: "dazzling" }), b = battle(a, d), before = d.hp;
    M.useMove(b, a, d, move("quickattack")); flush();
    check("Dazzling stops a priority move", d.hp === before, b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "hydration", status: "par" }), b = battle(f, mon("Snorlax"));
    b.weather = { kind: "rain", turns: 5 };
    M.endOfTurn(b); flush();
    check("Hydration cures a status in rain", !f.status, b.log.join(" / "));
}
{
    const f = mon("Gengar", { ability: "baddreams" }), d = mon("Snorlax", { status: "slp" }), b = battle(f, d), before = d.hp;
    M.endOfTurn(b); flush();
    check("Bad Dreams hurts a sleeping foe an eighth", before - d.hp === Math.floor(d.stats.hp / 8), b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "moody" }), b = battle(f, mon("Snorlax"));
    M.endOfTurn(b); flush();
    const v = Object.values(f.stages);
    check("Moody raises one stat two stages and lowers another one", v.includes(2) && v.includes(-1), JSON.stringify(f.stages));
}
{
    const f = mon("Snorlax", { ability: "unburden", held: "sitrus_berry", hp: 0.4 }), b = battle(f, mon("Snorlax"));
    const before = M.speedOf(f, b);
    M.heldBerry(b, f); flush();
    check("Unburden doubles Speed once its item is gone", M.speedOf(f, b) === before * 2, `${before} -> ${M.speedOf(f, b)}`);
}
{
    const f = mon("Snorlax", { ability: "gluttony", held: "liechi_berry", hp: 0.45 }), b = battle(f, mon("Snorlax"));
    M.heldBerry(b, f); flush();
    check("Gluttony eats a pinch berry at half HP", f.stages.atk === 1, b.log.join(" / "));
    const r = mon("Snorlax", { ability: "ripen", held: "liechi_berry", hp: 0.2 }), rb = battle(r, mon("Snorlax"));
    M.heldBerry(rb, r); flush();
    check("Ripen doubles a berry", r.stages.atk === 2, rb.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "cheekpouch", held: "oran_berry", hp: 0.4 }), b = battle(f, mon("Snorlax")), before = f.hp;
    M.heldBerry(b, f); flush();
    check("Cheek Pouch heals a third on top of the berry", f.hp - before === 10 + Math.floor(f.stats.hp / 3), `${before} -> ${f.hp}`);
}
{
    const f = mon("Snorlax", { ability: "harvest", held: "sitrus_berry", hp: 0.4 }), b = battle(f, mon("Snorlax"));
    b.weather = { kind: "sun", turns: 5 };
    M.heldBerry(b, f); flush();
    const eaten = !f.held;
    f.hp = f.stats.hp; b.turn++;
    M.endOfTurn(b); flush();
    check("Harvest grows the berry back in sun", eaten && f.held === "cobblemon:sitrus_berry", b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "cudchew", held: "liechi_berry", hp: 0.2 }), b = battle(f, mon("Snorlax"));
    M.heldBerry(b, f); flush();
    M.endOfTurn(b); flush();
    const once = f.stages.atk;
    b.turn++; M.endOfTurn(b); flush();
    check("Cud Chew eats the berry again at the end of the next turn", once === 1 && f.stages.atk === 2 && !f.held, b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "pickup" }), d = mon("Snorlax", { held: "sitrus_berry", hp: 0.4 }), b = battle(f, d);
    M.heldBerry(b, d); flush();
    rolled(0.9, () => { M.endOfTurn(b); flush(); });
    check("Pickup takes the item the other used up that turn", f.held === "cobblemon:sitrus_berry", b.log.join(" / "));
}
