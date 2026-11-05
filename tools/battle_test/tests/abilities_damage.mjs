// Abilities that change a hit's damage (batch A of the ability gaps): each against the same hit without it
import { M, mon, battle, move, check, damage } from "../harness.mjs";

const more = (name, withIt, without, factor) => check(name, withIt.dealt > without.dealt, `${without.dealt} -> ${withIt.dealt} (about ${factor})`);
const less = (name, withIt, without) => check(name, withIt.dealt < without.dealt, `${without.dealt} -> ${withIt.dealt}`);
const L = 50;

// the type changers: Pixilate's Tackle is Fairy (Dragon takes it twice over), boosted 1.2 times
{
    const plain = damage({ species: "Sylveon", level: L }, { species: "Dragonite", level: L }, "tackle");
    const pix = damage({ species: "Sylveon", level: L, ability: "pixilate" }, { species: "Dragonite", level: L }, "tackle");
    more("Pixilate turns Tackle Fairy and boosts it", pix, plain, "2 x 1.2");
    const ghost = damage({ species: "Snorlax", level: L, ability: "normalize" }, { species: "Gengar", level: L }, "flamethrower");
    check("Normalize makes Flamethrower Normal, which Ghosts ignore", ghost.dealt === 0, ghost.b.log.join(" / "));
    const voice = damage({ species: "Primarina", level: L, ability: "liquidvoice" }, { species: "Golem", level: L }, "hypervoice");
    const voice0 = damage({ species: "Primarina", level: L }, { species: "Golem", level: L }, "hypervoice");
    more("Liquid Voice makes sound moves Water", voice, voice0, "4 vs 0.5");
    const pp = mon("Sylveon", { ability: "pixilate", moves: ["tackle"] }), slot = pp.moves[0], left = slot.left;
    M.useMove(battle(pp, mon("Dragonite")), pp, battle(pp, mon("Dragonite")).foe, slot);
    check("a retyped move still spends its own PP", slot.left === left - 1, `${left} -> ${slot.left}`);
}
// attack modifiers
more("Dragon's Maw boosts Dragon moves", damage({ species: "Regidrago", level: L, ability: "dragonsmaw" }, { species: "Snorlax", level: L }, "dragonclaw"),
    damage({ species: "Regidrago", level: L, ability: "pressure" }, { species: "Snorlax", level: L }, "dragonclaw"), 1.5);
more("Transistor boosts Electric moves", damage({ species: "Regieleki", level: L, ability: "transistor" }, { species: "Snorlax", level: L }, "thunderbolt"),
    damage({ species: "Regieleki", level: L, ability: "pressure" }, { species: "Snorlax", level: L }, "thunderbolt"), 1.3);
less("Defeatist halves attack at half HP", damage({ species: "Archeops", level: L, ability: "defeatist", hp: 0.4 }, { species: "Snorlax", level: L }, "rockslide"),
    damage({ species: "Archeops", level: L, ability: "defeatist" }, { species: "Snorlax", level: L }, "rockslide"));
more("Stakeout doubles against a Pokemon that just came in", damage({ species: "Gumshoos", level: L, ability: "stakeout" }, { species: "Snorlax", level: L }, "tackle", (b, a, d) => { d.enteredTurn = b.turn; }),
    damage({ species: "Gumshoos", level: L, ability: "stakeout" }, { species: "Snorlax", level: L }, "tackle"), 2);
less("Tablets of Ruin weakens the foe's physical attack", damage({ species: "Snorlax", level: L }, { species: "Slowbro", level: L, ability: "tabletsofruin" }, "tackle"),
    damage({ species: "Snorlax", level: L }, { species: "Slowbro", level: L, ability: "pressure" }, "tackle"));
more("Sword of Ruin weakens the foe's Defense", damage({ species: "Weavile", level: L, ability: "swordofruin" }, { species: "Snorlax", level: L }, "iceshard"),
    damage({ species: "Weavile", level: L, ability: "pressure" }, { species: "Snorlax", level: L }, "iceshard"), 1.33);
// power modifiers
more("Analytic boosts a move made after the foe's", damage({ species: "Magnezone", level: L, ability: "analytic" }, { species: "Snorlax", level: L }, "flashcannon", (b, a, d) => { b.movedFirst = d; }),
    damage({ species: "Magnezone", level: L, ability: "analytic" }, { species: "Snorlax", level: L }, "flashcannon", (b, a) => { b.movedFirst = a; }), 1.3);
more("Flare Boost boosts special moves while burned", damage({ species: "Drifblim", level: L, ability: "flareboost", status: "brn" }, { species: "Snorlax", level: L }, "psybeam"),
    damage({ species: "Drifblim", level: L, ability: "flareboost" }, { species: "Snorlax", level: L }, "psybeam"), 1.5);
more("Toxic Boost boosts physical moves while poisoned", damage({ species: "Zangoose", level: L, ability: "toxicboost", status: "psn" }, { species: "Snorlax", level: L }, "slash"),
    damage({ species: "Zangoose", level: L, ability: "toxicboost" }, { species: "Snorlax", level: L }, "slash"), 1.5);
more("Rivalry boosts against the same gender", damage({ species: "Nidoking", level: L, ability: "rivalry", gender: "male" }, { species: "Snorlax", level: L, gender: "male" }, "tackle"),
    damage({ species: "Nidoking", level: L, ability: "rivalry", gender: "male" }, { species: "Snorlax", level: L, gender: "female" }, "tackle"), "1.25 vs 0.75");
more("Dark Aura boosts Dark moves", damage({ species: "Houndoom", level: L, ability: "darkaura" }, { species: "Snorlax", level: L }, "darkpulse"),
    damage({ species: "Houndoom", level: L, ability: "pressure" }, { species: "Snorlax", level: L }, "darkpulse"), 1.33);
less("Aura Break turns an Aura round", damage({ species: "Houndoom", level: L, ability: "darkaura" }, { species: "Snorlax", level: L, ability: "aurabreak" }, "darkpulse"),
    damage({ species: "Houndoom", level: L, ability: "pressure" }, { species: "Snorlax", level: L, ability: "aurabreak" }, "darkpulse"));
more("Punk Rock boosts sound moves", damage({ species: "Toxtricity", level: L, ability: "punkrock" }, { species: "Snorlax", level: L }, "boomburst"),
    damage({ species: "Toxtricity", level: L, ability: "plus" }, { species: "Snorlax", level: L }, "boomburst"), 1.3);
// damage taken
less("Fluffy halves contact damage", damage({ species: "Snorlax", level: L }, { species: "Bewear", level: L, ability: "fluffy" }, "tackle"),
    damage({ species: "Snorlax", level: L }, { species: "Bewear", level: L, ability: "unnerve" }, "tackle"));
more("Fluffy doubles Fire", damage({ species: "Charizard", level: L }, { species: "Bewear", level: L, ability: "fluffy" }, "flamethrower"),
    damage({ species: "Charizard", level: L }, { species: "Bewear", level: L, ability: "unnerve" }, "flamethrower"), 2);
less("Ice Scales halves special damage", damage({ species: "Charizard", level: L }, { species: "Frosmoth", level: L, ability: "icescales" }, "airslash"),
    damage({ species: "Charizard", level: L }, { species: "Frosmoth", level: L, ability: "shielddust" }, "airslash"));
more("Neuroforce boosts super effective hits", damage({ species: "Alakazam", level: 20, ability: "neuroforce" }, { species: "Machamp", level: L }, "psychic"),
    damage({ species: "Alakazam", level: 20, ability: "prismarmor" }, { species: "Machamp", level: L }, "psychic"), 1.25);
// accuracy, crits, contact, speed
{
    const d = damage({ species: "Ursaluna", level: L, ability: "mindseye" }, { species: "Gengar", level: L }, "bodyslam");
    check("Mind's Eye hits a Ghost with a Normal move", d.dealt > 0, d.b.log.join(" / "));
}
{
    const a = mon("Toxapex", { ability: "merciless" }), d = mon("Snorlax", { status: "psn" }), b = battle(a, d);
    M.useMove(b, a, d, move("liquidation"));
    check("Merciless lands a critical hit on a poisoned target", b.log.some((l) => l.includes("critical hit")), b.log.join(" / "));
}
{
    const a = mon("Ursaring", { ability: "quickfeet", status: "par" }), b = battle(a, mon("Snorlax"));
    const fast = M.speedOf(a, b);
    a.ability = "guts";
    check("Quick Feet speeds a statused Pokemon and ignores paralysis", fast > M.speedOf(a, b) * 2.5, `${fast} vs ${M.speedOf(a, b)}`);
}
{
    const a = mon("Machamp", { ability: "unseenfist" }), d = mon("Snorlax"), b = battle(a, d);
    d.protected = { turn: b.turn, kind: "protect" };
    const before = d.hp;
    M.useMove(b, a, d, move("closecombat"));
    check("Unseen Fist's contact moves go through Protect", d.hp < before, b.log.join(" / "));
}
