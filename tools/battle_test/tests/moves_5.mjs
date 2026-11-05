// The TM and tutor moves that were missing from the battles (move batch 5)
import { M, mon, battle, move, check, flush } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, b = battle(a, d), roll = 0.5) => rolled(roll, () => { M.useMove(b, a, d, move(id)); flush(); return b; });
const plain = (opts = {}) => mon("Snorlax", { ability: "thickfat", level: 60, ...opts });
{
    const ids = "alluringvoice blastburn burningjealousy chillingwater coaching corrosivegas dracometeor dragoncheer firepledge frenzyplant grasspledge grassyglide hardpress hydrocannon lashout meteorbeam mistyexplosion poltergeist pounce psychicnoise risingvoltage scaleshot scorchingsands skydrop steelbeam steelroller supercellslam telekinesis temperflare trailblaze tripleaxel upperhand waterpledge".split(" ");
    check("every TM's move is in the battles", ids.every((id) => move(id)?.id === id), ids.filter((id) => !move(id)).join(", "));
}
{
    const b = use(plain(), plain(), "coaching");
    check("Coaching has no ally to coach in a single battle", b.log.join(" ").includes("But it failed"), b.log.join(" / "));
    const d = plain({ held: "leftovers" }), gb = use(plain(), d, "corrosivegas");
    check("Corrosive Gas melts the target's item", !d.held && gb.log.join(" ").includes("corroded"), gb.log.join(" / "));
    const s = plain(), sb = use(mon("Pidgeot", { level: 60 }), s, "skydrop");
    check("Sky Drop cannot lift a Snorlax", sb.log.join(" ").includes("But it failed"), sb.log.join(" / "));
}
{
    const t = plain(), b = battle(plain(), t);
    use(b.ally, t, "telekinesis", b);
    const before = t.hp; use(b.ally, t, "earthquake", b);
    check("Telekinesis lifts its target out of reach of Ground moves", t.telekinesis === 3 && t.hp === before, b.log.join(" / "));
    t.stages.evasion = 6;
    const hp = t.hp; use(b.ally, t, "zapcannon", b, 0.99);
    check("and every other move hits it", t.hp < hp, b.log.join(" / "));
}
{
    const d = plain({ held: "leftovers" }), b = battle(plain(), d);
    use(b.ally, d, "psychicnoise", b);
    const hp = d.hp; M.endOfTurn(b); flush();
    check("Psychic Noise keeps Leftovers from healing", d.healBlock > 0 && d.hp === hp, b.log.join(" / "));
}
{
    const d = plain(), b = battle(plain(), d);
    d.raisedTurn = b.turn;
    use(b.ally, d, "burningjealousy", b, 0.01);
    check("Burning Jealousy burns a target whose stats rose this turn", d.status === "brn", b.log.join(" / "));
    const c = plain(), cb = battle(plain(), c);
    use(cb.ally, c, "burningjealousy", cb, 0.01);
    check("and not one whose stats did not", !c.status, cb.log.join(" / "));
}
{
    const a = plain(), b = battle(a, plain());
    b.terrain = { kind: "grassy", turns: 5 };
    check("Grassy Glide goes first on Grassy Terrain", M.priorityOf(b, a, move("grassyglide")) === 1 && M.priorityOf(battle(plain(), plain()), a, move("grassyglide")) === 0);
}
