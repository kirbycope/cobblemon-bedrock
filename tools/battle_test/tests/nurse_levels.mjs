// The Nurse levels as a villager: two offers a level, uses, XP thresholds, restocking
import { M, mon, check } from "../harness.mjs";

const nurse = mon("Chansey").entity;   // a stand-in entity with dynamic properties
const state = M.nurseState(nurse);
check("a new Nurse is a Novice with two of the level 1 offers", state.level === 1 && state.offers.length === 2 && state.offers.every(([lv]) => lv === 0), JSON.stringify(state.offers));
let levelled = false;
for (let n = 0; n < 10 && !levelled; n++) { state.uses = state.uses.map(() => 99); levelled = M.nurseTraded(state, 0) && state.level === 2; }
check("trades earn her XP until she is an Apprentice at 10", levelled && state.xp >= 10, JSON.stringify([state.level, state.xp]));
check("which draws two Apprentice offers", state.offers.filter(([lv]) => lv === 1).length === 2);
state.uses = state.uses.map(() => 0);
check("she restocks every offer at work", M.nurseRestock(state, 1, 10000) && state.uses.every((u) => u > 0));
state.uses = state.uses.map(() => 0);
check("but not again within 2400 ticks", !M.nurseRestock(state, 1, 11000));
check("and twice a day at most", M.nurseRestock(state, 1, 13000) && (state.uses = state.uses.map(() => 0)) && !M.nurseRestock(state, 1, 20000));
