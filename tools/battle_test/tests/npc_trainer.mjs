// Cobblemon's NPC trainer: its party drawn as PoolPartyProvider draws it, and StrongBattleAI's choices
import { M, mon, battle, check } from "../harness.mjs";

const preset = {
    skill: 5, min: 4, max: 6, isStatic: true, cooldown: 5, pool: [
        { entity: "cobblemon:p0013_weedle", weight: 10, times: 2, levels: [1, 8], variation: 0 },
        { entity: "cobblemon:p0010_caterpie", weight: 5, times: 2, levels: [1, 8], variation: 0 },
        { entity: "cobblemon:p0265_wurmple", weight: 8, times: 2, levels: [1, 8], variation: 0 },
        { entity: "cobblemon:p0014_kakuna", weight: 7, times: 2, levels: [8, 10], variation: 0 },
        { entity: "cobblemon:p0015_beedrill", weight: 5, times: 1, levels: [10, 15], variation: 0 },
        { entity: "cobblemon:p0012_butterfree", weight: 5, times: 1, levels: [10, 15], variation: 0 },
    ] };
{
    let sizes = true, times = true, levels = true;
    for (let n = 0; n < 200; n++) {
        const party = M.npcPresetParty(preset, 5), counts = {};
        if (party.length < 4 || party.length > 6) sizes = false;
        for (const [t, lv] of party) { counts[t] = (counts[t] ?? 0) + 1; if (lv !== 5) levels = false; }
        if (Object.values(counts).some((c) => c > 2)) times = false;
    }
    check("a level 5 trainer has four to six Pokemon", sizes);
    check("none more often than its selectableTimes", times);
    check("each at the trainer's level", levels);
    const high = M.npcPresetParty(preset, 12);
    check("a level 12 trainer draws only what its npcLevels allow, once each", high.length === 2 && new Set(high.map(([t]) => t)).size === 2, JSON.stringify(high));
}
{
    const npc = mon("Weedle").entity;
    const a = M.npcTrainerParty(npc), b = M.npcTrainerParty(npc);
    check("a static party is drawn once and kept", JSON.stringify(a) === JSON.stringify(b) && a.length > 0);
}
{
    // skill 5: the most damaging move; Thundershock does nothing to a Ground type
    const foe = mon("Pikachu", { level: 30, moves: ["thundershock", "quickattack", "growl", "tailwhip"] });
    const b = battle(mon("Geodude", { level: 30 }), foe);
    b.foe = foe; b.ally = b.ally;
    check("a skilled trainer picks the move that hurts", M.strongFoeMove(b, 5).id === "quickattack");
    foe.hp = Math.floor(foe.stats.hp * 0.2);
    const heal = mon("Chansey", { level: 30, moves: ["softboiled", "pound"] }), hb = battle(mon("Rattata", { level: 30 }), heal);
    heal.hp = Math.floor(heal.stats.hp * 0.4);
    check("and heals under half HP", M.strongFoeMove(hb, 5).id === "softboiled");
    let random = 0;
    for (let n = 0; n < 200; n++) if (M.strongFoeMove(b, 0).id !== "quickattack") random++;
    check("skill 0 picks at random", random > 100, String(random));
}
