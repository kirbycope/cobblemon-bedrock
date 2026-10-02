# Cobblemon Bedrock: what is left to port, and how

Written for an agent continuing this port. Everything below builds on `port.py` (1,687 lines, one
generator per Bedrock file kind), `scripts/main.js` (turn-based battles, Script API) and the three
tools under `tools/`. Read `README.md` first: it lists what each generator produces and from which
Cobblemon file. The upstream repository is a sparse clone at `java/`
(git-ignored), commit `6bc974f9`, and the paths below are relative to
`java/common/src/main/resources`.

## Status (September 2026)

All eight phases are in. What each carries and leaves out is in README.md's generator table.

| Phase | State |
| --- | --- |
| 1 forms, shinies, gender | Done, with species features (Unown letters, Vivillon wings, Valencian Vileplume) as extra forms |
| 2 Poke Ball types | Done: 49 balls, world and battle multipliers, ball picker |
| 3 riding | Done, flight included: fliers use the happy ghast's controls at entity format 1.26.30, and every Pokemon's identifier became `cobblemon:p<number>_<name>` to allow it |
| 4 evolution beyond level-up | Item and trade evolutions done; biome-gated regional evolutions left out |
| 5 Pokemon interactions | Done: 150 drops |
| 6 structures | 65 of 67 worldgen structures, start piece only |
| 7 berries and blocks | 70 berry bushes, the healing machine, and fossils (the revival machine, 15 fossils, 23 fossil formations with brushing) the PC (40 boxes of 30) and the pasture |
| 8 battle depth | Done: stages, statuses, abilities table, experience, PP, party and switching |

Regenerate with the full `python port.py --fix`. Rebuilding blocks alone once left every custom block invisible on the client with nothing in its log.

After the plan: the PC (40 boxes of 30), the pasture, fishing with the 48 Poke Rods, the Pokedex, apricorn trees and 147 converted recipes are in. Cobblemon's config defaults are used where they apply: shiny odds 1 in 8192, two fossils in the analyzer, 40 PC boxes.

## Ground rules

1. **Everything is generated.** Never hand-edit a file under `development_behavior_packs/` or
   `development_resource_packs/`; `port.py --fix` wipes and regenerates those folders. Add a generator
   (or extend one) in `port.py`, call it from `main()`, run `python port.py --fix` (about 90 seconds),
   then `python tools/deploy.py` (writes the bumped pack version into the server world and restarts
   BDS, about 60 seconds). The client caches the server's pack by version, so a deploy without the
   bump shows the old pack.
2. **Verify in the client, on the flat platform.** `python tools/bridge.py "fill 35 70 40 75 70 80 grass_block"`
   exists at spawn already. Stage with `bridge.stage(br, "cobblemon:<id>", spot=(50, 70, 55))`, capture
   with `client_drive.shot()`, read the capture. After a deploy the client shows a disconnect dialog:
   `client_drive.recover()` then `client_drive.join()`, and confirm with `bridge.check()`.
3. **Short steps.** No tool call may block more than about a minute. Call `bridge.check()` between
   steps and at least every 30 seconds of a run; stop at the first deviation. `bridge.protect()` keeps
   the player alive (stage() calls it).
4. **Errors live in two logs.** Server: `C:\GitHub\bedrock-server\bds.out.log` (`[error]`). Client:
   newest `%APPDATA%\Minecraft Bedrock\logs\ContentLog*.txt`, which can reach 50 MB; grep it with a
   time prefix, never cat it. A clean run adds no `[error]` lines to either.
5. **Molang and JSON debris.** Cobblemon's Blockbench exports are dirty; `fix_molang()` and
   `fix_animations()` carry every repair found so far. When a new class of error appears, add the
   repair there rather than patching a file.
6. **Selectors run at the world origin** when the bridge sends them; count around the player with
   `execute as Kirbycope at @s run testfor @e[...]` or `bridge.near()`.
7. **Commit nothing** unless asked; the repository has about 7,300 uncommitted changes from the
   port and that is expected.

## Phase 1: forms, shinies and gender (biggest visible payoff)

Cobblemon draws variants through **aspects**. Each resolver file
(`assets/cobblemon/bedrock/pokemon/resolvers/<id>/*.json`) has a `variations` list; the base
variation has `"aspects": []` and the rest name aspects such as `shiny`, `female`, `alolan`,
`hisuian`, `galarian`, `paldean`. A variation may override `model`, `texture`, `layers` and `poser`,
and a later resolver file (`1_<name>_shiny.json`) adds to the earlier one. Counts across the pack:
`shiny` 1175, `female` 149, `alolan` 67, `hisuian` 43, `galarian` 40, `paldean` 12.

Bedrock has no aspects; use **entity variants**.

1. In `port.py`, replace `resolver_layers(pokemon)` (currently returns the base variation's layers)
   with `resolver_variations(pokemon)` returning an ordered list of
   `{aspects, model, texture, layers}`, fully resolved (a variation inherits what it does not
   override from the base). Keep only aspects from this set for now: `shiny`, `female`, `alolan`,
   `galarian`, `hisuian`, `paldean`. Drop the `alpha_eyes` and `cosmetic_item-*` variations.
2. Number the variations: base is variant 0, each further variation gets the next integer. Write the
   list into the client entity as `textures` (`default_<n>`, `<layer>_<n>_<frame>`) and `geometry`
   (`default_<n>`), and generate one render controller per variant per layer whose `geometry` and
   `textures` pick by `query.variant`, for example
   `"geometry": "Geometry.default_0"` in a controller guarded by an array lookup:
   `"arrays": {"textures": {"Array.base": ["Texture.default_0", "Texture.default_1", ...]}, "geometries": {"Array.geo": ["Geometry.default_0", ...]}}`,
   `"geometry": "Array.geo[query.variant]"`, `"textures": ["Array.base[query.variant]"]`.
   Layers that exist only for some variants need a per-variant controller with
   `"materials"` plus an array of textures and a Molang guard in `part_visibility`, or simpler: emit a
   separate render controller per (variant, layer) and list them all, each guarded by
   `"geometry"`-level Molang is not available, so use one controller per layer with texture arrays
   indexed by `query.variant` and a transparent 1x1 texture (`textures/entity/blank.png`, generate
   it) for variants that lack the layer.
3. In the behavior entity, add component groups `cobblemon:variant_<n>` each holding
   `"minecraft:variant": {"value": n}`, an event `cobblemon:set_variant_<n>`, and on
   `minecraft:entity_spawned` a `randomize` that picks the base with weight 100, `female` with the
   species' `maleRatio` (a female variant is chosen with probability `1 - maleRatio` when a female
   variation exists), regional forms only in their biome (use `species.forms[].labels` and the spawn
   pool's biome; simplest first cut: regional variants weight 0 at spawn, only via `/event`), and
   `shiny` with weight 1 in 8192 scaled to the randomize's total.
4. Names and panels: a shiny keeps the species name; regional forms display
   `<Form> <Name>` (lang key `cobblemon.species.<key>.<form>.name` if present, else prefix the form
   label capitalised). The dialogue scene is per species, so add a `Form` line to the panel text only
   if the species has forms.
5. Filled Poke Balls: `cobblemon:poke_ball_<id>` places the base variant. Add
   `cobblemon:poke_ball_<id>_v<n>` items only if item count stays under Bedrock's practical limit
   (about 4,000 items total is fine; 904 species x 4 variants is not). Instead, keep one item per
   species and store the variant in the entity's persistence: capture via `cobblemon:captured` group
   already despawns the entity, so the variant is lost. Accept that for now and note it in README.
6. Verify: stage `0025_pikachu` (`alolan` variation with its own model `pikachu_alolan_male`),
   `0045_vileplume` (female texture), `0004_charmander` with `/event entity @e[...] cobblemon:set_variant_<shiny>`.
   Content log must add no errors; each variant must render with its own texture and, for Alolan
   Pikachu, its own geometry.

Species features (`data/cobblemon/species_features/*.json`, `species_feature_assignments/*.json`)
are the same mechanism with a choice list (`isAspect: true`, `aspectFormat` such as
`{{choice}}-fusion`). Port them after the six aspects above work, mapping each choice to a variant.

## Phase 2: Poke Ball types

Cobblemon ships 49 ball textures (`assets/cobblemon/textures/poke_balls/<name>.png`, item icons in
`textures/item/poke_balls/<name>.png`), one variation file per ball in
`assets/cobblemon/bedrock/poke_balls/variations/0_<name>_base.json` (all share
`poke_ball.geo` except the `ancient_*` balls, which use `ancient_poke_ball.geo`), and the catch
modifiers only in the lang tooltips (`item.cobblemon.<name>.tooltip`, for example
`great_ball` 1.5x, `ultra_ball` 2x, `master_ball` guaranteed, `dusk_ball` 3.5x at light 0,
`net_ball` 3x on Water or Bug, `dream_ball` 4x on sleeping, `quick_ball` 5x on the first battle turn,
`heavy_ball` by weight, `fast_ball` 4x on base Speed 100+, `nest_ball` by level, `level_ball` by
level difference, `timer_ball` by turn, `park_ball` 2.5x in forest or plains, `dive_ball` 3.5x
submerged, `lure_ball` 4x when fished, `beast_ball` 0.1x except Ultra Beasts, `love_ball` by gender,
`repeat_ball` 3.5x if already caught, `moon_ball` by moon phase, `friend_ball`, `luxury_ball`,
`heal_ball`, `premier_ball`, `cherish_ball`, `safari_ball`, `sport_ball` 1.5x, the colour balls 1x).

1. Generate `items/balls/<name>.json` for every variation file: `minecraft:throwable`,
   `minecraft:projectile` pointing at `cobblemon:ball_<name>`, icon `<name>` (copy the item texture
   into `textures/items/` and register it in `item_texture.json`), display name from
   `item.cobblemon.<name>` in the lang file. Keep `cobblemon:poke_ball` as is for compatibility.
2. Generate one projectile entity per ball, `cobblemon:ball_<name>`, from `create_poke_ball_entity()`
   with the ball's texture and geometry, and family `poke_ball` plus `ball_<name>`.
3. The catch roll happens in the Pokemon's damage sensor (`add_capture()`): today one trigger on
   `is_family poke_ball` fires `cobblemon:catch_attempt`. Give each ball its own trigger
   (`is_family ball_<name>`) firing `cobblemon:catch_attempt_<name>`, and generate a `randomize` per
   ball with the multiplier applied to the success weight. Multipliers that depend on state map as:
   sleeping (`is_sleeping` filter, already used), light (`is_brightness` filter for Dusk), biome
   (`is_biome` filter for Park), in water (`in_water` for Dive), types (species types, static), base
   speed (static), weight (static from `species.weight`), level (static: the Pokemon's spawn level
   against 30 for Nest). Turn-based, gender, moon, fished, repeat and love modifiers: use 1x and list
   them in README as approximations.
4. In `scripts/main.js` `throwBall()`, look up the ball item's type id, apply the same multiplier
   table (generate it into `data.js` as `BALLS = {name: {mult, rule}}`) and consume that item rather
   than only `cobblemon:poke_ball`. Add a ball picker to the battle form when the player holds more
   than one kind.
5. Trainer battle scene buttons and `create_items()` naming stay; add `item.cobblemon:ball_<name>.name`
   lines to `create_texts()`.
6. Verify: give `cobblemon:great_ball`, throw at a staged Tropius; the projectile renders with the
   great ball texture; capture yields `cobblemon:poke_ball_0357_tropius` (the filled ball stays
   species-keyed). Give `cobblemon:master_ball`, throw at a Charizard: 100 percent capture.

## Phase 3: riding

Cobblemon marks rideable species with `riding.behaviours` (`AIR`, `LAND`, `WATER` keys mapping to
`ride_settings` presets: `bird`, `horse`, `dolphin`, `boat`, `glider`, `helicopter`, `hover`, `jet`,
`rocket`, `submarine`, `vehicle`, `burst`, `minekart`) and `riding.seats` (`[{"locator": "seat_1"}]`).
The animation files carry `ride_*` animations (Charizard: `ride_air_fly`, `ride_air_dive`,
`ride_ground_run`, `ride_jump`).

1. Behavior: for species with `riding`, add `minecraft:rideable` with `seat_count` from `seats`,
   `family_types ["player"]`, `interact_text "action.interact.ride"`, `controlling_seat 0`, and a
   `seats` entry whose `position` is the `seat_1` locator's offset (`locator_offset()` exists).
   Add `minecraft:input_ground_controlled` for LAND, `minecraft:input_air_controlled` for AIR (this is
   the component the vanilla happy ghast uses; if the server rejects it on this build, fall back to
   LAND only), and a `cobblemon:ridden` component group toggled by `minecraft:entity_rider_added`
   style events is not available, so instead use the client-side `query.is_riding` to switch the pose
   controller into a `ride` state that plays `ride_ground_run` while `q.modified_move_speed > 0.1`
   and `ride_air_fly` when `!q.is_on_ground`.
2. Owned Pokemon only: riding a wild one is off; put `minecraft:rideable` in the `cobblemon:owned`
   group.
3. The interact conflict: an owned Pokemon's right-click currently opens the panel (NPC component).
   Bedrock gives `minecraft:rideable` priority when sneaking is false and the interact text is set;
   test which wins, and if the panel wins, add a `Ride` button to the panel that runs
   `/ride @initiator start_riding @s`.
4. Verify on the platform: claim a Charizard, ride it, film a short run with `client_drive` (hold
   `w`, capture every half second, `bridge.check()` between), confirm the ride animation plays.

## Phase 4: evolution beyond level-up

`species.evolutions[]` has `variant` in `level_up` (528), `item_interact` (65), `trade` (26) and
requirements `level` (413), `held_item` (92), `time_range` (83), `biome` (57), `properties` (49),
`friendship` (19), `structure` (19), `has_move` (16). Today only `level_up` with a `level`
requirement is ported (`cobblemon:growing` timer in `create_behavior_entities()`).

1. `item_interact`: `requiredContext` names the item (`cobblemon:thunder_stone`). Generate the 52
   evolution items from `assets/cobblemon/textures/item/evolution/` (icons, names from lang), and add
   `minecraft:interact` to the Pokemon with one entry per evolution: `on_interact` filter
   `has_equipment` with the item, `use_item true`, event `cobblemon:evolve_to_<id>` that removes
   `cobblemon:growing` and adds a transformation group for that result. `pokemon_for_species_name()`
   resolves the result.
2. `time_range` and `biome` requirements: add `filters` on the transformation event through an
   `environment_sensor` trigger (`is_daytime`, `is_biome`).
3. `trade`: no trading exists; treat as `item_interact` with a generated `cobblemon:link_cable`
   item (Cobblemon has one: `textures/item/link_cable.png` if present, else evolution folder).
4. `held_item` and `friendship`: skip, note in README.
5. Verify: give a thunder stone, interact with a claimed Pikachu, it becomes a Raichu (owned state
   must carry over: the transformation's `keep_level` plus re-adding `cobblemon:owned` on
   `minecraft:entity_transformed` for an entity that had it; use a `cobblemon:was_owned` property
   set through `minecraft:entity_transformed`'s filters or, simpler, re-tame in `main.js` on
   `entityDie`/spawn events by reading a dynamic property copied before the transform).

## Phase 5: Pokemon interactions and drops

`data/cobblemon/pokemon_interactions/*.json` (167 files): a `requirements` block (usually
`properties` target species) and `interactions[]` with `requirements` such as `owner_held_item`
(`#c:fertilizers`, `minecraft:shears`) and `effects` `shrink_item`, `drop_item`, `play_sound`,
`give_item`. Map each to `minecraft:interact` on the owned group: filter `has_equipment` on the
item, `use_item`, `spawn_items` loot table generated per interaction, `play_sounds` from the sound
id if it exists in the pack, and `cooldown` from the file (ticks divided by 20). Verify on
Abomasnow (bone meal gives a spruce sapling).

## Phase 6: structures and world

`data/cobblemon/structure/**` holds 1,235 `.nbt` structures (9.8 MB): `ruins`, `fishing_boats`,
`shipwreck_coves`, `habitats`, `fossils`, five village sets. Worldgen under
`data/cobblemon/worldgen/structure/<group>/<name>.json` gives the biome tag, jigsaw start pool and
size. Bedrock cannot place jigsaw pools, only whole `.mcstructure` files through feature rules.

1. Convert each `.nbt` to `.mcstructure` with a script (`tools/nbt_to_mcstructure.py`; the Java
   block palette must be mapped to Bedrock names, which the existing `BIOME_FILTERS` style table can
   hold for the few hundred blocks the ruins use; unmapped blocks become air and get logged).
2. For each worldgen structure, generate a `features/<name>.json` (`minecraft:weighted_random_feature`
   over the start pool's pieces as `minecraft:structure_template_feature`) and a
   `feature_rules/<name>.json` with `minecraft:biome_filter` from the biome tag (reuse
   `biome_filter_for()`), `scatter_chance` from the structure set's spacing, placement on the
   heightmap.
3. Start with `ruins/ancient_dais_ruins` (start pool `cobblemon:ruins/ancient_dais_ruins`, biome
   `#cobblemon:is_highlands`, size 7) and verify with `/locate` is unavailable for custom features, so
   teleport across fresh meadow chunks and `bridge.near("type=item")` is not enough; instead place it
   directly with `/structure load` first to prove the conversion, then check natural placement by
   scanning a few thousand blocks of new terrain for its marker block.

## Phase 7: berries, fossils, blocks

- Berries: 72 models under `assets/cobblemon/bedrock/berries/`, 70 data files (`growthTime`,
  `preferredBiomeTags`, `baseYield`). Port as custom crop blocks with the model as
  `minecraft:geometry`, growth stages from `growthTime`, and a `minecraft:loot` of the berry item.
- Fossils: 76 models; the fossil machine mechanic needs the resurrection block, defer.
- Block entities: 7 gilded chest variations, PC, healing machine, pasture. The healing machine is
  worth doing: a block whose interaction runs the professor's heal commands
  (`create_npcs()` scene `cobblemon:npc_sacchi`).

## Phase 8: battle depth (main.js)

In order: status moves that set stat stages (`boosts` in Showdown's moves.js, already parsed into
`data.js` if `showdown_moves()` keeps the `boosts` field; it drops it today, add it), accuracy and
evasion stages, secondary effects (`secondary.chance` and `status` brn/par/psn/slp with the
main-series damage and skip rules), abilities from `species.abilities` with a small table (Blaze,
Torrent, Overgrow, Static, Levitate, Intimidate first), experience and level-up (health formula
`hpAt()` already scales by level; store level as a dynamic property, award experience from
`species.baseExperienceYield`, learn moves from the learnset on level-up), PP per move, and a
party of up to six owned Pokemon with a switch button (find owned Pokemon by the `cobblemon:owner`
dynamic property, teleport the chosen one in).

## Things that will not port

- Cobblemon's own Molang queries in animations (`q.r.*`, `q.input_up`): stripped by `fix_molang()`.
- The three tail-flame particles have no texture upstream and are dropped.
- Client-side particle emitters attached through the resource pack do not render on this dedicated
  server; ambient particles go through the server-side controller route (README explains it). Any
  new particle-driven feature must use `/particle` from a behavior-pack animation controller or
  from `main.js` (`dimension.spawnParticle`).
- Cosmetic items (`cosmetic_item-*` aspects), marks, wallpapers, paintings, advancements, recipes
  (Bedrock recipes are possible but there is no crafting content to unlock yet).
