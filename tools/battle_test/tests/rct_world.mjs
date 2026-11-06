// Radical Cobblemon Trainers in the world: the full series graph and its stepped level cap, a trainer's own record
// against a player (rematches), the cooldown growth, RCT's dialogue by context, the spawner's weights and biome rules,
// the Trainer Spawner's signature items and the gyms' display case geometry (scripts/rct_world.js and main.js)
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { M, check } from "../harness.mjs";
import { system } from "../stub_server.mjs";

// the harness copies the scripts to a temporary folder (an ES module package) and main.js imports its modules from
// there, so the same instances are read from the newest such copy, not from the scripts folder itself
const copy = readdirSync(tmpdir()).filter((d) => d.startsWith("cobblemon-battle-")).map((d) => join(tmpdir(), d)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const W = await import(pathToFileURL(join(copy, "rct_world.js")).href);
const { RCT_TRAINERS, RCT_TRAINER_IDS, RCT_TYPES, RCT_DIALOG, RCT_BIOMES, RCT_LOOT } = await import(pathToFileURL(join(copy, "rct_trainers.js")).href);
const { GYM_CASES, GYM_TRAINER_IDS, GYM_LEAGUE } = await import(pathToFileURL(join(copy, "gyms.js")).href);

// a stand-in player: its dynamic properties, a party of one Pokemon at a level
function player(series, defeats = {}, level = 10) {
    const store = new Map([["cobblemon:rct_series", series], ["cobblemon:rct_defeats", JSON.stringify(defeats)]]);
    return { id: "p1", name: "Tester", isValid: true, level, getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), sendMessage() { }, playSound() { } };
}
// a stand-in trainer entity: the property is the trainer's index, its record a dynamic property
function trainer(id) {
    const store = new Map(), n = RCT_TRAINER_IDS.indexOf(id);
    return { id: `npc-${id}`, typeId: "cobblemon:rct_trainer", isValid: true, nameTag: "", location: { x: 0, y: 64, z: 0 }, getProperty: () => n, setProperty() { },
        getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v)), triggerEvent() { } };
}
// main.js's hooks read the party through summaryParty, which the stub world cannot give; the level cap and the
// requirements need only the player, so gymCanBattle's party checks are driven through a party of our own
W.initRctWorld({ party: () => [], levelOf: () => 1, series: M.rctSeries, levelCap: M.rctLevelCap, unlocked: M.rctUnlocked, next: M.rctNext, canBattle: () => null, startBattle() { }, inBattle: () => false });

{
    const all = RCT_TRAINER_IDS.length, withTeams = RCT_TRAINER_IDS.filter((id) => RCT_TRAINERS[id].team.length).length;
    check("RCT's trainers are all in the table, nearly every one with a team", all > 1500 && withTeams > all - 10, `${withTeams} of ${all}`);
    check("the 14 gym trainers are among them", GYM_TRAINER_IDS.every((id) => RCT_TRAINERS[id]?.team.length > 0));
    check("a trainer with no series belongs to every series, a leader to its own", M.rctInSeries("leader_brock_019e", "radicalred") && !M.rctInSeries("leader_brock_019e", "bdsp")
        && RCT_TRAINER_IDS.some((id) => !RCT_TRAINERS[id].series.length && M.rctInSeries(id, undefined) && M.rctInSeries(id, "unbound")));
    check("Brock's Radical Gyms data: no natural spawning, three wins at most", RCT_TRAINERS.leader_brock_019e.swf === 0 && RCT_TRAINERS.leader_brock_019e.maxWins === 3);
    check("types carry RCT's names, symbols and colours", RCT_TYPES.leader.name === "Leader" && RCT_TYPES.leader.symbol === "[L]" && RCT_TYPES.leader.colour === "a" && RCT_TYPES.e4.colour === "3");
    check("a leader's name is green, a champion's purple", W.rctName("leader_brock_019e").startsWith("§aLeader Brock") && W.rctName("champion_terry_01b8").startsWith("§5"));
}
{
    // the series graph: the cap climbs in steps through Radical Red's key trainers, not leader to leader
    const fresh = player("radicalred");
    const cap0 = M.rctLevelCap(fresh), next0 = M.rctNext(fresh);
    check("a fresh Radical Red player faces Brock first, at the initial cap of 15", next0.includes("leader_brock_019e") && cap0 === 15, `${cap0} ${next0.join(",")}`);
    const afterBrock = player("radicalred", { leader_brock_019e: 1 });
    const cap1 = M.rctLevelCap(afterBrock), next1 = M.rctNext(afterBrock);
    check("after Brock the next key trainer is not Misty yet (Archer and the rival come first)", !next1.includes("leader_misty_019f") && next1.length > 0, next1.join(","));
    check("so the cap rises in a step below Misty's level", cap1 >= cap0 && cap1 < RCT_TRAINERS.leader_misty_019f.level, `${cap1} < ${RCT_TRAINERS.leader_misty_019f.level}`);
    check("Misty is unlocked once one of Terry's three first teams is beaten", !M.rctUnlocked(afterBrock, "leader_misty_019f") && M.rctUnlocked(player("radicalred", { leader_brock_019e: 1, rival_terry_014d: 1 }), "leader_misty_019f"));
    check("no cap outside a series or in Freeroam", M.rctLevelCap(player(undefined)) === 100 && M.rctLevelCap(player("freeroam")) === 100);
    const graph = M.rctGraph("radicalred"), everyone = player("radicalred", Object.fromEntries(graph.map((id) => [id, 1])));
    check("the series is done once every key trainer is beaten, and the cap is 100", graph.length > 14 && !M.rctSeriesDone(fresh) && M.rctSeriesDone(everyone) && M.rctLevelCap(everyone) === 100, String(graph.length));
    check("bdsp and unbound have graphs of their own", M.rctGraph("bdsp").length > 5 && M.rctGraph("unbound").length > 5 && !M.rctGraph("bdsp").includes("leader_brock_019e"));
    // the three Champion Terry teams are siblings (one group of a later requirement), so beating one counts for the others
    check("Terry is key only once the Elite Four are beaten", !M.rctIsKey(fresh, "champion_terry_01b8") && M.rctIsKey(player("radicalred", Object.fromEntries(graph.filter((id) => !id.startsWith("champion_terry")).map((id) => [id, 1]))), "champion_terry_01b8"));
}
{
    // TrainerMob.canBattleAgainst as the port asks it: the entity's own record, the series, the requirements
    const brock = trainer("leader_brock_019e"), p = player("radicalred");
    check("a trainer in no series refuses with wrong_series", M.gymCanBattle(player(undefined), brock) === "wrong_series");
    check("Misty names the leader requirement first", M.gymCanBattle(player("radicalred"), trainer("leader_misty_019f")).startsWith("missing_required_trainer"));
    W.addRecord(brock, p, 0, 1);
    check("a trainer beaten by the player (its own record) says trainer_lost", M.gymCanBattle(p, brock) === "trainer_lost" && W.record(brock, p)[1] === 1);
    const fresh = trainer("leader_brock_019e");
    check("a fresh Brock, called back by the button, battles a player who beat another", M.gymCanBattle(p, fresh) !== "trainer_lost" && M.gymCanBattle(p, fresh) !== "wrong_series");
    W.addRecord(fresh, p, 3, 0);
    check("three wins over the player (Radical Gyms' maxTrainerWins) and it says trainer_won", M.gymCanBattle(p, fresh) === "trainer_won");
    const agatha = trainer("elite_four_agatha_0054"), done = player("radicalred", Object.fromEntries(M.rctGraph("radicalred").filter((id) => !id.startsWith("champion")).map((id) => [id, 1])));
    // the stub player has no party, so the answer here is missing_pokemon, past the record, series and requirement checks
    check("Agatha's rematch team can still be fought once her first was beaten", M.gymCanBattle(done, agatha) === "missing_pokemon", String(M.gymCanBattle(done, agatha)));
    check("every refusal has RCT's lines to speak", ["trainer_busy", "trainer_lost", "trainer_won", "on_cooldown", "player_busy", "wrong_series", "missing_required_trainer_leader", "over_level_cap", "missing_pokemon", "on_battle_start", "on_battle_won", "on_battle_lost"].every((c) => RCT_DIALOG[c]?.length >= 16));
    check("rctLine draws one of them", RCT_DIALOG.on_battle_start.includes(W.rctLine("on_battle_start", "x")) && W.rctLine("no_such_context", "fallback") === "fallback");
}
{
    // TrainerMob.finishBattle: the rest grows with each battle in a row and wears off afterwards
    const npc = trainer("leader_erika_01a1"), p = player("radicalred", { leader_brock_019e: 1 });
    const battle = { gym: { npc, won: true, id: "leader_erika_01a1" }, player: p, doubles: false, foe: {} };
    system.currentTick = 1000;
    M.gymEnded(battle);
    check("after one battle the trainer rests 240 ticks", M.gymCanBattle(p, npc) === "on_cooldown" && (system.currentTick = 1239, M.gymCanBattle(p, npc) === "on_cooldown") && (system.currentTick = 1240, M.gymCanBattle(p, npc) !== "on_cooldown"));
    system.currentTick = 1240; M.gymEnded(battle);   // straight away again: 240 + the extra 240
    system.currentTick = 1240 + 479;
    const stillResting = M.gymCanBattle(p, npc) === "on_cooldown";
    system.currentTick = 1240 + 480;
    check("the next battle in a row rests 480, the extra carried over", stillResting && M.gymCanBattle(p, npc) !== "on_cooldown");
    system.currentTick = 1240 + 480 + 10000;   // long after: the extra has worn off
    M.gymEnded(battle); system.currentTick += 241;
    check("the extra wears off a tick at a time once the rest is over", M.gymCanBattle(p, npc) !== "on_cooldown");
    const lost = { gym: { npc: trainer("leader_koga_01a2"), won: false, id: "leader_koga_01a2" }, player: p, doubles: false, foe: {} };
    M.gymEnded(lost);
    check("a battle the player lost is a win on the trainer's record", W.record(lost.gym.npc, p)[0] === 1);
    system.currentTick = 0;
}
{
    // TrainerSpawner's numbers
    const brock = RCT_TRAINERS.leader_brock_019e, generic = RCT_TRAINER_IDS.map((id) => RCT_TRAINERS[id]).find((t) => !t.series.length && t.swf === 1 && t.team.length);
    check("a key trainer at the player's level weighs 64 times its factor", Math.abs(W.spawnWeight({ ...generic, level: 20 }, true, 20) - 26 * 64) < 1e-9);
    // at player level 20 the allowance is max(4, 25 * 20 / 100) = 5 levels either way
    check("a trainer too far in level weighs nothing, the allowance scaling with the player's level (never under 4)", W.spawnWeight({ ...generic, level: 30 }, false, 20) === 0 && W.spawnWeight({ ...generic, level: 25 }, false, 20) > 0 && W.spawnWeight({ ...generic, level: 26 }, false, 20) === 0
        && W.spawnWeight({ ...generic, level: 9 }, false, 5) > 0 && W.spawnWeight({ ...generic, level: 10 }, false, 5) === 0);
    check("Brock's weight factor of 0 keeps him out of the wild", W.spawnWeight(brock, true, 14) === 0);
    check("the direct spawn chance is 0.42 for a key trainer at level, a quarter of it otherwise", Math.abs(W.spawnChance({ ...generic, level: 20 }, true, 20) - 0.42) < 1e-9 && Math.abs(W.spawnChance({ ...generic, level: 20 }, false, 20) - 0.105) < 1e-9);
    check("biome tags map to Bedrock biomes: a mountain trainer spawns in jagged peaks, not in the Nether", W.biomeOk(brock, "minecraft:jagged_peaks") && !W.biomeOk(brock, "minecraft:nether_wastes") && !W.biomeOk(brock, "minecraft:plains"));
    check("a trainer with no whitelist spawns anywhere not blacklisted", W.biomeOk({ biomes: [], noBiomes: ["is_nether"] }, "minecraft:plains") && !W.biomeOk({ biomes: [], noBiomes: ["is_nether"] }, "minecraft:crimson_forest"));
    check("RCT_BIOMES knows the tags the trainers use", ["is_plains", "is_cold", "is_end", "has_structure/end_city", "is_peak"].every((t) => RCT_BIOMES[t]?.length > 0) && RCT_BIOMES.is_peak.includes("minecraft:stony_peaks"));
    check("a trainer with no series spawns for a player in any series or none", W.inSeries(generic, undefined) && W.inSeries(generic, "bdsp") && !W.inSeries(brock, undefined) && W.inSeries(brock, "radicalred"));
    // Radical Gyms' own leader files carry no signature item, so the gym leaders cannot be attuned; Terry and the rest can
    check("signature items attune the Trainer Spawner: Terry's is a Life Orb, the gym leaders have none", RCT_TRAINERS.champion_terry_01b8.sig === "cobblemon:life_orb" && RCT_TRAINERS.leader_brock_019e.sig === null && RCT_TRAINER_IDS.filter((id) => RCT_TRAINERS[id].sig).length > 100);
}
{
    // the gyms' display cases: the template's door-to-spot line turned onto the world's
    const n = GYM_TRAINER_IDS.indexOf("leader_brock_019e"), g = GYM_CASES[String(n)];
    check("Pewter's template knows its door, spot, size and the Metal Coat in its case", g && g.cases.length === 1 && g.cases[0][3] === "cobblemon:metal_coat" && g.size[0] === 25);
    const ex = 100, ez = 200, dt = [g.spot[0] - g.entrance[0], g.spot[2] - g.entrance[2]];
    const asIs = W.gymTransform(n, { x: ex + dt[0], y: 70, z: ez + dt[1] }, { x: ex, y: 70, z: ez });
    check("a building placed as its template was maps its case straight", asIs && asIs.cases[0][0].x === ex + (g.cases[0][0] - g.entrance[0]) && asIs.cases[0][0].z === ez + (g.cases[0][2] - g.entrance[2]));
    const turned = W.gymTransform(n, { x: ex - dt[1], y: 70, z: ez + dt[0] }, { x: ex, y: 70, z: ez });   // a quarter turn
    check("a building turned a quarter maps its case with it", turned && turned.cases[0][0].x === ex - (g.cases[0][2] - g.entrance[2]) && turned.cases[0][0].z === ez + (g.cases[0][0] - g.entrance[0]));
    check("and its box spans 25 by 26 blocks around", asIs.box[3] - asIs.box[0] === 24 && asIs.box[5] - asIs.box[2] === 25 && turned.box[3] - turned.box[0] === 25);
    check("a line that is no rotation of the template's is refused", W.gymTransform(n, { x: ex + 3, y: 70, z: ez + 3 }, { x: ex, y: 70, z: ez }) === undefined);
    check("the League keeps its seven cases of medicine and its shop of 20 offers in emeralds", GYM_LEAGUE.cases.length === 7 && GYM_LEAGUE.shop.length === 20 && GYM_LEAGUE.shop.every(([id, price]) => id.startsWith("cobblemon:") && price >= 1)
        && GYM_LEAGUE.shop.some(([id]) => id === "cobblemon:max_elixir"));
}
{
    // the loot's defeat_count condition: an entry for the first defeat only
    const tables = Object.entries(RCT_LOOT.tables).filter(([, pools]) => pools.some((p) => p.entries.some((e) => e.d)));
    check("RCT's loot carries defeat_count conditions", tables.length > 0, tables.map(([t]) => t).join(" "));
    const [table] = tables[0] ?? [];
    if (table) {
        const random = Math.random; Math.random = () => 0;
        const first = M.rollRctLoot(table, 60, 0, [], 1), third = M.rollRctLoot(table, 60, 0, [], 3);
        Math.random = random;
        const gated = RCT_LOOT.tables[table].flatMap((p) => p.entries).filter((e) => e.d).map((e) => e.i);
        check("the gated item drops on the first defeat and not the third", first.some(([i]) => gated.includes(i)) && !third.some(([i]) => gated.includes(i)), `${first.map((d) => d[0])} | ${third.map((d) => d[0])}`);
    }
}
