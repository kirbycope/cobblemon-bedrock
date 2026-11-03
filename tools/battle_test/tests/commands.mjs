// The custom commands' Pokemon properties (parseProps): Cobblemon's key=value words, or the key and value as two words
import { M, check } from "../harness.mjs";

const p = M.parseProps(["pikachu", "level", "7", "shiny", "nature", "timid"]);
check("properties as key and value words", p.species === "pikachu" && p.level === 7 && p.shiny === true && p.nature === "timid", JSON.stringify(p));
const q = M.parseProps(["pikachu level=9 gender=female"]);
check("properties as Cobblemon's key=value", q.species === "pikachu" && q.level === 9 && q.gender === "female", JSON.stringify(q));
check("species by name or id", M.speciesNamed("mr. mime") === M.speciesNamed("mrmime") && !!M.speciesNamed("pikachu"));
const r = M.recordFor(M.speciesNamed("pikachu"), { level: 12, shiny: true });
check("a record for a given Pokemon has its level, moves and a shiny variant", r.lv === 12 && JSON.parse(r.mv).length > 0 && r.v > 0, JSON.stringify(r));
