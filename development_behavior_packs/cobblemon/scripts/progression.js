// The Pokemon record's progression (Pokemon.kt and its neighbours) as pure helpers main.js wires in: Deerling's season
// from the biome (SeasonFeatureHandler), the marks a revived fossil may take (callbacks/fossil_revived), the moveset
// builders' slot selectors (DefaultMovesetBuilder, MoveSelector), the pre-evolution and evolution-move maps a learnset
// query needs (TMMoveManager, Learnset.evolutionMoves) and the PP a swapped move arrives with (Pokemon.exchangeMove).
import { MARKS } from "./marks.js";
import { MOVE_WEIGHTS, SEASON_FILTERS, SEASON_SPECIES } from "./progression_data.js";

// TagSeasonResolver: the season of the biome a Pokemon stands in, from the has_season biome tags, winter first, then
// spring, autumn and summer; null in a biome in none of them, which leaves the season it has. passes(filter, tags)
// is main.js's filterPasses on the biome's Bedrock tags.
export const SEASON_ORDER = ["winter", "spring", "autumn", "summer"];
export function seasonFor(tags, passes) {
    for (const season of SEASON_ORDER) { const filter = SEASON_FILTERS[season]; if (filter && passes(filter, tags)) return season; }
    return null;
}
// species_feature_assignments/season.json: the species with the season feature (Deerling and Sawsbuck)
export const isSeasonal = (typeId) => SEASON_SPECIES.includes(typeId);
// the variant that wears a season with the current look's gender and shininess (spring is the standard form, whose
// look has no form name); -1 when the species has no such look
export function seasonLook(looks, current, season) {
    const [, female, shiny] = looks?.[current] ?? [null, 0, 0], form = season === "spring" ? null : season;
    return (looks ?? []).findIndex(([f, g, s]) => f === form && g === female && s === shiny);
}

// callbacks/fossil_revived/apply_marks.molang: a Pokemon from the Resurrection Machine may take the Rare, Uncommon and
// personality marks and the Revival Mark (1 in 25), rolled as it is handed over (Pokemon.applyPotentialMarks)
export function revivalPotentialMarks(marks = MARKS) {
    const groups = ["rare", "uncommon", "personality"];
    return [...Object.keys(marks).filter((id) => groups.includes(marks[id][5])), "cobblemon:mark_revival"].filter((id) => marks[id]);
}

// MoveTemplate.getSelectionWeight: move_weights.json's weight, 50 for a move it does not name (Moves.kt)
export const moveWeight = (id, weights = MOVE_WEIGHTS) => weights[id] ?? 50;
// CollectionUtils.weightedSelection: one of the ids by weight, none when every weight is 0
export function weightedPick(ids, weightOf, random = Math.random) {
    const total = ids.reduce((sum, id) => sum + Math.max(0, weightOf(id)), 0);
    if (!ids.length || total <= 0) return null;
    const chosen = random() * total;
    let sum = 0;
    for (const id of ids) { const w = weightOf(id); if (w > 0) { sum += w; if (sum >= chosen) return id; } }
    return ids[ids.length - 1];
}
// moveset_builders/alpha.json and wild.json: each slot's selectors, the first that finds a move filling it
export const ALPHA_SLOTS = [["last_suitable_offensive", "last_offensive", "last_levelup"], ["last_offensive", "last_levelup"], ["tm", "last_levelup"], ["tm", "last_levelup"]];
export const WILD_SLOTS = [["last_offensive", "last_levelup"], ["last_levelup"], ["last_levelup"], ["last_levelup"]];
// DefaultMovesetBuilder.build on MoveSelector's selectors. ctx: learnset [[level, id]...], level, tmMoves (the ids the
// species learns by TM), moves (the battle's move table, for the category), weights, and the base atk and spa.
// last_levelup: the latest level reached whose moves are not all chosen, one of them by weight; last_offensive: the
// same among damaging moves; last_suitable_offensive: among physical moves when base Attack is the higher, special
// when Sp. Atk is, either when they tie; tm: a TM move not chosen and not learnt by level so far, by weight.
export function buildMoveset(slots, ctx, random = Math.random) {
    const chosen = [], moves = ctx.moves ?? {}, weightOf = (id) => moveWeight(id, ctx.weights);
    const learnset = (ctx.learnset ?? []).filter(([at, id]) => at <= ctx.level && moves[id]);
    const levels = [...new Set(learnset.map(([at]) => at))].sort((a, b) => b - a);
    const byLevel = (at) => learnset.filter(([l]) => l === at).map(([, id]) => id);
    const suitable = ctx.atk > ctx.spa ? ["Physical"] : ctx.spa > ctx.atk ? ["Special"] : ["Physical", "Special"];
    const lastOf = (keep) => {
        for (const at of levels) { const ids = byLevel(at).filter((id) => !chosen.includes(id) && keep(id)); if (ids.length) return weightedPick(ids, weightOf, random); }
        return null;
    };
    const select = (name) => {
        switch (name) {
            case "last_levelup": return lastOf(() => true);
            case "last_offensive": return lastOf((id) => moves[id].category !== "Status");
            case "last_suitable_offensive": return lastOf((id) => suitable.includes(moves[id].category));
            case "tm": { const learnt = new Set(learnset.map(([, id]) => id)); return weightedPick((ctx.tmMoves ?? []).filter((id) => moves[id] && !chosen.includes(id) && !learnt.has(id)), weightOf, random); }
            default: return null;
        }
    };
    for (const slot of slots) for (const name of slot) { const id = select(name); if (id) { chosen.push(id); break; } }
    return chosen;
}

// a species' evolutions in the port's table: the level-up ones and the item ones the script picks between (itemEvos)
const evolutionsIn = (info) => [...(info.evolutions ?? []), ...(info.itemEvos ?? [])];
// the species that evolve into each species (PreEvolution)
export function preEvolutionsOf(pokemon) {
    const out = {};
    for (const [typeId, info] of Object.entries(pokemon)) for (const evo of evolutionsIn(info)) if (evo.to && !(out[evo.to] ??= []).includes(typeId)) out[evo.to].push(typeId);
    return out;
}
// Learnset.evolutionMoves: the moves an evolution into the species teaches (its learnableMoves), relearnable for good
export function evolutionMovesOf(pokemon) {
    const out = {};
    for (const info of Object.values(pokemon)) for (const evo of evolutionsIn(info)) for (const id of evo.moves ?? []) if (evo.to && !(out[evo.to] ??= []).includes(id)) out[evo.to].push(id);
    return out;
}

// Pokemon.exchangeMove: a move swapped in keeps the leaving move's share of its PP (truncated); one put into an
// empty slot comes with none, so forgetting and remembering a move cannot refill it
export function exchangePp(leavingLeft, leavingMax, newMax) {
    return leavingMax > 0 ? Math.floor((leavingLeft / leavingMax) * newMax) : 0;
}
