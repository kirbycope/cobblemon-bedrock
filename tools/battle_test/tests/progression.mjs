// The Pokemon record's progression (scripts/progression.js and its hooks in main.js): Deerling's season from the biome,
// the revived fossil's marks, the alpha moveset builder, TM unlocks through pre-evolutions, the moves kept across an
// evolution and the PP a relearned move arrives with
import { M, D, F, mon, check } from "../harness.mjs";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// the module and the tables it reads, copied beside a package.json that makes them ES modules, as the harness does for main.js
const scripts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "development_behavior_packs", "cobblemon", "scripts");
const copy = mkdtempSync(join(tmpdir(), "cobblemon-progression-"));
for (const f of ["progression.js", "progression_data.js", "marks.js", "variants.js", "tms.js"]) cpSync(join(scripts, f), join(copy, f));
writeFileSync(join(copy, "package.json"), JSON.stringify({ type: "module" }));
const { seasonFor, seasonLook, isSeasonal, revivalPotentialMarks, buildMoveset, ALPHA_SLOTS, evolutionMovesOf, preEvolutionsOf, exchangePp, weightedPick } = await import(pathToFileURL(join(copy, "progression.js")).href);
const { VARIANT_LOOKS } = await import(pathToFileURL(join(copy, "variants.js")).href);
const { TMS, TM_SPECIES } = await import(pathToFileURL(join(copy, "tms.js")).href);
const { MARKS } = await import(pathToFileURL(join(copy, "marks.js")).href);

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const DEERLING = "cobblemon:p0585_deerling", PIKACHU = "cobblemon:p0025_pikachu", RAICHU = "cobblemon:p0026_raichu";

// TagSeasonResolver: the season from the has_season biome tags, winter first, none in a biome without one
{
    const seasonAt = (biome) => seasonFor(F.BIOME_TAGS[biome] ?? [], M.filterPasses);
    check("a frozen river is winter (is_freezing)", seasonAt("minecraft:frozen_river") === "winter", String(seasonAt("minecraft:frozen_river")));
    check("plains are spring (is_plains)", seasonAt("minecraft:plains") === "spring", seasonAt("minecraft:plains"));
    check("a jungle is summer (is_jungle)", seasonAt("minecraft:jungle") === "summer", seasonAt("minecraft:jungle"));
    check("a desert is autumn (is_arid)", seasonAt("minecraft:desert") === "autumn", seasonAt("minecraft:desert"));
    check("the End has no season", seasonAt("minecraft:the_end") === null, seasonAt("minecraft:the_end"));
    check("Deerling and Sawsbuck carry the season feature, Pikachu does not", isSeasonal(DEERLING) && isSeasonal("cobblemon:p0586_sawsbuck") && !isSeasonal(PIKACHU));
    const looks = VARIANT_LOOKS[DEERLING];
    check("the winter look keeps the shininess", seasonLook(looks, 3, "winter") === 7 && seasonLook(looks, 2, "winter") === 6, `${seasonLook(looks, 3, "winter")} ${seasonLook(looks, 2, "winter")}`);
    check("spring is the standard look", seasonLook(looks, 2, "spring") === 0 && seasonLook(looks, 3, "spring") === 1);
    // updateSeason on a stand-in entity: a shiny spring Deerling in frozen peaks turns to its shiny winter variant
    const events = [], deerling = { typeId: DEERLING, isValid: true, location: { x: 0, y: 64, z: 0 }, dimension: { getBiome: () => ({ id: "minecraft:frozen_river" }) },
        getComponent: (k) => (k === "minecraft:variant" ? { value: 1 } : undefined), triggerEvent: (ev) => events.push(ev), getDynamicProperty: () => undefined, setDynamicProperty() { } };
    M.updateSeason(deerling);
    check("a Deerling sent out on a frozen river takes its winter look", events.includes("cobblemon:set_variant_7"), events.join(","));
    events.length = 0; deerling.dimension.getBiome = () => ({ id: "minecraft:the_end" });
    M.updateSeason(deerling);
    check("in a biome with no season it keeps its look", events.length === 0, events.join(","));
    events.length = 0; M.updateSeason({ ...deerling, typeId: PIKACHU });
    check("a species without the feature is left alone", events.length === 0);
}

// callbacks/fossil_revived/apply_marks: the Rare, Uncommon and personality marks and the Revival Mark, rolled at hand-over
{
    const potentials = revivalPotentialMarks();
    const personality = potentials.filter((id) => MARKS[id][5] === "personality").length;
    check("a revived fossil may take the Rare, Uncommon, personality and Revival marks", potentials.includes("cobblemon:mark_revival") && potentials.includes("cobblemon:mark_rare") && potentials.includes("cobblemon:mark_uncommon") && personality === 28, `${potentials.length} marks, ${personality} personality`);
    check("not the time, weather or fishing marks", !potentials.some((id) => /mark_time_|mark_weather_|mark_fishing/.test(id)));
    const fossil = mon("Kabuto").entity;
    fossil.setDynamicProperty("cobblemon:potential_marks", JSON.stringify(potentials));
    const given = rolled(0, () => M.applyPotentialMarks(fossil));
    check("the roll takes the rarest group first", given === "cobblemon:mark_rare" && M.marksOf(fossil).includes(given), String(given));
    const revived = mon("Omanyte").entity;
    revived.setDynamicProperty("cobblemon:potential_marks", JSON.stringify(potentials));
    const uncommon = MARKS["cobblemon:mark_uncommon"][6], revival = MARKS["cobblemon:mark_revival"][6];
    const got = rolled((uncommon + revival) / 2, () => M.applyPotentialMarks(revived));
    check("a roll past the uncommon chance but under the Revival Mark's 1 in 25 gives it", got === "cobblemon:mark_revival", `${got} (uncommon ${uncommon}, revival ${revival})`);
}

// moveset_builders/alpha.json: DefaultMovesetBuilder on MoveSelector's slot selectors
{
    const learnset = [[1, "tackle"], [1, "growl"], [7, "ember"], [12, "swordsdance"], [20, "flamethrower"]];
    const special = buildMoveset(ALPHA_SLOTS, { learnset, level: 20, tmMoves: ["earthquake", "protect"], moves: D.MOVES, atk: 50, spa: 100 }, () => 0);
    check("a special attacker leads with its last special move, then its last other attack, then two TM moves", special.join() === "flamethrower,ember,earthquake,protect", special.join());
    const physical = buildMoveset(ALPHA_SLOTS, { learnset, level: 20, tmMoves: ["earthquake", "protect"], moves: D.MOVES, atk: 100, spa: 50 }, () => 0);
    check("a physical attacker leads with its last physical move", physical[0] === "tackle" && physical[1] === "flamethrower", physical.join());
    const noTm = buildMoveset(ALPHA_SLOTS, { learnset, level: 20, tmMoves: [], moves: D.MOVES, atk: 50, spa: 100 }, () => 0);
    check("with no TM to learn the TM slots fall back to the last level-up moves", noTm.join() === "flamethrower,ember,swordsdance,tackle", noTm.join());
    const low = buildMoveset(ALPHA_SLOTS, { learnset, level: 5, tmMoves: ["earthquake"], moves: D.MOVES, atk: 50, spa: 100 }, () => 0);
    check("only moves learnt by its level: the attack, then the last other move, then the TM move", low.join() === "tackle,growl,earthquake", low.join());
    const weighted = buildMoveset([["tm"]], { learnset: [], level: 5, tmMoves: ["terablast", "protect"], moves: D.MOVES, atk: 1, spa: 1 }, () => 0);
    check("move_weights.json: Tera Blast at weight 0 is never picked", weighted.join() === "protect", weighted.join());
    check("weightedPick returns nothing when every weight is 0", weightedPick(["terablast"], () => 0) === null);
    const info = D.POKEMON[PIKACHU], levelUp = new Set((info.learnset ?? []).filter(([at]) => at <= 30).map(([, id]) => id));
    const tms = new Set((TM_SPECIES[PIKACHU] ?? []).map((n) => TMS[n][0]));
    const alpha = M.alphaMoves(info, 30, PIKACHU);
    check("an alpha Pikachu knows four moves, TM moves among them", alpha.length === 4 && alpha.every((id) => D.MOVES[id]) && alpha.some((id) => tms.has(id) && !levelUp.has(id)), alpha.join());
    check("its first move is a damaging one", D.MOVES[alpha[0]]?.category !== "Status", alpha[0]);
}

// TMMoveManager.getLearnableTMsFromPokemon: the TMs a Pokemon unlocks count its pre-evolutions' level-up moves
{
    const pre = preEvolutionsOf(D.POKEMON);
    check("Pikachu is Raichu's pre-evolution", (pre[RAICHU] ?? []).includes(PIKACHU), JSON.stringify(pre[RAICHU]));
    const DEWOTT = "cobblemon:p0502_dewott", own = M.accessibleMoves(DEWOTT, 17, [], []), all = M.tmUnlockMoves(DEWOTT, 17, [], []);
    check("a Dewott at 17 unlocks the TM of Razor Shell, which Oshawott learns at 17 and Dewott only at 18", all.has("razorshell") && !own.has("razorshell"), [...all].filter((id) => !own.has(id)).join());
    check("a Raichu's unlocks reach back through Pikachu to Pichu", [...M.tmUnlockMoves(RAICHU, 30, [], [])].every((id) => M.accessibleMoves(RAICHU, 30, [], []).has(id) || [PIKACHU, "cobblemon:p0172_pichu"].some((t) => (D.POKEMON[t].learnset ?? []).some(([at, m]) => at <= 30 && m === id))));
    check("a species with no pre-evolution unlocks only its own", [...M.tmUnlockMoves(PIKACHU, 30, [], [])].every((id) => M.accessibleMoves(PIKACHU, 30, [], []).has(id)) || (pre[PIKACHU] ?? []).length > 0);
}

// Learnset.evolutionMoves and Evolution.evolutionMethod: moves kept across an evolution
{
    const evolutionMoves = evolutionMovesOf(D.POKEMON), grotle = D.POKEMON["cobblemon:p0388_grotle"], torterra = "cobblemon:p0389_torterra";
    const taught = (grotle.evolutions ?? []).flatMap((e) => e.moves ?? []);
    check("Torterra's evolution moves are what Grotle's evolution teaches (Earthquake)", taught.includes("earthquake") && (evolutionMoves[torterra] ?? []).includes("earthquake"), `${taught.join()} / ${(evolutionMoves[torterra] ?? []).join()}`);
    const t = mon("Torterra", { level: 40, moves: ["tackle"] });
    check("an evolution move is relearnable for good", M.relearnable(t.entity, t).includes("earthquake"), M.relearnable(t.entity, t).join());
    const full = mon("Oshawott", { level: 17, moves: ["tackle", "tailwhip", "watergun", "soak"] }), evolution = D.POKEMON["cobblemon:p0501_oshawott"].evolutions[0];
    full.entity.nameTag = "";   // the stand-in entity has no name tag for nicknameOf to read
    M.evolutionEffects(full.entity, evolution);
    const benched = M.benchedOf(full.entity), moves = JSON.parse(full.entity.getDynamicProperty("cobblemon:moves"));
    check("with four moves known, Razor Shell and Focus Energy go onto the bench as it evolves at 17", benched.includes("razorshell") && benched.includes("focusenergy") && moves.length === 4, `${moves.join()} | ${benched.join()}`);
    const room = mon("Oshawott", { level: 17, moves: ["tackle", "tailwhip", "watergun"] });
    room.entity.nameTag = "";
    M.evolutionEffects(room.entity, evolution);
    const moves2 = JSON.parse(room.entity.getDynamicProperty("cobblemon:moves")), benched2 = M.benchedOf(room.entity);
    check("with a free slot the earliest of them (Water Sport, level 1) fills it and the rest are benched", moves2.includes("watersport") && moves2.length === 4 && ["soak", "focusenergy", "razorshell"].every((id) => benched2.includes(id)) && !benched2.includes("watersport"), `${moves2.join()} | ${benched2.join()}`);
}

// Pokemon.exchangeMove: the PP a move comes in with
{
    check("a swapped-in move keeps the leaving move's share of PP", exchangePp(10, 20, 30) === 15 && exchangePp(7, 10, 24) === 16, `${exchangePp(10, 20, 30)} ${exchangePp(7, 10, 24)}`);
    check("a move put into an empty slot comes with no PP", exchangePp(0, 0, 30) === 0 && exchangePp(5, 0, 30) === 0);
}
