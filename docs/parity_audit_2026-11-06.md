# Parity audit, 6 November 2026

Twelve audits of Cobblemon 1.8.4's source, data and wiki (and the four other mods the port draws from) against the
port, one per area: Pokemon entities, battles, items, blocks, world generation, spawning and fishing, Pokemon data
and progression, storage and NPCs, riding, client UI, commands and config, the other mods. Each read the README's
port table and PARITY.csv first, so nothing already listed as "Not carried" is repeated here. Every finding was
confirmed in the source and searched for in the port at least three ways. Two findings contradicted each other and
were checked by hand (Smeargle's tail is a gap; Name Tags are a divergence).

What the audit found: about 80 gaps Bedrock allows, 5 of them large, about 20 medium and the rest small; about 55
divergences (carried, but differently); and 14 things Bedrock blocks. Nothing is "missing" in PARITY.csv's sense,
since the tracker enumerates names (items, blocks, sounds, species, moves) and these are behaviours.

## Gaps Bedrock allows

### Large

| Area | Gap | Cobblemon | Port |
| --- | --- | --- | --- |
| RCT | Wandering trainers | `TrainerSpawner`: one of ~1,500 trainers per player every 180 ticks, 25 to 70 blocks away, biome-matched, level-matched to the strongest party member (+-25), 12 per player and 60 in all, only the player's series; they wander, follow a Trainer Card holder, stare 60 ticks within 8 blocks and force a battle when the level gap is 16 or less, despawn after 5 minutes unseen. With them the other trainer types (rivals, Team Rocket, Battleground, EV coaches), the bdsp and unbound series, and Radical Red's intermediate key trainers (Rival Terry, Archer, Giovanni, Brendan, May), so the level cap climbs in steps. | Only the 14 gym and League trainers, summoned by gym plates, standing still. |
| Blocks | Standalone Data Monitor | A Monitor outside a fossil machine takes a TM (unlocks its recipe) or a music disc (music screen), ejects to an empty hand; an Upgrade loads 90 ticks, breaks the monitor into a Damaged Monitor and spawns Porygon (20% Porygon2); a Dubious Disc glitches, explodes (iron ingots, sculk veins, hearts off nearby mobs) and spawns Porygon-Z half the time. The second TM-unlock route. | Monitor states are fossil-machine screens only; Damaged Monitor is decoration. |
| Blocks | Disc Shelf | 14 slots for TMs, Blank TMs, Upgrades, Dubious Discs and music discs, clicked on the front face; comparator by count; hoppers. A note block on top plays the discs as notes (sequencer). | A plain block. Slots allowed (an entity, as the display case); the sequencer is blocked (no note-block event). |
| Worldgen | The 17 feature-placed habitats | Treasure Hoard, Ancient Wellsprings, Deep Roots, Earthen Hives, Exposed Geodes, Lost Ruins, Rocky Outcrops, Rocky and Sandy Tidepools, Root Nurseries, Abandoned Fortress, Volcanic Plumes, Quartz Spikes, Skeletal Fall, Strange Crimson and Warped Fungal Dwellings, Chorus Briars: placed by `cobblemon:structure` features (caves, mountains, shores, Nether, End) at 1 chunk in 10 to 600. | Not generated. Same route as the 23 fossil formations (`structure_template_feature`). |
| UI | Pokedex Moves tab | Sort by Level, Name, Type, Discovered; category filter All, Level, TM, Egg; TM disc icons; clicking a move shows PP, power, accuracy, effect, type and category. | A paged text list. (Medium, listed here as the biggest UI piece.) |

### Medium

- **Riding, hover behaviour** (Bronzong, Claydol, Drifblim, Dusknoir, Forretress, Klinklang, Magnezone, Metagross): stamina drains only above the height the Jump stat allows (2 to 32 blocks, raycast down), refills in 2 s otherwise, forces descent at 0; omnidirectional strafing. Port rides them by the bird rules.
- **Riding, jet behaviour** (Dragonite, Dragapult, Garchomp, Gyarados, Latias, Latios): never below half top speed, cannot stop, drains the whole flight, sprint boost at the Jump multiple drains 1.5x, pushed down at 0 stamina. Port: bird rules. Forced forward motion is blocked by the free camera; the boost and drain are allowed.
- **Riding, rocket behaviour** (Blastoise, Golurk): falls unless jump is held, which lifts at the Jump stat; boost 5x; stamina drains only while lifting or boosting. Port: bird rules.
- **CobbleFurnies seating**: stools, sofas, chairs, armchairs, Poke chairs and toilets seat the player; an occupied seat gives comparator 15. Every gym is furnished with them.
- **CobbleFurnies crafting**: the FurniCrafter station with 348 recipes plus 20 crafting-table recipes. None of the 62 furniture blocks is craftable here.
- **RCT Trainer Spawner block and Trainer Repel Rod**: craftable; the spawner summons the trainer whose signature item it holds; the rod stops spawning in 7 by 7 chunks.
- **Terrain Seed crops**: Electric, Psychic, Misty and Grassy Seeds planted on farmland grow five ages into Voltaconia, Lucibell, Mistleaf and Verdroot.
- **Terrain plants' glow**: Voltaconia lights in thunderstorms, Verdroot in rain, Lucibell when stood in, Mistleaf by moon phase at night (comparator too).
- **Redstone decorations**: the Metronome toggles and gives comparator 4; the Eject Button is a real button (40 ticks, floor, wall, ceiling); the Ring Target gives 1 to 15 by projectile closeness.
- **Revival Herb mutation**: Surprise Mulch on a herb at age 6 or under sets Mental, Power, White or Mirror Herb as the drop.
- **Fossil machine extras**: breaking a part releases a finished Pokemon wild; a redstone pulse on the tank releases it; comparator on the tank (fill) and monitor (progress); hoppers insert.
- **Gilded chest redstone and hoppers**: comparator by contents, hoppers in and out, a solid block above stops it opening. (Piglin anger is blocked.)
- **Feature-placed ruins**: Crumbling Arch (deepslate caves, 1 in 60), Rooted Arch (lush caves, 1 in 40), Deep Crypt (deep dark, 1 in 3 chunks, treasure or trapped). The README's "two cave ruins with no start pool" were never jigsaws; these features place them.
- **Shipwreck cove trial spawners**: 12 cove pieces carry trial spawners (zombies, ominous waves, equipment) with reward tables (Relic Coins, Exp. Candy, Hyper Potion, Elixir, Revive...). The converter writes bare `trial_spawner` blocks, so they stand inert.
- **Structure traps and mobs**: the Gimmighoul towers' trapped variants carry evokers, witches and husks; the crypt's spider variant and tombstones carry mob spawners; the honey tower's bee nest holds bees; the Mossy Oubliette's tripwire dispenser holds a splash potion. The converter writes no entities, empty spawners and empty containers.
- **Spectator battle screen**: a spectator sees the tiles, health bars and message pane with a leave button. Port relays the log to chat.
- **Deerling and Sawsbuck seasons**: the biome's `has_season` tag sets the form on spawn and on every send-out (spring floral and plains, summer forest and jungle, autumn arid and taiga, winter freezing). Port never assigns the four looks it carries.
- **Composting**: 55 items are compostable (berries 65%, mints 95%, apricorns 65%, seeds 30%, herbs 85%...). Bedrock: by script on the composter.

### Small

Riding: the submarine's stamina should keep the rider breathing (Blastoise, Wailord and five more; the rider drowns on Bedrock's own air now); only the owner may mount and drive (any player can take a stranger's Pokemon now); boat jump (Lapras, Drampa, Garchomp leap at the Jump stat).

Battles: a ball thrown at a different wild Pokemon while in a battle is refused ("You can't do that while in a battle!"); a species already owned in the Pokedex makes a successful catch a one-shake critical; Moomoo Milk in battle resets stat stages and hands back a bottle; capture refusal messages ("That X is not a wild Pokemon", "in a battle and cannot be caught by you", "busy", "not your turn").

Entities: sleeping on the trainer's bed (335 species, walk to the bed within 12 blocks, sleep on it, wake when the owner rises); wild alphas always retaliate (the port's retaliate group ignores alphas); Mooshtank Miltank: a bowl gives Mushroom Stew, a flower fed to a brown one gives Suspicious Stew next, lightning flips red and brown; lightning: Ground types immune, Lightning Rod Strength II, Motor Drive Speed II, Volt Absorb heals, no fire; Ice types do not freeze in powder snow; Smeargle's tail colour from nature and characteristic; Levitate halves gravity; Pidgeotto hunts beached Magikarp; a wild Pokemon killed by a player drops XP orbs; lava walkers (Slugma line, Fuecoco line) and 93 lava swimmers; spiders immune to cobwebs (unclear on Bedrock).

Storage and NPCs: `doShinyStarters` game rule; Nurse Joy (a nurse named Joy, Joelle and the other listed names takes the Nurse Joy texture); farmer villagers gather mint seeds, Revival Herb, Vivichoke seeds and Hearty Grains.

Spawning and fishing: a fished-up Pokemon starts a battle a second after the reel-in; 39 Nether and End spawn entries carry their own drop tables (ghast tears, blaze powder, ender pearls, chorus fruit) that the port ignores; "Not even a nibble..." when no fishing spawn fits the spot (the port gives junk instead).

UI: Pokedex Stats tab's Ride Stats page (ride stat ranges and seats); alpha eye bloom and 400 ms trail; the exclamation icon over the head of a player who challenged or offered a trade; held item visibility toggle in the Summary; the shiny icon by the portrait in the Summary and PC; the status bar in the PC's info panel; the recall arm holding the ball (0.8 s, first and third person); clicking the Summary portrait plays the cry; the Size tab's height grid beside a player silhouette.

Items: mint seeds (six seed items; wild mints cannot be replanted); potions, status cures, Ethers, Elixirs and Ability Capsules hand back a bottle, Berry Juice a bowl, in and out of battle; the ten regional foods cure an owned Pokemon's status; Hopo Berry restores 10 PP (Ether in battle); Sweet, Tart and Syrupy Apples are food, and eating any apple drops Leftovers 1 in 40; Vivichoke Dip gives Absorption, clears effects, always edible, bowl back; plain Aprijuice is a drink (4 hunger), stack 16; a type gem placed on a block becomes a stage-1 cluster; an apricorn sprout placed on apricorn leaves; the campfire pot sits on a soul campfire too.

Data: the Revival Mark (1 in 25) and the personality marks on a revived fossil; TM unlock from putting a TM in a Data Monitor (part of the Data Monitor above).

Commands: `pokemoneditother`; `pokemonrestart` and `pokemonrestartother [reset_starters]`; `pokedex grant|revoke <player> all <dex>` and `only <species> <form>`, `pokedex printcalculations`; `technicalmachine check <player>`; `pcsearch other <player>` and search by any property; `teach` refusing unlearnable moves and benching a fifth; the property keys `alpha`, `friendship`, `fullness`, `pokeball`, `status`, `hiddenability`, `moves=`, per-stat `_iv`/`_ev`, `min_perfect_ivs`, `scale_modifier`, `tradeable`, `ot`, `aspect`, `uncatchable`, `no_ai`, `held_item_visible` and every species feature; `givetm` up to 2304; `unlockpcboxwallpaper`'s sound flag; `spawnallpokemon` with no arguments; the aliases `pokegive`, `pokespawn`, `pokeheal`, `giveTM` and the rest; `cobblemon info`.

Game rules with no toggle: `doPokemonSpawning`, `doPokemonLoot`, `battleInvulnerability`, `mobTargetInBattle`, `doShinyStarters`, `healersHealPC` (the healing machine healing the PC). Defaults match the port's fixed behaviour.

Blocks: shears harvest ripe berry bushes and apricorns, a hit harvests a ripe apricorn; a shovel removes mulch; Wistensu hangs and grows down, bone meal pops a Pauvillea copy; a water bottle washes honey off a saccharine log (and water touching it), honey goes on the side clicked; the campfire pot's lid follows redstone; the Damaged Monitor glitches under redstone (light 10); the Galarica Nut Bush slows entities inside it.

Loot: the village Pokemon Center chest generates empty (its table exists but the structure carries no LootTable); the ruins' decorated pots are placed empty (remedies, arrows, Relic Coins, a diamond).

RGS and CobbleFurnies: the gyms' display cases hold items (Metal Coat, Water Stone, Life Orb, the League's medicines) that generate empty; the gyms' lamps can be switched on and the TV's channel cycled; the gyms are mob-free in Java (spawn overrides); the Trainer Card glints with a target, filters by trainer type and lists a trainer's biomes.

## Divergences, carried but different

Gameplay:
- **Experience is paid per knockout**, in any battle. Cobblemon pays it only when the enemy team is wiped (or on loss with a config off by default), to Pokemon with HP left, in one lump at the end; a loser or forfeiter gets nothing.
- **Poke Snack cap**: Cobblemon waits at 18 or more Pokemon in the 3x3 chunks; the port stalls at 2 wild Pokemon within 12 blocks, so a snack stops after its own first two draws linger.
- **Natural spawns keep only biome anticonditions**: 293 `wild`-preset entries exclude villages and concrete, 354 structure anticonditions, 68 minY/maxY, 31 nearby-block, 3 time ones are dropped, so Pinsir, Heracross, Zubat and friends spawn inside villages where Cobblemon leaves only the urban ones. The script knows village bells and structure markers, so a post-spawn event could thin them.
- **Natural spawns ignore the base block**: the `natural` preset (1,715 entries) needs grass, dirt, sand, stone, snow and the like under the Pokemon, never farmland; the rules carry no `spawns_on_block_filter`, so Pokemon spawn on planks, bricks and concrete in a base.
- **Structure rates**: Java re-rolls a structure set's pick when the biome does not fit, so one member generates in every cell whose biome fits any member; the port splits the cell by weight over the whole set. A desert ruin comes about 2.5x more often in Java, a savanna Bug Mound 12x.
- **RCT rematches**: Java's defeat record is never saved, so a re-summoned leader battles again (badge only the first time) and drops loot again; the port says "You've already beaten me" for ever, and marks Agatha's rematch team done with her first. RGS leaders also refuse after 3 wins over a player; cooldowns grow 240, 480, 960.
- **Flee by distance** works without pressing Run (and while trapped) in Cobblemon.
- **Disconnect** ends any battle as a forced tie (wild healed and freed); the port handles PvP only, and a leaver's wild or trainer foe stays frozen until they return.
- **Catching while in a battle** also lacks the level-gap penalty Cobblemon never applies (the port's 0.1x at 50 levels over is not in 1.8.4).
- **Wild level** comes from the species-wide range, not the chosen entry's; Shellos and Gastrodon hemispheres (minX/maxX) ignored; herd seeds ignore moon phase (Basculin stripes); block-light conditions (Venonat near light, Misdreavus in the dark) not written; Poke Snacks draw grounded spawns only (Java draws water ones from a dock).
- **Fishing**: rain speeds bites and cover halves them; Luck of the Sea and open water weigh junk against treasure (the port rolls flat 66/17/17).
- **Interaction tool wear and drop counts**: brushes lose 8, 16 or 32 durability by species and most feather drops are 2; the port wears 1 and drops 1.
- **Water walkers**: 43 species (Bidoof, Surskit, Pikachu, Dratini, Lapras, Pelipper...) walk on the surface; the port floats them. Raft at send-out outside battle too. A failed capture makes the Pokemon avoid the thrower 5 to 20 s. Leads work on wild Pokemon. Napping wild Pokemon start a battle asleep; owned party Pokemon never nap on their own.
- **Alphas**: cannot sit on a shoulder; their eyes glow only while the Alpha Mark is active; their movesets take two TM moves (physical or special by the higher attack stat).
- **Baby size**: level 1 is drawn at 0.9, full size by level 9. Ambient cries about once a minute (the port's entities use Bedrock's 8 to 24 s). Scovillain lacks fire immunity.
- **Starter**: a player who already owns Pokemon keeps the right to a starter (box them, press the key); the port forfeits it. Pastured Pokemon cannot be ridden and are teleported back to the pasture when they stray.
- **Evolution and moves**: moves kept across an evolution go to the bench when the set is full and the evolution's own moves stay relearnable; a relearned move into an empty slot comes with 0 PP; TM unlocks count pre-evolutions' learnsets (a Raichu unlocks Pichu-only moves).
- **Ability Patch** on a hidden-ability Pokemon swaps it back to a standard ability (the port refuses). Portion berries (Figy, Wiki, Mago, Aguav, Iapapa) confuse a Pokemon whose nature dislikes the flavour. Persim and Lum cure confusion and Eggant infatuation as bag items; Dire Hit and Guard Spec give +1 friendship. Smoke Ball lets a trapped holder switch.
- **Items**: Poke Balls stack to 64 (port 16); Poke Rod durability 256 (port 64); Candied Apple and Candied Berry leave a stick; King's Rock, Never-Melt Ice, Galarica Wreath, Cleanse Tag and Spell Tag go in the helmet slot and render on the head; Medicinal Leek plants only in a water source and Vivichoke on farmland (the port places them anywhere); berries plant on farmland only (the port allows grass and dirt); the Galarica Nut's soil list lacks red sand, mycelium, moss, mud.
- **Blocks**: 30 or so blocks are waterloggable in Java (PC, pasture, TM Machine, gilded chests, plaques, orbs, placed medicines, coin pouches, tumblestone buds, saccharine leaves); only the Hearty Grains block is here. Light levels: Flame Orb 15, Light Ball 13, Life Orb 7, Luminous Moss 5, Wistensu 11, the stone blocks and ores 2 to 15; the port lights 23 blocks only. The healing machine recalls the party into itself (the port heals them where they stand). The pasture lamp lights while its screen is open (the port while Pokemon are out).
- **Name Tags**: Cobblemon refuses a Name Tag on a Pokemon; the port's `minecraft:nameable` spends the tag and the label then overwrites the name. Fix: `allow_name_tag_renaming: false`.
- **Structures**: a start carrying a `height_range` processor outside its range is discarded (so none on water); 29 rigid pieces carry a gravity processor and drape onto the ground (sandpit clearing, thermal crevice, berry patch, fossil formations); villages take Pokemon Centers at weight 35 in the houses pool, usually more than one; `block_rot` erodes the deserted house, tower and fallen statue; Galarica patches roll ages.
- **UI**: scanner frames show "Trainer Owned", the gender and the caught mark, and "Alpha"; TM and wallpaper unlocks are toasts; unselectable moves cannot be clicked and Switch is hidden while trapped; empty party slots are drawn collapsed.
- **RCT trainers** speak 16 lines per context (battle start, won, lost, cooldown, over cap, missing badges) as speech bubbles, names coloured by type; the League shop stocks Full Restore, Max Revive, Ethers and Elixirs; trainers have 30 HP and can be killed.
- **Commands**: `healpokemon` is refused in battle; `takepokemon` and `pctake` on another player put the Pokemon in the caller's party; `freezepokemon` freezes an animation frame.
- **Riding**: sneak never dismounts in Cobblemon (it descends); dismount is the send-out key, which leaves the Pokemon out, and is refused mid-air for fliers with a land ride; take-off needs a double jump (a single jump is the horse jump); Aprijuice is refused by a full Pokemon; birds drain 1.5x climbing straight up and dive at the Jump multiple; reversing at a third (horse), a quarter (boat, dolphin); air to water only when the eyes submerge; passengers dismount with the driver; mounting refused in battle, tethered, on a raft, mid-recall and under 0.75 scale.
- **Sacchi** and the standard NPC trainer (op-placed only): Sacchi checks for a healing machine and its charge and uses it; the standard trainer is Red/Green/Blue/Yellow with a doubles battle and a fixed level-100 team.

## Bedrock blocks these

Dispenser behaviours on custom blocks (shears harvests, honey and water bottles on logs); pottery sherd patterns (Bedrock's pot recipe and patterns are vanilla-only; the six sherds are brushed up but do nothing); the Automaton armour trim; paintings (only same-size vanilla overrides, no 3x2 slot for Slumber); the fishing boat's explorer map to a cove; the Disc Shelf's note-block sequencer; piglin anger at gilded chests; Hearty Grain Bale fall damage; structure-set exclusion zones; forced forward motion for jet mounts; sneak-to-descend instead of dismount; Cobblemon's own name-tag cancel is replaceable by the nameable flag.

## Not gaps after all

Bugwort and Sweet Incense are commented out of `CobblemonBlocks.kt` in 1.8.4; Scatter Bang, Sticky Glob and Poke Puff are unregistered; hourglass dusts are Supplementaries-only; Moonlight fluids are another mod's integration; tera type, dmax level, gmax factor and the tradeable flag have no player-facing effect; Rotom and Shaymin forms have no route in 1.8.4; `LightingData` is for dynamic-lights mods; `pokemon_gets_mad_at_thrower` is used by no species; the village long path is commented out upstream; Sacchi and the standard trainer are never spawned by Cobblemon itself.
