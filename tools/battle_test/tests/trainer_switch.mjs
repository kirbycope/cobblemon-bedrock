// RCTBattleAI's switching: a trainer weighs its bench against its moves (evalSwitch), and a switch comes before moves
import { M, mon, battle, check, flush } from "../harness.mjs";

function gymBattle(foeName, bench, allyName) {
    const foe = mon(foeName, { level: 30 }), b = battle(mon(allyName, { level: 30 }), foe);
    b.gym = { npc: foe.entity, at: 0, turns: 3, itemsLeft: 0, bag: [], margin: 0.25, name: "Test",
              party: [{ spec: { t: foe.entity.typeId, lv: 30, moves: ["tackle"] }, down: false },
                      ...bench.map((n) => ({ spec: { t: mon(n).entity.typeId, lv: 30, moves: ["tackle"], ivs: {}, evs: {} }, down: false }))] };
    return b;
}
{
    // Charmander against Squirtle: a Bulbasaur on the bench is a better matchup than a Vulpix
    let better = 0;
    for (let n = 0; n < 300; n++) {
        const b = gymBattle("Charmander", ["Bulbasaur", "Vulpix"], "Squirtle");
        if (M.gymSwitchRating(b, b.gym.party[1]) > M.gymSwitchRating(b, b.gym.party[2])) better++;
    }
    check("the bench Pokemon that resists the player's types rates higher", better > 200, String(better));
}
{
    // a bad matchup sometimes ends in a switch; a good one rarely does
    let bad = 0, good = 0;
    for (let n = 0; n < 300; n++) {
        const b = gymBattle("Charmander", ["Bulbasaur"], "Squirtle");
        if (M.gymFoeAction(b)?.gymSwitch) bad++;
        const g = gymBattle("Bulbasaur", ["Charmander"], "Squirtle");
        if (M.gymFoeAction(g)?.gymSwitch) good++;
    }
    check("a trainer in a bad matchup switches more often than one in a good matchup", bad > good, `${bad} against ${good}`);
    console.log(`  switches in 300 turns: bad matchup ${bad}, good ${good}`);
}
{
    let action;
    for (let n = 0; n < 300 && !action?.gymSwitch; n++) action = M.gymFoeAction(gymBattle("Charmander", ["Bulbasaur"], "Squirtle"));
    check("the switch goes before any move, to the Pokemon it rated", action.priority > 5 && action.gymSwitch && action.to === 1, JSON.stringify(action));
}
