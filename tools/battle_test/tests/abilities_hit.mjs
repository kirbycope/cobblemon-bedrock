// Abilities that answer a damaging hit (batch B of the ability gaps), each in the situation its code reacts to
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

// one move with every random roll at `roll`: 0.5 is no critical hit and no added effect, 0.1 lands a 30 percent one
function hit(a, d, moveId, roll = 0.5, setup) {
    const random = Math.random;
    Math.random = () => roll;
    try {
        const b = battle(a, d);
        if (setup) setup(b, a, d);
        const before = { a: a.hp, d: d.hp };
        M.useMove(b, a, d, move(moveId)); flush();
        return { b, a, d, before, text: b.log.join(" / ") };
    } finally { Math.random = random; }
}
const big = (opts = {}) => mon("Snorlax", { level: 100, ...opts });
const small = (species, ability, opts = {}) => mon(species, { level: 5, ability, ...opts });

{
    const r = hit(big(), small("Snorlax", "aftermath"), "tackle");
    check("Aftermath takes a quarter from the Pokemon that knocked it out by contact", r.d.hp === 0 && r.before.a - r.a.hp === Math.floor(r.a.stats.hp / 4), r.text);
    const s = hit(big(), small("Snorlax", "aftermath"), "swift");
    check("Aftermath does not answer a move without contact", s.d.hp === 0 && s.a.hp === s.before.a, s.text);
}
{
    const r = hit(big(), small("Snorlax", "innardsout"), "swift");
    check("Innards Out deals the HP it had to the Pokemon that knocked it out", r.d.hp === 0 && r.before.a - r.a.hp === r.before.d, `${r.before.d} vs ${r.before.a - r.a.hp}; ${r.text}`);
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "cottondown" }), "swift");
    check("Cotton Down lowers the attacker's Speed on any hit", r.a.stages.spe === -1, r.text);
    const g = hit(mon("Snorlax"), mon("Snorlax", { ability: "gooey" }), "tackle");
    const g2 = hit(mon("Snorlax"), mon("Snorlax", { ability: "tanglinghair" }), "swift");
    check("Gooey and Tangling Hair lower Speed on contact only", g.a.stages.spe === -1 && g2.a.stages.spe === 0, `${g.text} || ${g2.text}`);
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "perishbody" }), "tackle");
    check("Perish Body gives both a perish count on contact", r.a.perish === 4 && r.d.perish === 4, r.text);
    const s = hit(mon("Snorlax"), mon("Snorlax", { ability: "sandspit" }), "swift");
    check("Sand Spit whips up a sandstorm", M.weatherOf(s.b) === "sand", s.text);
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "steamengine" }), "watergun");
    check("Steam Engine raises Speed six stages on a Water hit", r.d.stages.spe === 6, r.text);
    const w = hit(mon("Snorlax"), mon("Snorlax", { ability: "watercompaction" }), "watergun");
    check("Water Compaction raises Defense two stages on a Water hit", w.d.stages.def === 2, w.text);
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "angerpoint" }), "tackle", 0.01);
    check("Anger Point maxes Attack after a critical hit", r.text.includes("critical hit") && r.d.stages.atk === 6, r.text);
}
{
    const r = hit(mon("Snorlax"), mon("Raichu", { ability: "electromorphosis" }), "tackle");
    check("Electromorphosis charges the Pokemon hit", r.d.charged === true, r.text);
    const charged = damage({ species: "Raichu", level: 50 }, { species: "Snorlax", level: 50 }, "thunderbolt", (b, a) => { a.charged = true; });
    const plain = damage({ species: "Raichu", level: 50 }, { species: "Snorlax", level: 50 }, "thunderbolt");
    check("a charged Pokemon's Electric move is twice as strong, once", charged.dealt > plain.dealt * 1.8 && charged.a.charged === false, `${plain.dealt} -> ${charged.dealt}`);
    const c = mon("Raichu"), cb = battle(c, mon("Snorlax"));
    M.useMove(cb, c, cb.foe, move("charge")); flush();
    check("Charge charges its user and raises Sp. Def", c.charged === true && c.stages.spd === 1, cb.log.join(" / "));
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "toxicdebris" }), "tackle");
    check("Toxic Debris scatters poison spikes on the attacker's side after a physical hit", M.sideOf(r.b, r.a).toxicspikes === 1, r.text);
}
{
    const d = mon("Snorlax", { level: 100, ability: "berserk" });
    const r = hit(mon("Snorlax", { level: 30 }), d, "tackle", 0.5, (b, a, def) => { def.hp = Math.floor(def.stats.hp / 2) + 3; });
    check("Berserk raises Sp. Atk when a hit takes it to half HP", r.d.stages.spa === 1, `${r.before.d} -> ${r.d.hp} of ${r.d.stats.hp}; ${r.text}`);
    const s = mon("Snorlax", { level: 100, ability: "angershell" });
    const t = hit(mon("Snorlax", { level: 30 }), s, "tackle", 0.5, (b, a, def) => { def.hp = Math.floor(def.stats.hp / 2) + 3; });
    check("Anger Shell raises Attack, Sp. Atk and Speed and lowers the defences", t.d.stages.atk === 1 && t.d.stages.spe === 1 && t.d.stages.def === -1, t.text);
}
{
    const r = hit(mon("Snorlax"), mon("Snorlax", { ability: "colorchange" }), "watergun");
    check("Color Change takes the type of the move that hit it", r.d.info.types.join() === "water", r.text);
}
{
    const r = hit(mon("Snorlax", { ability: "thickfat" }), mon("Snorlax", { ability: "mummy" }), "tackle");
    check("Mummy spreads to the Pokemon that touches it", r.a.ability === "mummy" && r.a.baseAbility === "thickfat", r.text);
    const w = hit(mon("Snorlax", { ability: "thickfat" }), mon("Snorlax", { ability: "wanderingspirit" }), "tackle");
    check("Wandering Spirit trades abilities on contact", w.a.ability === "wanderingspirit" && w.d.ability === "thickfat", w.text);
}
{
    const r = hit(mon("Snorlax", { held: "leftovers" }), mon("Snorlax", { ability: "pickpocket" }), "tackle");
    check("Pickpocket takes the item of the Pokemon that touched it", r.d.held === "cobblemon:leftovers" && !r.a.held, r.text);
    const m = hit(mon("Snorlax", { ability: "magician" }), mon("Snorlax", { held: "leftovers" }), "swift");
    check("Magician takes the item of the Pokemon it hits", m.a.held === "cobblemon:leftovers" && !m.d.held, m.text);
}
{
    const r = hit(mon("Snorlax", { ability: "poisontouch" }), mon("Snorlax", { ability: "thickfat" }), "tackle", 0.1);
    check("Poison Touch poisons on contact", r.d.status === "psn", r.text);
    const t = hit(mon("Snorlax", { ability: "toxicchain" }), mon("Snorlax", { ability: "thickfat" }), "swift", 0.1);
    check("Toxic Chain badly poisons", t.d.status === "tox", t.text);
}
{
    const r = hit(mon("Venusaur", { hp: 0.5 }), mon("Tentacruel", { ability: "liquidooze" }), "gigadrain");
    check("Liquid Ooze hurts a draining move's user", r.a.hp < r.before.a, r.text);
    const a = mon("Venusaur", { hp: 0.5 }), d = mon("Tentacruel", { ability: "liquidooze" }), b = battle(a, d);
    d.seeded = true;
    const before = a.hp;
    M.endOfTurn(b); flush();
    check("Liquid Ooze hurts the Leech Seed's user", a.hp < before, b.log.join(" / "));
}
{
    const e = mon("Snorlax", { ability: "eartheater", hp: 0.5 }), r = hit(mon("Snorlax"), e, "earthquake");
    check("Earth Eater heals on a Ground move instead", r.d.hp > r.before.d, r.text);
    const w = hit(mon("Snorlax"), mon("Snorlax", { ability: "wellbakedbody" }), "flamethrower");
    check("Well-Baked Body takes Fire as +2 Defense", w.d.hp === w.before.d && w.d.stages.def === 2, w.text);
    const v = hit(mon("Snorlax"), mon("Snorlax", { ability: "windrider" }), "hurricane");
    check("Wind Rider takes a wind move as +1 Attack", v.d.hp === v.before.d && v.d.stages.atk === 1, v.text);
}
