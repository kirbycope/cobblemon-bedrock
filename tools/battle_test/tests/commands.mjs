// The custom commands' Pokemon properties (parseProps): Cobblemon's key=value words, or the key and value as two words
import { M, check } from "../harness.mjs";

const p = M.parseProps(["pikachu", "level", "7", "shiny", "nature", "timid"]);
check("properties as key and value words", p.species === "pikachu" && p.level === 7 && p.shiny === true && p.nature === "timid", JSON.stringify(p));
const q = M.parseProps(["pikachu level=9 gender=female"]);
check("properties as Cobblemon's key=value", q.species === "pikachu" && q.level === 9 && q.gender === "female", JSON.stringify(q));
check("species by name or id", M.speciesNamed("mr. mime") === M.speciesNamed("mrmime") && !!M.speciesNamed("pikachu"));
const r = M.recordFor(M.speciesNamed("pikachu"), { level: 12, shiny: true });
check("a record for a given Pokemon has its level, moves and a shiny variant", r.lv === 12 && JSON.parse(r.mv).length > 0 && r.v > 0, JSON.stringify(r));
{
    // Bedrock's parser takes no number alone, so "level 5" cannot be typed; "level5" can
    const p = M.parseProps(["pikachu", "level5", "shiny"]), q = M.parseProps(["pikachu", "lvl12"]);
    check("a level runs on from its key", p.level === 5 && p.shiny === true && q.level === 12, JSON.stringify([p, q]));
}
{
    // PokemonProperties.create: no level= is Pokemon.level's default of 1 (SpawnPokemon and GivePokemon alike), and
    // roll() makes it shiny 1 in 8192 (config.shinyRate) unless shiny= says
    const pikachu = M.speciesNamed("pikachu"), random = Math.random;
    Math.random = () => 0;
    let lucky, plain, said;
    try { lucky = M.recordFor(pikachu, {}); said = M.recordFor(pikachu, { shiny: false }); Math.random = () => 1 / 8192; plain = M.recordFor(pikachu, {}); } finally { Math.random = random; }
    check("givepokemon with no level gives level 1", lucky.lv === 1 && plain.lv === 1, JSON.stringify([lucky.lv, plain.lv]));
    check("and rolls shiny 1 in 8192 when shiny is not given", lucky.v > 0 && plain.v === 0 && said.v === 0, JSON.stringify([lucky.v, plain.v, said.v]));
}
