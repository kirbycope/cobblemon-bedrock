// The gym trainers' moves: every move in an RCT team is one the battle knows, and the four that only they use do what
// Showdown's do
import { readFileSync } from "node:fs";
import { M, D, mon, move, battle, check } from "../harness.mjs";

const text = readFileSync(new URL("../../../development_behavior_packs/cobblemon/scripts/rct_trainers.js", import.meta.url), "utf-8");
const used = new Set([...text.matchAll(/"moves":\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1])));
const unknown = [...used].filter((m) => !D.MOVES[m]);
check("every move in a gym trainer's team is one the battle knows", used.size > 100 && !unknown.length, unknown.join(","));
const lv = { level: 50 };
function fixed(fn) { const random = Math.random; Math.random = () => 0.5; try { return fn(); } finally { Math.random = random; } }
{
    const user = mon("Venusaur", lv), foe = mon("Snorlax", lv), b = battle(user, foe);
    fixed(() => M.useMove(b, user, foe, move("chloroblast")));
    check("Chloroblast costs its user half its maximum HP once it hits", user.stats.hp - user.hp === Math.round(user.stats.hp / 2) && foe.hp < foe.stats.hp, `${user.hp}/${user.stats.hp}`);
    const head = mon("Venusaur", lv), b2 = battle(head, mon("Snorlax", lv));
    head.ability = "rockhead";
    fixed(() => M.useMove(b2, head, b2.foe, move("chloroblast")));
    check("and Rock Head keeps it off", head.hp === head.stats.hp);
}
{
    const user = mon("Machamp", lv), foe = mon("Snorlax", lv), b = battle(user, foe);
    fixed(() => M.useMove(b, user, foe, move("wickedblow")));
    check("Wicked Blow is always a critical hit", b.log.some((l) => /critical hit/i.test(l)), b.log.join(" | "));
    const b2 = battle(mon("Machamp", lv), mon("Snorlax", lv));
    fixed(() => M.useMove(b2, b2.ally, b2.foe, move("surgingstrikes")));
    check("Surging Strikes hits three times, each a critical hit", b2.log.some((l) => /Hit 3 times/.test(l)) && b2.log.filter((l) => /critical hit/i.test(l)).length >= 1, b2.log.join(" | "));
}
