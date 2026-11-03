// Lasting effects on one Pokemon, delayed hits and the rest (move batch 4)
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, b = battle(a, d), roll = 0.5) => rolled(roll, () => { M.useMove(b, a, d, move(id)); flush(); return b; });
const plain = (opts = {}) => mon("Snorlax", { ability: "thickfat", ...opts });

{
    const a = plain(), g = mon("Gengar"), b = battle(a, g);
    use(a, g, "foresight", b);
    const before = g.hp; use(a, g, "tackle", b);
    check("Foresight lets Normal moves hit a Ghost", g.hp < before, b.log.join(" / "));
    const l = plain(), lb = battle(l, plain()); use(l, lb.foe, "laserfocus", lb); lb.turn++;
    use(l, lb.foe, "tackle", lb);
    check("Laser Focus makes the next move a critical hit", lb.log.join(" ").includes("critical hit"), lb.log.join(" / "));
    const k = plain(), kd = plain(), kb = battle(k, kd); use(k, kd, "lockon", kb); kb.turn++; kd.stages.evasion = 6;
    const hp = kd.hp; use(k, kd, "zapcannon", kb, 0.99);
    check("Lock-On makes the next move hit", kd.hp < hp, kb.log.join(" / "));
}
{
    const a = plain(), b = battle(plain(), a); use(a, b.ally, "magnetrise", b);
    const before = a.hp; use(b.ally, a, "earthquake", b);
    check("Magnet Rise keeps Ground moves off", a.hp === before, b.log.join(" / "));
    const n = plain({ status: "slp" }), nb = battle(plain(), n); use(nb.ally, n, "nightmare", nb);
    const nh = n.hp; M.endOfTurn(nb); flush();
    check("Nightmare takes a quarter of a sleeper's HP each turn", nh - n.hp >= Math.floor(n.stats.hp / 4), nb.log.join(" / "));
    const o = plain(), ob = battle(plain(), o); use(ob.ally, o, "octolock", ob); M.endOfTurn(ob); flush();
    check("Octolock traps and lowers Defense and Sp. Def each turn", M.trappedIn(ob, o) && o.stages.def === -1 && o.stages.spd === -1, ob.log.join(" / "));
}
{
    const a = plain(), t = plain(), b = battle(t, a); use(a, t, "torment", b);
    t.lastMove = "tackle";
    check("Torment keeps the same move from being used twice running", !!M.blockedWhy(t, move("tackle")) && !M.blockedWhy(t, move("bodyslam")));
    const i = plain({ moves: ["tackle", "imprison"] }), id = plain(), ib = battle(id, i); use(i, id, "imprison", ib);
    const before = i.hp; use(id, i, "tackle", ib);
    check("Imprison seals the moves its user knows", i.hp === before && ib.log.join(" ").includes("sealed"), ib.log.join(" / "));
    const ts = plain(), tb = battle(plain(), ts); use(tb.ally, ts, "tarshot", tb);
    const fire = damage({ species: "Charizard", level: 50 }, ts, "flamethrower");
    check("Tar Shot lowers Speed and makes Fire super effective", ts.stages.spe === -1 && fire.b.log.join(" ").includes("super effective"), fire.b.log.join(" / "));
}
{
    const a = mon("Snorlax", { level: 50 }), d = plain({ level: 50 }), b = battle(a, d);
    use(a, d, "futuresight", b);
    const before = d.hp;
    M.endOfTurn(b); flush(); M.endOfTurn(b); flush(); const waiting = d.hp;
    M.endOfTurn(b); flush();
    check("Future Sight lands at the end of the second turn after its own", waiting === before && d.hp < before, b.log.join(" / "));
}
{
    const a = mon("Ninjask"), b = battle(a, plain());
    use(a, b.foe, "foresight", b);   // a status move, for Psycho Shift below
    const p = plain({ status: "brn" }), pd = mon("Snorlax", { ability: "thickfat" }); use(p, pd, "psychoshift");
    check("Psycho Shift passes the user's status on", pd.status === "brn" && !p.status);
    const c = plain({ gender: "male" }), cd = plain({ gender: "female" }); use(c, cd, "captivate");
    check("Captivate lowers the other gender's Sp. Atk two stages", cd.stages.spa === -2);
    const f = plain({ level: 100 }), fd = plain({ level: 3 }); use(f, fd, "fellstinger");
    check("Fell Stinger raises Attack three stages on a knockout", f.stages.atk === 3);
    const s = plain({ level: 100 }), sd = plain(), sb = use(s, sd, "stoneaxe");
    check("Stone Axe leaves stealth rocks", M.sideOf(sb, sd).stealthrock === 1, sb.log.join(" / "));
    const sc = plain(), scd = plain({ level: 100 }), scb = use(sc, scd, "saltcure");
    const hp = scd.hp; M.endOfTurn(scb); flush();
    check("Salt Cure takes an eighth each turn", hp - scd.hp === Math.floor(scd.stats.hp / 8), scb.log.join(" / "));
    const r = plain(), rd = plain(), rb = battle(r, rd); use(r, rd, "rage", rb); use(rd, r, "tackle", rb);
    check("Rage raises Attack when its user is hit", r.stages.atk === 1, rb.log.join(" / "));
    const bu = damage({ species: "Absol", level: 50 }, { species: "Snorlax", level: 50 }, "beatup");
    check("Beat Up hits", bu.dealt > 0, bu.b.log.join(" / "));
}
{
    const a = plain(), d = plain(), b = battle(a, d);
    a.lastHit = { dmg: 40, physical: false, tick: 0 };
    const random = Math.random; Math.random = () => 0.5;
    try { const before = d.hp; M.useMove(b, a, d, move("comeuppance")); flush(); check("Comeuppance returns half again the damage just taken", before - d.hp === 60, b.log.join(" / ")); }
    finally { Math.random = random; }
}
{
    const a = plain(), d = plain({ level: 100 }), b = battle(a, d);
    b.terrain = { kind: "electric", turns: 5 };
    use(a, d, "naturepower", b);
    check("Nature Power becomes the terrain's move", b.log.join(" ").includes("turned into Thunderbolt"), b.log.join(" / "));
}
