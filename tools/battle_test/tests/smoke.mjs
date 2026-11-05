// the harness itself: two Pokemon, a damaging move, the target loses HP and the log says so
import { M, mon, battle, move, check, flush } from "../harness.mjs";

const a = mon("Charizard", { level: 50, moves: ["flamethrower"] }), d = mon("Venusaur", { level: 50 });
const b = battle(a, d);
const before = d.hp;
M.useMove(b, a, d, move("flamethrower"));
flush();
check("a damaging move takes HP", d.hp < before, `${before} -> ${d.hp}; ${b.log.join(" / ")}`);
check("the log names the move", b.log.some((l) => l.includes("Flamethrower")), b.log.join(" / "));
