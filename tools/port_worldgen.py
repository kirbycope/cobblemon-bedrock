"""Worldgen pieces port.py imports (tools/ is on its path), from Cobblemon's world package: the structures it places as
features rather than jigsaws (CobblemonFeature: the feature habitats and the three cave ruins), the odds its structure
sets give each structure as Java rolls a cell, and the height-range and gravity processors a jigsaw pool's pieces carry,
which scripts/main.js reads from jigsaw.js. Each function imports port when it runs, for its paths and biome filters."""
import glob
import json
import os

# CobblemonPlacedFeatures.kt: the biome tag each cobblemon:structure placed feature is added to (addFeatureToWorldGen)
FEATURE_BIOMES = {
    "habitats/treasure_hoard": "#cobblemon:is_overworld", "habitats/abandoned_fortress": "#minecraft:is_nether",
    "habitats/ancient_wellsprings": "#cobblemon:is_lush", "habitats/chorus_briars": "#cobblemon:is_end",
    "habitats/deep_roots": "#cobblemon:is_lush", "habitats/earthen_hives": "#cobblemon:is_dripstone",
    "habitats/exposed_geodes": "#cobblemon:is_overworld", "habitats/lost_ruins": "#cobblemon:is_overworld",
    "habitats/quartz_spikes": "#cobblemon:nether/is_wasteland", "habitats/rocky_tidepools": "#cobblemon:is_stony_beach",
    "habitats/root_nurseries": "#cobblemon:is_swamp", "habitats/sandy_tidepools": "#cobblemon:is_beach",
    "habitats/skeletal_fall": "#cobblemon:nether/is_soul_sand", "habitats/strange_crimson_fungal_dwellings": "#cobblemon:nether/is_wasteland",
    "habitats/strange_warped_fungal_dwellings": "#cobblemon:nether/is_wasteland", "habitats/volcanic_plumes": "#minecraft:is_nether",
    "habitats/rocky_outcrops": "#cobblemon:is_mountain",
    "ruins/crumbling_arch": "#cobblemon:is_overworld", "ruins/deep_crypt": "#cobblemon:is_deep_dark", "ruins/rooted_arch": "#cobblemon:is_lush",
}
# the Nether wastes: a tag of other mods' biomes besides minecraft:nether_wastes, which biome_filter_for does not resolve
FEATURE_FILTERS = {"#cobblemon:nether/is_wasteland": {"test": "has_biome_tag", "operator": "==", "value": "nether_wastes"}}
# the features Java buries in caves (a height range under the surface), placed in Bedrock's underground pass
UNDERGROUND = {"treasure_hoard", "ancient_wellsprings", "deep_roots", "earthen_hives", "exposed_geodes", "lost_ruins",
               "crumbling_arch", "deep_crypt", "rooted_arch"}


def create_feature_structures(convert, parse_processors, invalid, unmapped, loot_path, loot_counts, site_markers, sites, site_of):
    """Cobblemon's feature-placed structures (worldgen/placed_feature/habitats and ruins, CobblemonFeature): the 17 feature
    habitats (Treasure Hoard, Ancient Wellsprings, Rocky Outcrops, the tidepools, the Nether's and the End's) and the
    Crumbling Arch, Rooted Arch and Deep Crypt ruins. Java rolls a chunk at the placed feature's rarity, a y in its height
    range, scans up to seven blocks for the floor (deepslate, stone, the lava sea's top) and sinks the template its random
    offset; the template is one of the configured feature's, turned at random, its middle on the spot. Here each becomes
    a feature rule at that rarity over Bedrock's uniform y in the range, a snap to the floor within the scan's reach (the
    Nether's lava sea at y 31 and the sandy tidepool's y 58 under the beach placed outright), a scatter down the random
    offset and a weighted pick of the templates, converted with their processor lists. A template with suspicious blocks
    takes structure markers like a jigsaw piece, so a brush in it rolls its own tables. Returns how many were written."""
    import port
    count = 0
    for path in sorted(glob.glob(f"{port.worldgenMain}/placed_feature/habitats/*.json") + glob.glob(f"{port.worldgenMain}/placed_feature/ruins/*.json")):
        name = os.path.relpath(path, f"{port.worldgenMain}/placed_feature").replace(os.sep, "/")[:-len(".json")]
        with open(path, encoding="utf-8") as file: placed = json.load(file)
        config_path = f"{port.worldgenMain}/configured_feature/{placed.get('feature', '').split(':', 1)[-1]}.json"
        if not os.path.exists(config_path): continue
        with open(config_path, encoding="utf-8") as file: config = json.load(file).get("config", {})
        if not config.get("cobblemon_structures"): continue
        tag = FEATURE_BIOMES.get(name, "")
        biome_filter = port.biome_filter_for([tag]) or FEATURE_FILTERS.get(tag)
        if not biome_filter: continue
        placement = placed.get("placement", [])
        chance = next((p["chance"] for p in placement if p["type"] == "minecraft:rarity_filter"), 1)
        height = next((p["height"] for p in placement if p["type"] == "minecraft:height_range"), {})
        low = height.get("min_inclusive", {}).get("absolute", 0)
        high = height.get("max_inclusive", {}).get("absolute", low)
        scan = next((p for p in placement if p["type"] == "minecraft:environment_scan"), None)
        allowed = (scan or {}).get("allowed_search_condition", {}).get("blocks", []) if scan else []
        lava = "minecraft:lava" in allowed
        # the sandy tidepool: sandstone under a beach whose sand is six blocks up, so it is carved into the beach from y 58
        buried = (scan or {}).get("target_condition", {}).get("blocks") == ["minecraft:sand"]
        spread = -min(0, next((p.get("y_spread", 0) for p in placement if p["type"] == "minecraft:random_offset"), 0))
        processor_path = f"{port.worldgenMain}/processor_list/{config.get('cobblemon_processors', '').split(':', 1)[-1]}.json"
        processors = []
        if os.path.exists(processor_path):
            with open(processor_path, encoding="utf-8") as file: processors = parse_processors(json.load(file).get("processors", []))
        key = port.structure_key(placed["feature"])
        features = []
        for template in config["cobblemon_structures"]:
            source = f"{port.structuresMain}/{template.split(':', 1)[-1]}.nbt"
            if not os.path.exists(source): continue
            piece = port.structure_key(template)
            destination = f"{port.structuresBedrock}/{piece}.mcstructure"
            brush = {}
            convert(source, destination, invalid, unmapped, processors, loot_path=loot_path, loot_counts=loot_counts, brush_counts=brush)
            if brush and piece not in site_of and len(sites) < 256:
                overrides, info = site_markers(source, len(sites))
                if info:
                    site_of[piece] = len(sites); sites.append({**info, "s": [placed["feature"]], "t": brush})
                    convert(source, destination, invalid, unmapped, processors, loot_path=loot_path, overrides=overrides)
            with open(f"{port.featuresBedrock}/{piece}_piece.json", "w") as file:
                file.write(json.dumps({"format_version": "1.13.0", "minecraft:structure_template_feature": {
                    "description": {"identifier": f"cobblemon:{piece}_piece"}, "structure_name": f"cobblemon:{piece}",
                    # CobblemonFeature places the template wherever the scan put it, whatever it replaces
                    "adjustment_radius": 0, "facing_direction": "random", "constraints": {}}}, indent=2))
            features.append([f"cobblemon:{piece}_piece", 1])
        if not features: continue
        write = lambda feature, kind, body: open(f"{port.featuresBedrock}/{feature}.json", "w").write(
            json.dumps({"format_version": "1.13.0", kind: {"description": {"identifier": f"cobblemon:{feature}"}, **body}}, indent=2))
        write(f"{key}_pick", "minecraft:weighted_random_feature", {"features": features})
        # Java's origin is the block the scan found, the floor itself or the lava's top; Bedrock's floor snap gives the
        # air above the floor, so the sink starts a block lower there
        down = 0 if lava or buried else 1
        sink = {"places_feature": f"cobblemon:{key}_pick", "iterations": 1, "x": 0, "z": 0,
                "y": {"distribution": "uniform", "extent": [-(spread + down), -down]} if spread else -down}
        if lava or buried: write(key, "minecraft:scatter_feature", sink)
        else:
            write(f"{key}_sink", "minecraft:scatter_feature", sink)
            write(key, "minecraft:snap_to_surface_feature", {"feature_to_snap": f"cobblemon:{key}_sink", "vertical_search_range": (scan or {}).get("max_steps", 7), "surface": "floor"})
        base = name.split("/")[-1]
        distribution = {"iterations": 1, "scatter_chance": {"numerator": 1, "denominator": chance},
                        "x": {"distribution": "uniform", "extent": [0, 15]}, "y": {"distribution": "uniform", "extent": [low, high]} if low != high else low,
                        "z": {"distribution": "uniform", "extent": [0, 15]}}
        # the tidepool needs the beach's sand six blocks over its sandstone: a surface that high
        if buried: distribution["iterations"] = f"(query.heightmap(variable.originx + 8, variable.originz + 8) >= {low + 6}) ? 1 : 0"
        with open(f"{port.featureRulesBedrock}/{key}_rule.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:feature_rules": {
                "description": {"identifier": f"cobblemon:{key}_rule", "places_feature": f"cobblemon:{key}"},
                "conditions": {"placement_pass": "underground_pass" if base in UNDERGROUND else "surface_pass", "minecraft:biome_filter": biome_filter},
                "distribution": distribution}}, indent=2))
        count += 1
    print(f"  feature structures: {count} placed features (the feature habitats and the arch and crypt ruins)")
    return count


# vanilla's own biome tags Cobblemon's tag files name (data/minecraft/tags/worldgen/biome in the vanilla jar), and
# Fabric's common tags, for the biomes a structure can stand in; is_overworld is left to mean everywhere
VANILLA_TAGS = {
    "#minecraft:is_taiga": ["taiga", "snowy_taiga", "old_growth_pine_taiga", "old_growth_spruce_taiga"],
    "#minecraft:is_savanna": ["savanna", "savanna_plateau", "windswept_savanna"],
    "#minecraft:is_badlands": ["badlands", "eroded_badlands", "wooded_badlands"],
    "#minecraft:is_jungle": ["bamboo_jungle", "jungle", "sparse_jungle"],
    "#minecraft:is_beach": ["beach", "snowy_beach"], "#minecraft:is_river": ["river", "frozen_river"],
    "#minecraft:is_ocean": ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean", "frozen_ocean", "ocean", "cold_ocean", "lukewarm_ocean", "warm_ocean"],
    "#minecraft:is_deep_ocean": ["deep_frozen_ocean", "deep_cold_ocean", "deep_ocean", "deep_lukewarm_ocean"],
    "#minecraft:is_mountain": ["meadow", "frozen_peaks", "jagged_peaks", "stony_peaks", "snowy_slopes", "cherry_grove"],
    "#minecraft:is_forest": ["forest", "flower_forest", "birch_forest", "old_growth_birch_forest", "dark_forest"],
    "#minecraft:is_hill": ["windswept_hills", "windswept_gravelly_hills", "windswept_forest"],
    "#minecraft:is_nether": ["nether_wastes", "crimson_forest", "warped_forest", "soul_sand_valley", "basalt_deltas"],
    "#minecraft:is_end": ["the_end", "end_highlands", "end_midlands", "small_end_islands", "end_barrens"],
    "#c:is_stony_shores": ["stony_shore"],
}


def biome_set(ref, seen=()):
    """The vanilla biomes a structure's biome reference names: a set of minecraft: ids from Cobblemon's own tag files
    (other mods' optional members left out) and VANILLA_TAGS, or None for a reference the data cannot resolve."""
    import port
    if not ref.startswith("#"): return {ref} if ref.startswith("minecraft:") else set()
    if ref in VANILLA_TAGS: return {f"minecraft:{b}" for b in VANILLA_TAGS[ref]}
    namespace, tag = (ref[1:].split(":", 1) + [""])[:2]
    if namespace == "c": namespace = "cobblemon"   # Fabric's common tags, which Cobblemon names the same way
    path = f"{port.cobblemonData}/tags/worldgen/biome/{tag}.json"
    if namespace != "cobblemon" or ref in seen or not os.path.exists(path): return None
    with open(path, encoding="utf-8") as file: values = json.load(file).get("values", [])
    out = set()
    for value in values:
        if isinstance(value, dict): continue   # another mod's biome, optional
        if not isinstance(value, str): continue
        if value.startswith("#"):
            inner = biome_set(value, seen + (ref,))
            if inner is None: return None
            out |= inner
        elif value.startswith("minecraft:"): out.add(value)
    return out


def structure_odds(odds):
    """Each jigsaw structure's chunks per placement as Java's ChunkGenerator.createStructures rolls them: a set places one
    structure in each spacing-by-spacing chunk cell, drawn by weight from its members, and when the drawn one's biomes do
    not hold at the cell it is dropped and another drawn, so a member shares a cell only with the members that can stand
    in the same biome. For each member the share is its weight over the weights of the members whose biomes include the
    biome, averaged over its biomes; a member whose biomes the data cannot read competes everywhere, and keeps the share
    structure_spacing() gave it (spacing squared times the whole set's weight over its own)."""
    import port
    for path in sorted(glob.glob(f"{port.worldgenMain}/structure_set/**/*.json", recursive=True)):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        spacing = data.get("placement", {}).get("spacing", 32)
        members = []
        for entry in data.get("structures", []):
            structure_path = f"{port.worldgenMain}/structure/{entry['structure'].split(':', 1)[-1]}.json"
            biomes = None
            if os.path.exists(structure_path):
                with open(structure_path, encoding="utf-8") as file: biomes = json.load(file).get("biomes")
            refs = [biomes] if isinstance(biomes, str) else (biomes or [])
            ids = set()
            for ref in refs:
                found = biome_set(ref)
                if found is None: ids = None; break
                ids |= found
            members.append((entry["structure"], entry.get("weight", 1), ids))
        for structure, weight, ids in members:
            if not ids: continue
            shares = [weight / sum(w for _, w, other in members if other is None or biome in other) for biome in sorted(ids)]
            odds[structure] = round(spacing * spacing / (sum(shares) / len(shares)))
    return odds


def piece_fit(inner):
    """How a pool element meets the ground, for jigsaw.js: (flag, hr). flag is 1 for a terrain_matching element (its blocks
    dropped to the surface heightmap less one), a gravity processor's own offset (-2, -4, -6, a negative number) for a rigid
    element whose processor list drapes it onto the surface heightmap at that offset (GravityProcessor), else 0; hr is
    [min, max] over sea level from a cobblemon:height_range processor (HeightRangeStructureProcessor, whose range
    StructureMixin discards a whole start outside of), or None."""
    import port
    flag = 1 if inner.get("projection") == "terrain_matching" else 0
    hr = None
    processors = inner.get("processors")
    if isinstance(processors, str):
        path = f"{port.worldgenMain}/processor_list/{processors.split(':', 1)[-1]}.json"
        if os.path.exists(path):
            with open(path, encoding="utf-8") as file: processors = json.load(file)
        else: processors = {}
    processors = (processors or {}).get("processors", []) if isinstance(processors, dict) else []
    for processor in processors:
        kind = processor.get("processor_type")
        if kind == "gravity" and not flag and str(processor.get("heightmap", "WORLD_SURFACE_WG")).startswith("WORLD_SURFACE"):
            flag = min(-1, int(processor.get("offset", -1)))
        if kind == "cobblemon:height_range" and processor.get("reference", "sea_level") == "sea_level":
            hr = [int(processor.get("min_offset", -100)), int(processor.get("max_offset", 300))]
    return flag, hr
