// Abilities that trap, block, reflect or otherwise change what a move can do (batch F), and Attract with them
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, roll = 0.5, setup) => rolled(roll, () => { const b = battle(a, d); if (setup) setup(b); M.useMove(b, a, d, move(id)); flush(); return b; });

{
    const t = mon("Wobbuffet", { ability: "shadowtag" }), f = mon("Snorlax"), b = battle(f, t);
    const tagged = M.trappedIn(b, f);
    const g = mon("Gengar"), gb = battle(g, t);
    check("Shadow Tag traps, but not a Ghost type", tagged && !M.trappedIn(gb, g));
    const a = mon("Dugtrio", { ability: "arenatrap" }), p = mon("Pidgeot"), s = mon("Snorlax");
    check("Arena Trap traps the grounded only", M.trappedIn(battle(s, a), s) && !M.trappedIn(battle(p, a), p));
    const m = mon("Magnezone", { ability: "magnetpull" }), st = mon("Steelix");
    check("Magnet Pull traps Steel types", M.trappedIn(battle(st, m), st) && !M.trappedIn(battle(s, m), s));
}
{
    const b = use(mon("Snorlax"), mon("Octillery", { ability: "suctioncups" }), "roar");
    check("Suction Cups holds against Roar", !b.swap, b.log.join(" / "));
}
{
    const f = mon("Leafeon", { ability: "leafguard" }), b = battle(mon("Snorlax"), f);
    b.weather = { kind: "sun", turns: 5 };
    M.inflict(b, f, "par", true, b.ally); flush();
    check("Leaf Guard keeps off a status in sun", !f.status, b.log.join(" / "));
}
{
    const a = mon("Snorlax", { ability: "poisonpuppeteer" }), d = mon("Snorlax", { ability: "thickfat" }), b = battle(a, d);
    rolled(0.9, () => M.inflict(b, d, "psn", true, a)); flush();
    check("Poison Puppeteer's poison confuses as well", d.status === "psn" && d.confused > 0, b.log.join(" / "));
}
{
    const o = mon("Snorlax", { ability: "opportunist" }), f = mon("Snorlax"), b = battle(f, o);
    M.boost(b, f, { atk: 2 }, f); flush();
    check("Opportunist copies the other's raise", o.stages.atk === 2, b.log.join(" / "));
}
{
    const a = mon("Snorlax", { ability: "thickfat" }), d = mon("Espeon", { ability: "magicbounce" });
    const b = use(a, d, "thunderwave");
    check("Magic Bounce sends a status move back", a.status === "par" && !d.status, b.log.join(" / "));
    const g = mon("Snorlax", { ability: "goodasgold" }), gb = use(mon("Snorlax"), g, "thunderwave");
    check("Good as Gold is not touched by status moves", !g.status, gb.log.join(" / "));
}
{
    const a = mon("Greninja", { ability: "protean" }), b = use(a, mon("Snorlax"), "icebeam");
    check("Protean takes the type of the move it uses, once", a.info.types.join() === "ice" && a.protean, b.log.join(" / "));
}
{
    const plain = use(mon("Snorlax"), mon("Snorlax", { ability: "thickfat" }), "thunderwave", 0.7);
    const skin = use(mon("Snorlax"), mon("Snorlax", { ability: "wonderskin" }), "thunderwave", 0.7);
    check("Wonder Skin makes a status move hit half the time", plain.foe.status === "par" && !skin.foe.status, skin.log.join(" / "));
    const tf = mon("Snorlax", { ability: "tangledfeet" });
    const t = use(mon("Snorlax"), tf, "tackle", 0.7, () => { tf.confused = 3; });
    check("Tangled Feet halves accuracy while confused", t.foe.hp === t.foe.stats.hp, t.log.join(" / "));
}
{
    const plain = damage({ species: "Darmanitan", level: 50, ability: "sheerforce" }, { species: "Snorlax", level: 50 }, "tackle");
    const gorilla = damage({ species: "Darmanitan", level: 50, ability: "gorillatactics" }, { species: "Snorlax", level: 50 }, "tackle");
    check("Gorilla Tactics raises Attack by half", gorilla.dealt > plain.dealt * 1.3, `${plain.dealt} -> ${gorilla.dealt}`);
    const one = damage({ species: "Kangaskhan", level: 50, ability: "scrappy" }, { species: "Snorlax", level: 50 }, "tackle");
    const two = damage({ species: "Kangaskhan", level: 50, ability: "parentalbond" }, { species: "Snorlax", level: 50 }, "tackle");
    check("Parental Bond hits again at a quarter of the power", two.dealt > one.dealt * 1.15 && two.dealt < one.dealt * 1.4, `${one.dealt} -> ${two.dealt}; ${two.b.log.join(" / ")}`);
}
{
    const a = mon("Snorlax", { level: 100, ability: "soulheart" }), b = use(a, mon("Snorlax", { level: 2 }), "tackle");
    check("Soul-Heart raises Sp. Atk on a knockout", a.stages.spa === 1, b.log.join(" / "));
}
{
    const d = mon("Golisopod", { level: 100, ability: "emergencyexit" });
    const b = use(mon("Snorlax", { level: 30 }), d, "tackle", 0.5, () => { d.hp = Math.floor(d.stats.hp / 2) + 3; });
    check("Emergency Exit sends the player's Pokemon back at half HP", b.ejectAlly === undefined && b.dragFoe === true, b.log.join(" / "));
}
{
    const a = mon("Snorlax", { gender: "male" }), d = mon("Snorlax", { gender: "female", ability: "thickfat" }), b = use(a, d, "attract");
    check("Attract makes the other gender fall in love", d.attracted === a, b.log.join(" / "));
    const same = use(mon("Snorlax", { gender: "male" }), mon("Snorlax", { gender: "male" }), "attract");
    check("but not the same gender", !same.foe.attracted, same.log.join(" / "));
    const stuck = rolled(0.1, () => M.canAct(b, d, move("tackle")));
    check("a Pokemon in love is held back half the time", stuck === false, b.log.join(" / "));
    const c = mon("Snorlax", { gender: "male" }), cc = mon("Clefable", { gender: "female", ability: "cutecharm" });
    const cb = use(c, cc, "tackle", 0.1);
    check("Cute Charm makes a Pokemon that touches it fall in love", c.attracted === cc, cb.log.join(" / "));
}
{
    const f = mon("Slaking", { ability: "truant" }), b = battle(f, mon("Snorlax"));
    const first = rolled(0.9, () => M.canAct(b, f, move("tackle"))), second = rolled(0.9, () => M.canAct(b, f, move("tackle")));
    check("Truant moves every other turn", first === true && second === false, b.log.join(" / "));
}
{
    const f = mon("Snorlax", { ability: "mimicry" }), b = battle(f, mon("Snorlax"));
    M.setTerrain(b, "grassy", b.foe); flush();
    const grass = f.info.types.join();
    b.terrain.turns = 1; M.endOfTurn(b); flush();
    check("Mimicry takes the terrain's type and drops it after", grass === "grass" && f.info.types.join() === "normal", b.log.join(" / "));
}
