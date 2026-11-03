// Item, field and guarding moves (move batch 3)
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, setup, b = battle(a, d)) => rolled(0.5, () => { if (setup) setup(b, a, d); M.useMove(b, a, d, move(id)); flush(); return { b, text: b.log.join(" / ") }; });
const plain = (opts = {}) => mon("Snorlax", { ability: "thickfat", ...opts });

// items
{
    const d = plain({ held: "leftovers", level: 100 }), r = use(mon("Weavile"), d, "knockoff");
    check("Knock Off removes the target's item", !d.held, r.text);
    const t = mon("Weavile"), td = plain({ held: "leftovers", level: 100 }); use(t, td, "thief");
    check("Thief takes the target's item", t.held === "cobblemon:leftovers" && !td.held);
    const k = plain({ held: "choice_scarf" }), kd = plain({ held: "leftovers" }); use(k, kd, "trick");
    check("Trick swaps items", k.held === "cobblemon:leftovers" && kd.held === "cobblemon:choice_scarf");
    const s = plain({ held: "leftovers" }), sd = mon("Snorlax", { ability: "stickyhold", held: "life_orb" }), sr = use(s, sd, "trick");
    check("but not with Sticky Hold", sd.held === "cobblemon:life_orb", sr.text);
    const i = plain({ held: "sitrus_berry", level: 100 }); use(mon("Charizard"), i, "incinerate");
    check("Incinerate burns up a berry", !i.held);
    const bb = mon("Scyther", { hp: 0.3 }), before = bb.hp, bd = plain({ held: "sitrus_berry", level: 100 }), br = use(bb, bd, "bugbite");
    check("Bug Bite eats the target's berry for itself", !bd.held && bb.hp > before, br.text);
    const c = plain(), cd = plain(); cd.stages.atk = 3; use(mon("Weezing"), cd, "clearsmog");
    check("Clear Smog clears the target's stages", cd.stages.atk === 0);
}
{
    const a = plain({ held: "sitrus_berry", hp: 0.4 }), b = battle(a, plain());
    M.heldBerry(b, a); flush();
    const eaten = !a.held; use(a, b.foe, "recycle", null, b);
    check("Recycle brings back the item used up", eaten && a.held === "cobblemon:sitrus_berry", b.log.join(" / "));
    const e = plain({ held: "leftovers" }); use(plain(), e, "embargo");
    check("Embargo leaves the target's item doing nothing", M.held(e) === null && e.held === "cobblemon:leftovers");
    const f = plain({ held: "flame_orb" }), fd = mon("Snorlax", { ability: "thickfat", level: 100 }), fr = use(f, fd, "fling");
    check("Fling throws the item, and a Flame Orb burns", !f.held && fd.status === "brn", fr.text);
    const s = plain({ held: "liechi_berry" }); use(s, plain(), "stuffcheeks");
    check("Stuff Cheeks eats the berry and raises Defense two stages", !s.held && s.stages.def === 2 && s.stages.atk === 1);
}
// the field
{
    const a = plain(), d = mon("Pidgeot"), b = battle(a, d);
    const flying = M.onGround(b, d);
    use(a, d, "gravity", null, b);
    check("Gravity grounds a Flying type", !flying && M.onGround(b, d), b.log.join(" / "));
    for (let n = 0; n < 5; n++) { M.endOfTurn(b); flush(); }
    check("for five turns", !M.onGround(b, d));
}
{
    const a = plain({ held: "leftovers" }), b = battle(a, plain());
    use(a, b.foe, "magicroom", null, b);
    check("Magic Room leaves every item doing nothing", M.held(a) === null, b.log.join(" / "));
    const plainHit = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "tackle", (bb, x, y) => { y.stats.def = 300; y.stats.spd = 30; });
    const room = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "tackle", (bb, x, y) => { y.stats.def = 300; y.stats.spd = 30; bb.wonderroom = 5; });
    check("Wonder Room hits Sp. Def with a physical move", room.dealt > plainHit.dealt * 3, `${plainHit.dealt} vs ${room.dealt}`);
    const mud = damage({ species: "Raichu", level: 50 }, { species: "Snorlax", level: 50 }, "thunderbolt", (bb) => { bb.mudsport = 5; });
    const bolt = damage({ species: "Raichu", level: 50 }, { species: "Snorlax", level: 50 }, "thunderbolt");
    check("Mud Sport weakens Electric moves to a third", mud.dealt < bolt.dealt / 2, `${bolt.dealt} vs ${mud.dealt}`);
}
{
    const a = plain(), d = plain(), b = battle(a, d);
    use(a, d, "fairylock", null, b);
    check("Fairy Lock keeps everyone in", M.trappedIn(b, d) && M.trappedIn(b, a));
    const c = plain(), cb = battle(c, plain()); cb.sides = { a: { reflect: 5 }, b: { stealthrock: 1 } };
    use(c, cb.foe, "courtchange", null, cb);
    check("Court Change swaps the sides' conditions", cb.sides.a.stealthrock === 1 && cb.sides.b.reflect === 5);
    const l = plain(), lb = battle(l, plain()); use(l, lb.foe, "luckychant", null, lb);
    const r = rolled(0.001, () => { const before = l.hp; M.useMove(lb, lb.foe, l, move("tackle")); flush(); return lb.log.join(" "); });
    check("Lucky Chant keeps critical hits off", !r.includes("critical hit"), r);
    const g = mon("Gengar"), eb = battle(g, plain()); eb.movedFirst = g;
    use(g, eb.foe, "electrify", null, eb);
    const before = g.hp; rolled(0.5, () => { M.useMove(eb, eb.foe, g, move("tackle")); flush(); });
    check("Electrify turns the target's move Electric, so Tackle hits a Ghost", g.hp < before, eb.log.join(" / "));
}
// guards
{
    const a = plain(), d = plain(), b = battle(d, a); b.movedFirst = a;
    use(a, d, "quickguard", null, b);
    const before = a.hp; rolled(0.5, () => { M.useMove(b, d, a, move("quickattack")); flush(); });
    check("Quick Guard stops priority moves", a.hp === before, b.log.join(" / "));
    const c = plain(), cd = plain(), cb = battle(cd, c);
    use(c, cd, "craftyshield", null, cb);
    rolled(0.5, () => { M.useMove(cb, cd, c, move("thunderwave")); flush(); });
    check("Crafty Shield stops status moves", !c.status, cb.log.join(" / "));
    const m = mon("Snorlax", { ability: "immunity" }), md = plain(), mb = battle(m, md); mb.movedFirst = m;
    use(m, md, "magiccoat", null, mb);
    rolled(0.5, () => { M.useMove(mb, md, m, move("thunderwave")); flush(); });
    check("Magic Coat sends a status move back", md.status === "par" && !m.status, mb.log.join(" / "));
    const s = plain(), sd = plain(), sb = battle(s, sd); sb.movedFirst = s;
    use(s, sd, "snatch", null, sb);
    rolled(0.5, () => { M.useMove(sb, sd, s, move("swordsdance")); flush(); });
    check("Snatch takes the other's move on itself", s.stages.atk === 2 && sd.stages.atk === 0, sb.log.join(" / "));
}
