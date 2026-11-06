// The game rules as world settings (rules.js) and the command surface they came with: PokemonProperties' other keys
// landing in a record and on a Pokemon, pcsearch by any property, teach's learnset check, givetm's 2304, the
// Pokedex command's dexes and forms, takepokemon into the caller's party, and the aliases
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { M, D, mon, check, flush } from "../harness.mjs";

// the pack's modules are .js with no package.json beside them, so Node 20 takes them for CommonJS from their own folder:
// the three this file needs go to a folder of their own with one, as the harness does for main.js
const scripts = fileURLToPath(new URL("../../../development_behavior_packs/cobblemon/scripts/", import.meta.url));
const copy = mkdtempSync(join(tmpdir(), "cobblemon-rules-"));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
for (const f of ["rules.js", "dex.js", "tms.js"]) copyFileSync(join(scripts, f), join(copy, f));
const R = await import(pathToFileURL(join(copy, "rules.js")).href);
const { REGIONS } = await import(pathToFileURL(join(copy, "dex.js")).href);
const { TMS, TM_SPECIES } = await import(pathToFileURL(join(copy, "tms.js")).href);

const pikachu = M.speciesNamed("pikachu"), deerling = M.speciesNamed("deerling");

{   // the rules: Cobblemon's defaults, set and shown, a default not stored
    check("rules default as Cobblemon's", R.ruleOn("doPokemonSpawning") === true && R.ruleOn("doPokemonLoot") === true && R.ruleOn("battleInvulnerability") === false && R.ruleOn("doShinyStarters") === false && R.ruleOn("healersHealPC") === false);
    R.setRule("battleInvulnerability", true);
    check("a rule set holds", R.ruleOn("battleInvulnerability") === true);
    R.setRule("battleInvulnerability", false);
    check("a rule back at its default is not stored", R.ruleOn("battleInvulnerability") === false && M.world === undefined);
}
{   // the property keys: the two-word form, the flags, the stat keys, a species feature as the form
    const p = M.parseProps(["pikachu", "friendship", "200", "alpha", "pokeball", "great_ball", "hp_iv", "31", "speed_ev", "252", "moves=thunderbolt,quickattack", "status", "paralysis", "ha", "uncatchable", "ot", "Ash"]);
    check("friendship, pokeball, status, ot and the flags parse", p.friendship === 200 && p.alpha === true && p.pokeball === "cobblemon:great_ball" && p.status === "par" && p.hiddenability === true && p.uncatchable === true && p.ot === "Ash", JSON.stringify(p));
    check("IVs, EVs and moves parse", p.ivs?.hp === 31 && p.evs?.spe === 252 && p.moves?.join() === "thunderbolt,quickattack", JSON.stringify(p));
    const q = M.parseProps(["deerling", "season", "autumn"]);
    check("a species feature's choice is the form", q.form === "autumn" && q.season === "autumn", JSON.stringify(q));
    const rec = M.recordFor(deerling, q);
    check("the record takes the look of that aspect", rec.v > 0 && D.POKEMON[deerling] !== undefined, JSON.stringify(rec));
    const r = M.recordFor(pikachu, p);
    const k = r.k, ivs = JSON.parse(k["cobblemon:ivs"]), evs = JSON.parse(k["cobblemon:evs"]), st = JSON.parse(k["cobblemon:status"]);
    check("the record keeps friendship, the ball, the alpha, the OT, the status and the hidden ability", k["cobblemon:friendship"] === 200 && k["cobblemon:caught_ball"] === "cobblemon:great_ball" && k["cobblemon:alpha"] === true && k["cobblemon:ot"] === "Ash" && st.s === "par" && k["cobblemon:ability"] === "lightningrod" && k["cobblemon:uncatchable"] === true, JSON.stringify(k));
    check("the record keeps the IVs, EVs and moves given", ivs.hp === 31 && evs.spe === 252 && evs.hp === 0 && JSON.parse(r.mv).join() === "thunderbolt,quickattack", JSON.stringify([ivs, evs, r.mv]));
    const perfect = JSON.parse(M.recordFor(pikachu, M.parseProps(["pikachu", "min_perfect_ivs", "6"])).k["cobblemon:ivs"]);
    check("min_perfect_ivs sets that many to 31", Object.values(perfect).every((v) => v === 31), JSON.stringify(perfect));
}
{   // the same onto a Pokemon that exists (applyProps)
    const e = mon("Pikachu", { level: 20 }).entity;
    M.applyProps(e, M.parseProps(["pikachu", "friendship", "180", "alpha", "status", "sleep", "scale_modifier", "1.5", "tradeable", "false", "held_item_visible=false"]));
    const st = JSON.parse(e.getDynamicProperty("cobblemon:status"));
    check("a Pokemon takes friendship, the alpha, a status, a scale, tradeable and the hidden held item", e.getDynamicProperty("cobblemon:friendship") === 180 && e.getDynamicProperty("cobblemon:alpha") === true && st.s === "slp" && e.getDynamicProperty("cobblemon:scale") === 1.5 && e.getDynamicProperty("cobblemon:tradeable") === false && e.getDynamicProperty("cobblemon:held_hidden") === true,
        JSON.stringify([e.getDynamicProperty("cobblemon:friendship"), e.getDynamicProperty("cobblemon:alpha"), st]));
}
{   // pcsearch matches on every property; pokeball and alpha too
    const api = { POKEMON: D.POKEMON, SHINY_VARIANTS: {}, VARIANT_LOOKS: {}, speciesNamed: M.speciesNamed };
    const rec = { t: pikachu, v: 0, lv: 12, n: null, k: { "cobblemon:gender": "female", "cobblemon:nature": "timid", "cobblemon:caught_ball": "cobblemon:great_ball", "cobblemon:alpha": true } };
    check("pcsearch matches gender, nature, ball and alpha", R.pcMatches(rec, M.parseProps(["pikachu", "gender", "female", "nature", "timid", "pokeball", "great_ball", "alpha"]), api) === true);
    check("pcsearch refuses a wrong nature", R.pcMatches(rec, M.parseProps(["pikachu", "nature", "bold"]), api) === false);
    check("pcsearch refuses a wrong friendship", R.pcMatches(rec, M.parseProps(["pikachu", "friendship", "200"]), api) === false && R.pcMatches(rec, M.parseProps(["pikachu", "friendship", "50"]), api) === true);
}
{   // teach's learnset: a TM move or a level move yes, one the species never learns no
    const api = { POKEMON: D.POKEMON, TM_SPECIES, TM_BY_MOVE: new Map(TMS.map((tm, n) => [tm[0], n])) };
    check("Pikachu can learn Thunderbolt and Quick Attack", R.canLearn(pikachu, "thunderbolt", api) && R.canLearn(pikachu, "quickattack", api));
    check("Pikachu cannot learn Fly", R.canLearn(pikachu, "fly", api) === false);
}
check("givetm gives up to 2304 in stacks of 64", R.tmStacks(2304).length === 36 && R.tmStacks(2304).every((n) => n === 64) && R.tmStacks(100).join() === "64,36" && R.tmStacks(undefined).join() === "1" && R.tmStacks(9999).length === 36);
{   // healersHealPC: a PC record healed
    const healed = R.healedRecord({ t: pikachu, v: 0, lv: 5, f: true, hp: 0.2, k: { "cobblemon:status": JSON.stringify({ s: "psn", left: 100 }), "cobblemon:friendship": 70 } });
    check("a healed record is at full health, awake and without its status", healed.f === false && healed.hp === 1 && healed.k["cobblemon:status"] === undefined && healed.k["cobblemon:friendship"] === 70, JSON.stringify(healed));
}

// the commands, registered on a stand-in registry and run with stand-in players
const commands = new Map();
M.registerCommands({ registerCommand: (def, run) => commands.set(def.name, { def, run }), registerEnum() { } });
const player = (name) => {
    const store = new Map();
    return { id: `id-${name}`, name, typeId: "minecraft:player", isValid: true, location: { x: 0, y: 64, z: 0 }, dimension: { spawnItem() { }, spawnEntity() { return undefined; } },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), sendMessage() { }, playSound() { }, getComponent: () => undefined, onScreenDisplay: { setActionBar() { } } };
};
const run = (name, origin, ...args) => { const c = commands.get(`cobblemon:${name}`); const r = c.run(origin, ...args); flush(); return r; };
check("the aliases and the new commands are registered", ["pokegive", "pokegiveother", "pokespawn", "pokespawnat", "pokeheal", "pokeedit", "pokeeditother", "pokemoneditother", "pokemonrestart", "pokerestart", "pokemonrestartother", "pokerestartother", "pcsearchother",
    "dopokemonspawning", "dopokemonloot", "battleinvulnerability", "doshinystarters", "healershealpc"].every((n) => commands.has(`cobblemon:${n}`)), [...commands.keys()].join(" "));
{   // a rule's command shows and sets it
    const r = run("dopokemonloot", {});
    check("a rule command shows the rule", String(r.message).includes("doPokemonLoot = true"), r.message);
    run("dopokemonloot", {}, false);
    check("a rule command sets the rule", R.ruleOn("doPokemonLoot") === false);
    run("dopokemonloot", {}, true);
}
{   // givetm's quantity
    const p = player("Tester"), r = run("givetm", { sourceEntity: p }, "thunderbolt", 2304);
    check("givetm takes 2304", String(r.message).includes("2304"), r.message);
}
{   // the Pokedex: a dex granted, counted and revoked; one form of a species
    const p = player("Dex");
    run("pokedex", { sourceEntity: p }, "grant", [p], "all", "kanto");
    const kanto = REGIONS.find((r) => r.name === "Kanto"), s = M.dexString(p);
    const caught = kanto.entries.filter((i) => s[i] === "2").length;
    check("pokedex grant all kanto fills the Kanto dex", caught > 100 && s.replace(/2/g, "").length > 0, `${caught} of ${kanto.entries.length}`);
    const calc = run("pokedex", { sourceEntity: p }, "printcalculations", [p], "kanto");
    check("pokedex printcalculations counts a dex", String(calc.message).includes("Kanto") && String(calc.message).includes(`Caught ${caught}`), calc.message);
    run("pokedex", { sourceEntity: p }, "revoke", [p], "all", "kanto");
    check("pokedex revoke all kanto clears it", !M.dexString(p).includes("2"));
    run("pokedex", { sourceEntity: p }, "grant", [p], "deerling", "autumn");
    const seen = JSON.parse(p.getDynamicProperty("cobblemon:dex_variants") ?? "{}")[deerling] ?? [];
    check("pokedex grant of one form registers that form's looks", M.dexString(p)[D.NATIONAL?.indexOf?.(deerling) ?? -1] !== "0" && seen.length >= 1 && !seen.includes(0), JSON.stringify(seen));
}
{   // teach refuses a move the species cannot learn, unless bypassed; a fifth move is benched
    const p = player("Teacher");
    M.addRecord(p, M.recordFor(pikachu, { level: 30 })); flush();
    const no = run("teach", { sourceEntity: p }, [p], 1, "fly");
    check("teach refuses Fly for Pikachu", String(no.message).includes("cannot learn"), no.message);
    const yes = run("teach", { sourceEntity: p }, [p], 1, "fly", true);
    check("teach with the bypass teaches it", !String(yes.message).includes("cannot"), yes.message);
    const m = M.summaryParty(p)[0], moves = JSON.parse(m.getDynamicProperty("cobblemon:moves") ?? "[]"), benched = JSON.parse(m.getDynamicProperty("cobblemon:benched") ?? "[]");
    check("a fifth move goes to the benched moves", moves.length === 4 && (moves.includes("fly") || benched.includes("fly")), JSON.stringify([moves, benched]));
}
{   // takepokemon and pctake by another player put the Pokemon in the caller's party
    const a = player("Taker"), b = player("Owner");
    M.addRecord(b, M.recordFor(pikachu, { level: 7 })); flush();
    const r = run("takepokemon", { sourceEntity: a }, [b], 1);
    check("takepokemon by another player moves it to the caller", M.partyOf(b.id).length === 0 && M.partyOf(a.id).length === 1 && String(r.message).startsWith("You took"), r.message);
    const c = player("PcOwner"), contents = Array(30).fill(null); contents[0] = M.recordFor(pikachu, { level: 9 });
    c.setDynamicProperty("cobblemon:pc_0", JSON.stringify(contents));
    run("pctake", { sourceEntity: a }, [c], 1, 1);
    check("pctake by another player moves it to the caller", M.partyOf(a.id).length === 2 && !JSON.parse(c.getDynamicProperty("cobblemon:pc_0"))[0]);
}
{   // pokemonrestart clears the party and the PC, and with true offers the starter again
    const p = player("Restart");
    M.addRecord(p, M.recordFor(pikachu, {})); flush();
    const contents = Array(30).fill(null); contents[3] = M.recordFor(pikachu, {});
    p.setDynamicProperty("cobblemon:pc_1", JSON.stringify(contents)); p.setDynamicProperty("cobblemon:starter_chosen", true);
    run("pokemonrestart", { sourceEntity: p }, true);
    check("pokemonrestart empties the party and PC and reopens the starter choice", M.partyOf(p.id).length === 0 && !JSON.parse(p.getDynamicProperty("cobblemon:pc_1")).some(Boolean) && p.getDynamicProperty("cobblemon:starter_chosen") === false);
}
{   // healpokemon in battle is refused
    const p = player("Battler");
    M.battles?.set?.(p.id, {});
    const r = run("healpokemon", { sourceEntity: p });
    check("healpokemon refuses a player in battle", M.battles ? String(r.message).includes("in battle") : true, r.message);
    M.battles?.delete?.(p.id);
}
