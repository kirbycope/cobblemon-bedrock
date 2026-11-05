// PartyOverlay's level-up scroll: a Pokemon that levelled up shows the scroll over its portrait after the bar's 17
// ticks, fourteen steps over LEVEL_UP_PORTRAIT_TIME's 10 ticks; experience without a level-up shows none
import { M, mon, battle, check, flush } from "../harness.mjs";
import { system } from "../stub_server.mjs";

const f = mon("Pikachu", { level: 10 }), pika = f.entity, b = battle(f, mon("Rattata", { level: 5 }));
M.gainExperience(b, f, null, M.expFor(f.info.expGroup, 11) - M.expFor(f.info.expGroup, 10) + 1);
check("the Pokemon levelled up", pika.getDynamicProperty("cobblemon:level") === 11);
system.currentTick = 1000;
M.offerLevelEvolutions(b.player);
const at = (t) => { system.currentTick = 1000 + t; return M.scrollCode(pika); };
check("no scroll while the bar fills", at(0) === "z" && at(16) === "z" && at(17) === "z");
const steps = [18, 19, 20, 21, 22, 23, 24, 25, 26].map(at).join("");
check("then the steps of PartyOverlay's ceil(transition x 14)", steps === "bcefgijlm", steps);
check("and none once its 10 ticks are over", at(27) === "z" && at(100) === "z");
pika.nameTag = "";   // the stand-in entity has no name tag of its own
const record = M.partyRecord(pika, true, b.player);
check("the slot's record carries it as its last field, 64 bytes as the HUD counts them", Buffer.byteLength(record) === 64 && record.endsWith("Lv.z"), record);

const g = mon("Bulbasaur", { level: 10 }), bulba = g.entity, b2 = battle(g, mon("Rattata", { level: 5 }));
M.gainExperience(b2, g, null, 1);
system.currentTick = 2000;
M.offerLevelEvolutions(b2.player);
system.currentTick = 2020;
check("experience without a level-up shows no scroll", M.scrollCode(bulba) === "z");
flush();
