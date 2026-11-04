// The player wheel's Spectate and spectatebattle: the player joins the battle's spectators
import { M, mon, battle, check } from "../harness.mjs";

const b = battle(mon("Pikachu"), mon("Eevee"));
const said = [], player = { id: "watcher", name: "Watcher", sendMessage: (t) => said.push(t) };
M.spectateBattle(player, { name: "Tester" }, b);
check("the spectator follows the battle", b.spectators?.has("watcher") && said.some((t) => t.includes("Tester's battle")));
