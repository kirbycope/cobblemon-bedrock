// The rules around a battle (scripts/battle_rules.js and the main.js functions it hooks): experience and EVs paid when
// the battle ends and only once the foe's team is wiped, the Poke Ball refusals, the Pokedex-owned critical capture, the
// Smoke Ball, the bag items that clear stat stages, confusion and infatuation, the portion berries' confusion, the battle
// items' friendship and the forced tie of a player who leaves
import { readFileSync } from "node:fs";
import { M, mon, battle, check, flush } from "../harness.mjs";
// the module as its own instance: the scripts folder is not a Node package, so its text is imported as a data URL, whose
// bare imports the test loader still resolves to the stubs
const source = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/battle_rules.js", import.meta.url), "utf-8");
const rules = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

// a player the engine can pay experience to and take an item from
function player(id = "player") {
    const props = new Map(), lines = [];
    return { id, name: "Tester", isValid: true, lines, location: { x: 0, y: 0, z: 0 },
        sendMessage: (t) => lines.push(String(t).replace(/§./g, "")), playSound() { },
        getDynamicProperty: (k) => props.get(k), setDynamicProperty: (k, v) => (v === undefined ? props.delete(k) : props.set(k, v)),
        getComponent: () => ({ container: { size: 0, addItem() { } } }), onScreenDisplay: { setActionBar() { } } };
}
const ctx = (party, actives) => ({ partyOf: () => party, prop: M.prop, FAINTED: "cobblemon:fainted", allActives: () => actives, fighter: M.fighter,
    memberKey: M.memberKey, held: M.held, addEvs: M.addEvs, POWER_ITEMS: { power_bracer: "atk" }, battleExperience: M.battleExperience, gainExperience: M.gainExperience });
const expOf = (f) => M.prop(f.entity, "cobblemon:exp") ?? 0;
const evTotal = (f) => Object.values(M.evsOf(f.entity)).reduce((a, b) => a + b, 0);

{
    // PokemonBattle.end: nothing for a foe knocked out while its team stands (awardExperienceOnBattleLoss off), but its EVs
    const a = mon("Charmander", { level: 5 }), foe = mon("Pidgey", { level: 5 }), p = player();
    const b = battle(a, foe, { player: p });
    rules.recordFaint(b, foe, "foe", b, [M.memberKey(a.entity)]);
    const paid = rules.payExperience(b, ctx([a.entity], [a, foe]));
    const yieldTotal = Object.values(foe.info.evYield ?? {}).reduce((x, y) => x + y, 0);
    check("a foe knocked out with its team standing pays no experience", paid.length === 0 && expOf(a) === 0, JSON.stringify(paid));
    check("but its EVs come (Generation8EvCalculator)", evTotal(a) === yieldTotal, `${evTotal(a)} of ${yieldTotal}`);
}
{
    // the whole team wiped: each foe's experience to the Pokemon that faced it, one award a foe (opponent.awardExperience
    // in end's loop), the second at the level the first left it
    const a = mon("Charmander", { level: 5 }), f1 = mon("Pidgey", { level: 5 }), f2 = mon("Rattata", { level: 6 }), p = player();
    const b = battle(a, f1, { player: p, trainer: "Youngster" });
    const first = M.battleExperience(b, a, f1, 1);
    rules.recordFaint(b, f1, "foe", b, [M.memberKey(a.entity)]);
    rules.recordFaint(b, f2, "foe", b, [M.memberKey(a.entity)]);
    rules.teamWiped(b, "foe");
    const paid = rules.payExperience(b, ctx([a.entity], [a, f2]));
    const said = p.lines.filter((l) => l.includes("gained")).map((l) => Number(l.match(/gained (\d+)/)[1]));
    check("a wiped team pays every foe, one award each", paid.length === 1 && said.length === 2 && said[0] === first && paid[0].exp === said[0] + said[1] && expOf(a) === M.expFor(a.info.expGroup, 5) + paid[0].exp, `${JSON.stringify(paid.map((x) => x.exp))} ${said} first ${first}`);
    let mid = 5;
    while (M.expFor(a.info.expGroup, mid + 1) <= M.expFor(a.info.expGroup, 5) + first) mid++;
    const second = M.battleExperience(b, mon("Charmander", { level: mid }), f2, 1);
    check("the second at the level the first left it", mid > 5 && said[1] === second && second !== M.battleExperience(b, mon("Charmander", { level: 5 }), f2, 1), `Lv ${mid}: ${said[1]} vs ${second}`);
    check("nothing is pending afterwards", rules.payExperience(b, ctx([a.entity], [a, f2])).length === 0);
}
{
    // Raticate (medium fast) at level 10 against three level 10 foes of base experience 60: 242 and 242 at level 10, which
    // make level 11, then 223 there; 707 in all, not the 726 of three awards at level 10
    const a = mon("Raticate", { level: 10 }), p = player(), foes = [1, 2, 3].map(() => { const f = mon("Vulpix", { level: 10 }); f.info = { ...f.info, baseExp: 60 }; return f; });
    const b = battle(a, foes[0], { player: p, trainer: "Youngster" });
    for (const f of foes) rules.recordFaint(b, f, "foe", b, [M.memberKey(a.entity)]);
    rules.teamWiped(b, "foe");
    const paid = rules.payExperience(b, ctx([a.entity], [a]));
    const said = p.lines.filter((l) => l.includes("gained")).map((l) => l.match(/gained (\d+)/)[1]).join(",");
    check("three foes in a row pay 707 to a level 10 medium fast Pokemon, the level updated between them", paid[0]?.exp === 707 && said === "242,242,223" && expOf(a) === 1707, `${paid[0]?.exp} (${said})`);
}
{
    // BattlePokemon.facedOpponents as PokemonBattle.turn records them: Charmander faces the first foe at turn 1, Bulbasaur
    // switches in during it and faces only the second, from turn 2; each is paid for its own foe only
    const a = mon("Charmander", { level: 5 }), bench = mon("Bulbasaur", { level: 5 }), f1 = mon("Pidgey", { level: 5 }), f2 = mon("Rattata", { level: 5 }), p = player();
    const b = battle(a, f1, { player: p, trainer: "Youngster" });
    M.recordTurnFaced(b);
    b.ally = bench;   // a switch during turn 1, before the foe went down
    f1.hp = 0; M.recordBattleFaint(b, f1, "foe", b);
    b.foe = f2; M.recordTurnFaced(b);
    f2.hp = 0; M.recordBattleFaint(b, f2, "foe", b);
    rules.teamWiped(b, "foe");
    const ea = M.battleExperience(b, a, f1, 1), eb = M.battleExperience(b, bench, f2, 1);
    const paid = rules.payExperience(b, ctx([a.entity, bench.entity], [bench, f2]));
    const of = (f) => paid.find((x) => x.entity === f.entity)?.exp;
    check("the Pokemon out at a turn's start is paid for the foe it faced, and not for the next", of(a) === ea, `${of(a)} vs ${ea}`);
    check("one switched in mid-turn is paid only for the foe out at the next turn's start", of(bench) === eb, `${of(bench)} vs ${eb}`);
    const c = mon("Squirtle", { level: 5 }), w = mon("Pidgey", { level: 5 }), d = battle(c, w, { player: player() });
    c.hp = 0; M.recordTurnFaced(d);
    check("a fainted Pokemon faces nothing at a turn's start", M.facedBy(d, w).length === 0);
}
{
    // BattlePokemon keeps its identity across switches (PokemonBattle.kt's facedOpponents holds the BattlePokemon): a
    // trainer's Pidgey recalled and sent out again is a new entity here, but the same party member, so Charmander, which
    // faced it only before the recall, is still paid when it faints facing Bulbasaur after coming back
    const p = player(), a = mon("Charmander", { level: 5 }), bench = mon("Bulbasaur", { level: 5 }), other = mon("Rattata", { level: 5 });
    const npc = { location: { x: 0, y: 0, z: 0 }, dimension: { spawnEntity: (t) => mon(t).entity } };
    const spec = { t: mon("Pidgey").entity.typeId, lv: 5, moves: ["tackle"], ivs: {}, evs: {} };
    const first = M.fighter(M.spawnGymPokemon(npc, spec, p));
    const b = battle(a, first, { player: p, trainer: "Youngster" });
    M.recordTurnFaced(b);                       // turn 1: Charmander against the Pidgey
    b.foe = other; M.recordTurnFaced(b);        // the trainer withdrew it for a Rattata
    b.ally = bench;                             // and the player switched to Bulbasaur
    const again = M.fighter(M.spawnGymPokemon(npc, spec, p));
    b.foe = again; M.recordTurnFaced(b);        // the Pidgey back out, a new entity
    check("a trainer's Pokemon sent out again keeps its member key, a wild one keys by its entity", again.entity.id !== first.entity.id
        && M.memberKey(again.entity) === M.memberKey(first.entity) && M.memberKey(other.entity) === other.entity.id, M.memberKey(again.entity));
    again.hp = 0; M.recordBattleFaint(b, again, "foe", b);
    rules.teamWiped(b, "foe");
    const ea = M.battleExperience(b, a, again, 1);
    const paid = rules.payExperience(b, ctx([a.entity, bench.entity], [bench, again]));
    const of = (f) => paid.find((x) => x.entity === f.entity)?.exp;
    check("one that faced a trainer's Pokemon before its recall is paid when it faints after coming back", of(a) === ea && of(bench) > 0, `${of(a)} vs ${ea}, ${of(bench)}`);
}
{
    // ExperienceGroups.kt in its integer order: Erratic's bands end below 50, 68 and 98, and its third multiplies before it
    // divides by 3, so level 97 needs 572,550 (the games' table has 571,333); the other groups as before, level 1 at 0
    const e = (n) => M.expFor("erratic", n);
    check("Erratic: 120,001 at 49, 125,000 at 50, 258,043 at 68, 572,550 at 97, 583,539 at 98, 600,000 at 100",
        e(49) === 120001 && e(50) === 125000 && e(67) === 249633 && e(68) === 258043 && e(97) === 572550 && e(98) === 583539 && e(100) === 600000,
        [49, 50, 67, 68, 97, 98, 100].map(e).join(","));
    check("the other groups unchanged", M.expFor("medium_fast", 10) === 1000 && M.expFor("fast", 50) === 100000 && M.expFor("slow", 50) === 156250
        && M.expFor("medium_slow", 50) === 117360 && M.expFor("fluctuating", 15) === 1957 && M.expFor("fluctuating", 36) === 46656 && M.expFor("fluctuating", 50) === 142500);
    check("level 1 is 0 in every group", ["erratic", "fast", "medium_fast", "medium_slow", "slow", "fluctuating"].every((g) => M.expFor(g, 1) === 0));
}
{
    // Pokemon's level setter: the health keeps its share, ceil(currentHealth / maxHealth x newMax), not the old health plus
    // what the maximum gained
    const a = mon("Raticate", { level: 10 }), p = player(), b = battle(a, mon("Pidgey", { level: 5 }), { player: p });
    a.hp = Math.floor(a.stats.hp / 3);
    const [hp, max] = [a.hp, a.stats.hp];
    M.gainExperience(b, a, null, M.expFor("medium_fast", 11) - M.expFor("medium_fast", 10));
    const want = Math.ceil(Math.fround(Math.fround(hp / max) * a.stats.hp));
    check("a level-up keeps the share of health", a.level === 11 && a.hp === want && a.stats.hp > max, `${hp}/${max} to ${a.hp}/${a.stats.hp}, want ${want}`);
}
{
    // RCT's onExperienceGained: past the level cap the gain is cut to what reaches it, and the message says that much
    const a = mon("Raticate", { level: 14 }), p = player();
    p.setDynamicProperty("cobblemon:rct_series", "radicalred"); p.setDynamicProperty("cobblemon:rct_defeats", "{}");
    const b = battle(a, mon("Pidgey", { level: 5 }), { player: p });
    M.gainExperience(b, a, null, 5000);
    const allowed = M.expFor("medium_fast", 15) - M.expFor("medium_fast", 14);
    check("the level cap stops the gain at the cap", expOf(a) === M.expFor("medium_fast", 15) && a.level === 15, `${expOf(a)} Lv ${a.level}`);
    check("and the gain said is the part let through", p.lines.some((l) => l.includes("level cap (Lv. 15)")) && p.lines.some((l) => l.includes(`gained ${allowed} Exp. Points`)), p.lines.join(" / "));
}
{
    // a fainted party member gets nothing; an Exp. Share holder on the bench half the experience and the EVs
    const a = mon("Charmander", { level: 5 }), foe = mon("Pidgey", { level: 5 }), bench = mon("Bulbasaur", { level: 5 }), down = mon("Squirtle", { level: 5 }), p = player();
    bench.entity.setDynamicProperty("cobblemon:held", "cobblemon:exp_share");
    down.entity.setDynamicProperty("cobblemon:fainted", true);
    const b = battle(a, foe, { player: p });
    rules.recordFaint(b, foe, "foe", b, [M.memberKey(a.entity)]);
    rules.teamWiped(b, "foe");
    const half = M.battleExperience(b, M.fighter(bench.entity), foe, 0.5);
    const paid = rules.payExperience(b, ctx([a.entity, bench.entity, down.entity], [a, foe]));
    const benchPaid = paid.find((x) => x.entity === bench.entity);
    check("an Exp. Share holder on the bench gets half the experience", benchPaid?.exp === half, `${benchPaid?.exp} vs ${half}`);
    check("and the EVs in full", evTotal(bench) === Object.values(foe.info.evYield ?? {}).reduce((x, y) => x + y, 0), String(evTotal(bench)));
    check("a fainted party member gets nothing", !paid.some((x) => x.entity === down.entity) && evTotal(down) === 0);
}
{
    // EmptyPokeBallEntity.onHitEntity, in its order
    const s = (o) => rules.captureRefusal({ name: "Pidgey", wild: true, inBattle: false, capturing: false, asked: false, mine: null, ...o });
    check("an owned Pokemon is not wild", s({ wild: false }) === "That Pidgey is not a wild Pokémon.");
    check("a trainer's Pokemon in the thrower's battle is not wild", s({ inBattle: true, mine: { foe: true, trainer: true, minimised: false } }) === "That Pidgey is not a wild Pokémon.");
    check("the foe before its turn is over", s({ inBattle: true, mine: { foe: true, minimised: false } }) === "It's not your turn to act.");
    check("the foe with the screen minimised may be caught", s({ inBattle: true, mine: { foe: true, minimised: true } }) === null);
    check("the foe with a ball already on it is busy", s({ inBattle: true, capturing: true, mine: { foe: true, minimised: true } }) === "The Pidgey is busy!");
    check("a Pokemon in another player's battle", s({ inBattle: true }) === "That Pidgey is in a battle and cannot be caught by you.");
    check("a wild Pokemon being caught is busy", s({ capturing: true }) === "The Pidgey is busy!");
    check("another wild Pokemon while in a battle", s({ mine: { foe: false, minimised: true } }) === "You can't do that while in a battle!");
    check("a free wild Pokemon may be caught", s({}) === null);
}
{
    // PokedexStatusCaptureInfluencer: a species the thrower's Pokedex has as owned is caught critically, in one shake
    const foe = mon("Pidgey", { level: 3 }), a = mon("Charmander", { level: 5 });
    const owner = player("owner"), stranger = player("stranger");
    owner.setDynamicProperty("cobblemon:dex", "2".repeat(2000));
    const random = Math.random;
    Math.random = () => 0;   // every shake check passes
    try {
        const b = battle(a, foe, { player: owner });
        const r1 = M.captureRoll(owner, foe.entity, "cobblemon:poke_ball", b);
        const r2 = M.captureRoll(stranger, foe.entity, "cobblemon:poke_ball", battle(a, foe, { player: stranger }));
        check("a catch of an owned species is a one-shake critical capture", r1.caught && r1.critical && r1.shakes === 1, JSON.stringify(r1));
        check("of a new species, the full three shakes", r2.caught && !r2.critical && r2.shakes === 3, JSON.stringify(r2));
        const r3 = M.captureRoll(owner, foe.entity, "cobblemon:master_ball", b);
        check("a Master Ball's guaranteed catch of an owned species is critical too", r3.caught && r3.critical, JSON.stringify(r3));
    } finally { Math.random = random; }
}
{
    // the level-gap penalty Cobblemon never applies (findHighestThrowerLevel finds no actor) is gone: a catch rate 255 Pokemon
    // at full HP in battle passes a check at 0.75 whether the thrower's party is level 1 or 100 (a tenth of the rate would fail)
    const foe = mon("Pidgey", { level: 100 }), a = mon("Charmander", { level: 1 }), p = player();
    const random = Math.random;
    Math.random = () => 0.75;
    try {
        const r = M.captureRoll(p, foe.entity, "cobblemon:poke_ball", battle(a, foe, { player: p }));
        check("no level-gap penalty on the catch rate", r.caught, JSON.stringify(r));
    } finally { Math.random = random; }
}
{
    // Smoke Ball slips every trap, as a Shed Shell does
    const t = mon("Wobbuffet", { ability: "shadowtag" }), s = mon("Snorlax", { held: "smoke_ball" }), plain = mon("Snorlax");
    check("a Smoke Ball holder is not trapped by Shadow Tag", !M.trappedIn(battle(s, t), s) && M.trappedIn(battle(plain, t), plain));
}
{
    // the bag items: Moomoo Milk (clear_boost), Persim, Eggant, Lum and a Full Restore (cure_status, full_restore), Dire Hit's friendship
    const make = () => { const a = mon("Charmander", { level: 10 }), foe = mon("Pidgey", { level: 5 }); return { a, foe, b: battle(a, foe, { player: player() }) }; };
    let { a, b } = make();
    a.stages.atk = 2; a.stages.spe = -1;
    check("Moomoo Milk puts every stat stage back", M.useBagItem(b, "cobblemon:moomoo_milk") && a.stages.atk === 0 && a.stages.spe === 0, b.log.join(" / "));
    check("and does nothing with no stages to clear", !M.useBagItem(b, "cobblemon:moomoo_milk"));
    ({ a, b } = make()); a.confused = 3;
    check("a Persim Berry cures confusion", M.useBagItem(b, "cobblemon:persim_berry") && a.confused === 0, b.log.join(" / "));
    ({ a, b } = make()); a.attracted = b.foe;
    check("an Eggant Berry cures infatuation", M.useBagItem(b, "cobblemon:eggant_berry") && !a.attracted, b.log.join(" / "));
    ({ a, b } = make()); a.confused = 3;
    check("a Lum Berry takes confusion too", M.useBagItem(b, "cobblemon:lum_berry") && a.confused === 0, b.log.join(" / "));
    ({ a, b } = make()); a.confused = 3; a.hp = a.stats.hp;
    check("a Full Restore clears confusion", M.useBagItem(b, "cobblemon:full_restore") && a.confused === 0, b.log.join(" / "));
    ({ a, b } = make());
    const before = M.friendshipOf(a.entity);
    check("Dire Hit adds a point of friendship", M.useBagItem(b, "cobblemon:dire_hit") && M.friendshipOf(a.entity) === before + 1);
    ({ a, b } = make());
    check("Guard Spec adds a point of friendship", M.useBagItem(b, "cobblemon:guard_spec") && M.friendshipOf(a.entity) === before + 1);
}
{
    // the portion berries confuse a Pokemon whose nature dislikes their flavour (Berry.dislikedBy), used or held
    const eat = (nature, id, held) => {
        const a = mon("Charmander", { level: 10 }), foe = mon("Pidgey", { level: 5 }), b = battle(a, foe, { player: player() });
        a.entity.setDynamicProperty("cobblemon:nature", nature);
        a.hp = 1;
        if (held) { a.held = `cobblemon:${id}`; M.heldBerry(b, a); flush(); } else M.useBagItem(b, `cobblemon:${id}`);
        return a;
    };
    check("a Figy Berry confuses a Modest (minus Attack) Pokemon", eat("modest", "figy_berry").confused > 0);
    check("but not an Adamant one", eat("adamant", "figy_berry").confused === undefined || eat("adamant", "figy_berry").confused === 0);
    check("held, a Wiki Berry confuses an Adamant (minus Sp. Atk) Pokemon", eat("adamant", "wiki_berry", true).confused > 0);
    check("held, not a Modest one", !(eat("modest", "wiki_berry", true).confused > 0));
}
{
    // BattleRegistry.onPlayerDisconnect: a forced tie, with no winner said
    const other = player("other"), closed = [];
    let ended;
    const view = { pvp: true, side: 0, player: { id: "leaver", isValid: false }, opponent: other };
    rules.forcedTie(view, "leaver", { realBattle: (v) => v, endBattle: (b, text) => { ended = { b, text }; } });
    check("a leaver's battle ends with no winner message", ended?.b === view && ended.text === undefined && view.tied, JSON.stringify(ended?.text));
    check("the other player hears only that it ended", other.lines.length === 1 && other.lines[0] === "The battle ended." && !other.lines.some((l) => l.includes("won")), other.lines.join(" / "));
    const wild = { pvp: false, player: { id: "leaver", isValid: false }, ally: {}, foe: {} };
    ended = undefined;
    rules.forcedTie(wild, "leaver", { realBattle: (v) => v, endBattle: (b, text) => { ended = { b, text }; } });
    check("a wild battle ends the same way", ended?.b === wild && ended.text === undefined);
}
