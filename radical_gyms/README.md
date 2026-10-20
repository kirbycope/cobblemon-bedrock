# Radical Gyms & Structures

The data of [Radical Gyms & Structures (RGS)](https://modrinth.com/datapack/radical-gyms-cobblemon) by JayOnline,
version 0.7 of 6 September 2026 (`Radical Gyms  Structures - RGS.jar`, for Minecraft 1.21.1), under the MIT licence in
`LICENSE` (the licence its Modrinth page declares). It adds the Kanto gyms, Blackthorn's gym and the Kanto League as
naturally generating structures, each holding the key trainer of [Radical Cobblemon Trainers](https://modrinth.com/mod/rctmod)
(RCT) who belongs there.

`data/` is the datapack's own `data/` unchanged: `rgs/structure/*.nbt` (the nine buildings), `rgs/worldgen/` and
`rgs/tags/` (where and how often they generate), and `rctmod/mobs/trainers/single/` (its changes to RCT's gym leaders:
no natural spawning, and the biomes they belong to). `port.py` converts the buildings and places them
(`create_gyms()`); the trainers themselves are RCT's, in `../rct_trainers/`. The buildings are furnished with
CobbleFurnies blocks, which `port.py` converts from a git-ignored clone of CobbleFurnies at `../java_cobblefurnies/`.
