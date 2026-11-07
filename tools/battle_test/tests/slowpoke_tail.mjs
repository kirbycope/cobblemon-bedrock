// SlowpokeTailsMechanic: a sheared tail grows back segment by segment over 1200 seconds of world time; EatGrassTask: sheared wool grows back
import { M, mon, check } from "../harness.mjs";
import { clock } from "../stub_server.mjs";

const slowpoke = mon("Slowpoke").entity;
check("an unsheared Slowpoke has its whole tail", M.tailSegments(slowpoke) === 3);
clock.ticks = 100000;
slowpoke.setDynamicProperty("cobblemon:tail_cut", clock.ticks);
check("a freshly sheared one has none of it", M.tailSegments(slowpoke) === 0);
clock.ticks += 501 * 20;
check("the first segment is back with under 700 seconds left", M.tailSegments(slowpoke) === 1);
clock.ticks += 500 * 20;
check("the second with under 200", M.tailSegments(slowpoke) === 2);
clock.ticks += 200 * 20;
check("and all of it after 1200 seconds", M.tailSegments(slowpoke) === 3);

// EatGrassTask: a sheared Wooloo on a grass block eats it at eat_grass_chance 1 / (20 * 20) a tick, about 1 in 20 a
// second, the grass going to dirt and the wool growing back (PokemonEntity.ate)
{
    const wooloo = mon("Wooloo").entity;
    let set = null;
    wooloo.dimension = { getBlock: () => ({ typeId: "minecraft:grass_block", setType: (t) => { set = t; } }) };
    wooloo.setDynamicProperty("cobblemon:sheared", true);
    const chance = 1 - (399 / 400) ** 20;
    check("a second's chance is twenty ticks of 1 in 400, about 1 in 20", Math.abs(chance - 0.0488) < 0.0005);
    check("a roll above it leaves the wool off", !M.grazeSheared(wooloo, chance + 0.001) && wooloo.getDynamicProperty("cobblemon:sheared") === true);
    check("a roll under it eats the grass and grows the wool back", M.grazeSheared(wooloo, chance - 0.001) && set === "minecraft:dirt" && wooloo.getDynamicProperty("cobblemon:sheared") === undefined);
    check("an unsheared one does not graze", !M.grazeSheared(wooloo, 0));
}
