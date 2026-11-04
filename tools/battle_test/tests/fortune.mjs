// Fortune's share of Cobblemon's block drops, by Minecraft's formulas (ApplyBonusCount)
import { M, check } from "../harness.mjs";

function mean(bonus, level, n = 4000) { let t = 0; for (let i = 0; i < n; i++) t += M.fortuneExtra(bonus, level); return t / n; }
{
    // ore_drops: count times 1 to level + 1, the 1 twice as likely; Fortune III averages 2.2 times, so 1.2 extra
    const ore = { item: "cobblemon:fire_stone", formula: "ore_drops", params: {}, base: 1 };
    const three = mean(ore, 3), one = mean(ore, 1);
    check("Fortune III adds about 1.2 to an ore's one stone", three > 1.05 && three < 1.35, three.toFixed(2));
    check("and Fortune I about a third", one > 0.25 && one < 0.42, one.toFixed(2));
}
{
    // uniform_bonus_count: up to multiplier times level, so Fortune II averages 1
    const gem = { item: "cobblemon:fire_gem", formula: "uniform_bonus_count", params: { bonusMultiplier: 1 }, base: { min: 2, max: 4 } };
    const two = mean(gem, 2);
    check("a gem block's uniform bonus averages level / 2", two > 0.9 && two < 1.1, two.toFixed(2));
}
{
    // binomial_with_bonus_count: level + extra tries; without Fortune a ripe leek still gets its three tries at 4/7
    const leek = { item: "cobblemon:medicinal_leek", formula: "binomial_with_bonus_count", params: { extra: 3, probability: 0.5714286 }, base: 1 };
    const none = mean(leek, 0);
    check("a ripe leek's extra leeks roll without Fortune", none > 1.6 && none < 1.85, none.toFixed(2));
}
