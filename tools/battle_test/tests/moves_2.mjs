// Status moves that change stats, types, abilities and HP (move batch 2)
import { M, mon, battle, move, check, flush } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, setup) => rolled(0.5, () => { const b = battle(a, d); if (setup) setup(b, a, d); M.useMove(b, a, d, move(id)); flush(); return { b, text: b.log.join(" / ") }; });
const has = (id) => { try { move(id); return true; } catch (e) { return false; } };
const plain = () => mon("Snorlax", { ability: "thickfat" });

{
    const a = plain(), r = use(a, plain(), "acupressure");
    check("Acupressure raises a stat two stages", Object.values(a.stages).includes(2), r.text);
    const c = plain(), cr = use(c, plain(), "curse");
    check("Curse raises Attack and Defense and lowers Speed for a non-Ghost", c.stages.atk === 1 && c.stages.def === 1 && c.stages.spe === -1, cr.text);
    const g = mon("Gengar"), t = plain(), gr = use(g, t, "curse");
    check("a Ghost's Curse costs half its HP and curses the target", g.hp === g.stats.hp - Math.floor(g.stats.hp / 2) && t.cursed, gr.text);
    const before = t.hp, b = battle(plain(), t); M.endOfTurn(b); flush();
    check("the curse takes a quarter each turn", before - t.hp === Math.floor(t.stats.hp / 4), b.log.join(" / "));
}
{
    const a = plain(), d = plain(); d.stages.atk = 2; d.stages.spe = -1;
    use(a, d, "psychup");
    check("Psych Up copies the target's stages", a.stages.atk === 2 && a.stages.spe === -1);
    const t = plain(); t.stages.atk = 2; t.stages.def = -1;
    use(plain(), t, "topsyturvy");
    check("Topsy-Turvy turns the target's stages round", t.stages.atk === -2 && t.stages.def === 1);
    const p = plain(), q = plain(); p.stats.atk = 100; p.stats.spa = 100; q.stats.atk = 300; q.stats.spa = 50;
    use(p, q, "powersplit");
    check("Power Split averages Attack and Sp. Atk", p.stats.atk === 200 && q.stats.atk === 200 && p.stats.spa === 75);
    const s = plain(), sd = plain(); s.stats.spe = 30; sd.stats.spe = 90;
    use(s, sd, "speedswap");
    check("Speed Swap trades Speed", s.stats.spe === 90 && sd.stats.spe === 30);
    const w = plain(); w.stats.atk = 50; w.stats.def = 200;
    use(w, plain(), "powertrick");
    check("Power Trick swaps Attack and Defense", w.stats.atk === 200 && w.stats.def === 50);
}
{
    const a = mon("Snorlax", { hp: 0.5, ability: "thickfat" }), d = plain(), before = a.hp, r = use(a, d, "strengthsap");
    check("Strength Sap heals by the target's Attack and lowers it", a.hp > before && d.stages.atk === -1, r.text);
    const v = plain(), vd = mon("Snorlax", { status: "psn" }); use(v, vd, "venomdrench");
    check("Venom Drench lowers a poisoned target's stats", vd.stages.atk === -1 && vd.stages.spe === -1);
    const sp = plain(), st = plain(); st.lastMove = "tackle"; st.moves = [move("tackle")];
    const left = st.moves[0].left; use(sp, st, "spite");
    check("Spite cuts the last move's PP by four", st.moves[0].left === left - 4);
}
{
    const p = mon("Porygon", { moves: ["thunderbolt", "conversion"] }); use(p, plain(), "conversion");
    check("Conversion makes Porygon its first move's type", p.info.types.join() === "electric");
    const rt = plain(), rd = mon("Charizard"); use(rt, rd, "reflecttype");
    check("Reflect Type copies the target's types", rt.info.types.join() === "fire,flying");
    const f = plain(); use(mon("Trevenant"), f, "forestscurse");
    check("Forest's Curse adds Grass", f.info.types.join() === "normal,grass");
}
{
    const a = mon("Snorlax", { ability: "thickfat" }), d = mon("Snorlax", { ability: "immunity" });
    use(a, d, "skillswap");
    check("Skill Swap trades abilities", a.ability === "immunity" && d.ability === "thickfat");
    const s = mon("Snorlax", { ability: "thickfat" }); use(plain(), s, "simplebeam");
    check("Simple Beam makes the target Simple", s.ability === "simple");
    const w = mon("Snorlax", { ability: "thickfat", status: "slp" }); use(plain(), w, "worryseed");
    check("Worry Seed gives Insomnia and wakes the target", w.ability === "insomnia" && !w.status);
    const g = mon("Snorlax", { ability: "thickfat" }); use(plain(), g, "gastroacid");
    check("Gastro Acid suppresses the target's ability", g.ability === null && g.baseAbility === "thickfat");
}
{
    const d = mon("Snorlax", { hp: 0.3 }), before = d.hp; use(plain(), d, "healpulse");
    check("Heal Pulse heals its target half", d.hp - before === Math.round(d.stats.hp / 2));
    const r = mon("Snorlax", { status: "brn" }); use(r, plain(), "refresh");
    check("Refresh cures the user's burn", !r.status);
}
{
    const a = mon("Snorlax", { hp: 0.5 }), b = battle(a, plain());
    M.useMove(b, a, b.foe, move("aquaring")); flush();
    const before = a.hp; M.endOfTurn(b); flush();
    check("Aqua Ring heals a sixteenth each turn", a.hp - before === Math.floor(a.stats.hp / 16), b.log.join(" / "));
    const i = mon("Snorlax"), ib = battle(i, plain());
    M.useMove(ib, i, ib.foe, move("ingrain")); flush();
    check("Ingrain keeps its user in", M.trappedIn(ib, i));
    const h = mon("Snorlax", { hp: 0.4 }), hb = battle(plain(), h);
    M.useMove(hb, hb.ally, h, move("healblock")); flush();
    const hp = h.hp; M.useMove(hb, h, hb.ally, move("recover")); flush();
    check("Heal Block stops healing moves", h.hp === hp && hb.log.join(" ").includes("Heal Block"), hb.log.join(" / "));
}
{
    const a = mon("Snorlax", { hp: 0.3 }), b = battle(a, plain());
    for (let n = 0; n < 3; n++) { M.useMove(b, a, b.foe, move("stockpile")); flush(); }
    const stocked = a.stockpile === 3 && a.stages.def === 3;
    const spit = M.movePower(b, a, b.foe, move("spitup"));
    const before = a.hp; M.useMove(b, a, b.foe, move("swallow")); flush();
    check("Stockpile stores three, Spit Up hits for 300 and Swallow heals fully, giving back the raises", stocked && spit === 300 && a.hp === a.stats.hp && a.hp > before && a.stages.def === 0 && !a.stockpile, b.log.join(" / "));
}
