// Moves whose own code the battle now carries (move batch 1): power decided by the battle, the stats a move uses,
// critical hits, the moves that only work at some moments, crash damage, fainting users and the hits that thaw
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, roll = 0.5, setup) => rolled(roll, () => { const b = battle(a, d); if (setup) setup(b, a, d); const before = { a: a.hp, d: d.hp }; M.useMove(b, a, d, move(id)); flush(); return { b, before, text: b.log.join(" / ") }; });
// a move the port's species do not learn is not in the table, so its power check gets a stand-in with Showdown's power
const STAND_IN = { lashout: 75, fusionflare: 100 };
const power = (id, setup, a = mon("Snorlax"), d = mon("Snorlax")) => {
    const b = battle(a, d); if (setup) setup(b, a, d);
    return M.movePower(b, a, d, STAND_IN[id] ? { id, power: STAND_IN[id], type: "normal", category: "Physical" } : move(id));
};

// twice as strong when its condition holds
check("Assurance doubles against a target hurt this turn", power("assurance", (b, a, d) => { d.hurtTurn = b.turn; }) === 120 && power("assurance") === 60);
check("Avalanche and Revenge double after the target hit the user this turn", power("avalanche", (b, a, d) => { a.lastHit = { dmg: 10, turn: b.turn, by: d }; }) === 120 && power("revenge") === 60);
check("Lash Out doubles after a stat fell this turn", power("lashout", (b, a) => { a.loweredTurn = b.turn; }) === 150);
check("Stomping Tantrum doubles after a failed move", power("stompingtantrum", (b, a) => { a.lastFailed = true; }) === 150 && power("stompingtantrum") === 75);
check("Retaliate doubles after a teammate fainted last turn", power("retaliate", (b, a) => { M.sideOf(b, a).faintedTurn = b.turn - 1; }) === 140);
check("Smelling Salts doubles against paralysis, Wake-Up Slap against sleep", power("smellingsalts", (b, a, d) => { d.status = "par"; }) === 140 && power("wakeupslap", (b, a, d) => { d.status = "slp"; }) === 140);
check("Fusion Flare doubles right after Fusion Bolt", power("fusionflare", (b) => { b.lastMoveUsed = { id: "fusionbolt", turn: b.turn }; }) === 200);
check("Rage Fist grows with each hit taken", power("ragefist", (b, a) => { a.timesHit = 3; }) === 200);
{
    const a = mon("Snorlax"), d = mon("Snorlax"), b = battle(a, d);
    const first = M.movePower(b, a, d, move("echoedvoice")); b.turn++;
    const second = M.movePower(b, a, d, move("echoedvoice"));
    check("Echoed Voice grows on consecutive turns", first === 40 && second === 80);
}
{
    const m = move("trumpcard"); m.left = 0;
    check("Trump Card is strongest on its last PP", M.movePower(battle(mon("Snorlax"), mon("Snorlax")), mon("Snorlax"), mon("Snorlax"), m) === 200);
}
// the stats a move uses
{
    const plain = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "psychic", (b, a, d) => { d.stats.spd = 400; d.stats.def = 50; });
    const shock = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "psyshock", (b, a, d) => { d.stats.spd = 400; d.stats.def = 50; });
    check("Psyshock hits the target's Defense", shock.dealt > plain.dealt * 3, `${plain.dealt} vs ${shock.dealt}`);
    const press = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "bodypress", (b, a) => { a.stats.def = 400; a.stats.atk = 50; });
    const punch = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "bodypress", (b, a) => { a.stats.def = 50; a.stats.atk = 400; });
    check("Body Press attacks with the user's Defense", press.dealt > punch.dealt * 3, `${punch.dealt} vs ${press.dealt}`);
    const foul = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "foulplay", (b, a, d) => { d.stats.atk = 400; a.stats.atk = 50; });
    const weak = damage({ species: "Snorlax", level: 50 }, { species: "Snorlax", level: 50 }, "foulplay", (b, a, d) => { d.stats.atk = 50; a.stats.atk = 400; });
    check("Foul Play attacks with the target's Attack", foul.dealt > weak.dealt * 3, `${weak.dealt} vs ${foul.dealt}`);
    const sword = damage({ species: "Machamp", level: 50 }, { species: "Snorlax", level: 50 }, "sacredsword", (b, a, d) => { d.stages.def = 6; });
    const plainHit = damage({ species: "Machamp", level: 50 }, { species: "Snorlax", level: 50 }, "sacredsword");
    check("Sacred Sword ignores the target's Defense raises", sword.dealt === plainHit.dealt, `${plainHit.dealt} vs ${sword.dealt}`);
}
{
    const r = use(mon("Lapras"), mon("Snorlax", { ability: "thickfat" }), "frostbreath");
    check("Frost Breath always lands a critical hit", r.text.includes("critical hit"), r.text);
    const dry = damage({ species: "Lapras", level: 50 }, { species: "Vaporeon", level: 50 }, "freezedry");
    const beam = damage({ species: "Lapras", level: 50 }, { species: "Vaporeon", level: 50 }, "icebeam");
    check("Freeze-Dry is super effective on Water types", dry.b.log.join(" ").includes("super effective") && dry.dealt > beam.dealt * 2, `${beam.dealt} vs ${dry.dealt}`);
}
// the moments a move can work
{
    const a = mon("Snorlax"), d = mon("Snorlax");
    const first = use(a, d, "fakeout"), again = use(a, d, "fakeout");
    check("Fake Out works only as the first move after coming in", !first.text.includes("failed") && first.text.includes("damage") && again.text.includes("failed"), `${first.text} || ${again.text}`);
    const s = use(mon("Absol"), mon("Snorlax"), "suckerpunch", 0.5, (b, a, t) => { t.chosenMove = move("tackle"); b.movedFirst = a; });
    const s2 = use(mon("Absol"), mon("Snorlax"), "suckerpunch", 0.5, (b, a, t) => { t.chosenMove = move("growl"); b.movedFirst = a; });
    check("Sucker Punch hits a target about to attack, and fails against a status move", !s.text.includes("failed") && s2.text.includes("failed"), `${s.text} || ${s2.text}`);
    const e = use(mon("Gengar"), mon("Snorlax", { ability: "thickfat" }), "dreameater");
    check("Dream Eater needs a sleeping target", e.text.includes("wasn't affected"), e.text);
}
{
    const a = mon("Hitmonlee", { stats: { spe: 999 } }), r = use(a, mon("Gengar"), "highjumpkick");
    check("High Jump Kick crashes for half the user's HP when it does not land", r.before.a - a.hp === Math.floor(a.stats.hp / 2), r.text);
}
{
    const a = mon("Electrode"), d = mon("Snorlax", { level: 100 }), r = use(a, d, "explosion");
    check("Explosion faints its user", a.hp === 0 && d.hp < r.before.d, r.text);
    const g = mon("Electrode"), damp = use(g, mon("Golduck", { ability: "damp" }), "explosion");
    check("but not against Damp, which stops it", g.hp > 0 && damp.text.includes("Damp"), damp.text);
}
{
    const a = mon("Snorlax", { level: 100 }), d = mon("Snorlax", { level: 5 });
    use(a, d, "falseswipe");
    check("False Swipe leaves its target 1 HP", d.hp === 1);
    const f = mon("Snorlax", { status: "frz" }), r = use(mon("Vaporeon"), f, "scald", 0.9);
    check("Scald thaws its target", f.status !== "frz", r.text);
    const s = mon("Snorlax", { status: "par", level: 100 }), sr = use(mon("Hitmonchan"), s, "smellingsalts");
    check("Smelling Salts cures the paralysis it doubled on", !s.status, sr.text);
}
{
    const a = mon("Machamp"), d = mon("Snorlax", { ability: "thickfat" }), r = use(a, d, "brickbreak", 0.5, (b) => { b.sides = { a: {}, b: { reflect: 5 } }; });
    check("Brick Break shatters Reflect", !r.b.sides.b.reflect, r.text);
    const f = mon("Snorlax"), fd = mon("Snorlax"), fr = use(f, fd, "feint", 0.5, (b) => { fd.protected = { turn: b.turn, kind: "protect" }; });
    check("Feint breaks through Protect", fd.hp < fr.before.d, fr.text);
    const cs = mon("Kommo-o"), cr = use(cs, mon("Snorlax", { ability: "thickfat" }), "clangingscales");
    check("Clanging Scales lowers its user's Defense, not the target's", cs.stages.def === -1 && cr.b.foe.stages.def === 0, cr.text);
}
{
    const a = mon("Snorlax"), b = battle(a, mon("Snorlax"));
    M.sideOf(b, a).healingWish = "healingwish";
    const next = mon("Snorlax", { hp: 0.2, status: "brn" }); b.ally = next;
    M.enter(b, next, b.foe); flush();
    check("Healing Wish heals the next Pokemon in fully", next.hp === next.stats.hp && !next.status, b.log.join(" / "));
}
