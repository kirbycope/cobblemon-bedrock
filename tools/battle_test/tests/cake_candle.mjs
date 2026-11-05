// PokeSnackBlock's candle on the Poke Cake: placed, lit, put out and taken back
import { M, check } from "../harness.mjs";

function cake() {
    let states = { "cobblemon:candle_hi": 0, "cobblemon:candle_lo": 0, "cobblemon:lit": false };
    const perm = (st = states) => ({ getState: (k) => st[k], withState: (k, v) => { const next = { ...st, [k]: v }; return { ...perm(next), next }; } });
    const block = { x: 0, y: 0, z: 0, location: { x: 0, y: 0, z: 0 }, dimension: { playSound() { } }, get permutation() { return perm(); },
                    setPermutation(p) { states = p.next; } };
    return { block, states: () => states };
}
const given = [], player = { isSneaking: false, getGameMode: () => "Creative", getComponent: () => undefined, sendMessage() { } };
const c = cake();
check("a red candle goes on the cake", M.cakeCandle(c.block, player, "minecraft:red_candle") && c.states()["cobblemon:candle_hi"] === 1 && c.states()["cobblemon:candle_lo"] === 0);
check("a second candle does not", !M.cakeCandle(c.block, player, "minecraft:white_candle"));
check("flint and steel lights it", M.cakeCandle(c.block, player, "minecraft:flint_and_steel") && c.states()["cobblemon:lit"] === true);
check("an empty hand puts it out", M.cakeCandle(c.block, player, undefined) && c.states()["cobblemon:lit"] === false);
