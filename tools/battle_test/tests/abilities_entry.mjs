// Abilities that act as their holder comes in, and those that change what the other side can do (batch C)
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

const enter = (f, other, setup) => { const b = battle(f, other); if (setup) setup(b); M.enter(b, f, other); flush(); return b; };

{
    const k = mon("Snorlax", { ability: "klutz", held: "leftovers" });
    const m = mon("Snorlax", { ability: "klutz", held: "macho_brace" });
    check("Klutz leaves its holder's item doing nothing", M.held(k) === null && M.held(m) === "macho_brace");
}
{
    const a = mon("Golduck", { ability: "cloudnine" }), d = mon("Snorlax"), b = battle(a, d);
    b.weather = { kind: "rain", turns: 5 };
    const locked = M.weatherOf(b);
    a.ability = "damp";
    check("Cloud Nine and Air Lock stop the weather acting", locked === null && M.weatherOf(b) === "rain");
}
{
    const a = mon("Snorlax", { held: "oran_berry", hp: 0.3 }), d = mon("Snorlax", { ability: "unnerve" }), b = battle(a, d);
    M.heldBerry(b, a); flush();
    check("Unnerve keeps the other side from eating a berry", a.held === "cobblemon:oran_berry", b.log.join(" / "));
    d.ability = "thickfat"; M.heldBerry(b, a); flush();
    check("without it the berry is eaten", !a.held, b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "slowstart" }), d = mon("Snorlax"), fast = M.speedOf(f, battle(f, d));
    const b = enter(f, d);
    check("Slow Start halves Speed for five turns", Math.abs(M.speedOf(f, b) - fast / 2) < 0.01, b.log.join(" / "));
    b.turn += 5;
    check("and then lets it go", M.speedOf(f, b) === fast);
}
{
    const f = mon("Porygon", { ability: "download" }), d = mon("Snorlax", { stats: { def: 50, spd: 200 } });
    enter(f, d);
    const g = mon("Porygon", { ability: "download" }), e = mon("Snorlax", { stats: { def: 200, spd: 50 } });
    enter(g, e);
    check("Download raises Attack against the lower Defense, Sp. Atk against the lower Sp. Def", f.stages.atk === 1 && g.stages.spa === 1);
}
{
    const f = mon("Snorlax", { ability: "intrepidsword" }), d = mon("Snorlax");
    enter(f, d); enter(f, d);
    check("Intrepid Sword raises Attack once a battle", f.stages.atk === 1);
    const s = mon("Snorlax", { ability: "supersweetsyrup" }), t = mon("Snorlax");
    enter(s, t);
    check("Supersweet Syrup lowers the other's evasion", t.stages.evasion === -1);
}
{
    const f = mon("Mr. Mime", { ability: "screencleaner" }), d = mon("Snorlax");
    const b = enter(f, d, (b) => { b.sides = { a: { reflect: 5 }, b: { lightscreen: 5 } }; });
    check("Screen Cleaner takes down both sides' screens", !b.sides.a.reflect && !b.sides.b.lightscreen, b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "anticipation" }), d = mon("Machamp", { moves: ["closecombat"] });
    check("Anticipation shudders at a super effective move", enter(f, d).log.join(" ").includes("shuddered"));
    const g = mon("Snorlax", { ability: "forewarn" }), e = mon("Machamp", { moves: ["tackle", "closecombat"] });
    check("Forewarn names the strongest move", enter(g, e).log.join(" ").includes("Close Combat"));
    const h = mon("Snorlax", { ability: "frisk" }), i = mon("Machamp", { held: "leftovers" });
    check("Frisk names the other's item", enter(h, i).log.join(" ").includes("Leftovers"));
}
{
    const f = mon("Snorlax", { ability: "protosynthesis", stats: { atk: 300, def: 100, spa: 100, spd: 100, spe: 100 } }), d = mon("Snorlax");
    const b = battle(f, d);
    const plain = M.paradoxStat(b, f);
    b.weather = { kind: "sun", turns: 5 };
    check("Protosynthesis raises the highest stat in sun", plain === null && M.paradoxStat(b, f) === "atk");
    const q = mon("Snorlax", { ability: "quarkdrive", held: "booster_energy", stats: { atk: 100, def: 100, spa: 100, spd: 100, spe: 300 } });
    const qb = enter(q, mon("Snorlax"));
    check("Booster Energy turns Quark Drive on; Speed is raised by half", !q.held && M.paradoxStat(qb, q) === "spe", qb.log.join(" / "));
    const sun = damage({ species: "Snorlax", level: 50, ability: "protosynthesis", stats: { atk: 400 } }, { species: "Snorlax", level: 50 }, "tackle", (b) => { b.weather = { kind: "sun", turns: 5 }; });
    const none = damage({ species: "Snorlax", level: 50, ability: "protosynthesis", stats: { atk: 400 } }, { species: "Snorlax", level: 50 }, "tackle");
    check("and a raised Attack hits harder", sun.dealt > none.dealt, `${none.dealt} -> ${sun.dealt}`);
}
{
    const f = mon("Gardevoir", { ability: "trace" }), d = mon("Gyarados", { ability: "intimidate" });
    const b = enter(f, d);
    check("Trace copies the other's ability and uses it", f.ability === "intimidate" && d.stages.atk === -1, b.log.join(" / "));
}
{
    const f = mon("Weezing", { ability: "neutralizinggas" }), d = mon("Gyarados", { ability: "intimidate" });
    const b = enter(f, d);
    check("Neutralizing Gas stops the other's ability", d.ability === null, b.log.join(" / "));
    const next = mon("Snorlax"); b.ally = next;
    M.enter(b, next, d); flush();
    check("and gives it back once the gas has gone", d.ability === "intimidate");
}
