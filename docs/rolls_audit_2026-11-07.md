# Rates and rolls audit, 7 November 2026

Thirteen read-only audits compared every rate, chance, roll, formula, threshold and timing in the port against
Cobblemon 1.8.4's source (and the Pokemon Showdown build it bundles, `data/cobblemon/showdown.zip`), one area each.
Each finding below names Cobblemon's value and the port's; the "Fixed" column is filled in from the fix pass that
followed the same day (release 1.0.558). Items marked "upstream" are places where Cobblemon 1.8.4's shipped code
does not do what its data or comments intend; the port now follows the shipped behaviour, since that is what a
Cobblemon player meets, and the README notes each so it can be flipped when Cobblemon changes.

## Natural spawning (selection, filters, weights)

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Preset conditions dropped when a preset is mixed with `natural` (urban's concrete, the pyramids' bases and minY, webs' and salt's modded biomes): 260 entries, 115 species | preset conditions merged into the entry (`SpawnDetailPreset.apply`) | written as plain overworld rules at full weight (Stoutland, Sigilyph, Joltik-3, Nacli-2 anywhere) | yes |
| Untimed open-sky entries (`minSkyLight 8`, 1,259 entries) | raw sky light, so they spawn all night | `brightness_filter` min 8, which never passes at night | yes |
| Night and dusk entries with `minSkyLight 8` | any open sky in the window | brightness exactly 7, only during the dimming minutes | yes |
| Untimed `maxSkyLight 7` entries without `canSeeSky`/`maxY` (265 conditions, cave species) | never an open-sky spot | surface rules at brightness 0..7, so caves' species on the surface at night | yes |
| Per-species bucket totals | odds at a spot = P(bucket) x raw weight / eligible raw weight of the bucket there | every species one total per bucket: plains Rattata 9.66% of spawns there vs 0.30% here, uncommon bucket 5% vs about 0.4%, herds 31% of land spawns vs 47% | yes (biome-aware normalisation) |
| Legendary Encounters odds | ultra-rare roll then raw weight | weight 1 each: Ho-Oh and Xerneas 22x, Regigigas 30x, Mew 0.13x | yes |
| The datapack's `"weather"` key on legendaries (Zapdos, Rayquaza thunder; Ho-Oh clear) | not a `SpawningCondition` field, ignored: any weather | honoured, so thunderstorms only | yes (upstream) |
| Alpha herd rate after the 1.0.557 floor | boss bucket 0.3% | 0.54% land, 0.91% water (floor of 1 per condition) | yes (sub-1 conditions merged) |

Matching: bucket weights 94/5/0.5/0.2/0.3 (`best-spawner-config.json`), position type weights all 1, the twelve time
windows, moon phases, weather mapping, slime chunks 1 in 10, the cap of 9 per 3x3 chunks, despawn 600/3600 ticks at
32/96 blocks, spawn reach 16 to 64, nearby blocks 4 across 2 up, minY/maxY, canSeeSky, anticondition biomes, weight
multipliers, natural base blocks.

## Herds

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Alpha-led herds' followers (355 species whose leaders are named "x alpha") | followers match a leader by its full properties, alpha leaders tier +9001 | `herd_leaders` dropped aspect-named leaders: no follower group, nobody follows the alpha | yes |
| Wild alpha level | party-matched level floored at the species' minimum evolution level (Venusaur 32), re-applied while the level differs | no floor (level 9 Venusaur by a level 5 party), matched once per player | yes |
| Herd conditions at the fill | a herd that fails its weather or other condition is not selected | `fillHerd` fell back to every herd when none fit: 94 dry-weather seeds filled in rain, Flygon's in clear | yes |
| Member placement | a resolved position meeting every herd condition, no room spends no `maxTimes` | any non-liquid block within 6, `counts` spent before the spot was found | yes |
| Follow distance | walks when the leader is 4 to 8 away | `stop_distance` 4 | yes (6) |
| Leader election | re-elected every second among visible tolerated Pokemon | a coin flip at spawn fixes the roles | README note (Bedrock's `follow_mob` has no election) |

Matching: first member by weight (leader first), leader-first fill, `maxTimes`, size min(maxHerdSize, 8), herd level
and member clamp and offset, held items, alpha marking and scale, member drop tables, moon phase, cap check, regional
first members, boss bucket 0.3.

## Rolls on a new Pokemon

| Finding | Cobblemon 1.8.4 | Port before | Fixed |
| --- | --- | --- | --- |
| Wild level | `PokemonSpawnAction.createEntity` overwrites the party influence: uniform over the entry's range | narrowed to the party's best plus or minus 5 | yes (upstream) |
| Regional forms' abilities | the form's own list (Alolan Raichu Surge Surfer, Alolan Geodude Magnet Pull) | the base species' | yes |
| Random features whose plain choice is the base look | uniform or weighted over every choice (Toxtricity 50/50, Dudunsparce 99/1, Gyarados eyes 50/50, Minior 100% meteor with a hidden core) | the base look got 0 (100% Low Key, 100% three-segment, 100% purple eyes, 50% bare cores) | yes (full run) |
| Species with several random features (Spinda's spots, Alcremie's cream and decoration) | every feature rolled | one look from one feature | not carried (combination looks) |
| Marks sharing a 2% chance (uncommon, time, weather) | a TreeMap keyed on the chance merges them: only uncommon is ever awarded | each rolled, about 6.9% of catches marked vs 3.1% | yes (upstream) |
| `/spawnpokemon` and `/givepokemon` without `level=` | level 1 | the species' lowest spawn level | yes |
| `/givepokemon` shiny | 1 in 8192 | never | yes |
| Form base friendship (Galarian Stunfisk 50) | the form's | the species' 70 | yes |
| Tera type | rolled at creation | none | not carried (no Terastallization) |

Matching: shiny 1 in 8192, gender from maleRatio, nature uniform, IVs 0..31, friendship from baseFriendship, hidden
ability never on a wild Pokemon, ability slot kept on evolution, honey log odds, scale 0.95..1.05, alpha scale, alpha
level bands, mark time windows and chances, starter level 10, spawn-entry properties.

## Catching

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Dream Ball | 4x on a sleeping target, in battle and on a napper | 1x | yes |
| Heavy Ball | 1 / 1.5 / 2.5 / 4 at 100, 200, 300 kg | 1 / 2 / 3 / 4 | yes |
| Moon Ball | night from 12000; full 4x, gibbous 2.5x, quarters 1.5x | night 13000..23000; 4 / 3 / 2 | yes |
| Love Ball | 8x same species opposite gender active, 2.5x any opposite gender | 1x | yes |
| Lure Ball | 4x on a fished Pokemon | 1x | yes |
| Level Ball | 1x out of battle; strict > thresholds | party's strongest out of battle; >= | yes |
| Ultra Beasts | only the Beast Ball is 0.1x on non-beasts | every other ball 0.1x on Poipole and Naganadel | yes |
| Timer Ball | 1 + turn x 0.3, turn 1 on the first turn | turn - 1 | yes |
| Heal Ball | HP, PP and status restored | HP only | yes |
| Nest Ball at level 30 | 1x | 1.1x | yes |
| Park Ball biomes | Cobblemon's forest and plains tags | `/forest|plains/` (ice plains in, meadow and cherry grove out) | yes |
| Dive Ball | eyes under water | any part in water | yes |
| Dusk Ball light | max(block light, sky light minus the night darkening) | `getLightLevel` untimed | yes (closest reading) |
| Ancient ball throw power | Feather 2x, Heavy 0.6x of a normal throw | 1.33x and 0.67x | yes |
| Critical capture timing | shakes + 2 steps | shakes + 1 | yes |

Matching: the capture formula, 0.5x out of battle, status 2.5/1.5, the low-level bonus, shake probability and count,
critical capture odds by dex count, Master and Origin Balls, Beast Ball 5x, every flat multiplier, Net, Fast, Repeat,
Quick, Safari, Dusk thresholds, refusals, shake timing, post-catch effects.

## Battle formulas and rolls

| Finding | Showdown as bundled | Port before | Fixed |
| --- | --- | --- | --- |
| Damage roll | 16 steps 85..100 inclusive | continuous 0.85..1.0, the full roll never | yes |
| Wild alpha boosts | applied in `getStat` only (speed order and speed callbacks), not in the damage formula | Attack and Defence up to 4x | yes (upstream) |
| Metronome | a random move from the pool | did nothing | yes |
| Weather Ball | 100 power in weather | 50 | yes |
| Solar Beam and Solar Blade | halved in rain, sand, snow | full | yes |
| Sheer Cold by a non-Ice user | 20 base accuracy | 30 | yes |
| Toxic from a Poison type | never misses | 90% | yes |
| Frozen user's defrost moves | thaw and go | 20% roll | yes |
| Shield Dust and self secondaries | self boosts kept | blocked | yes |
| Effect Spore | 11/10/9 and powder immunity | 10/10/10, no immunity | yes |
| King's Rock, Razor Fang, Stench | a 10% secondary: Serene Grace doubles, Shield Dust blocks | flat 10% | yes |
| Screens in doubles | 2/3 | 1/2 | yes |
| Taunt | 3, or 4 after the target moved | 3 | yes |
| Flinch before the sleep counter | sleep ticks first | flinch first | yes |
| A napping wild foe | enters battle with a 2-turn sleep | sleep 0 | yes |

Matching: stat formulas, base damage and every multiplier, crit stages, stage multipliers, accuracy modifiers,
multi-hit 35/35/15/15, secondaries and Serene Grace, every status's numbers, residuals, durations, items, turn order,
variable powers, fixed damage, recoil and drain, hazards.

## Experience, EVs, friendship

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Form EV yield, base experience, base friendship (18 carried forms: Alolan Ninetales spe 2, Rotom appliances 182 exp) | the form's | the species root's | yes |
| Who faced a foe in PvP and doubles | per pair, active at the same turn start | one set that only grows: a benched Pokemon paid in full | yes |
| Several foes' experience | awarded per foe, level updated between | summed at the old level (707 vs 726) | yes |
| HP after a level-up | ratio kept, ceil | max-HP gain added | yes |
| Erratic curve, levels 68..97 | Cobblemon's integer order (level 97: 572,550) | the games' (571,333) | yes |
| Level cap message | the clamped gain | the unclamped | yes |

Matching: the formula and every multiplier, non-OT 1.5, Exp. Share 0.5, payment only on a win, level 100, EV caps,
vitamins, feathers, mochi, candies, the other five curves, friendship gains and losses, Luxury Ball and Soothe Bell,
the RCT level cap.

## Evolution

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Pancham to Pangoro | any Dark-type party member | compared the name to "type=dark": never | yes |
| Form-specific evolutions (Galarian Farfetch'd, Yamask, Meowth, Mr. Mime, Corsola, Linoone, Slowpoke; Hisuian Sneasel, Qwilfish; White-Striped Basculin; Paldean Wooper; Dusk Rockruff; Antique Sinistea; Artisan Poltchageist) | the form's own list | the base list: wrong species or none | yes |
| Maushold on evolution | Family of Three 1% | 100% | yes |
| Damage-taken counter (Runerigus) | the HP deficit after each hit | the hit's damage | yes |
| Crit counter (Sirfetch'd) | per battle | kept for good | yes |
| Defeat credit (Kingambit) | at battle end to every ally that faced the Bisharp | the KO's Pokemon only | yes |
| Permanent evolutions and held items | checked every second, item consumed when first met, permanent offers kept past the window | re-tested at the press | yes |
| Everstone | queued and hidden | cancelled (a traded Kadabra loses Alakazam) | yes |
| Shelmet by Link Cable with a Karrablast | evolves | refused | yes |
| Grotle holding an azalea | Torterra with the tree, azalea consumed | the plain evolution, azalea kept | yes |
| Fainted party members | count for party requirements | filtered out | yes |

Matching: every threshold and comparison, time windows, weather, Tyrogue, Gimmighoul, Wurmple 50/50, Toxel natures,
gender splits, Inkay, Sliggoo, Rockruff, Eevee, Mantyke, Vivillon, held item consumption, recoil counting, Shedinja,
friendship gains, animation timing, evolution drops.

## Berries, crops, trees

| Finding | Java | Port before | Fixed |
| --- | --- | --- | --- |
| Revival Herb growth | 1 in 7 per random tick on hydrated farmland, light 9 (about 64 min) | flat 1 in 26 per Bedrock tick (about 11.8 h) | yes |
| Medicinal Leek | 1 in 4 | 0.2 per Bedrock tick (3.75x slower) | yes |
| Vivichoke | farmland moisture, 1 in 7 | 0.2 (2.1x slower) | yes |
| Mints | 1 in 8 with light 9 | 0.2, no light | yes |
| Apricorns | 1 in 5 | 0.2 (3x slower) | yes |
| Galarica bush | 1 in 8, block light counts | 1/8 uncompensated, sky light only | yes |
| Bone meal on mints, Vivichoke, Leek, Hearty Grains | +1, +1, +1, +1..3 | nothing | yes |
| Hearty Grains harvest | upper drops 2..3 and the lower regrows from age 3 | a stump that never regrows | yes |
| Bone meal on berry bushes | one of 5 ages | one of 3 stages (5/3 the worth) | yes |
| Breaking a ripe bush | the full harvest | 1 berry | yes |
| Mulch on a flowering or ripe bush | refused | allowed | yes |
| Saccharine honey drip | 1 in 2 per random tick | 0.5 per Bedrock tick (3x slower) | yes |
| Saplings | two 1-in-7 successes, light 9, 45% per bone meal stage | one roll, one bone meal | yes |
| Berry mutation moment | when flowering begins | when fruit forms | yes |
| Wild berry grove rate | 1 in 25 per chunk everywhere; ages 3..5 about 31% ripe | 1 in 20 to 1 in 47 by biome; 67% ripe | yes (full run) |

Matching: all 70 berries' numbers, the growth timer, mulches, mutation 125/1000 and x4, honey log odds, apricorn
yields, Revival Herb ages and loot, tumblestone, roots, terrain seeds, Hearty Grains growth, Galarica, worldgen rates.

## Fishing and Poke Snacks

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Fishing buckets | 83.25 / 11.25 / 4.125 / 1.375 | the world buckets 94 / 5 / 0.5 / 0.2 (rare 8x rarer) | yes |
| An empty bucket roll | "Not even a nibble" | the rarer buckets' share given to those present | yes |
| Poke Rod Smithing Template | once at 16.7% | twice (30.6%) | yes |
| Rain hastening the wait | only where the biome rains | any rain | yes |
| Poke Snack bucket levelling | firstTier 1.2 | 1.29 (the rod's) | yes |
| Experience on a reel | 1..6 for a Pokemon too | items only | yes |

Matching: wait 100..600 and its decrements, 85% Pokemon, hook windows, loot shares, rod durability, bait consumption
and every bait effect, lure conditions and multipliers, the fishing pool, reel pull, the Poke Snack's radius, bites,
cycles, cap, buckets and seasonings.

## Drops, machines, loot

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Revived fossil level | 1 | the species' lowest spawn level (Aerodactyl 27) | yes |
| Drops naming Java-only items (lily pad, terracotta, jack o'lantern, dead bush: 9 species) | drop | never dropped | yes |
| Big Root in 18 formations' common brush loot | weight 6 of 39 | missing | yes |
| Sheared wool regrowth | mean 20 s | mean 40 s | yes |
| Ruins' vanilla book | 30-level treasure enchantment | plain book | yes |
| Cove barrel potions and bow | Water Breathing, damaged bow | water bottles, pristine bow | yes |

Matching: the drop algorithm and all 905 tables, death drop rules, interactions, shears, pickup, the fossil machine's
numbers, natural materials, the Data Monitor, Gimmighoul chests, 235 of 242 loot tables.

## Trainers, gyms, legendaries

| Finding | RCT / Radical Gyms | Port before | Fixed |
| --- | --- | --- | --- |
| Natural trainer spawn chance | a picked candidate spawns outright | rolled `computeChance` too: 42% at best, a few percent off-level | yes |
| Potion use | RCT's `evalItem` (Max Potion at half HP 0.21) | about four times RCT's (0.85) | yes |
| Pick within the margin | 1/(k + floor(16w)), ties 50% | 1/(i + 16w), ties always the later | yes |
| Status, buff and debuff scoring | stops boosting near +1 average, rates repeated status down, type-adjusted | none | yes |
| Per-move evaluators (92 moves) | Thunder Wave on Ground 0, Fake Out after turn one 0... | PP and Showdown blocks only | yes |
| Trainer Spawner block reach | 46.67 blocks, min 1.41 | 16, min 2 | yes |
| Unique-trainer radius | 500 | 1000 | yes |
| Summoned gym leaders | despawn like any trainer (600 ticks unattended, 6000 unseen) | persistent | yes |
| Unseen despawn | line of sight within 128 blocks every 40 ticks | any player within 48 every 20 | yes |
| Far despawn | 600 ticks with no player within 128 | at once at 128 and at the simulation edge | yes |
| Spawn column | down from +30 or up from -30 | always down | yes |
| Forced switch-in | `evalSwitch` with the margin pick | best type matchup | yes |
| Friendly coaches | itemBias 0, statusMoveBias 1, moveBias 1 | not read | yes |
| Speed penalty and damage estimate | randomised, with accuracy | fixed | yes |

Matching: the spawn interval and chance curve, caps, offsets, `computeWeight`, candidate filters, levels, the level
cap steps, cooldowns, health, force battle, repel rod, Trainer Association, loot resolution, AI defaults and
`evalSwitch`, fixed teams, gym placement, legendaries' levels and times.

## Generated data tables

| Finding | Source | Port before | Fixed |
| --- | --- | --- | --- |
| Wild moveset builder | `wild.json`: two offensive level-up moves and two TM moves, weighted | the four latest level-up moves | yes |
| Regional forms' abilities and level-up moves (54 and 70 forms) | the form's | the base's | yes |
| Female forms (Indeedee, Basculegion, Oinkologne, Meowstic) | own stats and abilities | none | yes |
| Secret Power | 70 power, 30% paralysis | a 100% SpA drop scraped from code, paralysis rolled twice | yes |
| Tera Blast, Triple Arrows, Mimic and Sketch targets | Showdown's | scraping errors | yes |

Matching: every move's power, accuracy, pp, priority, category, type, crit ratio, multihit, recoil, drain, heal, flags,
secondaries; every species' base stats, types, catch rate, male ratio, friendship, exp yield and group, EV yield,
abilities, height, weight, level-up and egg moves; the type chart; natures; dex numbers.

## Wild behaviour

| Finding | Cobblemon | Port before | Fixed |
| --- | --- | --- | --- |
| Melee damage | ceil(sqrt((Attack - 10)^0.875)) from the real stat (level 5 Rattata 2) | base Attack / 10 at every level (Rattata 6) | yes |
| Walking speed | 0.7 x 0.35 x 2.5 x walkSpeed, default 0.35 | walkSpeed itself, default 0.25 (1.63x) | yes (full run) |
| Flying speed | flySpeedHorizontal 0.3 for every flier | walkSpeed | yes (full run) |
| Hover wander | one spot in 120 ticks, 10 across, 5 up, 0..6 high | every tick, 8, 8, 1..4 | yes (full run) |
| Stroll and amphibious swim cadence | about 11 s; 3 s, 7 up | 6 s; 1 s, 5 up | yes (full run) |
| Looking | any living entity | players only | yes (full run) |
| Follow owner | teleport past 32, stop at 3 | 60, 2 | yes (full run) |
| Panic | while the attacker lives | 30 s | yes |
| Wary after a failed capture | not applied in 1.8.4 | 5..20 s avoidance | yes (upstream) |
| Breaking out of a ball while napping | sleep cleared | kept | yes |
| Nap filter | no weather test; not while retaliating | refused thunderstorms | yes |
| Sleep time lists ("167-11833,13702-22299", 14 species) | parsed | fell back to all day | yes |
| Sleep spot light (8 species need a glowing block) | tested | not tested | README note |
| Defend owner | 32 blocks, mobs targeting the owner too | 16 blocks, attackers only, 10 s | yes (32 blocks; targets unreadable) |

Matching: flee and defend flags, panic trigger, villager hostile ranges, relative speeds, melee reach and cooldown,
look distance, cry interval, sleep odds and hours, pickup, shoulder, follow start, swim speed, fish wander.
