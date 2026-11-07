// Evolution rules: the party a requirement looks at, a form's own evolutions, the evolution queue (PlayerPartyStore's
// once-a-second pass, held items used up as an evolution queues, permanent offers, the Everstone), item tags, the
// Link Cable, a random feature rolled on evolving, and the progress counted in battle
import { M, D, mod, mon, battle, move, check, flush } from "../harness.mjs";

const { VARIANT_LOOKS } = await mod("variants.js");

const id = (name) => Object.keys(D.POKEMON).find((t) => D.POKEMON[t].name === name);
const player = (name) => {
    const store = new Map();
    return { id: `id-${name}`, name, typeId: "minecraft:player", isValid: true, location: { x: 0, y: 64, z: 0 }, dimension: { spawnItem() { }, spawnEntity() { return undefined; } },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), sendMessage() { }, playSound() { },
        getComponent: () => undefined, onScreenDisplay: { setActionBar() { } } };
};
// a party member in its ball, as the party keeps it
function member(p, name, props = {}) {
    const { slot } = M.addRecord(p, M.recordFor(id(name), { level: props.level ?? 30, shiny: false }));
    if (props.v !== undefined) slot.rec.v = props.v;
    if (props.fainted) slot.rec.f = true;
    if (props.held) { slot.rec.k ??= {}; slot.rec.k["cobblemon:held"] = props.held; }
    flush();
    return M.summaryParty(p).find((e) => e.slot === slot);
}
function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }

{   // PartyMemberRequirement: Pancham's "type=dark" is any Dark-type member, fainted or not
    const p = player("Pancham"), pancham = member(p, "Pancham", { level: 32 });
    const party = { t: "party", type: "dark", contains: true };
    check("a Dark-type party member is not there: no Pangoro", !M.meets(pancham, M.fighter(pancham), party, p));
    member(p, "Machop");
    check("a Fighting-type one does not count", !M.meets(pancham, M.fighter(pancham), party, p));
    member(p, "Umbreon", { fainted: true });
    check("a fainted Umbreon counts (PartyStore holds every member)", M.meets(pancham, M.fighter(pancham), party, p));
    check("so Pancham at 32 is ready to evolve", M.readyEvolutions(pancham, p).some((e) => e.to === id("Pangoro")), JSON.stringify(D.POKEMON[id("Pancham")].evolutions));
    check("and the data names the type, not a species called type=dark", D.POKEMON[id("Pancham")].evolutions[0].req.some((r) => r.t === "party" && r.type === "dark" && !r.species));
}
{   // FormData.evolutions: a form evolves by its own list alone
    const p = player("Forms");
    let n = 0;   // each in a party of its own, as six fill one
    const form = (name, f, props) => { const e = member(player(`Forms${n++}`), name, props); e.slot.rec.v = VARIANT_LOOKS[e.typeId].findIndex((l) => l[0] === f && !l[1] && !l[2]); return e; };
    const sirfetchd = form("Farfetch'd", "galarian");
    check("a Galarian Farfetch'd evolves into Sirfetch'd after three critical hits", M.evolutionsOf(sirfetchd, "level").some((e) => e.to === id("Sirfetch'd") && e.req.some((r) => r.t === "crits" && r.min === 3)));
    const plainFarfetchd = member(player("Plain"), "Farfetch'd");
    check("a plain one evolves into nothing", M.evolutionsOf(plainFarfetchd, "level").length === 0);
    const meowth = form("Meowth", "galarian", { level: 28 });
    check("a Galarian Meowth becomes Perrserker at 28, not Persian", M.evolutionsOf(meowth, "level").map((e) => e.to).join() === id("Perrserker"));
    const slowpoke = form("Slowpoke", "galarian", { level: 40 });
    check("a Galarian Slowpoke does not become Slowbro by level", !M.readyEvolutions(slowpoke, p).length);
    check("but by the Galarica Cuff, into Galarian Slowbro", M.itemEvolution(slowpoke, p, "cobblemon:galarica_cuff")?.form === "galarian");
    check("and it has no trade evolution, so the King's Rock does nothing", M.evolutionsOf(slowpoke, "trade").length === 0 && !M.evolutionsOf(member(player("Plain2"), "Slowpoke"), "trade"));
    for (const [name, f, to] of [["Yamask", "galarian", "Runerigus"], ["Mr. Mime", "galarian", "Mr. Rime"], ["Corsola", "galarian", "Cursola"], ["Linoone", "galarian", "Obstagoon"],
        ["Sneasel", "hisuian", "Sneasler"], ["Qwilfish", "hisuian", "Overqwil"], ["Basculin", "whitestriped", "Basculegion"], ["Wooper", "paldean", "Clodsire"]]) {
        check(`${f} ${name} evolves into ${to}`, M.evolutionsOf(form(name, f), "level").some((e) => e.to === id(to)), JSON.stringify(D.POKEMON[id(name)].formEvos?.[f]));
    }
    check("a Dusk Rockruff becomes Dusk Lycanroc", M.evolutionsOf(form("Rockruff", "dusk-form"), "level").every((e) => e.form === "dusk-form"));
    check("an Antique Sinistea evolves by the Chipped Pot", M.evolutionsOf(form("Sinistea", "antique"), "item").map((e) => e.item).join() === "cobblemon:chipped_pot" && D.POKEMON[id("Sinistea")].formEvos.antique.block.includes("cobblemon:cracked_pot"));
    check("an Artisan Poltchageist by the Masterpiece Teacup", M.evolutionsOf(form("Poltchageist", "artisan"), "item").map((e) => e.item).join() === "cobblemon:masterpiece_teacup");
}
{   // the queue: a held item used up as the evolution queues, a permanent one kept, the Everstone hides
    const p = player("Queue"), grotle = member(p, "Grotle", { level: 32, held: "minecraft:oak_sapling" });
    check("Grotle holding an oak sapling queues the oak Torterra", M.queueEvolutions(grotle, p) && M.pendingKeys(grotle).some((k) => k.endsWith("|tree-oak")));
    check("the sapling is used up as it queues", grotle.getDynamicProperty("cobblemon:held") === undefined);
    check("and the offer stays, being permanent", M.readyEvolutions(grotle, p)[0]?.form === "tree-oak", JSON.stringify(M.readyEvolutions(grotle, p)));
    const azalea = member(p, "Grotle", { level: 32, held: "minecraft:flowering_azalea" });
    check("a flowering azalea is in #cobblemon:azalea_tree: the azalea Torterra", M.readyEvolutions(azalea, p)[0]?.form === "tree-azalea", JSON.stringify(M.readyEvolutions(azalea, p)));
    const q = player("Queue2"), pancham = member(q, "Pancham", { level: 32 }), dark = member(q, "Umbreon");
    check("Pancham queues Pangoro with a Dark type beside it", M.queueEvolutions(pancham, q));
    M.partyOf(q.id).splice(M.partyOf(q.id).findIndex((s) => s === dark.slot), 1);
    check("and drops it once that member is gone (not permanent)", !M.queueEvolutions(pancham, q) && !M.pendingKeys(pancham).length && !M.readyEvolutions(pancham, q).length);
    const charmander = member(q, "Charmander", { level: 16, held: "cobblemon:everstone" });
    check("an Everstone hides a ready evolution", M.readyEvolutions(charmander, q).length === 0);
    check("but it is queued all the same (ServerEvolutionController has no Everstone check)", M.pendingKeys(charmander).length === 1);
    charmander.setDynamicProperty("cobblemon:held", undefined);
    check("and shows again once the Everstone is taken", M.readyEvolutions(charmander, q)[0]?.to === id("Charmeleon"));
}
{   // Shelmet by Link Cable with a Karrablast in the party (shelmet_accelgor_item)
    const p = player("Shelmet"), shelmet = member(p, "Shelmet");
    check("a Link Cable on Shelmet alone does nothing", M.itemEvolution(shelmet, p, "cobblemon:link_cable") === null);
    member(p, "Karrablast");
    const evo = M.itemEvolution(shelmet, p, "cobblemon:link_cable");
    check("with a Karrablast in the party it evolves into Accelgor, dropping a Shell Helmet", evo?.to === id("Accelgor") && evo.drops?.[0]?.[0] === "cobblemon:shell_helmet");
}
{   // a random feature rolled as the Pokemon becomes the species (maushold_family: three 1, four 99)
    const tandemaus = id("Tandemaus"), maushold = id("Maushold");
    check("a Tandemaus's Maushold is a family of three 1 time in 100", rolled(0.005, () => M.rolledFeatureLook(tandemaus, maushold)) === null);
    check("and of four the other 99", rolled(0.011, () => M.rolledFeatureLook(tandemaus, maushold)) === "maushold-family-four" && rolled(0.99, () => M.rolledFeatureLook(tandemaus, maushold)) === "maushold-family-four");
    check("a Burmy's Wormadam keeps its cloak, not rolled again", M.rolledFeatureLook(id("Burmy"), id("Wormadam")) === undefined);
}
{   // DamageInstruction: the damage_taken count adds the HP short of the most after each hit
    const yamask = mon("Yamask", { level: 100 }); yamask.entity.setDynamicProperty("cobblemon:owner", "player");
    const b = battle(mon("Snorlax", { level: 20 }), yamask), deficits = [];
    for (let n = 0; n < 2; n++) { rolled(0.5, () => { M.useMove(b, b.ally, yamask, move("crunch")); flush(); }); deficits.push(yamask.stats.hp - yamask.hp); }
    check("two hits count the deficit after each (first + second)", M.progressOf(yamask.entity).damage === deficits[0] + deficits[1], `${JSON.stringify(M.progressOf(yamask.entity))} ${deficits}`);
}
{   // LastBattleCriticalHits: the critical hits of the last battle, started again as each battle begins
    const p = player("Crits"), farfetchd = member(p, "Farfetch'd");
    farfetchd.setDynamicProperty("cobblemon:progress", JSON.stringify({ crits: 3 }));
    M.resetBattleCrits(p);
    check("a new battle starts the count again", !M.progressOf(farfetchd).crits && !M.meets(farfetchd, M.fighter(farfetchd), { t: "crits", min: 3 }));
    const a = mon("Farfetch'd", { level: 100 }); a.entity.setDynamicProperty("cobblemon:owner", "player");
    a.entity.setDynamicProperty("cobblemon:progress", JSON.stringify({ crits: 5 }));
    const b = battle(a, mon("Snorlax", { level: 100 }));
    rolled(0, () => { M.useMove(b, a, b.foe, move("tackle")); flush(); });
    check("one critical hit this battle is one, not the best of every battle", M.progressOf(a.entity).crits === 1, JSON.stringify(M.progressOf(a.entity)));
}
{   // PokemonBattle.end: a defeat for every Pokemon still standing that faced the foe, not only the one that knocked it out
    const p = player("Kingambit"), faced = member(p, "Bisharp", { level: 60 }), benched = member(p, "Bisharp", { level: 60 }), down = member(p, "Bisharp", { level: 60, fainted: true });
    const foe = mon("Bisharp", { level: 5, held: "leaders_crest" }), b = battle(mon("Bisharp", { level: 60 }), foe, { player: p });
    b.pendingExp = [{ foe, loser: "foe", winners: b, faced: new Set([M.memberKey(faced), M.memberKey(down)]) }];
    M.creditDefeats(b);
    const target = "bisharp held_item=cobblemon:leaders_crest";
    check("the Bisharp that faced it is credited at the battle's end", M.defeatsOf(faced, target) === 1, JSON.stringify(M.progressOf(faced)));
    check("one that never faced it is not, nor a fainted one", M.defeatsOf(benched, target) === 0 && M.defeatsOf(down, target) === 0);
    const a = mon("Bisharp", { level: 100 }); a.entity.setDynamicProperty("cobblemon:owner", "player");
    const d = mon("Bisharp", { level: 2, held: "leaders_crest" }), b2 = battle(a, d);
    rolled(0.5, () => { M.useMove(b2, a, d, move("tackle")); flush(); });
    check("a knockout alone credits nothing until then", M.defeatsOf(a.entity, target) === 0);
}
