# Legendary Encounters

The spawn files of [Cobblemon Legendary Encounters](https://www.curseforge.com/minecraft/data-packs/cobblemon-legendary-encounters)
by Yağız (kurbagayagiz), version of 4 January 2026 (`LegendaryEncounters.zip`, for Minecraft 1.21.1), under the MIT
licence in `LICENSE`. Cobblemon itself never spawns a legendary or mythical Pokemon; this datapack gives 53 of them an
ultra-rare natural spawn in fitting biomes, some only at a time of day or in a weather.

`spawn_pool_world/` is the datapack's `data/cobblemon/spawn_pool_world/` unchanged. `port.py` reads it alongside
Cobblemon's own spawn pools (`legendary_spawn_pools()`). Left out: the datapack's tick function, which only printed a
test message to chat every tick.
