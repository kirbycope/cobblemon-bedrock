// The battle data's forms and moves (port.py's create_battle_data, variant_battle_overrides, learnset_data and
// showdown_moves): a form's own abilities, learnset, egg moves and yields (FormData's getters), fighter()'s merge of them,
// the female forms, moveset_builders/wild.json on every spawn that is not an alpha, and the move table's read of Showdown
import { M, D, check, battle, move, flush } from "../harness.mjs";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", "..", "..");
const scripts = join(root, "development_behavior_packs", "cobblemon", "scripts");
const copy = mkdtempSync(join(tmpdir(), "cobblemon-forms-"));
for (const f of ["progression.js", "progression_data.js", "marks.js", "variants.js"]) cpSync(join(scripts, f), join(copy, f));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const { buildMoveset, WILD_SLOTS } = await import(pathToFileURL(join(copy, "progression.js")).href);
const { VARIANT_LOOKS } = await import(pathToFileURL(join(copy, "variants.js")).href);
const species = (name) => JSON.parse(readFileSync(join(root, "java", "common", "src", "main", "resources", "data", "cobblemon", "species", name), "utf-8").replace(/^﻿/, ""));

// a stand-in entity whose minecraft:variant is the look asked for
function entity(typeId, variant, props = {}) {
    const store = new Map(Object.entries(props));
    return new Proxy({ typeId, id: `forms-${typeId}-${Math.random()}`, isValid: true, isProxy: false, location: { x: 0, y: 0, z: 0 },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)),
        getComponent: (c) => (c === "minecraft:variant" ? { value: variant } : undefined), hasComponent: () => false, getProperty: () => 0,
        setProperty() { }, triggerEvent() { }, addEffect() { }, removeEffect() { }, dimension: new Proxy({}, { get: () => () => [] }) },
        { get: (t, k) => (k in t ? t[k] : () => undefined) });
}
// the look index of a form aspect (VARIANT_LOOKS: [form, female, shiny]), not shiny
const look = (typeId, form, female = 0) => VARIANT_LOOKS[typeId].findIndex((l) => l[0] === form && l[1] === female && l[2] === 0);
const id = (name) => Object.keys(D.POKEMON).find((k) => D.POKEMON[k].name === name);

// Alolan Ninetales (ninetales.json's Alola form): its abilities, hidden ability, learnset, egg moves and EV yield
{
    const t = id("Ninetales"), n = look(t, "alolan"), v = D.POKEMON[t].variants[n];
    check("Alolan Ninetales' variant has Snow Cloak and Snow Warning hidden", v?.abilities?.join() === "snowcloak" && v.hidden?.join() === "snowwarning", JSON.stringify(v?.abilities));
    check("its learnset is the form's (Powder Snow, Freeze-Dry), not Ninetales' (Ember)", v.learnset.some(([, m]) => m === "freezedry") && !v.learnset.some(([, m]) => m === "ember"));
    check("its EV yield is the form's 2 Speed", JSON.stringify(v.evYield) === JSON.stringify({ spe: 2 }), JSON.stringify(v.evYield));
    const f = M.fighter(entity(t, n));
    check("fighter() merges it: the ability rolled is Snow Cloak", f.ability === "snowcloak", f.ability);
    check("and its moves come from the form's learnset", f.moves.length > 0 && f.moves.every((m) => v.learnset.some(([, id]) => id === m.id)), f.moves.map((m) => m.id).join());
    check("and the experience and EVs read its yield", f.info.evYield.spe === 2 && !f.info.evYield.spd, JSON.stringify(f.info.evYield));
    const base = M.fighter(entity(t, 0));
    check("the plain look keeps Ninetales' Flash Fire", base.ability === "flashfire", base.ability);
}

// the female forms (aspect female, picked by the female look): Indeedee's F has Own Tempo and a Sp. Def yield, and its
// own learnset (Baton Pass at 5); Meowstic's F Competitive hidden; Oinkologne's F Aroma Veil
{
    const t = id("Indeedee"), n = look(t, null, 1), v = D.POKEMON[t].variants[n];
    check("Indeedee's female look is its F form: Own Tempo", v?.abilities?.[0] === "owntempo", JSON.stringify(v));
    check("with 2 Sp. Def EVs and Baton Pass at level 5", v.evYield?.spd === 2 && v.learnset.some(([at, m]) => at === 5 && m === "batonpass"), JSON.stringify(v.evYield));
    check("its male look stays Inner Focus", !D.POKEMON[t].variants[look(t, null, 0)] && D.POKEMON[t].ability === "innerfocus");
    const meowstic = id("Meowstic"), oink = id("Oinkologne"), basc = id("Basculegion");
    if (meowstic) check("Meowstic's F has Competitive hidden", D.POKEMON[meowstic].variants[look(meowstic, null, 1)]?.hidden?.join() === "competitive");
    if (oink) check("Oinkologne's F has Aroma Veil", D.POKEMON[oink].variants[look(oink, null, 1)]?.ability === "aromaveil");
    if (basc) check("Basculegion's F fights with its own stats", !!D.POKEMON[basc].variants[look(basc, null, 1)]?.stats);
}

// a form's base experience and friendship: Rotom's appliances 182 (to Rotom's 154), Galarian Stunfisk's 50 (to 70)
{
    const rotom = id("Rotom");
    if (rotom) {
        const heat = VARIANT_LOOKS[rotom].findIndex((l) => l[0] === "heat-appliance" && !l[2]);
        check("Heat Rotom gives 182 base experience", heat > 0 && M.fighter(entity(rotom, heat)).info.baseExp === 182, String(heat));
    }
    const t = id("Stunfisk"), n = look(t, "galarian");
    check("Galarian Stunfisk's base friendship is 50, Stunfisk's 70", D.POKEMON[t].variants[n]?.friendship === 50 && D.POKEMON[t].friendship === 70);
    check("friendshipOf reads it for one with no friendship of its own", M.friendshipOf(entity(t, n)) === 50 && M.friendshipOf(entity(t, 0)) === 70);
    check("and Galarian Stunfisk's Mimicry", M.fighter(entity(t, n)).ability === "mimicry");
}

// Tauros' Paldean breeds: the aqua-breed look is Paldea-Aqua (aspects paldean and aqua-breed), Fighting and Water
{
    const t = id("Tauros"), n = look(t, "aqua-breed");
    check("the aqua-breed look fights as Paldea-Aqua", D.POKEMON[t].variants[n]?.types?.join() === "fighting,water", JSON.stringify(D.POKEMON[t].variants[n]?.types));
}

// moveset_builders/wild.json: the slots WILD_SLOTS carries, and every spawn but an alpha's (movesAt) builds from them
{
    const wild = JSON.parse(readFileSync(join(root, "java", "common", "src", "main", "resources", "data", "cobblemon", "moveset_builders", "wild.json"), "utf-8"));
    check("WILD_SLOTS is wild.json's four slots", JSON.stringify(WILD_SLOTS) === JSON.stringify([wild.slot1, wild.slot2, wild.slot3, wild.slot4]), JSON.stringify(WILD_SLOTS));
    const learnset = [[1, "tackle"], [1, "growl"], [7, "ember"], [12, "smokescreen"], [17, "dragonbreath"], [20, "scaryface"]];
    const built = buildMoveset(WILD_SLOTS, { learnset, level: 20, moves: D.MOVES }, () => 0);
    check("slot 1 the last offensive move, slots 2 to 4 the last level-up moves", built.join() === "dragonbreath,scaryface,smokescreen,ember", built.join());
    const at = M.movesAt({ learnset }, 20);
    check("movesAt is that builder", at[0] === "dragonbreath" && at.length === 4 && at.includes("scaryface"), at.join());
    check("Tackle when nothing is learnt by the level (Moves.getExceptional)", M.movesAt({ learnset: [[10, "ember"]] }, 5).join() === "tackle");
    const t = id("Charmander"), e = entity(t, 0, { "cobblemon:level": 20 });
    const f = M.fighter(e), kept = JSON.parse(e.getDynamicProperty("cobblemon:moves") ?? "null");
    check("a wild spawn with only a level gets wild.json's moves and keeps them", Array.isArray(kept) && kept.join() === f.moves.map((m) => m.id).join() && MOVES_OFFENSIVE(f.moves[0].id), JSON.stringify(kept));
    check("the table's fallback moves follow wild.json too (Charmander at 5: Ember first)", D.POKEMON[t].moves[0] !== undefined && D.MOVES[D.POKEMON[t].moves[0]].category !== "Status", D.POKEMON[t].moves.join());
}
function MOVES_OFFENSIVE(m) { return D.MOVES[m]?.category !== "Status"; }

// the move table, from Showdown's moves.js
{
    const sp = D.MOVES.secretpower;
    check("Secret Power has no Sp. Atk drop of its own (only Misty Terrain's, in its code)", !sp.boosts && sp.secondary?.status === "par" && sp.secondary.chance === 30, JSON.stringify(sp));
    check("Tera Blast has no stat drop of its own (Stellar's is in its code)", !D.MOVES.terablast.boosts, JSON.stringify(D.MOVES.terablast));
    check("Curse's non-Ghost raise is left to its own case", !D.MOVES.curse.boosts);
    const ta = D.MOVES.triplearrows.secondaries ?? [];
    check("Triple Arrows has both secondaries: 50 percent Defense drop and 30 percent flinch", ta.length === 2 && ta[0].chance === 50 && ta[0].boosts?.def === -1 && ta[1].flinch && ta[1].chance === 30, JSON.stringify(ta));
    check("Mimic and Sketch target normal", D.MOVES.mimic.target === "normal" && D.MOVES.sketch.target === "normal", D.MOVES.mimic.target + " " + D.MOVES.sketch.target);
    check("the table still carries METRONOME_POOL, the defrost flag and Sheer Cold's Ice", Array.isArray(D.METRONOME_POOL) && D.METRONOME_POOL.length > 100 && D.MOVES.scald.flags.includes("defrost") && D.MOVES.sheercold.ohko === "Ice");
}

// Secret Power in battle: one 30 percent roll, paralysis outside a terrain, the terrain's effect in one
{
    const run = (terrain, roll) => {
        const random = Math.random; Math.random = () => roll;
        try {
            const a = M.fighter(entity(id("Rattata"), 0, { "cobblemon:level": 50, "cobblemon:moves": JSON.stringify(["secretpower"]) }));
            const d = M.fighter(entity(id("Snorlax"), 0, { "cobblemon:level": 50, "cobblemon:moves": JSON.stringify(["rest"]) }));
            const b = battle(a, d);
            if (terrain) b.terrain = { kind: terrain, turns: 5 };
            M.useMove(b, a, d, move("secretpower")); flush();
            return d;
        } finally { Math.random = random; }
    };
    const plain = run(null, 0.1);
    check("outside a terrain it paralyses and drops nothing", plain.status === "par" && plain.stages.spa === 0, `${plain.status} ${plain.stages.spa}`);
    const misty = run("misty", 0.1);
    check("in Misty Terrain it drops Sp. Atk and does not paralyse", misty.stages.spa === -1 && misty.status !== "par", `${misty.status} ${misty.stages.spa}`);
    const missed = run(null, 0.5);
    check("a roll past 30 percent does nothing", !missed.status && missed.stages.spa === 0, `${missed.status}`);
}
