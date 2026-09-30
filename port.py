"""Port Cobblemon's assets and data to a Bedrock behavior pack and resource pack.

    python port.py         full port: fetch the Cobblemon repository, copy models, animations, textures
                           and cries, download the spawn egg sprites, then generate everything below
    python port.py --fix   regenerate only: repair the copied animations and models, then rebuild the
                           animation controllers, render controllers, client entities, behavior
                           entities, loot tables, NPC dialogue scenes and sound definitions

The generated files come from Cobblemon's own data rather than from a template:

- a Pokemon's behavior (hitbox, scale, health, how it moves, whether it fights or flees, what it
  drops, what it evolves into) comes from its species file under data/cobblemon/species
- its animation controller comes from the animation names its own animation file carries
  (ground_idle, ground_walk, air_fly, water_swim, sleep, blink and so on)
- its interact wheel and name label are the script's (scripts/main.js), on Cobblemon's own GUI textures
"""
import collections
import glob
import json
import math
import os
import re
import shutil
import sys
import textwrap
import urllib.request

from PIL import Image, ImageDraw

import poses

pokemons = None
pwd = os.getcwd()

# cobblemon-bedrock
resourcePack = f"{pwd}/development_resource_packs/cobblemon"
behaviorPack = f"{pwd}/development_behavior_packs/cobblemon"
animationsBedrock = f"{resourcePack}/animations"
animationControllersBedrock = f"{resourcePack}/animation_controllers"
renderControllersBedrock = f"{resourcePack}/render_controllers"
entityBedrock = f"{resourcePack}/entity"
modelsBedrock = f"{resourcePack}/models/entity"
soundsBedrock = f"{resourcePack}/sounds"
textsBedrock = f"{resourcePack}/texts"
texturesEntityBedrock = f"{resourcePack}/textures/entity"
texturesItemsBedrock = f"{resourcePack}/textures/items"
entitiesBedrock = f"{behaviorPack}/entities"
lootTablesBedrock = f"{behaviorPack}/loot_tables/entities"
dialogueBedrock = f"{behaviorPack}/dialogue"
spawnRulesBedrock = f"{behaviorPack}/spawn_rules"

# java/ (a sparse clone of https://gitlab.com/cable-mc/cobblemon, see get_cobblemon; git-ignored, never committed)
cobblemonRepo = f"{pwd}/java"
cobblemonResources = f"{cobblemonRepo}/common/src/main/resources"
cobblemon = f"{cobblemonResources}/assets/cobblemon"
cobblemonData = f"{cobblemonResources}/data/cobblemon"
animationsMain = f"{cobblemon}/bedrock/pokemon/animations"
modelsMain = f"{cobblemon}/bedrock/pokemon/models"
texturesMain = f"{cobblemon}/textures/pokemon"

SPARSE_PATHS = [
    "common/src/main/resources/data/cobblemon",
    "common/src/main/resources/assets/cobblemon/bedrock",
    "common/src/main/resources/assets/cobblemon/lang",
    "common/src/main/resources/assets/cobblemon/sounds",
    "common/src/main/resources/assets/cobblemon/textures/pokemon",
]


def fresh(folder):
    """Empty a folder that is generated in full, so a Pokemon that no longer qualifies leaves no stale file."""
    if os.path.isdir(folder): shutil.rmtree(folder)
    os.makedirs(folder, exist_ok=True)


def get_cobblemon():
    """A partial clone with only the folders the port reads; the whole repository is several GB."""
    if os.path.isdir(cobblemonRepo):
        return
    print("Cloning Cobblemon (sparse)...")
    os.system(f'git clone --depth 1 --filter=blob:none --sparse https://gitlab.com/cable-mc/cobblemon.git "{cobblemonRepo}"')
    os.system(f'git -C "{cobblemonRepo}" sparse-checkout set {" ".join(SPARSE_PATHS)}')


def copy_animations():
    fresh(animationsBedrock)
    print("Copying animations...")
    shutil.copytree(src=animationsMain, dst=animationsBedrock, dirs_exist_ok=True)
    print("Copy animations complete.")


def copy_models():
    fresh(modelsBedrock)
    print("Copying models...")
    shutil.copytree(src=modelsMain, dst=modelsBedrock, dirs_exist_ok=True)
    print("Copy models complete.")


def copy_textures():
    fresh(texturesEntityBedrock)
    print("Copying textures...")
    shutil.copytree(src=texturesMain, dst=texturesEntityBedrock, dirs_exist_ok=True)
    print("Copy textures complete.")


# ---------------------------------------------------------------------------
# Cobblemon data: species, spawn levels, names and dex entries, cry sounds
# ---------------------------------------------------------------------------

species_by_number = {}
spawn_level_by_name = {}
lang = {}
cobblemon_sounds = {}


feature_aspects = {}   # aspect -> {"feature": name, "random": bool, "default": aspect or None}


def load_species_features():
    """Map every aspect a species feature can produce to its feature, and whether a spawn picks it at random."""
    for path in glob.glob(f"{cobblemonData}/species_features/*.json"):
        with open(path, encoding="utf-8") as file: feature = json.load(file)
        name = os.path.basename(path)[:-len(".json")]
        if feature.get("type") == "flag":
            for key in feature.get("keys", []): feature_aspects[key] = {"feature": name, "random": False, "default": None}
            continue
        if feature.get("type") not in ("choice", "weighted_choice") or not feature.get("isAspect", True): continue
        form = feature.get("aspectFormat", "{{choice}}")
        choices = [c if isinstance(c, str) else c.get("aspect", c.get("value", "")) for c in feature.get("choices", [])]
        default = feature.get("default")
        default_aspect = form.replace("{{choice}}", default) if isinstance(default, str) and default in choices else None
        for choice in choices:
            feature_aspects[form.replace("{{choice}}", choice)] = {"feature": name, "random": default == "random", "default": default_aspect}


def load_cobblemon_data():
    global lang, cobblemon_sounds
    load_species_features()
    for root, _, files in os.walk(f"{cobblemonData}/species"):
        for name in files:
            if not name.endswith(".json"): continue
            with open(os.path.join(root, name), encoding="utf-8") as file: data = json.load(file)
            species_by_number[data["nationalPokedexNumber"]] = data
    for root, _, files in os.walk(f"{cobblemonData}/spawn_pool_world"):
        for name in files:
            if not name.endswith(".json"): continue
            with open(os.path.join(root, name), encoding="utf-8") as file: data = json.load(file)
            for spawn in data.get("spawns", []):
                low = int(str(spawn.get("level", "5")).split("-")[0])
                pokemon = spawn.get("pokemon", "").split(" ")[0]
                spawn_level_by_name[pokemon] = min(low, spawn_level_by_name.get(pokemon, 999))
    with open(f"{cobblemon}/lang/en_us.json", encoding="utf-8") as file: lang = json.load(file)
    with open(f"{cobblemon}/sounds.json", encoding="utf-8") as file: cobblemon_sounds = json.load(file)
    print(f"Loaded {len(species_by_number)} species, {len(spawn_level_by_name)} spawn levels.")


def species_for(pokemon):
    """The species file for a pack folder such as 0004_charmander, by its dex number."""
    return species_by_number.get(int(pokemon.split("_")[0]))


def species_key(species):
    """Cobblemon's own lower-case key for a species: 'Mr. Mime' -> 'mrmime', 'Nidoran F' -> 'nidoranf'."""
    name = species["name"].replace("♀", "f").replace("♂", "m")
    return re.sub(r"[^a-z0-9]", "", name.lower())


def entity_id(pokemon):
    """A Pokemon's entity identifier, 'cobblemon:p0006_charizard'. The pack folders keep the Pokedex number first,
    but Bedrock's newer entity formats (1.21.90 on, which the air controls need) refuse an identifier whose name
    starts with a digit, so the entity takes a 'p' in front."""
    return f"cobblemon:p{pokemon}"


def pokemon_for_species_name(name):
    """The pack folder for a species name used in evolution results, 'charmeleon' -> '0005_charmeleon'."""
    key = re.sub(r"[^a-z0-9]", "", name.lower().split(" ")[0])
    for pokemon in pokemons:
        species = species_for(pokemon)
        if species and species_key(species) == key: return pokemon
    return None


def display_name(species):
    return lang.get(f"cobblemon.species.{species_key(species)}.name", species["name"])


def type_name(type_key):
    return lang.get(f"cobblemon.type.{type_key}", type_key.capitalize())


def write_item_names(names):
    """Names for the items create_general_items made; the lang file is written before them, so this appends."""
    with open(f"{textsBedrock}/en_US.lang", "a", encoding="utf-8") as file:
        for name in names: file.write(f"item.cobblemon:{name}.name={lang['item.cobblemon.' + name]}" + chr(10))


def create_texts():
    print("Creating texts...")
    os.makedirs(textsBedrock, exist_ok=True)
    with open(f"{textsBedrock}/en_US.lang", "w", encoding="utf-8") as file:
        for pokemon in pokemons:
            species = species_for(pokemon)
            name = display_name(species) if species else pokemon[pokemon.index("_")+1:].capitalize()
            file.write(f"entity.{entity_id(pokemon)}.name={name}\n")
            file.write(f"item.spawn_egg.entity.{entity_id(pokemon)}.name=Spawn {name}\n")
            file.write(f"item.cobblemon:poke_ball_{pokemon}.name=Poké Ball ({name})\n")
        file.write("item.cobblemon:poke_ball.name=Poké Ball\n")
        for info in poke_balls():
            if info["name"] != "poke_ball": file.write(f"item.{info['item']}.name={info['display']}\n")
        file.write("itemGroup.name.cobblemon_balls=Poké Balls\n")
        for pokemon in pokemons:
            if ride_behaviours(species_for(pokemon)): file.write(f"action.hint.exit.{entity_id(pokemon)}=Sneak to dismount\n")
        for f in sorted(os.listdir(evolutionItemsMain)):
            if f.endswith(".png"): name = f[:-len(".png")]; file.write(f"item.cobblemon:{name}.name={lang.get('item.cobblemon.' + name, name.replace('_', ' ').title())}\n")
        for name in ("shed_shell", "moomoo_milk", "revival_herb"): file.write(f"item.cobblemon:{name}.name={lang.get('item.cobblemon.' + name, name.replace('_', ' ').title())}\n")
        for berry, _ in berry_bushes():
            name = lang.get("item.cobblemon." + berry, berry.replace("_", " ").title())
            file.write(f"item.cobblemon:{berry}.name={name}\n")
            file.write(f"tile.cobblemon:{berry}_bush.name={name} Bush\n")
        for name in sorted({f.split(":")[1] for _, fs in fossil_recipes() for f in fs}):
            file.write(f"item.cobblemon:{name}.name={lang.get('item.cobblemon.' + name, name.replace('_', ' ').title())}\n")
        for name, title in (("fossil_analyzer", "Fossil Analyzer"), ("restoration_tank", "Restoration Tank"), ("monitor", "Monitor"), ("pc", "PC"), ("pasture", "Pasture")):
            file.write(f"tile.cobblemon:{name}.name={lang.get('block.cobblemon.' + name, title)}\n")
        file.write("entity.cobblemon:fossil_display.name=Fossil\n")
        file.write("tile.cobblemon:healing_machine.name=Healing Machine\n")
        for rod, _ in poke_rods(): file.write(f"item.cobblemon:{rod}.name={lang.get('item.cobblemon.' + rod, rod.replace('_', ' ').title())}\n")
        file.write(f"item.cobblemon:pokerod_smithing_template.name={lang.get('item.cobblemon.pokerod_smithing_template', 'Poke Rod Smithing Template')}\n")
        file.write("entity.cobblemon:poke_bobber.name=Bobber\n")
        for colour in POKEDEX_COLOURS: file.write(f"item.cobblemon:pokedex_{colour}.name={lang.get('item.cobblemon.pokedex_' + colour, 'Pokedex')}\n")
        for colour in APRICORN_COLOURS:
            for suffix in ("apricorn", "apricorn_seed"): file.write(f"item.cobblemon:{colour}_{suffix}.name={lang.get(f'item.cobblemon.{colour}_{suffix}', (colour + ' ' + suffix).replace('_', ' ').title())}\n")
            file.write(f"tile.cobblemon:{colour}_apricorn.name={lang.get(f'item.cobblemon.{colour}_apricorn', colour.title() + ' Apricorn')}\n")
            file.write(f"tile.cobblemon:{colour}_apricorn_sapling.name={lang.get(f'block.cobblemon.{colour}_apricorn_sapling', colour.title() + ' Apricorn Sapling')}\n")
        for stone in ("tumblestone", "sky_tumblestone", "black_tumblestone"): file.write(f"item.cobblemon:{stone}.name={lang.get('item.cobblemon.' + stone, stone.replace('_', ' ').title())}\n")
        for name in ("apricorn_log", "stripped_apricorn_log", "apricorn_wood", "stripped_apricorn_wood", "apricorn_planks", "apricorn_leaves"):
            file.write(f"tile.cobblemon:{name}.name={lang.get('block.cobblemon.' + name, name.replace('_', ' ').title())}\n")
        file.write("action.interact.use=Use\n")
        file.write("action.interact.evolve=Evolve\n")
        for npc, info in NPCS.items():
            file.write(f"entity.cobblemon:{npc}.name={info['name']}\n")
            file.write(f"item.spawn_egg.entity.cobblemon:{npc}.name=Spawn {info['name']}\n")
    print("Create text complete.")


def download_spawn_egg_textures():
    print("Downloading spawn egg textures...")
    os.makedirs(texturesItemsBedrock, exist_ok=True)
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, "r") as file: itemTextureData = json.load(file)
    for pokemon in pokemons:
        fileName = f"{texturesItemsBedrock}/{pokemon}_spawn_egg.png"
        if not os.path.exists(fileName):
            pokemonName = pokemon[pokemon.index("_")+1:]
            for old, new in (("nidoranf", "nidoran-f"), ("nidoranm", "nidoran-m"), ("mrmime", "mr-mime"), ("mimejr", "mime-jr"), ("porygonz", "porygon-z"), ("walkingwake", "walking-wake"), ("ironleaves", "iron-leaves")):
                pokemonName = pokemonName.replace(old, new)
            for base in ("https://img.pokemondb.net/sprites/sword-shield/icon", "https://img.pokemondb.net/sprites/scarlet-violet/icon"):
                try:
                    request = urllib.request.Request(f"{base}/{pokemonName}.png", headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(request) as response, open(fileName, "wb") as file: file.write(response.read())
                    break
                except Exception: continue
            else: print(f"Failed to download: {pokemon}")
        itemTextureData["texture_data"][f"{pokemon}_spawn_egg"] = {"textures": [f"textures/items/{pokemon}_spawn_egg"]}
    itemTextureData["texture_data"]["poke_ball"] = {"textures": ["textures/items/poke_ball"]}
    with open(itemTexturePath, "w") as file: file.write(json.dumps(itemTextureData, indent=4))
    print("Download spawn egg textures complete.")


# ---------------------------------------------------------------------------
# Fixes for what Cobblemon's Blockbench exports carry that Bedrock rejects.
# ---------------------------------------------------------------------------

MOLANG_KNOWN = {"q", "query", "v", "variable", "t", "temp", "c", "context", "math", "true", "false", "return", "this"}
# the queries Bedrock answers inside an animation; Cobblemon's own (q.r.velocity_y, q.input_up, ...) are not among them
BEDROCK_ANIMATION_QUERIES = {"anim_time", "life_time", "modified_move_speed", "ground_speed", "vertical_speed", "is_on_ground", "is_in_water",
    "is_sleeping", "all_animations_finished", "any_animation_finished", "head_x_rotation", "head_y_rotation", "body_x_rotation", "body_y_rotation",
    "time_stamp", "is_moving", "is_jumping", "target_x_rotation", "target_y_rotation", "yaw_speed", "walk_distance", "delta_time", "is_riding",
    "is_baby", "is_angry", "key_frame_lerp_time", "modified_distance_moved", "is_on_fire", "is_swimming", "is_gliding", "is_sneaking", "is_sprinting"}


def sanitize_animation_name(name):
    """'animation.ponyta.true faint' -> 'animation.ponyta.true_faint', 'faint(wip)' -> 'faint_wip'."""
    return re.sub(r"[^A-Za-z0-9_.]+", "_", name).strip("_")


def fix_molang(expr):
    """Return a Molang expression Bedrock's parser accepts, or None to drop it."""
    # Blockbench writes NaN for a broken number; treat it as 0
    expr = re.sub(r"(?<![\w.])NaN(?![\w.])", "0", expr)
    # Cobblemon's NPC animations use Java-side helpers: radians to degrees, limb swing and age in ticks
    expr = re.sub(r"math\.r2d\(", "57.2958*(", expr)
    expr = re.sub(r"(?<![\w.])(?:v|variable)\.limb_swing_amount(?![\w])", "q.modified_move_speed", expr)
    expr = re.sub(r"(?<![\w.])(?:v|variable)\.limb_swing(?![\w])", "q.walk_distance", expr)
    expr = re.sub(r"(?<![\w.])(?:v|variable)\.age_in_ticks(?![\w])", "(q.life_time*20)", expr)
    # typos in the exports: "Math.", a truncated "ath.", a doubled sign, "*+", "- +", "0.0.5", a decimal comma
    expr = re.sub(r"(?<![\w.])(?:M|m?)ath\.", "math.", expr)
    expr = re.sub(r"\+\s*\+", "+", expr)
    expr = re.sub(r"([*/-])\s*\+", lambda m: m.group(1), expr)
    expr = re.sub(r"(\d+\.\d+)\.(\d+)", lambda m: m.group(1) + m.group(2), expr)
    depth = 0; out = []
    for i, ch in enumerate(expr):
        depth += (ch == "(") - (ch == ")")
        if ch == "," and depth == 0 and i > 0 and expr[i-1].isdigit() and i + 1 < len(expr) and expr[i+1].isdigit(): out.append(".")
        else: out.append(ch)
    expr = "".join(out)
    # a double minus is a plus, and two numbers run together lost their plus
    expr = expr.replace("--", "+")
    expr = re.sub(r"(\d+\.\d+?)(?=\d+\.\d)", r"\1+", expr)
    # Molang has no unary plus: "(+math.sin" and "+0.01*x" are parse errors
    expr = re.sub(r"(^|[(,])\s*\+", r"\1", expr)
    # two calls with no operator between them: "clamp(...)math.clamp(" was a "+"
    expr = re.sub(r"\)\s*(?=math\.)", ")+", expr)
    # a number glued after a call, "math.sin(...)5", was a "*"; a stray 0 is just dropped
    expr = re.sub(r"\)\s*0(?![\d.])", ")", expr)
    expr = re.sub(r"\)\s*(?=\d)", ")*", expr)
    # math.clamp with only a minimum is math.max
    expr = re.sub(r"math\.clamp\(([^(),]*(?:\([^()]*\)[^(),]*)*),([^(),]*)\)", r"math.max(\1,\2)", expr)
    # an identifier that is neither a namespace nor a function is a test-only variable (walk, run)
    for tok in re.findall(r"(?<![\w.])([A-Za-z_]\w*)(?![\w.(])", expr):
        if tok not in MOLANG_KNOWN: return None
    for query in re.findall(r"(?<![\w.])(?:q|query)\.([A-Za-z_][\w.]*)", expr):
        if query not in BEDROCK_ANIMATION_QUERIES: return None
    # surplus closing parentheses are dropped from the end, missing ones appended, before any wrapping
    while expr.count(")") > expr.count("(") and expr.rstrip().endswith(")"): expr = expr.rstrip()[:-1]
    # parentheses closed before they are opened: wrap until the depth never goes negative
    for _ in range(4):
        depth = 0; broken = False
        for ch in expr:
            depth += (ch == "(") - (ch == ")")
            if depth < 0: broken = True; break
        if not broken and depth == 0: break
        expr = f"({expr})" if broken else expr + ")" * depth
    return expr


def fix_channel(channel):
    """Fix every expression in a bone channel; catmullrom cannot interpolate Molang, so those go linear."""
    has_molang = False
    def fix_value(value):
        nonlocal has_molang
        if isinstance(value, str):
            has_molang = True
            fixed = fix_molang(value)
            return 0 if fixed is None else fixed
        if isinstance(value, list): return [fix_value(v) for v in value]
        if isinstance(value, dict): return {k: (v if k in ("lerp_mode", "easing") else fix_value(v)) for k, v in value.items()}
        return value
    channel = fix_value(channel)
    if has_molang and isinstance(channel, dict):
        for keyframe in channel.values():
            if isinstance(keyframe, dict) and keyframe.get("lerp_mode") == "catmullrom": keyframe["lerp_mode"] = "linear"
    return channel


def fix_animations():
    print("Fixing animations...")
    count = 0
    for root, _, files in os.walk(animationsBedrock):
        for name in files:
            if not name.endswith(".animation.json"): continue
            # the port's own animations (the beam, the held balls) use queries of its own, not Cobblemon's
            if name == "beam.animation.json" or name.endswith("_held.animation.json"): continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as file: data = json.load(file)
            before = json.dumps(data)
            for key in [k for k in data if k not in ("format_version", "animations")]: data.pop(key)   # geckolib_format_version, geometry.* debris
            animations = {}
            for animName, anim in data.get("animations", {}).items():
                # a bone whose name is not an identifier, and effect maps that landed inside the bones, are export debris
                bones = {b: v for b, v in anim.get("bones", {}).items() if re.fullmatch(r"[\w.-]+", b) and b not in ("sound_effects", "particle_effects")}
                if bones: anim["bones"] = bones
                else: anim.pop("bones", None)   # an empty bones map is itself an error
                for bone in bones.values():
                    for channel in ("rotation", "position", "scale"):
                        if channel in bone: bone[channel] = fix_channel(bone[channel])
                # a keyframe with no effect is an export artefact; a name without the prefix is not an animation
                if "particle_effects" in anim:
                    anim["particle_effects"] = {k: v for k, v in anim["particle_effects"].items() if v}
                    # a pre_effect_script is Molang too, and Cobblemon's ride queries do not exist here
                    for keyframe in anim["particle_effects"].values():
                        for entry in (keyframe if isinstance(keyframe, list) else [keyframe]):
                            if isinstance(entry, dict) and "pre_effect_script" in entry and fix_molang(entry["pre_effect_script"].rstrip(";")) is None:
                                entry.pop("pre_effect_script")
                anim.pop("timeline", None)
                # only keyframe times belong in these maps; Blockbench sometimes leaves animation_length inside
                for key in ("particle_effects", "sound_effects"):
                    if key in anim: anim[key] = {k: v for k, v in anim[key].items() if re.fullmatch(r"[\d.]+", k)}
                animName = sanitize_animation_name(animName)
                if not animName.startswith("animation."): animName = f"animation.{name[:-len('.animation.json')]}.{animName}"
                if animName.endswith("."): continue   # "animation.charjabug." is an export artefact, not an animation
                animations[animName] = anim
            data["animations"] = animations
            if json.dumps(data) != before:
                count += 1
                with open(path, "w", encoding="utf-8") as file: file.write(json.dumps(data, indent="\t"))
    print(f"Fix animations complete: {count} file(s) changed.")


HELD_SPOTS = (("item", "held_item"), ("item_face", "held_item_face"), ("item_hat", "held_item_hat"))


def held_geometry(geometry):
    """A companion to a Pokemon's geometry for its held item, as HeldItemRenderer draws it: the same bones with no
    cubes, so every animation moves them alike, and a flat 8 pixel quad at each of the item, item_face and item_hat
    locators, where the render controller shows the held item's icon. None for a model with none of the locators."""
    bones, quads = [], []
    for bone in geometry.get("bones", []):
        if bone["name"] in ("rightItem", "leftItem"): continue
        bones.append({k: v for k, v in bone.items() if k in ("name", "parent", "pivot", "rotation")})
    for locator, name in HELD_SPOTS:
        for bone in geometry.get("bones", []):
            spot = (bone.get("locators") or {}).get(locator)
            if spot is None: continue
            x, y, z = spot.get("offset", [0, 0, 0]) if isinstance(spot, dict) else spot
            face = {"uv": [0, 0], "uv_size": [16, 16]}
            quads.append({"name": name, "parent": bone["name"], "pivot": [x, y, z],
                          "cubes": [{"origin": [x - 4, y - 4, z], "size": [8, 8, 0], "uv": {"north": face, "south": face}}]})
            break
    if not quads: return None
    description = dict(geometry["description"], identifier=geometry["description"]["identifier"] + ".held", texture_width=16, texture_height=16)
    return {"description": description, "bones": bones + quads}


def fix_models():
    """Blockbench leaves 'geometry.unknown' or a sibling's name in a model; name each after its file."""
    print("Fixing models...")
    count = 0
    for root, _, files in os.walk(modelsBedrock):
        for name in files:
            if not name.endswith(".json"): continue
            path = os.path.join(root, name)
            with open(path, encoding="utf-8") as file: data = json.load(file)
            stem = name[:-len(".geo.json")] if name.endswith(".geo.json") else name[:-len(".json")]
            wanted = f"geometry.{stem.lower()}"
            geometries = data.get("minecraft:geometry", [])
            changed = False
            if len(geometries) == 1 and geometries[0]["description"]["identifier"] != wanted:
                geometries[0]["description"]["identifier"] = wanted; changed = True
            # a locator defined on two bones is an error in Bedrock; the first definition wins
            seen = set()
            for geometry in geometries:
                for bone in geometry.get("bones", []):
                    for locator in [l for l in bone.get("locators", {}) if l in seen]:
                        bone["locators"].pop(locator); changed = True
                    seen.update(bone.get("locators", {}))
                # bones an earlier run added for equipment, which Bedrock does not draw on a custom mob
                before = len(geometry.get("bones", []))
                geometry["bones"] = [bn for bn in geometry.get("bones", []) if bn["name"] not in ("rightItem", "leftItem")]
                changed |= len(geometry["bones"]) != before
            base = [g for g in geometries if not g["description"]["identifier"].endswith(".held")]
            held = [h for h in (held_geometry(g) for g in base) if h]
            if base + held != geometries: data["minecraft:geometry"] = base + held; changed = True
            if changed:
                count += 1
                with open(path, "w", encoding="utf-8") as file: file.write(json.dumps(data, indent="\t"))
    print(f"Fix models complete: {count} file(s) renamed.")


# ---------------------------------------------------------------------------
# Resource pack: geometry choice, texture layers, animation and render controllers, client entities
# ---------------------------------------------------------------------------

LAYER_FPS = 10
resolversMain = f"{cobblemon}/bedrock/pokemon/resolvers"


def model_files(pokemon):
    folder = f"{modelsBedrock}/{pokemon}"
    return sorted(f for f in os.listdir(folder) if f.endswith(".geo.json")) if os.path.isdir(folder) else []


def geometry_for(pokemon, pokemonName):
    """The geometry a client entity should use: the plain model, else the male one, else the first."""
    stems = [f[:-len(".geo.json")].lower() for f in model_files(pokemon)]
    for candidate in (pokemonName, f"{pokemonName}_male", f"{pokemonName}_female"):
        if candidate in stems: return f"geometry.{candidate}"
    return f"geometry.{stems[0]}" if stems else f"geometry.{pokemonName}"


posersMain = f"{cobblemon}/bedrock/pokemon/posers"
LOOK_DEFAULTS = (1.0, 1.0, 70.0, -45.0, 45.0, -45.0)   # SingleBoneLookAnimation: multipliers, then max/min pitch and yaw
look_animations = {}


def look_animation(pokemon, pokemonName):
    """Cobblemon's head tracking for a Pokemon, as a Bedrock animation, or None. Its poser spreads the look over
    one or more bones with q.look(bone, pitchMultiplier, yawMultiplier, maxPitch, minPitch, maxYaw, minYaw), and
    each bone turns by the multiplier times the head's pitch and yaw clamped to those limits (Charizard's four neck
    bones and its head each take a share). The standing pose's calls are used for every pose."""
    folder = f"{posersMain}/{pokemon}"
    if not os.path.isdir(folder): return None
    geometry = geometry_for(pokemon, pokemonName)[len("geometry."):]
    path = f"{modelsBedrock}/{pokemon}/{geometry}.geo.json"
    if not os.path.exists(path): return None
    with open(path, encoding="utf-8") as file: bones = {b["name"] for g in json.load(file).get("minecraft:geometry", []) for b in g.get("bones", [])}
    poses = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith(".json"): continue
        with open(f"{folder}/{name}", encoding="utf-8") as file: poser = json.load(file)
        poses += list(poser.get("poses", {}).values())
    standing = sorted(poses, key=lambda p: "STAND" not in p.get("poseTypes", []))
    for pose in standing:
        calls = re.findall(r"q\.look\(\s*'([a-z0-9_]+)'\s*((?:,\s*-?[\d.]+\s*)*)\)", json.dumps(pose.get("animations", [])))
        result = {}
        for bone, args in calls:
            if bone not in bones: continue
            values = [float(a) for a in re.findall(r"-?[\d.]+", args)]
            pm, ym, max_p, min_p, max_y, min_y = values + list(LOOK_DEFAULTS[len(values):])
            x = f"{pm:g} * math.clamp(query.target_x_rotation, {min_p:g}, {max_p:g})" if pm else "0"
            y = f"{ym:g} * math.clamp(query.target_y_rotation, {min_y:g}, {max_y:g})" if ym else "0"
            result[bone] = {"rotation": [x, y, 0]}
        if result: return {"loop": True, "bones": result}
    return None


def model_bones(pokemon, pokemonName):
    geometry = geometry_for(pokemon, pokemonName)[len("geometry."):]
    path = f"{modelsBedrock}/{pokemon}/{geometry}.geo.json"
    if not os.path.exists(path): return set()
    with open(path, encoding="utf-8") as file: data = json.load(file)
    return {bone["name"] for geo in data.get("minecraft:geometry", []) for bone in geo.get("bones", [])}


_animation_ids = None


def animation_ids():
    """Every animation id the pack's Pokemon animation files define."""
    global _animation_ids
    if _animation_ids is None:
        _animation_ids = set()
        for path in glob.glob(f"{animationsBedrock}/*/*.animation.json"):
            if os.path.basename(path) == "poses.animation.json": continue
            with open(path, encoding="utf-8") as file: _animation_ids |= set(json.load(file).get("animations", {}))
    return _animation_ids


pose_plans = {}


def pose_plan(pokemon, pokemonName):
    """The Pokemon's poses from Cobblemon's poser as controller states, or None when it has no poser."""
    if pokemon in pose_plans: return pose_plans[pokemon]
    found = poses.poser(pokemon)
    plan = None
    if found and poses.world_poses(found):
        has_look = bool(look_animation(pokemon, pokemonName)) or model_has_head(pokemon, pokemonName)
        flier = movement_kind(species_for(pokemon)) in ("bird", "hover")
        plan = poses.to_bedrock(pokemon, found, animation_ids(), model_bones(pokemon, pokemonName), flier, has_look,
                                ambient_particles(pokemon, pokemonName))
        plan["source"] = found["source"]
    pose_plans[pokemon] = plan
    return plan


def model_has_head(pokemon, pokemonName):
    geometry = geometry_for(pokemon, pokemonName)[len("geometry."):]
    path = f"{modelsBedrock}/{pokemon}/{geometry}.geo.json"
    if not os.path.exists(path): return False
    with open(path, encoding="utf-8") as file: data = json.load(file)
    return any(bone["name"] == "head" for geo in data.get("minecraft:geometry", []) for bone in geo.get("bones", []))


def texture_for(pokemon, pokemonName):
    """The base texture: the plain one, else male, else the first that is not a shiny, alpha or decoration layer."""
    folder = f"{texturesEntityBedrock}/{pokemon}"
    names = sorted(f[:-4] for f in os.listdir(folder) if f.endswith(".png")) if os.path.isdir(folder) else []
    for candidate in (pokemonName, f"{pokemonName}_male", f"{pokemonName}_female"):
        if candidate in names: return f"textures/entity/{pokemon}/{candidate}"
    plain = [n for n in names if not any(tag in n for tag in ("shiny", "alpha", "emissive", "decoration", "flame"))]
    return f"textures/entity/{pokemon}/{plain[0] if plain else pokemonName}"


VARIANT_FORMS = ("alolan", "galarian", "hisuian", "paldean")
VARIANT_ASPECTS = {"shiny", "female", *VARIANT_FORMS}
SHINY_ODDS = 8192   # CobblemonConfig.shinyRate
_variation_cache = {}


def _resolver_texture(ref):
    """'cobblemon:textures/pokemon/0019_rattata/rattata_alolan.png' -> pack path, or None if the file is missing."""
    if not isinstance(ref, str): return None
    path = re.sub(r"\.png$", "", re.sub(r"^cobblemon:textures/pokemon/", "textures/entity/", ref))
    return path if os.path.exists(f"{resourcePack}/{path}.png") else None


def _resolver_model(pokemon, ref):
    """'cobblemon:rattata_alolan.geo' -> 'rattata_alolan' when that model is in the pack."""
    if not isinstance(ref, str): return None
    stem = re.sub(r"\.geo$", "", ref.split(":")[-1]).lower()
    return stem if os.path.exists(f"{modelsBedrock}/{pokemon}/{stem}.geo.json") else None


def _resolver_layer(layer, index):
    texture = layer.get("texture")
    frames = texture.get("frames", []) if isinstance(texture, dict) else [texture]
    paths = [p for p in (_resolver_texture(f) for f in frames) if p]
    if not paths: return None
    label = re.sub(r"[^a-z0-9]+", "_", str(layer.get("name") or f"layer{index}").lower()).strip("_") or f"layer{index}"
    fps = texture.get("fps", LAYER_FPS) if isinstance(texture, dict) else LAYER_FPS
    return {"name": label, "frames": paths, "fps": fps}


def resolver_variations(pokemon):
    """Every look a Pokemon can have, base first: [{aspects, model, texture, layers}].

    Cobblemon's resolver files list variations keyed by aspects; a Pokemon's look is the merge of every
    variation whose aspects it has, in file order, each overriding only the fields it names (model,
    texture, layers by name). Here that merge runs for every combination of regional form, gender and
    shiny the resolvers distinguish; the index in this list is the entity's minecraft:variant value."""
    if pokemon in _variation_cache: return _variation_cache[pokemon]
    pokemonName = pokemon[pokemon.index("_")+1:]
    folder = f"{resolversMain}/{pokemon}"
    raw = []
    if os.path.isdir(folder):
        for name in sorted(f for f in os.listdir(folder) if f.endswith(".json")):
            with open(f"{folder}/{name}", encoding="utf-8") as file: data = json.load(file)
            for variation in data.get("variations", []):
                aspects = set(variation.get("aspects", []))
                if aspects <= VARIANT_ASPECTS | set(feature_aspects): raw.append((aspects, variation))
    present = set().union(*[a for a, _ in raw]) if raw else set()
    # regional forms and feature values (Unown letters, Vivillon wings, Valencian Vileplume) are mutually exclusive looks
    forms = [None] + [f for f in VARIANT_FORMS if f in present] + sorted(a for a in present if a in feature_aspects and a not in VARIANT_ASPECTS)
    genders = [False, True] if "female" in present else [False]
    shinies = [False, True] if "shiny" in present else [False]
    base_model = geometry_for(pokemon, pokemonName)[len("geometry."):]
    base_texture = texture_for(pokemon, pokemonName)
    result = []
    for form in forms:
        for female in genders:
            for shiny in shinies:
                want = {a for a, on in ((form, form), ("female", female), ("shiny", shiny)) if on}
                model, texture, layers = None, None, {}
                for aspects, variation in raw:
                    if not aspects <= want: continue
                    model = _resolver_model(pokemon, variation.get("model")) or model
                    texture = _resolver_texture(variation.get("texture")) or texture
                    if "layers" in variation:
                        for index, layer in enumerate(variation["layers"]):
                            resolved = _resolver_layer(layer, index)
                            if resolved: layers[resolved["name"]] = resolved
                result.append({"aspects": want, "form": form, "female": female, "shiny": shiny,
                               "model": model or base_model, "texture": texture or base_texture, "layers": list(layers.values())})
    if not result:
        result = [{"aspects": set(), "form": None, "female": False, "shiny": False, "model": base_model, "texture": base_texture, "layers": []}]
    _variation_cache[pokemon] = result
    return result


def _layer_names(variations):
    names = []
    for variation in variations:
        for layer in variation["layers"]:
            if layer["name"] not in names: names.append(layer["name"])
    return names


def variant_textures(pokemon):
    variations = resolver_variations(pokemon)
    textures = {"default": variations[0]["texture"], "blank": "textures/entity/blank"}
    for n, variation in enumerate(variations):
        textures[f"v{n}"] = variation["texture"]
        for layer in variation["layers"]:
            for index, frame in enumerate(layer["frames"]): textures[f"{layer['name']}_{n}_{index}"] = frame
    return textures


def geometry_key(stem):
    """A geometry short name Molang can parse: 'kommo-o' -> 'g_kommo_o'."""
    return "g_" + re.sub(r"[^a-z0-9_]", "_", stem.lower())


def variant_geometries(pokemon):
    variations = resolver_variations(pokemon)
    geometries = {}
    for variation in variations: geometries[geometry_key(variation["model"])] = f"geometry.{variation['model']}"
    return geometries


def dedupe_variant_locators(pokemon):
    """Bedrock merges the locators of every geometry an entity lists and logs an error for each name two
    of them place differently. The base model's locators win, so a variant model drops its copies."""
    variations = resolver_variations(pokemon)
    stems = []
    for variation in variations:
        if variation["model"] not in stems: stems.append(variation["model"])
    if len(stems) < 2: return
    def load(stem):
        with open(f"{modelsBedrock}/{pokemon}/{stem}.geo.json", encoding="utf-8") as file: return json.load(file)
    taken = {l for geo in load(stems[0]).get("minecraft:geometry", []) for bone in geo.get("bones", []) for l in bone.get("locators", {})}
    for stem in stems[1:]:
        data = load(stem); changed = False
        for geo in data.get("minecraft:geometry", []):
            for bone in geo.get("bones", []):
                for name in [l for l in bone.get("locators", {}) if l in taken]:
                    bone["locators"].pop(name); changed = True
                if "locators" in bone and not bone["locators"]: bone.pop("locators")
        taken |= {l for geo in data.get("minecraft:geometry", []) for bone in geo.get("bones", []) for l in bone.get("locators", {})}
        if changed:
            with open(f"{modelsBedrock}/{pokemon}/{stem}.geo.json", "w", encoding="utf-8") as file: file.write(json.dumps(data, indent="	"))


def render_controller_names(pokemon, pokemonName):
    return [f"controller.render.{pokemonName}"] + [f"controller.render.{pokemonName}_{name}" for name in _layer_names(resolver_variations(pokemon))]


# PokemonRenderer.renderTransition: a Pokemon beamed into a ball turns red as it shrinks (recallBeamColour)
RED_OVERLAY = {"r": 1.0, "g": 0.1, "b": 0.1, "a": "q.property('cobblemon:red')"}


def create_render_controllers():
    """The base pass and one pass per texture layer, each picking its texture and geometry by the
    entity's variant; a variant without a given layer draws that pass with a blank texture."""
    print("Creating render controllers...")
    fresh(renderControllersBedrock)
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{texturesEntityBedrock}/blank.png")
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        variations = resolver_variations(pokemon)
        geometry_array = [f"Geometry.{geometry_key(v['model'])}" for v in variations]
        dedupe_variant_locators(pokemon)
        base = {"materials": [{"*": "Material.default"}], "overlay_color": RED_OVERLAY}
        if len(variations) == 1:
            base.update({"geometry": geometry_array[0], "textures": ["Texture.v0"]})
        else:
            base.update({"arrays": {"textures": {"Array.skin": [f"Texture.v{n}" for n in range(len(variations))]}, "geometries": {"Array.geo": geometry_array}},
                         "geometry": "Array.geo[query.variant]", "textures": ["Array.skin[query.variant]"]})
        controllers = {f"controller.render.{pokemonName}": base}
        for name in _layer_names(variations):
            # every variant gets the same number of slots (the least common multiple of its frame counts,
            # frames repeated to fill), so the index is arithmetic on query.variant rather than a chain of
            # ternaries, which Molang refuses past a few dozen variants (Spinda has 86)
            layers = [next((l for l in v["layers"] if l["name"] == name), None) for v in variations]
            counts = [len(l["frames"]) for l in layers if l]
            fps = {l["fps"] for l in layers if l and len(l["frames"]) > 1}
            stride = math.lcm(*counts) if counts else 1
            flat = []
            for n, layer in enumerate(layers):
                if layer is None: flat += ["Texture.blank"] * stride
                else: flat += [f"Texture.{name}_{n}_{i % len(layer['frames'])}" for i in range(stride)]
            frame = f" + math.mod(math.floor(q.life_time * {max(fps)}), {stride})" if stride > 1 else ""
            index = (f"query.variant * {stride}" if len(variations) > 1 else "0") + frame
            controller = {"materials": [{"*": "Material.translucent"}], "arrays": {"textures": {f"Array.{name}": flat}}, "textures": [f"Array.{name}[{index}]"], "overlay_color": RED_OVERLAY}
            if len(variations) == 1: controller["geometry"] = geometry_array[0]
            else: controller.update({"geometry": "Array.geo[query.variant]"}); controller["arrays"]["geometries"] = {"Array.geo": geometry_array}
            controllers[f"controller.render.{pokemonName}_{name}"] = controller
        with open(f"{renderControllersBedrock}/{pokemon}.render_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "render_controllers": controllers}, indent=4))
    print("Create render controllers complete.")


def add_variants(entity, species, pokemon):
    """One component group per look (minecraft:variant n), an event to set each, and a spawn roll:
    gender by the species' maleRatio, shiny at 1 in 4096, regional forms only through their event."""
    variations = resolver_variations(pokemon)
    if len(variations) < 2: return
    groups = entity["minecraft:entity"].setdefault("component_groups", {})
    events = entity["minecraft:entity"].setdefault("events", {})
    names = [f"cobblemon:variant_{n}" for n in range(len(variations))]
    for n, name in enumerate(names):
        groups[name] = {"minecraft:variant": {"value": n}}
        events[f"cobblemon:set_variant_{n}"] = {"remove": {"component_groups": [g for g in names if g != name]}, "add": {"component_groups": [name]}}
    male = species.get("maleRatio", 0.5)
    female_share = 0.0 if male is None or male < 0 else 1.0 - male
    # form shares: the base look, unless a choice feature replaces it with a random or default choice
    forms = [f for f in dict.fromkeys(v["form"] for v in variations) if f]
    shares = {None: 1.0}
    for feature in {feature_aspects[f]["feature"] for f in forms if f in feature_aspects}:
        members = [f for f in forms if feature_aspects.get(f, {}).get("feature") == feature]
        info = feature_aspects[members[0]]
        if info["random"]:
            shares[None] = 0.0
            for f in members: shares[f] = 1.0 / len(members)
        elif info["default"] in members:
            shares[None] = 0.0; shares[info["default"]] = 1.0
    roll = []
    for n, variation in enumerate(variations):
        share = shares.get(variation["form"], 0.0)
        if share <= 0: continue
        weight = share * (female_share if variation["female"] else 1.0 - female_share if any(v["female"] for v in variations) else 1.0)
        weight *= 1 if variation["shiny"] else SHINY_ODDS - 1
        weight = round(weight * 1000)
        if weight > 0: roll.append({"weight": weight, "add": {"component_groups": [names[n]]}})
    spawned = events.get("minecraft:entity_spawned", {})
    events["minecraft:entity_spawned"] = {"sequence": [spawned, {"randomize": roll}]} if spawned else {"randomize": roll}


def variant_battle_overrides(pokemon, species):
    """Types, stats and name for each variant that is a regional form, from the species' forms list."""
    overrides = {}
    for n, variation in enumerate(resolver_variations(pokemon)):
        if not variation["form"]: continue
        form = next((f for f in species.get("forms", []) if variation["form"] in f.get("aspects", [])), None)
        if not form: continue
        stats = form.get("baseStats") or species.get("baseStats", {})
        overrides[n] = {
            "name": f"{variation['form'].capitalize()} {display_name(species)}" if variation["form"] in VARIANT_FORMS else f"{display_name(species)} ({form.get('name', variation['form'])})",
            "types": [t for t in (form.get("primaryType", species.get("primaryType")), form.get("secondaryType", species.get("secondaryType") if "primaryType" not in form else None)) if t],
            "stats": {"hp": stats.get("hp", 40), "atk": stats.get("attack", 40), "def": stats.get("defence", 40), "spa": stats.get("special_attack", 40), "spd": stats.get("special_defence", 40), "spe": stats.get("speed", 40)}
        }
    return overrides


def animation_names(pokemon, pokemonName):
    """The short names in a Pokemon's animation file: ground_idle, ground_walk, air_fly, sleep, blink..."""
    path = f"{animationsBedrock}/{pokemon}/{pokemonName}.animation.json"
    if not os.path.exists(path): return {}
    with open(path, encoding="utf-8") as file: data = json.load(file)
    return {name[name.rindex(".")+1:]: name for name in data.get("animations", {})}


def movement_kind(species):
    """How Cobblemon says a species moves: 'fish' (water only), 'hover' (flies, never walks), 'bird' (flies and walks) or 'walk'."""
    moving = (species or {}).get("behaviour", {}).get("moving", {})
    walk = moving.get("walk", {}); fly = moving.get("fly", {}); swim = moving.get("swim", {})
    can_walk = walk.get("canWalk", True) and not walk.get("avoidsLand", False)
    if not can_walk and swim.get("canBreatheUnderwater", False): return "fish"
    if fly.get("canFly", False): return "hover" if not can_walk else "bird"
    return "walk"


def create_animation_controllers():
    """One pose controller per Pokemon from the animations it actually has, plus a blink quirk controller."""
    print("Creating animation controllers...")
    fresh(animationControllersBedrock)
    report = {}
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        names = animation_names(pokemon, pokemonName)
        kind = movement_kind(species_for(pokemon))
        plan = pose_plan(pokemon, pokemonName)
        if plan:
            # Cobblemon's own poses: one state per pose, chosen as its PosableModel chooses them
            controllers = {f"controller.animation.{pokemonName}.pose": {"initial_state": "spawn", "states": plan["states"]}}
            generated = f"{animationsBedrock}/{pokemon}/poses.animation.json"
            if plan["animations"]:
                os.makedirs(f"{animationsBedrock}/{pokemon}", exist_ok=True)
                with open(generated, "w", encoding="utf-8") as file:
                    file.write(json.dumps({"format_version": "1.8.0", "animations": plan["animations"]}, indent=1))
            elif os.path.exists(generated): os.remove(generated)   # Bedrock rejects an empty animations list
            report[pokemon] = {"source": plan["source"], "poses": plan["names"], "issues": plan["report"]}
            add_quirk_controllers(controllers, pokemonName, names)
            with open(f"{animationControllersBedrock}/{pokemon}.animation_controllers.json", "w") as file:
                file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": controllers}, indent=4))
            continue
        def first(*candidates):
            return next((c for c in candidates if c in names), None)
        idle = first("ground_idle", "idle", "water_idle", "air_idle") or next(iter(names), None)
        if not idle: continue
        walk = first("ground_walk", "ground_run", "walk", "move") or idle
        air_idle = first("air_idle", "air_fly"); air_fly = first("air_fly", "air_idle")
        water_idle = first("water_idle", "surfacewater_idle", "water_swim"); water_swim = first("water_swim", "surfacewater_swim", "water_idle")
        sleep = first("sleep", "ground_sleep", "water_sleep")
        states = {}
        ambient = ambient_particles(pokemon, pokemonName)
        def state(name, animations, transitions):
            if animations and animations[0]:
                states[name] = {"animations": animations, "transitions": transitions, "blend_transition": 0.2}
                effects = [e for a in animations for e in ambient.get(a, [])]
                if effects: states[name]["particle_effects"] = effects
        moving = "q.modified_move_speed > 0.1"
        still = "q.modified_move_speed <= 0.1"
        in_water = "q.is_in_water"
        in_air = "!q.is_on_ground && !q.is_in_water"
        on_ground = "q.is_on_ground"
        idle_transitions = [{"moving": f"{moving} && {on_ground}"}]
        moving_transitions = [{"idle": f"{still} && {on_ground}"}]
        if kind in ("hover", "bird") and air_fly:
            idle_transitions += [{"hover": f"{in_air} && {still}"}, {"fly": f"{in_air} && {moving}"}]
            moving_transitions += [{"hover": f"{in_air} && {still}"}, {"fly": f"{in_air} && {moving}"}]
            state("hover", [air_idle], [{"fly": moving}, {"idle": f"{on_ground} && {still}"}, {"moving": f"{on_ground} && {moving}"}])
            state("fly", [air_fly], [{"hover": still}, {"idle": f"{on_ground} && {still}"}, {"moving": f"{on_ground} && {moving}"}])
        if water_swim:
            idle_transitions = [{"float": f"{in_water} && {still}"}, {"swim": f"{in_water} && {moving}"}] + idle_transitions
            moving_transitions = [{"float": f"{in_water} && {still}"}, {"swim": f"{in_water} && {moving}"}] + moving_transitions
            state("float", [water_idle], [{"swim": f"{in_water} && {moving}"}, {"idle": f"!{in_water} && {still}"}, {"moving": f"!{in_water} && {moving}"}])
            state("swim", [water_swim], [{"float": f"{in_water} && {still}"}, {"idle": f"!{in_water} && {still}"}, {"moving": f"!{in_water} && {moving}"}])
        state("idle", [idle], idle_transitions)
        state("moving", [walk], moving_transitions)
        if sleep:
            state("sleeping", [sleep], [{"idle": "!q.is_sleeping"}])
            for name in states:
                if name != "sleeping": states[name]["transitions"].insert(0, {"sleeping": "q.is_sleeping"})
        if "faint" in names: state("fainting", ["faint"], [])
        if ride_behaviours(species_for(pokemon)):
            # ridden: the mount plays Cobblemon's ride animations, falling back to its own walk, fly and swim
            ridden = "q.has_rider"
            ride_move = first("ride_ground_run", "ride_ground_walk", "ride_mount_run", "ride_mount_walk", "ride_ground") or walk
            ride_fly = first("ride_air_fly", "ride_air_glide", "ride_jetstream_fly") or air_fly
            ride_swim = first("ride_water_swim", "ride_surfacewater_swim") or water_swim
            to_fly = [{"ride_fly": in_air}] if ride_fly else []
            to_swim = [{"ride_swim": in_water}] if ride_swim else []
            ride_names = []
            for name, animations, transitions in (
                ("ride_idle", [idle], [{"ride_move": f"{moving} && {on_ground}"}] + to_fly + to_swim),
                ("ride_move", [ride_move], [{"ride_idle": f"{still} && {on_ground}"}] + to_fly + to_swim),
                ("ride_fly", [ride_fly], [{"ride_idle": f"{on_ground} && {still}"}, {"ride_move": f"{on_ground} && {moving}"}] + to_swim),
                ("ride_swim", [ride_swim], [{"ride_idle": f"!{in_water} && {still}"}, {"ride_move": f"!{in_water} && {moving}"}])):
                if name in ("ride_fly", "ride_swim") and not animations[0]: continue
                state(name, animations, [{"idle": f"!{ridden}"}] + transitions); ride_names.append(name)
            for name in states:
                if name not in ride_names: states[name]["transitions"].insert(0, {"ride_idle": ridden})
        # Bedrock does not run the initial state's entry effects, so a throwaway first state hands over to idle
        states["spawn"] = {"transitions": [{"idle": "1"}]}
        controllers = {f"controller.animation.{pokemonName}.pose": {"initial_state": "spawn", "states": states}}
        add_quirk_controllers(controllers, pokemonName, names)
        with open(f"{animationControllersBedrock}/{pokemon}.animation_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": controllers}, indent=4))
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "poses_report.json"), "w", encoding="utf-8") as file:
        file.write(json.dumps(report, indent=1))
    print(f"Create animation controllers complete: {len(report)} from Cobblemon's posers.")


def add_quirk_controllers(controllers, pokemonName, names):
    """The quirk and blink controllers, which run beside the pose controller."""
    if True:
        quirks = [n for n in names if "quirk" in n and "sleep" not in n and "battle" not in n]
        if quirks:
            controllers[f"controller.animation.{pokemonName}.quirk"] = {
                "initial_state": "wait",
                "states": {
                    "wait": {"transitions": [{"play": "!q.is_sleeping && q.modified_move_speed < 0.1 && math.random(0, 900) < 1"}]},
                    "play": {"animations": [f"quirk_{i}" for i in range(len(quirks))] if len(quirks) == 1 else [{f"quirk_{i}": f"v.quirk == {i}"} for i in range(len(quirks))],
                             "on_entry": [f"v.quirk = math.floor(math.random(0, {len(quirks)}));"],
                             "transitions": [{"wait": "q.all_animations_finished || q.is_sleeping"}]}
                }
            }
        if "blink" in names:
            controllers[f"controller.animation.{pokemonName}.blink"] = {
                "initial_state": "open",
                "states": {
                    "open": {"transitions": [{"blink": "math.random(0, 200) < 1"}]},
                    "blink": {"animations": ["blink"], "transitions": [{"open": "q.all_animations_finished"}]}
                }
            }


def create_client_entities():
    print("Creating client entities...")
    fresh(entityBedrock)
    look_animations.clear()
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        names = animation_names(pokemon, pokemonName)
        if not names: print(f"No animation file for {pokemon}, no client entity."); continue
        animations = {"pose": f"controller.animation.{pokemonName}.pose"}
        animate = ["pose"]
        if "blink" in names:
            animations["blink_quirk"] = f"controller.animation.{pokemonName}.blink"; animate.append("blink_quirk")
        quirks = [n for n in names if "quirk" in n and "sleep" not in n and "battle" not in n]
        if quirks:
            animations["quirk"] = f"controller.animation.{pokemonName}.quirk"; animate.append("quirk")
            for index, quirk in enumerate(quirks): animations[f"quirk_{index}"] = names[quirk]
        look = look_animation(pokemon, pokemonName)
        if look:
            look_animations[f"animation.{pokemon}.look"] = look
            animations["look_at_target"] = f"animation.{pokemon}.look"; animate.append("look_at_target")
        elif model_has_head(pokemon, pokemonName):
            # no poser: Cobblemon's default single-bone look on the head, clamped as it clamps
            look_animations[f"animation.{pokemon}.look"] = {"loop": True, "bones": {"head": {"rotation": [
                "math.clamp(query.target_x_rotation, -45, 70)", "math.clamp(query.target_y_rotation, -45, 45)", 0]}}}
            animations["look_at_target"] = f"animation.{pokemon}.look"; animate.append("look_at_target")
        # a species' own animation named like a controller key (Arbok's "pose") must not replace the controller
        for short, full in names.items(): animations[short if short not in animations else f"{short}_animation"] = full
        scripts = {"animate": animate}
        plan = pose_plan(pokemon, pokemonName)
        if plan:
            # the pose controller picks the pose each frame and plays the look inside the poses that have it
            animations.update(plan["keys"])
            scripts = {"initialize": plan["initialize"], "pre_animation": plan["pre_animation"], "animate": [a for a in animate if a != "look_at_target"]}
        entity = {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": entity_id(pokemon),
                    "materials": {
                        "default": "entity_alphatest_one_sided",
                        "emissive": "entity_emissive_alpha",
                        "translucent": "entity_alphablend"
                    },
                    "textures": variant_textures(pokemon),
                    "geometry": variant_geometries(pokemon),
                    "scripts": {**scripts, "scale": "q.property('cobblemon:size')"},
                    "animations": animations,
                    "render_controllers": render_controller_names(pokemon, pokemonName),
                    "spawn_egg": {"texture": f"{pokemon}_spawn_egg"}
                }
            }
        }
        particles, sounds = animation_effects(pokemon, pokemonName)
        if particles: entity["minecraft:client_entity"]["description"]["particle_effects"] = particles
        if sounds: entity["minecraft:client_entity"]["description"]["sound_effects"] = sounds
        with open(f"{entityBedrock}/{pokemon}.entity.json", "w") as file: file.write(json.dumps(entity, indent=4))
    with open(f"{animationsBedrock}/look.animation.json", "w") as file:
        file.write(json.dumps({"format_version": "1.8.0", "animations": look_animations}, indent=1))
    print(f"Create client entities complete: {len(look_animations)} look animations.")


# ---------------------------------------------------------------------------
# Behavior pack: entities from the species files, loot tables, dialogue panels; cries for the resource pack
# ---------------------------------------------------------------------------

def health_at(base_hp, level):
    """Pokemon HP at a level with full IVs and no EVs, the formula every main-series game uses."""
    return (2 * base_hp + 31) * level // 100 + level + 10


def movement_components(species, kind):
    """The vanilla component set for each way of moving: fish, bee, parrot and wolf are the references."""
    moving = species.get("behaviour", {}).get("moving", {})
    walk_speed = moving.get("walk", {}).get("walkSpeed", 0.25)
    swim_speed = moving.get("swim", {}).get("swimSpeed", 0.1)
    # a speed Cobblemon gives as Molang (faster on sand) is a number here: the speed away from sand, the last one named
    def plain(speed, fallback):
        if isinstance(speed, (int, float)): return speed
        numbers = re.findall(r"\d*\.\d+|\d+", str(speed))
        return float(numbers[-1]) if numbers else fallback
    walk_speed, swim_speed = plain(walk_speed, 0.25), plain(swim_speed, 0.1)
    avoids_water = moving.get("swim", {}).get("avoidsWater", False)
    breathes_water = moving.get("swim", {}).get("canBreatheUnderwater", False)
    if kind == "fish":
        return {
            "minecraft:movement": {"value": swim_speed},
            "minecraft:underwater_movement": {"value": swim_speed},
            "minecraft:movement.sway": {"sway_amplitude": 0},
            "minecraft:navigation.generic": {"can_swim": True, "can_walk": False, "can_breach": True, "can_path_over_water": False, "can_sink": False, "is_amphibious": False},
            "minecraft:breathable": {"breathes_air": False, "breathes_water": True, "suffocate_time": 0, "total_supply": 15},
            "minecraft:physics": {"has_gravity": False},
            "minecraft:behavior.random_swim": {"priority": 3, "interval": 0, "xz_dist": 16, "y_dist": 4, "speed_multiplier": 1}
        }
    breathable = {"total_supply": 15, "suffocate_time": 0, "breathes_air": True, "breathes_water": breathes_water}
    if kind == "hover":
        return {
            "minecraft:movement": {"value": walk_speed},
            "minecraft:movement.hover": {},
            "minecraft:navigation.hover": {"can_path_over_water": True, "can_sink": False, "can_path_from_air": True, "avoid_water": avoids_water, "avoid_damage_blocks": True},
            "minecraft:can_fly": {},
            "minecraft:jump.static": {},
            "minecraft:breathable": breathable,
            "minecraft:physics": {},
            "minecraft:behavior.random_hover": {"priority": 8, "xz_dist": 8, "y_dist": 8, "y_offset": -1, "interval": 1, "hover_height": [1, 4]},
            "minecraft:behavior.float": {"priority": 0}
        }
    if kind == "bird":
        return {
            "minecraft:movement": {"value": walk_speed},
            "minecraft:movement.fly": {},
            "minecraft:navigation.fly": {"can_path_from_air": True, "can_path_over_water": True, "avoid_water": avoids_water, "avoid_damage_blocks": True},
            "minecraft:can_fly": {},
            "minecraft:jump.static": {},
            "minecraft:breathable": breathable,
            "minecraft:physics": {},
            "minecraft:behavior.random_fly": {"priority": 8, "xz_dist": 15, "y_dist": 1, "y_offset": 0, "avoid_damage_blocks": True},
            "minecraft:behavior.random_stroll": {"priority": 9, "speed_multiplier": 1},
            "minecraft:behavior.float": {"priority": 0}
        }
    return {
        "minecraft:movement": {"value": walk_speed},
        "minecraft:underwater_movement": {"value": swim_speed},
        "minecraft:movement.basic": {},
        "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_water": avoids_water, "avoid_damage_blocks": True},
        "minecraft:jump.static": {},
        "minecraft:breathable": breathable,
        "minecraft:physics": {},
        "minecraft:behavior.random_stroll": {"priority": 8, "speed_multiplier": 1},
        "minecraft:behavior.float": {"priority": 0}
    }


def create_behavior_entities():
    print("Creating behavior entities...")
    fresh(entitiesBedrock)
    for pokemon in pokemons:
        species = species_for(pokemon)
        if not species: print(f"No species data for {pokemon}, no behavior entity."); continue
        behaviour = species.get("behaviour", {})
        kind = movement_kind(species)
        level = spawn_level_by_name.get(species_key(species), 5)
        stats = species.get("baseStats", {})
        hitbox = species.get("hitbox", {"width": 0.6, "height": 0.8})
        scale = species.get("baseScale", 1.0)
        types = [t for t in (species.get("primaryType"), species.get("secondaryType")) if t]
        combat = behaviour.get("combat", {})
        health = health_at(stats.get("hp", 40), level)
        components = {
            "minecraft:nameable": {},
            "minecraft:type_family": {"family": ["mob", "pokemon", "npc"] + types},
            "minecraft:collision_box": {"width": round(hitbox["width"] * scale, 3), "height": round(hitbox["height"] * scale, 3)},
            "minecraft:scale": {"value": scale},
            "minecraft:health": {"value": health, "max": health},
            "minecraft:attack": {"damage": max(1, round(stats.get("attack", 40) / 10))},
            "minecraft:loot": {"table": f"loot_tables/entities/{pokemon}.json"},
            "minecraft:despawn": {"despawn_from_distance": {}},
            "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
            "minecraft:conditional_bandwidth_optimization": {},
            "minecraft:behavior.look_at_player": {"priority": 6, "look_distance": 6, "probability": 0.02}
        }
        components.update(movement_components(species, kind))
        if behaviour.get("fireImmune", False): components["minecraft:fire_immune"] = {}
        if combat.get("willFlee", False):
            components["minecraft:behavior.panic"] = {"priority": 1, "speed_multiplier": 1.25}
        if combat.get("willDefendSelf", False):
            components["minecraft:behavior.hurt_by_target"] = {"priority": 2}
            components["minecraft:behavior.melee_attack"] = {"priority": 3}
        if kind != "fish":
            components["minecraft:hurt_on_condition"] = {"damage_conditions": [{"filters": {"test": "in_lava", "subject": "self", "operator": "==", "value": True}, "cause": "lava", "damage_per_tick": 4}]}
        entity = {
            "format_version": "1.16.0",
            "minecraft:entity": {
                "description": {
                    "identifier": entity_id(pokemon), "is_spawnable": True, "is_summonable": True, "is_experimental": False,
                    "spawn_category": "water_creature" if kind == "fish" else "creature",
                    # read by the client's pose choice: in battle, and under water (Molang can only tell touching it)
                    "properties": {"cobblemon:battle": {"type": "bool", "default": False, "client_sync": True},
                                   "cobblemon:submerged": {"type": "bool", "default": False, "client_sync": True},
                                   "cobblemon:holding": {"type": "bool", "default": False, "client_sync": True},
                                   "cobblemon:held_index": {"type": "int", "range": [0, 1023], "default": 0, "client_sync": True},
                                   "cobblemon:on_sand": {"type": "int", "range": [0, 2], "default": 0, "client_sync": True},
                                   # PokemonClientDelegate's send-out scale and the red of a Pokemon beamed into a ball
                                   "cobblemon:size": {"type": "float", "range": [0.0, 1.0], "default": 1.0, "client_sync": True},
                                   "cobblemon:red": {"type": "float", "range": [0.0, 1.0], "default": 0.0, "client_sync": True}},
                    "animations": {},
                    "scripts": {"animate": []}
                },
                "component_groups": {},
                "components": components,
                "events": {}
            }
        }
        # evolution: level-up evolutions are the script's (levelling up, with their requirements); stones, trades and
        # the rest go through add_item_evolutions(), which also makes every evolution's transformation event
        add_sleep(entity, species, kind)
        if ambient_particles(pokemon, pokemon[pokemon.index("_")+1:]):
            entity["minecraft:entity"]["description"]["animations"]["ambient"] = f"controller.animation.{pokemon}.ambient"
            entity["minecraft:entity"]["description"]["scripts"]["animate"].append("ambient")
        add_capture(entity, species, pokemon, kind)
        add_item_evolutions(entity, species, pokemon)
        add_pokemon_interactions(entity, species, pokemon)
        add_battle(entity, species)
        add_battle_states(entity)
        add_variants(entity, species, pokemon)
        if entity["format_version"] >= "1.21.90":   # the fliers, written at 1.26.30
            # that format spells a damage sensor's deals_damage as a word
            minecraft = entity["minecraft:entity"]
            for block in [minecraft["components"], *minecraft.get("component_groups", {}).values()]:
                for trigger in block.get("minecraft:damage_sensor", {}).get("triggers", []):
                    if isinstance(trigger.get("deals_damage"), bool): trigger["deals_damage"] = "yes" if trigger["deals_damage"] else "no"
                # and drops or reshapes what the older schema allowed
                for key in ("avoid_damage_blocks", "y_offset"): block.get("minecraft:behavior.random_fly", {}).pop(key, None)
                hover = block.get("minecraft:behavior.random_hover", {})
                if "hover_height" in hover and not isinstance(hover["hover_height"], dict):
                    h = hover["hover_height"]; low, high = (h[0], h[-1]) if isinstance(h, list) else (h, h)
                    hover["hover_height"] = {"min": low, "max": high}
                if "minecraft:pushable" in block:
                    push = block.pop("minecraft:pushable")
                    if push.get("is_pushable", True): block["minecraft:pushable_by_entity"] = {}
                    if push.get("is_pushable_by_piston", True): block["minecraft:pushable_by_block"] = {}
        with open(f"{entitiesBedrock}/{pokemon}.behavior.json", "w") as file: file.write(json.dumps(entity, indent=4))
    print("Create behavior entities complete.")


def create_loot_tables():
    """What Cobblemon says a species drops; items Bedrock does not have (Cobblemon's own) are left out."""
    print("Creating loot tables...")
    fresh(lootTablesBedrock)
    for pokemon in pokemons:
        species = species_for(pokemon)
        pools = []
        for entry in (species or {}).get("drops", {}).get("entries", []):
            item = entry.get("item", "")
            if not item.startswith("minecraft:"): continue
            low, _, high = str(entry.get("quantityRange", "1")).partition("-")
            pool = {"rolls": 1, "entries": [{"type": "item", "name": item, "weight": 1, "functions": [{"function": "set_count", "count": {"min": int(low), "max": int(high or low)}}]}]}
            if "percentage" in entry: pool["conditions"] = [{"condition": "random_chance", "chance": entry["percentage"] / 100}]
            pools.append(pool)
        with open(f"{lootTablesBedrock}/{pokemon}.json", "w") as file: file.write(json.dumps({"pools": pools}, indent=4))
    print("Create loot tables complete.")


def copy_cries():
    """Each species' cry and ambient sound from Cobblemon's sounds.json into sounds/pokemon/<pokemon>/."""
    print("Copying cries...")
    count = 0
    for pokemon in pokemons:
        species = species_for(pokemon)
        if not species: continue
        key = species_key(species)
        for event in ("cry", "ambient"):
            definition = cobblemon_sounds.get(f"pokemon.{key}.{event}")
            if not definition: continue
            sound = definition["sounds"][0]
            name = sound["name"] if isinstance(sound, dict) else sound
            source = f"{cobblemon}/sounds/{name.split(':', 1)[1]}.ogg"
            if not os.path.exists(source): continue
            os.makedirs(f"{soundsBedrock}/pokemon/{pokemon}", exist_ok=True)
            shutil.copyfile(source, f"{soundsBedrock}/pokemon/{pokemon}/{event}.ogg"); count += 1
    print(f"Copy cries complete: {count} file(s).")


def create_sounds():
    print("Creating sound definitions...")
    definitions = {}; entities = {}
    for pokemon in pokemons:
        species = species_for(pokemon)
        if not species: continue
        key = species_key(species); events = {}
        for event in ("cry", "ambient"):
            if os.path.exists(f"{soundsBedrock}/pokemon/{pokemon}/{event}.ogg"):
                definitions[f"cobblemon.{key}.{event}"] = {"category": "neutral", "sounds": [{"name": f"sounds/pokemon/{pokemon}/{event}", "volume": 0.8}]}
        if f"cobblemon.{key}.cry" in definitions:
            events.update({"hurt": f"cobblemon.{key}.cry", "death": f"cobblemon.{key}.cry"})
            events["ambient"] = f"cobblemon.{key}.ambient" if f"cobblemon.{key}.ambient" in definitions else f"cobblemon.{key}.cry"
        if events: entities[entity_id(pokemon)] = {"volume": 1.0, "pitch": 1.0, "events": events}
    # Cobblemon's Poke Ball sounds (throw, hit, open, shut, bounce, shake, capture, break, recall, send out) and its
    # evolution sounds (the party slot's notification jingle, the evolution itself, the UI)
    for key, definition in cobblemon_sounds.items():
        if not key.startswith(("poke_ball.", "evolution.", "item.pokedex.", "pc.", "gui.")): continue
        folder = key.split(".")[-2] if key.startswith("item.") else key.split(".")[0]
        sounds = []
        for sound in definition.get("sounds", []):
            name = sound["name"] if isinstance(sound, dict) else sound
            source = f"{cobblemon}/sounds/{name.split(':', 1)[1]}.ogg"
            if not os.path.exists(source): continue
            os.makedirs(f"{soundsBedrock}/{folder}", exist_ok=True)
            shutil.copyfile(source, f"{soundsBedrock}/{folder}/{os.path.basename(source)}")
            sounds.append({"name": f"sounds/{folder}/{os.path.basename(source)[:-4]}", "volume": sound.get("volume", 1.0) if isinstance(sound, dict) else 1.0})
        if sounds: definitions[f"cobblemon.{key}"] = {"category": "neutral", "sounds": sounds}
    os.makedirs(soundsBedrock, exist_ok=True)
    with open(f"{soundsBedrock}/sound_definitions.json", "w") as file:
        file.write(json.dumps({"format_version": "1.14.0", "sound_definitions": definitions}, indent=4))
    with open(f"{resourcePack}/sounds.json", "w") as file:
        file.write(json.dumps({"entity_sounds": {"entities": entities}}, indent=4))
    print(f"Create sound definitions complete: {len(definitions)} sounds.")


# ---------------------------------------------------------------------------
# Spawn rules from Cobblemon's spawn pools.
#
# Cobblemon names biomes by its own tags (#cobblemon:is_forest); Bedrock spawn rules filter by the
# tags its biome definitions carry (forest, taiga, mesa, mountains, ...). BIOME_FILTERS says how each
# Cobblemon tag reads in Bedrock tags. Tags with no vanilla member (is_volcanic, is_sky, mod biomes)
# resolve to nothing and are dropped; a spawn entry with no resolvable biome, or one that needs a
# structure, a nearby block or fishing, is not ported.
# ---------------------------------------------------------------------------

def _tag(name, present=True):
    return {"test": "has_biome_tag", "operator": "==" if present else "!=", "value": name}


def _any(*filters): return {"any_of": list(filters)}
def _all(*filters): return {"all_of": list(filters)}


BIOME_FILTERS = {
    "is_overworld": _tag("overworld"),
    "is_forest": _any(_all(_tag("forest"), _tag("taiga", False), _tag("extreme_hills", False)), _tag("flower_forest"), _tag("cherry_grove"), _tag("grove")),
    "is_taiga": _tag("taiga"),
    "is_snowy_taiga": _any(_all(_tag("taiga"), _tag("cold")), _tag("grove")),
    "is_jungle": _tag("jungle"),
    "is_bamboo": _tag("bamboo"),
    "is_savanna": _tag("savanna"),
    "is_badlands": _tag("mesa"),
    "is_desert": _tag("desert"),
    "is_arid": _any(_tag("mesa"), _tag("desert"), _tag("savanna")),
    "is_sandy": _any(_tag("mesa"), _tag("desert")),
    "is_beach": _all(_tag("beach"), _tag("stone", False)),
    "is_stony_beach": _all(_tag("beach"), _tag("stone")),
    "is_coast": _any(_tag("beach"), _tag("shore")),
    "is_river": _tag("river"),
    "is_freshwater": _any(_tag("river"), _tag("swamp"), _tag("mangrove_swamp")),
    "is_swamp": _any(_tag("swamp"), _tag("mangrove_swamp")),
    "is_ocean": _tag("ocean"),
    "is_deep_ocean": _all(_tag("ocean"), _tag("deep")),
    "is_cold_ocean": _all(_tag("ocean"), _tag("cold")),
    "is_frozen_ocean": _all(_tag("ocean"), _tag("frozen")),
    "is_lukewarm_ocean": _all(_tag("ocean"), _tag("lukewarm")),
    "is_warm_ocean": _all(_tag("ocean"), _tag("warm")),
    "is_temperate_ocean": _all(_tag("ocean"), _tag("cold", False), _tag("frozen", False), _tag("lukewarm", False), _tag("warm", False)),
    "is_cold_and_temperate_ocean": _all(_tag("ocean"), _tag("frozen", False), _tag("lukewarm", False), _tag("warm", False)),
    "is_lukewarm_and_temperate_ocean": _all(_tag("ocean"), _tag("cold", False), _tag("frozen", False), _tag("warm", False)),
    "is_plains": _any(_tag("plains"), _tag("meadow")),
    "is_grassland": _any(_tag("plains"), _tag("meadow"), _tag("savanna")),
    "is_highlands": _tag("meadow"),
    "is_hills": _any(_tag("extreme_hills"), _tag("meadow")),
    "is_mountain": _any(_tag("mountains"), _tag("extreme_hills"), _tag("meadow")),
    "is_peak": _any(_tag("frozen_peaks"), _tag("jagged_peaks"), _tag("snowy_slopes"), _all(_tag("mountains"), _tag("frozen", False), _tag("meadow", False), _tag("cherry_grove", False), _tag("grove", False))),
    "is_glacial": _any(_tag("frozen_peaks"), _all(_tag("ice_plains"), _tag("mutated"))),
    "is_snowy": _any(_tag("frozen"), _all(_tag("beach"), _tag("cold")), _all(_tag("taiga"), _tag("cold")), _tag("grove")),
    "is_freezing": _any(_tag("frozen"), _all(_tag("beach"), _tag("cold")), _all(_tag("taiga"), _tag("cold")), _tag("grove")),
    "is_cold": _any(_tag("cold"), _tag("frozen"), _tag("taiga"), _tag("mountains")),
    "is_tundra": _tag("ice_plains"),
    "is_snowy_flat": _all(_tag("ice_plains"), _tag("mutated", False)),
    "is_temperate": _any(_all(_tag("forest"), _tag("taiga", False), _tag("extreme_hills", False)), _tag("flower_forest"), _tag("cherry_grove"), _tag("grove"), _tag("plains"), _tag("meadow")),
    "is_floral": _any(_tag("cherry_grove"), _tag("flower_forest"), _tag("meadow"), _all(_tag("plains"), _tag("mutated"))),
    "is_cherry_blossom": _tag("cherry_grove"),
    "is_magical": _tag("roofed"),
    "is_spooky": _any(_tag("roofed"), _tag("pale_garden")),
    "is_mushroom": _any(_tag("roofed"), _tag("mooshroom_island")),
    "is_island": _tag("mooshroom_island"),
    "is_lush": _tag("lush_caves"),
    "is_dripstone": _tag("dripstone_caves"),
    "is_deep_dark": _tag("deep_dark"),
    "is_cave": _tag("caves"),
    "is_plateau": _tag("plateau"),
    "is_end": _tag("the_end"),
    "is_nether": _tag("nether"),
    "nether/is_basalt": _tag("basalt_deltas"),
    "nether/is_crimson": _tag("crimson_forest"),
    "nether/is_warped": _tag("warped_forest"),
    "nether/is_soul_sand": _tag("soulsand_valley"),
    "nether/is_wastes": _tag("nether_wastes"),
}

# Java biome ids that a spawn names directly, as Bedrock tag filters
BIOME_IDS = {
    "minecraft:cherry_grove": _tag("cherry_grove"), "minecraft:meadow": _tag("meadow"), "minecraft:grove": _tag("grove"),
    "minecraft:lush_caves": _tag("lush_caves"), "minecraft:dripstone_caves": _tag("dripstone_caves"), "minecraft:deep_dark": _tag("deep_dark"),
    "minecraft:mushroom_fields": _tag("mooshroom_island"), "minecraft:dark_forest": _tag("roofed"), "minecraft:flower_forest": _tag("flower_forest"),
    "minecraft:bamboo_jungle": _tag("bamboo"), "minecraft:swamp": _tag("swamp"), "minecraft:mangrove_swamp": _tag("mangrove_swamp"),
    "minecraft:desert": _tag("desert"), "minecraft:plains": _all(_tag("plains"), _tag("mutated", False)), "minecraft:sunflower_plains": _all(_tag("plains"), _tag("mutated")),
    "minecraft:stony_shore": _all(_tag("beach"), _tag("stone")), "minecraft:frozen_river": _all(_tag("river"), _tag("frozen")), "minecraft:river": _all(_tag("river"), _tag("frozen", False)),
    "minecraft:warm_ocean": _all(_tag("ocean"), _tag("warm")), "minecraft:pale_garden": _tag("pale_garden"),
}

# Cobblemon's bucket weights (data/cobblemon/spawning/best-spawner-config.json), so rarity survives the port
BUCKET_WEIGHTS = {"common": 94.0, "uncommon": 5.0, "rare": 0.5, "ultra-rare": 0.2}
SURFACE_PRESETS = {"natural", "wild", "treetop", "foliage", "water"}


def biome_filter_for(biome_ids):
    filters = []
    for biome in biome_ids:
        if biome.startswith("#cobblemon:"): rule = BIOME_FILTERS.get(biome[len("#cobblemon:"):])
        else: rule = BIOME_IDS.get(biome)
        if rule: filters.append(rule)
    if not filters: return None
    return filters[0] if len(filters) == 1 else _any(*filters)


def spawn_condition(spawn, species, kind):
    """One Bedrock spawn condition from one Cobblemon spawn entry, or None if it cannot be expressed."""
    condition = spawn.get("condition", {})
    if condition.get("structures") or condition.get("neededNearbyBlocks") or spawn.get("spawnablePositionType") == "fishing": return None
    if not set(spawn.get("presets", ["natural"])) & SURFACE_PRESETS and spawn.get("presets"): return None
    biome_filter = biome_filter_for(condition.get("biomes", ["#cobblemon:is_overworld"]))
    if biome_filter is None: return None
    position = spawn.get("spawnablePositionType", "grounded")
    weight = max(1, round(spawn.get("weight", 10) * BUCKET_WEIGHTS.get(spawn.get("bucket", "common"), 1.0) / 6))
    rule = {"minecraft:weight": {"default": weight}, "minecraft:biome_filter": biome_filter}
    in_water = position in ("submerged", "surface", "seafloor") or kind == "fish"
    underground = condition.get("canSeeSky") is False or (condition.get("maxY") is not None and condition["maxY"] < 60)
    if in_water: rule["minecraft:spawns_underwater"] = {}; rule["minecraft:spawns_on_surface"] = {}
    elif underground: rule["minecraft:spawns_underground"] = {}
    else: rule["minecraft:spawns_on_surface"] = {}
    if "minSkyLight" in condition or "maxSkyLight" in condition or "timeRange" in condition:
        low = condition.get("minSkyLight", 0); high = condition.get("maxSkyLight", 15)
        time_range = condition.get("timeRange", "")
        if time_range in ("night", "midnight", "dusk"): high = min(high, 7)
        if time_range in ("day", "morning", "afternoon", "noon"): low = max(low, 8)
        rule["minecraft:brightness_filter"] = {"min": low, "max": high, "adjust_for_weather": time_range in ("night", "midnight", "dusk", "day", "morning", "afternoon", "noon")}
    if "minY" in condition or "maxY" in condition:
        rule["minecraft:height_filter"] = {"min": condition.get("minY", -64), "max": condition.get("maxY", 320)}
    herd = species.get("behaviour", {}).get("herd", {}).get("maxSize", 1)
    rule["minecraft:herd"] = {"min_size": 1, "max_size": max(1, min(int(herd), 4))}
    return rule


def create_spawn_rules():
    print("Creating spawn rules...")
    fresh(spawnRulesBedrock)
    pools = {}
    for root, _, files in os.walk(f"{cobblemonData}/spawn_pool_world"):
        for name in files:
            if name.endswith(".json") and "herds" not in root:
                with open(os.path.join(root, name), encoding="utf-8") as file: pools[name[:-5]] = json.load(file)
    written = 0; skipped = 0
    for pokemon in pokemons:
        species = species_for(pokemon)
        pool = pools.get(pokemon)
        if not species or not pool: continue
        kind = movement_kind(species)
        conditions = []
        for spawn in pool.get("spawns", []):
            if spawn.get("pokemon", "").split(" ")[0] != species_key(species): continue   # forms and shinies spawn as the base species
            rule = spawn_condition(spawn, species, kind)
            if rule: conditions.append(rule)
            else: skipped += 1
        if not conditions: continue
        # one population pool per file: water spawns go in water_animal, and a species that spawns both
        # on land and in water keeps only its land spawns, because water spawns counted in the animal
        # pool fill it from every shore and starve the land spawns (vanilla cows included)
        water = [c for c in conditions if "minecraft:spawns_underwater" in c]
        if len(water) == len(conditions): population = "water_animal"
        else: population = "animal"; conditions = [c for c in conditions if "minecraft:spawns_underwater" not in c]
        data = {"format_version": "1.8.0", "minecraft:spawn_rules": {"description": {"identifier": entity_id(pokemon), "population_control": population}, "conditions": conditions}}
        with open(f"{spawnRulesBedrock}/{pokemon}.json", "w") as file: file.write(json.dumps(data, indent=4))
        written += 1
    print(f"Create spawn rules complete: {written} Pokemon spawn naturally, {skipped} spawn entries not expressible (structures, nearby blocks, fishing, modded biomes).")



# ---------------------------------------------------------------------------
# Particles. Cobblemon's particle files are already Bedrock particle JSON (they were authored for
# Snowstorm); only the "cobblemon:emitter_space" component is Cobblemon's own and is dropped. The
# textures they name under textures/particles/ live upstream under textures/particle/.
# ---------------------------------------------------------------------------

particlesMain = f"{cobblemon}/bedrock/particles"
particleTexturesMain = f"{cobblemon}/textures/particle"
particlesBedrock = f"{resourcePack}/particles"
particleTexturesBedrock = f"{resourcePack}/textures/particles"
particle_ids = {}


def particle_texture_path(texture):
    """Cobblemon's particle textures live under textures/particle; a few files name them by other paths."""
    path = re.sub(r"^cobblemon:", "", texture)
    path = re.sub(r"^textures/(?:particle|textures)/", "textures/particles/", path)
    if os.path.exists(f"{particleTexturesMain}/{path[len('textures/particles/'):]}.png"): return path
    name = os.path.basename(path)
    for root, _, files in os.walk(particleTexturesMain):
        if f"{name}.png" in files: return "textures/particles/" + os.path.relpath(os.path.join(root, name), particleTexturesMain).replace(os.sep, "/")
    return path


def nest_minmax(expr):
    """math.max(a, b, c) -> math.max(a, math.max(b, c)): Bedrock's min and max take exactly two arguments."""
    out, i = "", 0
    while True:
        match = re.search(r"math\.(max|min)\(", expr[i:])
        if not match: return out + expr[i:]
        start = i + match.start(); open_at = i + match.end()
        depth, args, current, j = 1, [], "", open_at
        while j < len(expr) and depth:
            ch = expr[j]; depth += (ch == "(") - (ch == ")")
            if depth == 0: break
            if ch == "," and depth == 1: args.append(current); current = ""
            else: current += ch
            j += 1
        args.append(current)
        args = [nest_minmax(a.strip()) for a in args]
        name = match.group(1)
        call = args[-1]
        for a in reversed(args[:-1]): call = f"math.{name}({a}, {call})"
        if len(args) == 1: call = f"math.{name}({args[0]})"
        out += expr[i:start] + call; i = j + 1


def particle_molang(expr):
    """Repairs for Molang strings in Cobblemon's particle files, which Bedrock parses more strictly."""
    expr = re.sub(r"math\.random\(\s*\)", "math.random(0, 1)", expr)
    if expr.count("(") == expr.count(")"): expr = nest_minmax(expr)
    if "=" in expr or ";" in expr:
        # an assignment is never wrapped; surplus closing parentheses before the ';' are dropped
        while expr.count(")") > expr.count("("):
            i = expr.rfind(")"); expr = expr[:i] + expr[i+1:]
        return nest_minmax(expr) if expr.count("(") == expr.count(")") else expr
    depth = 0
    for i, ch in enumerate(expr):
        depth += (ch == "(") - (ch == ")")
        if ch == "," and depth == 0: expr = expr[:i]; break   # a stray top-level comma ends the expression
    if expr.count("(") != expr.count(")"):
        fixed = fix_molang(expr); expr = expr if fixed is None else fixed
    return expr


def normalize_particle(data):
    """Field-level repairs Bedrock insists on: collision radius, flipbook max_frame, numeric step_UV,
    boolean loop, and the Molang fixes above on every string."""
    def walk(value):
        if isinstance(value, str) and re.search(r"[a-z_]+\.[a-z_]|[()]", value): return particle_molang(value)
        if isinstance(value, list): return [walk(v) for v in value]
        if isinstance(value, dict): return {k: walk(v) for k, v in value.items()}
        return value
    data = walk(data)
    components = data.get("particle_effect", {}).get("components", {})
    collision = components.get("minecraft:particle_motion_collision")
    if isinstance(collision, dict):
        radius = collision.get("collision_radius")
        collision["collision_radius"] = min(radius, 0.5) if isinstance(radius, (int, float)) else 0.1
    flipbook = components.get("minecraft:particle_appearance_billboard", {}).get("uv", {}).get("flipbook")
    if isinstance(flipbook, dict):
        size = flipbook.get("size_UV", [1, 1])
        step = flipbook.get("step_UV", [0, 0])
        if isinstance(step, list):
            flipbook["step_UV"] = [s if isinstance(s, (int, float)) else (size[i] if i < len(size) and isinstance(size[i], (int, float)) else 0) for i, s in enumerate(step)]
        if "max_frame" not in flipbook: flipbook["max_frame"] = 1
        if isinstance(flipbook.get("loop"), str): flipbook["loop"] = flipbook["loop"].lower() == "true"
    return data


def copy_particles():
    print("Copying particles...")
    fresh(particlesBedrock)
    count = 0
    for root, _, files in os.walk(particlesMain):
        for name in files:
            if not name.endswith(".particle.json"): continue
            with open(os.path.join(root, name), encoding="utf-8") as file: data = json.load(file)
            effect = data.get("particle_effect", {})
            components = effect.get("components", {})
            for key in [k for k in components if not k.startswith("minecraft:")]: components.pop(key)
            # Cobblemon feeds its particles the entity's size and the move's target; Bedrock has no such queries
            text = json.dumps(data)
            text = re.sub(r"(?<![\w.])(?:q|query)\.(?:entity_size|entity_scale|entity_height|entity_width|entity_radius)(?![\w])", "1", text)
            text = re.sub(r"(?<![\w.])(?:q|query)\.(?:target_delta[xyz]|target_distance)(?![\w])", "0", text)
            text = re.sub(r"(?<![\w.])(?:v|variable)\.(?:entity_size|entity_scale|entity_height|entity_width|entity_radius)(?![\w])", "1", text)
            text = re.sub(r"(?<![\w.])\d+(?:\.\d+)?\s*=\s*[^;\"]*;\s*", "", text)   # "1=1;" after v.entity_size became 1
            data = json.loads(text)
            data = normalize_particle(data)
            events = data["particle_effect"].get("events", {})
            for key in [k for k, v in events.items() if "sound" in json.dumps(v)]: events.pop(key)   # Bedrock particles cannot play sounds
            render = data["particle_effect"].get("description", {}).get("basic_render_parameters", {})
            if render.get("texture"): render["texture"] = particle_texture_path(render["texture"])
            # Cobblemon fades these through the tint's alpha, which only a blending material honours; alpha
            # test draws them as solid squares
            tint = components.get("minecraft:particle_appearance_tinting", {}).get("color")
            alpha = tint[3] if isinstance(tint, list) and len(tint) == 4 else (tint.get("alpha") if isinstance(tint, dict) else None)
            if render.get("material") == "particles_alpha" and (isinstance(alpha, str) or (isinstance(alpha, (int, float)) and alpha < 1)):
                render["material"] = "particles_blend"
            texture = render.get("texture", "")
            if texture.startswith("textures/particles/") and not os.path.exists(f"{particleTexturesMain}/{texture[len('textures/particles/'):]}.png"):
                continue   # Cobblemon ships no texture for it (the tailflame particles); it would render as a missing-texture square
            collision = data["particle_effect"].get("components", {}).get("minecraft:particle_motion_collision")
            if collision and isinstance(collision.get("enabled"), str) and not re.search(r"[\w.]+\s*[<>=!]", collision["enabled"]):
                collision["enabled"] = True   # a truncated expression such as "positio" is an export artefact
            identifier = effect.get("description", {}).get("identifier")
            if not identifier: continue
            relative = os.path.relpath(os.path.join(root, name), particlesMain).replace(os.sep, "/")
            particle_ids[identifier] = relative
            os.makedirs(os.path.dirname(f"{particlesBedrock}/{relative}"), exist_ok=True)
            with open(f"{particlesBedrock}/{relative}", "w", encoding="utf-8") as file: file.write(json.dumps(data, indent="\t"))
            count += 1
    shutil.copytree(src=particleTexturesMain, dst=particleTexturesBedrock, dirs_exist_ok=True)
    print(f"Copy particles complete: {count} particle(s).")


def load_particle_ids():
    if particle_ids or not os.path.isdir(particlesBedrock): return
    for root, _, files in os.walk(particlesBedrock):
        for name in files:
            with open(os.path.join(root, name), encoding="utf-8") as file: data = json.load(file)
            identifier = data.get("particle_effect", {}).get("description", {}).get("identifier")
            if identifier: particle_ids[identifier] = name


ambient_cache = {}


def ambient_particles(pokemon, pokemonName):
    """{short animation name: [particle entries]} for effects keyed at time 0 of a looping animation. Bedrock
    fires an animation's keyframe particles once, so a constant effect (Slugma's bubbles) is spawned by the
    controller state that plays the animation as well (the keyframe still fires once at spawn, which is harmless)."""
    if pokemon in ambient_cache: return ambient_cache[pokemon]
    load_particle_ids()
    path = f"{animationsBedrock}/{pokemon}/{pokemonName}.animation.json"
    result = ambient_cache[pokemon] = {}
    if not os.path.exists(path): return result
    with open(path, encoding="utf-8") as file: data = json.load(file)
    for name, anim in data.get("animations", {}).items():
        if not anim.get("loop") or "0.0" not in anim.get("particle_effects", {}): continue
        keyframe = anim["particle_effects"]["0.0"]
        entries = [e for e in (keyframe if isinstance(keyframe, list) else [keyframe]) if isinstance(e, dict) and e.get("locator") and f"cobblemon:{e.get('effect')}" in particle_ids]
        if not entries: continue
        result[name[name.rindex(".")+1:]] = [{"effect": e["effect"], "locator": e["locator"]} for e in entries]
    return result


def animation_effects(pokemon, pokemonName):
    """The particle and sound effect names a Pokemon's animations fire, mapped to the pack's identifiers."""
    path = f"{animationsBedrock}/{pokemon}/{pokemonName}.animation.json"
    particles = {}; sounds = {}
    if not os.path.exists(path): return particles, sounds
    with open(path, encoding="utf-8") as file: data = json.load(file)
    for name, entries in ambient_particles(pokemon, pokemonName).items():
        for entry in entries: particles[entry["effect"]] = f"cobblemon:{entry['effect']}"
    for anim in data.get("animations", {}).values():
        for keyframe in anim.get("particle_effects", {}).values():
            for entry in (keyframe if isinstance(keyframe, list) else [keyframe]):
                effect = entry.get("effect") if isinstance(entry, dict) else None
                if effect and f"cobblemon:{effect}" in particle_ids: particles[effect] = f"cobblemon:{effect}"
        for keyframe in anim.get("sound_effects", {}).values():
            for entry in (keyframe if isinstance(keyframe, list) else [keyframe]):
                effect = entry.get("effect") if isinstance(entry, dict) else None
                match = re.match(r"pokemon\.(\w+)\.(cry|ambient)$", effect or "")
                if match and os.path.exists(f"{soundsBedrock}/pokemon/{pokemon}/{match.group(2)}.ogg"): sounds[effect] = f"cobblemon.{match.group(1)}.{match.group(2)}"
    return particles, sounds


# ---------------------------------------------------------------------------
# Sleeping. Cobblemon's resting data says whether a species sleeps and in what light; Bedrock's nap
# goal (the fox's) puts an entity to sleep and exposes q.is_sleeping to the client. Species that
# sleep in the dark nap at night, species that sleep by day nap in daylight, "any" naps whenever.
# ---------------------------------------------------------------------------

def sleep_time(species):
    """'night', 'day', 'any' or None for a species, from behaviour.resting."""
    resting = species.get("behaviour", {}).get("resting", {})
    if not resting.get("canSleep", False): return None
    times = resting.get("times", [])
    if "any" in times: return "any"
    if "day" in times: return "day"
    light = resting.get("light", "0-4")
    return "day" if light.startswith("1") and not light.startswith("0") else "night"


def nap_component():
    return {
        "priority": 8,
        "cooldown_min": 20.0,
        "cooldown_max": 120.0,
        "mob_detect_dist": 6.0,
        "mob_detect_height": 4.0,
        "can_nap_filters": {"all_of": [
            {"test": "in_water", "subject": "self", "operator": "==", "value": False},
            {"test": "on_ground", "subject": "self", "operator": "==", "value": True},
            {"test": "is_weather", "subject": "self", "operator": "!=", "value": "thunderstorm"}
        ]},
        "wake_mob_exceptions": {"any_of": [
            {"test": "is_family", "subject": "other", "operator": "==", "value": "pokemon"},
            {"test": "is_sneaking", "subject": "other", "operator": "==", "value": True}
        ]}
    }


def add_sleep(entity, species, kind):
    when = sleep_time(species)
    if when is None or kind == "fish": return
    groups = entity["minecraft:entity"].setdefault("component_groups", {})
    events = entity["minecraft:entity"].setdefault("events", {})
    groups["cobblemon:sleepy"] = {"minecraft:behavior.nap": nap_component()}
    if when == "any":
        entity["minecraft:entity"]["components"]["minecraft:behavior.nap"] = nap_component()
        return
    daytime = when == "day"
    entity["minecraft:entity"]["components"]["minecraft:environment_sensor"] = {"triggers": [
        {"filters": {"test": "is_daytime", "value": daytime}, "event": "cobblemon:bedtime"},
        {"filters": {"test": "is_daytime", "value": not daytime}, "event": "cobblemon:wake_up"}
    ]}
    events["cobblemon:bedtime"] = {"add": {"component_groups": ["cobblemon:sleepy"]}}
    events["cobblemon:wake_up"] = {"remove": {"component_groups": ["cobblemon:sleepy"]}}



# ---------------------------------------------------------------------------
# Poke Balls, capture, ownership and combat. All vanilla components, no scripts:
#
# - cobblemon:poke_ball is a throwable item whose projectile scripts/main.js catches when it hits a wild
#   Pokemon: EmptyPokeBallEntity's sequence (bounce, open, the red beam, fall, shakes), then Cobblemon's
#   catch roll; on a success the Pokemon drops a filled ball item, cobblemon:poke_ball_<id>, and vanishes.
# - a filled ball places its Pokemon back with the cobblemon:released event, which makes it claimable.
# - a wild Pokemon is tamed (minecraft:tameable) only by the script, when a capture succeeds; interacting while
#   holding an empty Poke Ball throws it. A released one can still be claimed with a ball in hand.
# - an owned Pokemon follows its owner, fights what the owner fights and what attacks the owner,
#   attacks hostile mobs on its own, never despawns, and its panel gains Stay and Follow buttons.
# ---------------------------------------------------------------------------

itemsBedrock = f"{behaviorPack}/items"
pokeBallsMain = f"{cobblemon}/bedrock/poke_balls"
npcsMain = f"{cobblemon}/bedrock/npcs"


def catch_rate(species):
    return max(1, min(255, int(species.get("catchRate", 45))))


# ---------------------------------------------------------------------------
# Poke Ball types. Every ball in Cobblemon's bedrock/poke_balls/variations becomes an item, cobblemon:<name>,
# thrown as its own projectile, cobblemon:ball_<name>, on the ball's own model and texture. Cobblemon keeps
# the catch modifiers in code; the lang tooltips state them, and that is where the multipliers come from.
# scripts/main.js applies the multipliers when a thrown ball lands (ballMultiplier).
# ---------------------------------------------------------------------------

# balls whose multiplier depends on something; the rest are the flat multiplier in their tooltip
BALL_RULES = {
    "master_ball": "master", "ancient_origin_ball": "master",
    "dusk_ball": "dusk", "park_ball": "park", "dive_ball": "dive", "net_ball": "net", "fast_ball": "fast",
    "heavy_ball": "heavy", "nest_ball": "nest", "beast_ball": "beast", "dream_ball": "dream", "safari_ball": "safari",
    "quick_ball": "quick", "timer_ball": "timer", "level_ball": "level", "moon_ball": "moon",
    "love_ball": "love", "lure_ball": "lure", "repeat_ball": "repeat",
}
# rules a thrown ball can apply in the world; the others need a battle and apply only in main.js
WORLD_RULES = {"master", "dusk", "park", "dive", "net", "fast", "heavy", "nest", "beast", "dream"}
_balls = None


def poke_balls():
    """Every ball Cobblemon ships, Poke Ball first: name, display name, item and projectile ids, model,
    texture, tooltip multiplier, rule, catch class and throw power."""
    global _balls
    if _balls is not None: return _balls
    balls = []
    for path in sorted(glob.glob(f"{pokeBallsMain}/variations/*.json")):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        name = data["pokeball"].split(":")[-1]
        variation = data["variations"][0]
        model = re.sub(r"\.geo$", "", variation["model"].split(":")[-1])
        texture = os.path.basename(variation["texture"])[:-len(".png")]
        tooltip = lang.get(f"item.cobblemon.{name}.tooltip", "")
        match = re.match(r"([\d.]+)", tooltip)
        mult = float(match.group(1)) if match else 1.0
        rule = BALL_RULES.get(name)
        # Safari's 1.5x is outside battle, which is every thrown ball here
        # and a rule that needs a battle (Quick, Timer, Level, Moon, Love, Lure, Repeat) is 1x when thrown in the world
        catch = "x1_5" if rule == "safari" else rule if rule in WORLD_RULES else "x1" if rule else "x" + f"{mult:g}".replace(".", "_")
        power = 2.0 if "flies further" in tooltip else 1.0 if "throws less far" in tooltip else 1.5
        balls.append({"name": name, "display": lang.get(f"item.cobblemon.{name}", name.replace("_", " ").title()),
                      "item": f"cobblemon:{name}", "entity": f"cobblemon:ball_{name}",   # never the item's own id, which its attachable holds
                      "model": model, "texture": texture, "mult": mult, "rule": rule, "catch": catch, "power": power})
    balls.sort(key=lambda b: b["name"] != "poke_ball")
    _balls = balls
    return balls


# ---------------------------------------------------------------------------
# Evolution by item. Cobblemon's item_interact evolutions (a Thunder Stone on a Pikachu) and its trade
# evolutions, which have no trading to hang on here, become a right-click with the item on an owned Pokemon:
# the item held for the trade (a Metal Coat for Onix) or else Cobblemon's Link Cable. The Pokemon transforms
# into its evolution, and scripts/main.js hands the result back to its owner.
# ---------------------------------------------------------------------------

evolutionItemsMain = f"{cobblemon}/textures/item/evolution"


def evolution_item(evolution):
    """The item that triggers an item or trade evolution, as an item id this pack defines, or None."""
    if evolution.get("variant") == "item_interact": item = evolution.get("requiredContext")
    else: item = next((r.get("itemCondition") for r in evolution.get("requirements", []) if r.get("variant") == "held_item"), None)
    if not (isinstance(item, str) and item.startswith("cobblemon:")): item = "cobblemon:link_cable"
    return item if os.path.exists(f"{evolutionItemsMain}/{item.split(':')[1]}.png") else None


def add_item_evolutions(entity, species, pokemon):
    """A right-click with the evolution item on an owned Pokemon transforms it. Day or night and gender
    requirements become filters; an evolution that needs a biome (the regional ones) is left out, and moon
    phase, party member and the other requirements are not checked."""
    minecraft = entity["minecraft:entity"]
    variations = resolver_variations(pokemon)
    interactions = []
    for evolution in species.get("evolutions", []):
        result = pokemon_for_species_name(evolution.get("result", ""))
        if result:
            group = f"cobblemon:evolve_{result}"
            minecraft["component_groups"][group] = {"minecraft:transformation": {"into": entity_id(result), "keep_level": True}}
            minecraft["events"][f"cobblemon:evolve_to_{result}"] = {"add": {"component_groups": [group]}}
        if evolution.get("variant") not in ("item_interact", "trade"): continue
        requirements = evolution.get("requirements", [])
        # a biome anticondition marks the everywhere-else evolution, which is the one kept
        if any(r.get("variant") == "biome" and "biomeCondition" in r for r in requirements): continue
        result = pokemon_for_species_name(evolution.get("result", ""))
        item = evolution_item(evolution)
        if not result or not item: continue
        filters = [{"test": "has_equipment", "subject": "other", "domain": "hand", "value": item}]
        skip = False
        for requirement in requirements:
            if requirement.get("variant") == "time_range" and requirement.get("range") in ("day", "night"):
                filters.append({"test": "is_daytime", "value": requirement["range"] == "day"})
            match = re.match(r"gender=(male|female)$", requirement.get("target", "")) if requirement.get("variant") == "properties" else None
            if match:
                looks = [n for n, v in enumerate(variations) if v["female"] == (match.group(1) == "female")]
                if not looks: skip = True
                elif len(variations) > 1: filters.append({"any_of": [{"test": "is_variant", "subject": "self", "value": n} for n in looks]})
        if skip: continue
        group = f"cobblemon:evolve_{result}"
        minecraft["component_groups"][group] = {"minecraft:transformation": {"into": entity_id(result), "keep_level": True}}
        minecraft["events"][f"cobblemon:evolve_to_{result}"] = {"add": {"component_groups": [group]}}
        interactions.append({"on_interact": {"filters": {"all_of": filters}, "event": f"cobblemon:evolve_to_{result}", "target": "self"},
                             "use_item": True, "swing": True, "interact_text": "action.interact.evolve"})
    if interactions: minecraft["component_groups"]["cobblemon:owned"]["minecraft:interact"] = {"interactions": interactions}


# ---------------------------------------------------------------------------
# Pokemon interactions. Cobblemon's data/cobblemon/pokemon_interactions files let an owner use an item on a
# Pokemon for a drop: a brush on a Charmander for a Shed Shell, bone meal on an Abomasnow for a spruce
# sapling, a bucket on a Miltank for milk. Each becomes an entry in the owned Pokemon's minecraft:interact.
# ---------------------------------------------------------------------------

interactionsMain = f"{cobblemonData}/pokemon_interactions"
lootInteractionsBedrock = f"{behaviorPack}/loot_tables/interactions"
# Cobblemon's item tags as the Bedrock item that stands for them
INTERACTION_ITEMS = {"#c:tools/brush": "minecraft:brush", "#c:fertilizers": "minecraft:bone_meal", "#c:tools/shear": "minecraft:shears"}
TOOLS = {"minecraft:brush", "minecraft:shears"}
_interactions = None


def pokemon_interactions():
    """Interaction files by pack folder, skipping those for one form only (a Rotom appliance)."""
    global _interactions
    if _interactions is not None: return _interactions
    _interactions = {}
    for path in sorted(glob.glob(f"{interactionsMain}/*.json")):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        targets = [r.get("target", "") for r in data.get("requirements", []) if r.get("variant") == "properties"]
        if not targets or " " in targets[0]: continue
        pokemon = pokemon_for_species_name(targets[0])
        if pokemon: _interactions.setdefault(pokemon, []).extend(data.get("interactions", []))
    return _interactions


def interaction_item_texture(name):
    """A Cobblemon item icon anywhere under textures/item, or None."""
    for root, _, files in os.walk(f"{cobblemon}/textures/item"):
        if f"{name}.png" in files: return os.path.join(root, f"{name}.png")
    return None


def add_pokemon_interactions(entity, species, pokemon):
    """The owner's item on the Pokemon: a tool takes a point of wear, anything else is used up; a drop
    comes from a generated loot table, a bucket or bottle turns into what it filled with, and the file's
    cooldown (in ticks) holds off the next one. Sounds are Java sound ids with no Bedrock equivalent."""
    entries = []
    for index, interaction in enumerate(pokemon_interactions().get(pokemon, [])):
        held = next((r.get("itemCondition") for r in interaction.get("requirements", []) if r.get("variant") == "owner_held_item"), None)
        item = INTERACTION_ITEMS.get(held, held)
        if not (isinstance(item, str) and item.startswith("minecraft:")): continue
        effects = interaction.get("effects", [])
        entry = {"on_interact": {"filters": {"all_of": [{"test": "has_equipment", "subject": "other", "domain": "hand", "value": item}]}}, "swing": True,
                 "interact_text": "action.interact.use", "cooldown": round(int(interaction.get("cooldown", 0) or 0) / 20, 1)}
        give = next((e["item"] for e in effects if e.get("variant") == "give_item"), None)
        if give and (give.startswith("minecraft:") or interaction_item_texture(give.split(":")[1])): entry["transform_to_item"] = give
        elif any(e.get("variant") == "shrink_item" for e in effects):
            if item in TOOLS: entry["hurt_item"] = 1
            else: entry["use_item"] = True
        drops = [e["item"] for e in effects if e.get("variant") == "drop_item" and (e["item"].startswith("minecraft:") or interaction_item_texture(e["item"].split(":")[1]))]
        if drops:
            os.makedirs(lootInteractionsBedrock, exist_ok=True)
            table = f"{pokemon}_{index}.json"
            with open(f"{lootInteractionsBedrock}/{table}", "w") as file:
                file.write(json.dumps({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": d, "weight": 1} for d in drops]}]}, indent=4))
            entry["spawn_items"] = {"table": f"loot_tables/interactions/{table}"}
        if "spawn_items" in entry or "transform_to_item" in entry: entries.append(entry)
    if not entries: return
    owned = entity["minecraft:entity"]["component_groups"]["cobblemon:owned"]
    owned.setdefault("minecraft:interact", {"interactions": []})["interactions"].extend(entries)


def create_interaction_items():
    """Cobblemon items an interaction hands out (Shed Shell, Moomoo Milk, Revival Herb) as plain items."""
    names = set()
    for interactions in pokemon_interactions().values():
        for interaction in interactions:
            for effect in interaction.get("effects", []):
                item = effect.get("item", "")
                if item.startswith("cobblemon:"): names.add(item.split(":")[1])
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    made = []
    for name in sorted(names):
        icon = interaction_item_texture(name)
        if not icon: continue
        shutil.copyfile(icon, f"{texturesItemsBedrock}/{name}.png")
        itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        item = {"format_version": "1.20.50", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "items"}},
            "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"}, "minecraft:max_stack_size": 64}}}
        with open(f"{itemsBedrock}/{name}.json", "w") as file: file.write(json.dumps(item, indent=4))
        made.append(name)
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    return made


def create_evolution_items():
    """Cobblemon's evolution items (stones, trade items, the Link Cable) as plain items with their icons."""
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/evolution", exist_ok=True)
    names = sorted(f[:-len(".png")] for f in os.listdir(evolutionItemsMain) if f.endswith(".png"))
    for name in names:
        shutil.copyfile(f"{evolutionItemsMain}/{name}.png", f"{texturesItemsBedrock}/{name}.png")
        itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        item = {"format_version": "1.20.50", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "items"}},
            "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"}, "minecraft:max_stack_size": 64}}}
        with open(f"{itemsBedrock}/evolution/{name}.json", "w") as file: file.write(json.dumps(item, indent=4))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    return names


def ride_behaviours(species):
    """Cobblemon's riding styles for a species (AIR, LAND, WATER), empty when it cannot be ridden."""
    return set(((species or {}).get("riding") or {}).get("behaviours", {}))


def add_riding(entity, species, pokemon):
    """An owned Pokemon Cobblemon lets you ride takes riders at its seat locators, the first seat steering."""
    kinds = ride_behaviours(species)
    if not kinds: return
    owned = entity["minecraft:entity"]["component_groups"]["cobblemon:owned"]
    seats = species["riding"].get("seats") or [{"locator": "seat_1"}]
    # a model faces -Z and an entity's seat space faces +Z, so the locator's depth flips
    positions = [[x, y, round(-z, 2)] for x, y, z in (locator_offset(pokemon, pokemon[pokemon.index("_")+1:], seat.get("locator", "seat_1")) for seat in seats)]
    owned["minecraft:rideable"] = {
        "seat_count": len(seats), "family_types": ["player"], "interact_text": "action.interact.ride.horse",
        "controlling_seat": 0, "crouching_skip_interact": True, "pull_in_entities": False,
        "seats": [{"position": position, "min_rider_count": 0, "max_rider_count": len(seats)} for position in positions]
    }
    # on land and in water with the ground controls. A species Cobblemon flies (AIR) is steered the way the vanilla
    # happy ghast is (behavior_packs/vanilla_1.26.30/entities/happy_ghast.json, adult_harnessed): free camera
    # controls, which move it where the rider looks, a vertical movement action so jump climbs, and the ride-tamed
    # behavior, read from entity format 1.26.30, with its gravity off while it carries a rider
    if "AIR" not in kinds:
        owned["minecraft:input_ground_controlled"] = {}
        return
    minecraft = entity["minecraft:entity"]
    entity["format_version"] = "1.26.30"
    owned["minecraft:free_camera_controlled"] = {"strafe_speed_modifier": 1.0, "backwards_movement_modifier": 0.5}
    owned["minecraft:vertical_movement_action"] = {"vertical_velocity": 0.5}
    owned["minecraft:behavior.player_ride_tamed"] = {"priority": 1}
    # a flier lands or is left in the air by its rider without a fall hurting it, as the happy ghast is
    minecraft["components"].setdefault("minecraft:damage_sensor", {"triggers": []})["triggers"].insert(0, {"cause": "fall", "deals_damage": False})
    # gravity lives in its own group, so a rider can take it away rather than a second physics component trying to override it
    groups, events = minecraft["component_groups"], minecraft["events"]
    # and so do its own flight movement and pathing: the adult happy ghast carries neither, and while they are on,
    # they rather than the rider decide the mount's height
    unridden = {"minecraft:physics": minecraft["components"].pop("minecraft:physics", {})}
    for key in [k for k in minecraft["components"] if k.startswith("minecraft:movement.") or k.startswith("minecraft:navigation.")]:
        unridden[key] = minecraft["components"].pop(key)
    groups["cobblemon:gravity"] = unridden
    groups["cobblemon:ridden_air"] = {"minecraft:physics": {"has_gravity": False}, "minecraft:flying_speed": {"value": 0.05},
                                      "minecraft:navigation.float": {"can_path_over_water": True},
                                      "minecraft:body_rotation_always_follows_head": {}}
    events["cobblemon:ride_air_on"] = {"remove": {"component_groups": ["cobblemon:gravity"]}, "add": {"component_groups": ["cobblemon:ridden_air"]}}
    events["cobblemon:ride_air_off"] = {"remove": {"component_groups": ["cobblemon:ridden_air"]}, "add": {"component_groups": ["cobblemon:gravity"]}}
    for event in ("minecraft:entity_spawned", "minecraft:entity_born", "minecraft:entity_transformed", "cobblemon:caught", "cobblemon:released"):
        events.setdefault(event, {}).setdefault("add", {}).setdefault("component_groups", []).append("cobblemon:gravity")
    owned["minecraft:rideable"]["on_rider_enter_event"] = "cobblemon:ride_air_on"
    owned["minecraft:rideable"]["on_rider_exit_event"] = "cobblemon:ride_air_off"


def add_capture(entity, species, pokemon, kind):
    rate = catch_rate(species)
    components = entity["minecraft:entity"]["components"]
    groups = entity["minecraft:entity"].setdefault("component_groups", {})
    events = entity["minecraft:entity"].setdefault("events", {})
    # wild: may despawn, may be tamed at the catch rate; owned: follows and fights for its owner
    despawn = components.pop("minecraft:despawn", {"despawn_from_distance": {}})
    groups["cobblemon:wild"] = {"minecraft:despawn": despawn}
    balls = poke_balls(); ball_items = [b["item"] for b in balls]; classes = sorted({b["catch"] for b in balls})
    # tamed only by the script when a capture succeeds, so a ball in hand is always thrown, as Cobblemon's is
    components["minecraft:tameable"] = {"probability": round(rate / 255, 3), "tame_items": [], "tame_event": {"event": "cobblemon:caught", "target": "self"}}
    # a thrown ball never hurts; scripts/main.js plays the capture and rolls the catch
    components["minecraft:damage_sensor"] = {"triggers": [{"on_damage": {"filters": {"test": "is_family", "subject": "damager", "value": "poke_ball"}}, "deals_damage": False}]}
    groups["cobblemon:released"] = {"minecraft:tameable": {"probability": 1.0, "tame_items": ball_items, "tame_event": {"event": "cobblemon:caught", "target": "self"}}, "minecraft:persistent": {}}
    groups["cobblemon:owned"] = {
        "minecraft:is_tamed": {},
        # the same families plus "owned", so selectors can tell an owned Pokemon from a wild one
        "minecraft:type_family": {"family": components["minecraft:type_family"]["family"] + ["owned"]},
        "minecraft:persistent": {},
        "minecraft:leashable": {},
        "minecraft:behavior.owner_hurt_by_target": {"priority": 1},
        "minecraft:behavior.owner_hurt_target": {"priority": 2},
        "minecraft:behavior.melee_attack": {"priority": 3, "track_target": True},
        "minecraft:behavior.nearest_attackable_target": {"priority": 4, "must_see": True, "reselect_targets": True, "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "monster"}, "max_dist": 12}]}
    }
    # pastured (PokemonPastureBlockEntity): roams within pastureMaxWanderDistance, 32 blocks, of where it was sent out
    groups["cobblemon:pastured"] = {"minecraft:home": {"restriction_radius": 32, "restriction_type": "random_movement"},
                                    "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8}}
    events["cobblemon:pasture"] = {"remove": {"component_groups": ["cobblemon:following"]}, "add": {"component_groups": ["cobblemon:pastured"]}}
    groups["cobblemon:following"] = {"minecraft:behavior.follow_owner": {"priority": 5, "speed_multiplier": 1.2, "start_distance": 5, "stop_distance": 2, "can_teleport": True}}
    groups["cobblemon:captured"] = {
        "minecraft:spawn_entity": {"entities": [{"spawn_item": f"cobblemon:poke_ball_{pokemon}", "min_wait_time": 0, "max_wait_time": 0, "num_to_spawn": 1, "single_use": True}]},
        "minecraft:timer": {"time": 1.0, "looping": False, "time_down_event": {"event": "cobblemon:vanish", "target": "self"}}
    }
    groups["cobblemon:gone"] = {"minecraft:instant_despawn": {}}
    for spawn_event in ("minecraft:entity_spawned", "minecraft:entity_born", "minecraft:entity_transformed"):
        events.setdefault(spawn_event, {}).setdefault("add", {}).setdefault("component_groups", []).append("cobblemon:wild")
    events["cobblemon:released"] = {"remove": {"component_groups": ["cobblemon:wild"]}, "add": {"component_groups": ["cobblemon:released"]}}
    events["cobblemon:caught"] = {"remove": {"component_groups": ["cobblemon:wild", "cobblemon:released"]}, "add": {"component_groups": ["cobblemon:owned", "cobblemon:following"]}}
    events["cobblemon:stay"] = {"remove": {"component_groups": ["cobblemon:following"]}}
    events["cobblemon:follow"] = {"add": {"component_groups": ["cobblemon:following"]}}
    events["cobblemon:vanish"] = {"add": {"component_groups": ["cobblemon:gone"]}}
    add_riding(entity, species, pokemon)   # after the events above, which it adds to
    level = max(5, spawn_level_by_name.get(species_key(species), 5))


def create_items():
    """The empty Poke Ball, and a filled ball per Pokemon that places it back."""
    print("Creating items...")
    fresh(itemsBedrock)
    os.makedirs(f"{itemsBedrock}/balls", exist_ok=True)
    ball = {"format_version": "1.20.50", "minecraft:item": {
        "description": {"identifier": "cobblemon:poke_ball", "menu_category": {"category": "items"}},
        "components": {
            "minecraft:icon": "poke_ball",
            "minecraft:display_name": {"value": "item.cobblemon:poke_ball.name"},
            "minecraft:max_stack_size": 16,
            "minecraft:throwable": {"do_swing_animation": True, "launch_power_scale": 1.0, "max_launch_power": 1.0},
            "minecraft:projectile": {"projectile_entity": "cobblemon:ball_poke_ball"},
            "minecraft:tags": {"tags": ["minecraft:transform_materials"]}
        }}}
    with open(f"{itemsBedrock}/poke_ball.json", "w") as file: file.write(json.dumps(ball, indent=4))
    # every other ball: the same throwable with its own icon and projectile
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(texturesItemsBedrock, exist_ok=True)
    for info in poke_balls():
        icon = f"{cobblemon}/textures/item/poke_balls/{info['name']}.png"
        if os.path.exists(icon): shutil.copyfile(icon, f"{texturesItemsBedrock}/{info['name']}.png")
        itemTextureData["texture_data"][info["name"]] = {"textures": [f"textures/items/{info['name']}"]}
        if info["name"] == "poke_ball": continue
        item = json.loads(json.dumps(ball))
        item["minecraft:item"]["description"]["identifier"] = info["item"]
        components = item["minecraft:item"]["components"]
        components["minecraft:icon"] = info["name"]
        components["minecraft:display_name"] = {"value": f"item.{info['item']}.name"}
        components["minecraft:projectile"] = {"projectile_entity": info["entity"]}
        with open(f"{itemsBedrock}/{info['name']}.json", "w") as file: file.write(json.dumps(item, indent=4))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    evolution_items = create_evolution_items()
    create_interaction_items()
    count = 0
    for pokemon in pokemons:
        if not species_for(pokemon): continue
        filled = {"format_version": "1.20.50", "minecraft:item": {
            "description": {"identifier": f"cobblemon:poke_ball_{pokemon}", "menu_category": {"category": "items", "group": "itemGroup.name.cobblemon_balls"}},
            "components": {
                "minecraft:icon": "poke_ball",
                "minecraft:display_name": {"value": f"item.cobblemon:poke_ball_{pokemon}.name"},
                "minecraft:max_stack_size": 1,
                "minecraft:entity_placer": {"entity": f"{entity_id(pokemon)}<cobblemon:released>"}
            }}}
        with open(f"{itemsBedrock}/balls/{pokemon}.json", "w") as file: file.write(json.dumps(filled, indent=4))
        count += 1
    print(f"Create items complete: {count} filled balls, {len(evolution_items)} evolution items.")


def create_poke_ball_entity():
    """The thrown balls: a projectile per ball that lands as a one-point hit on whatever Pokemon it strikes,
    which the Pokemon's damage sensor turns into the catch roll for the ball's class."""
    print("Creating Poke Ball entities...")
    for folder in (f"{modelsBedrock}/poke_ball", f"{animationsBedrock}/poke_ball", f"{texturesEntityBedrock}/poke_ball", texturesItemsBedrock): os.makedirs(folder, exist_ok=True)
    for model in ("poke_ball", "ancient_poke_ball"):
        with open(f"{pokeBallsMain}/models/{model}.geo.json", encoding="utf-8") as file: geo = json.load(file)
        geo["minecraft:geometry"][0]["description"]["identifier"] = f"geometry.{model}"
        with open(f"{modelsBedrock}/poke_ball/{model}.geo.json", "w") as file: file.write(json.dumps(geo, indent="\t"))
        shutil.copyfile(f"{pokeBallsMain}/animations/{model}.animation.json", f"{animationsBedrock}/poke_ball/{model}.animation.json")
    with open(f"{renderControllersBedrock}/poke_ball.render_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {"controller.render.poke_ball": {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}}}, indent=4))
    for info in poke_balls():
        stem = info["entity"].split(":")[-1]
        behavior = {"format_version": "1.16.0", "minecraft:entity": {
            "description": {"identifier": info["entity"], "is_spawnable": False, "is_summonable": True, "is_experimental": False},
            "components": {
                "minecraft:type_family": {"family": ["poke_ball", f"catch_{info['catch']}", "projectile"]},
                "minecraft:collision_box": {"width": 0.25, "height": 0.25},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": True},
                "minecraft:projectile": {
                    "power": info["power"], "gravity": 0.03, "angle_offset": 0.0, "hit_sound": "cobblemon.poke_ball.hit",
                    # a one-point hit, which the Pokemon's damage sensor cancels, so the ball registers on what it strikes
                    "on_hit": {"impact_damage": {"damage": 1, "knockback": False, "semi_random_diff_damage": False}, "remove_on_hit": {}}
                }
            }}}
        with open(f"{entitiesBedrock}/{stem}.behavior.json", "w") as file: file.write(json.dumps(behavior, indent=4))
        source = f"{cobblemon}/textures/poke_balls/{info['texture']}.png"
        if os.path.exists(source): shutil.copyfile(source, f"{texturesEntityBedrock}/poke_ball/{info['texture']}.png")
        client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": info["entity"],
            "materials": {"default": "entity_alphatest"},
            "textures": {"default": f"textures/entity/poke_ball/{info['texture']}"},
            "geometry": {"default": f"geometry.{info['model']}"},
            "animations": {"throw": f"animation.{info['model']}.throw"},
            "scripts": {"animate": ["throw"]},
            "render_controllers": ["controller.render.poke_ball"]
        }}}
        with open(f"{entityBedrock}/{stem}.entity.json", "w") as file: file.write(json.dumps(client, indent=4))
    create_capture_ball()
    create_beam()
    create_ball_attachables()
    print(f"Create Poke Ball entities complete: {len(poke_balls())} balls.")


def ball_model_textures(model):
    """The balls drawn on one model, in the order the capture ball's texture array and data.js index them."""
    return [b for b in poke_balls() if b["model"] == model]


# the capture ball's states, set by scripts/main.js as EmptyPokeBallEntity's CaptureState moves on
BALL_STATES = {"fly": 0, "hover": 1, "open": 2, "shut": 3, "shake": 4, "critical": 5, "capture": 6, "break": 7}


def create_capture_ball():
    """The ball after it hits: one entity per ball model, its texture picked by cobblemon:ball, playing
    PokeBallModel's poses and PokeBallPosableState's animations for the state the script sets: open when the
    ball hovers (then shut 1.75 seconds later), bounce as it lands, a random bob on each shake, capture or break."""
    for model in ("poke_ball", "ancient_poke_ball"):
        balls = ball_model_textures(model)
        stem = "capture_ball" if model == "poke_ball" else "capture_ball_ancient"
        ident = f"cobblemon:{stem}"
        state = "q.property('cobblemon:state')"
        a = lambda n: f"animation.{model}.{n}"
        route = lambda here: [{name: f"{state} == {value}"} for name, value in BALL_STATES.items() if name != here]
        bob = {f"bob{n}": f"v.bob == {n}" for n in range(1, 7)}
        odd = "math.mod(q.property('cobblemon:shake'), 2) == 1"
        states = {
            "fly": {"animations": ["throw"], "transitions": route("fly")},
            "hover": {"animations": ["shut_idle"], "transitions": route("hover")},
            "open": {"animations": ["open"], "transitions": [{"opened": "q.all_animations_finished"}] + route("open")},
            "opened": {"animations": ["open_idle"], "transitions": route("open")},
            "shut": {"animations": ["shut"], "transitions": [{"closed": "q.all_animations_finished"}] + route("shut")},
            "closed": {"animations": ["shut_idle"], "transitions": route("shut")},
            "shake": {"animations": ["bounce"], "transitions": [{"bob_odd": odd}] + route("shake")},
            "bob_odd": {"on_entry": ["v.bob = math.random_integer(1, 6);"], "animations": [bob], "transitions": [{"bob_even": f"!({odd})"}] + route("shake")},
            "bob_even": {"on_entry": ["v.bob = math.random_integer(1, 6);"], "animations": [bob], "transitions": [{"bob_odd": odd}] + route("shake")},
            "critical": {"animations": ["critical"], "transitions": route("critical")},
            "capture": {"animations": ["capture"], "transitions": route("capture")},
            "break": {"animations": ["break"], "transitions": route("break")},
        }
        with open(f"{animationControllersBedrock}/{stem}.animation_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": {f"controller.animation.{stem}": {"initial_state": "fly", "states": states}}}, indent=2))
        with open(f"{renderControllersBedrock}/{stem}.render_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {f"controller.render.{stem}": {
                "arrays": {"textures": {"Array.ball": [f"Texture.b{n}" for n in range(len(balls))]}},
                "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
                "textures": ["Array.ball[q.property('cobblemon:ball')]"]}}}, indent=2))
        names = ["throw", "open", "open_idle", "shut", "shut_idle", "bounce", "critical", "capture", "break"] + [f"bob{n}" for n in range(1, 7)]
        with open(f"{pokeBallsMain}/animations/{model}.animation.json", encoding="utf-8") as file: clips = json.load(file)["animations"]
        effects = sorted({e["effect"] for c in clips.values() for e in c.get("sound_effects", {}).values() if isinstance(e, dict)})
        particles = sorted({e["effect"] for c in clips.values() for v in c.get("particle_effects", {}).values() for e in (v if isinstance(v, list) else [v])})
        client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": ident,
            "materials": {"default": "entity_alphatest"},
            "textures": {f"b{n}": f"textures/entity/poke_ball/{b['texture']}" for n, b in enumerate(balls)},
            "geometry": {"default": f"geometry.{model}"},
            "animations": {**{n: a(n) for n in names}, "state": f"controller.animation.{stem}"},
            "scripts": {"scale": "0.7", "animate": ["state"]},   # PokeBallRenderer draws the ball at 0.7
            "sound_effects": {e: f"cobblemon.{e}" for e in effects},
            # a key cannot hold a namespace, so an effect the clip names by its full id is left out
            "particle_effects": {e: f"cobblemon:{e}" for e in particles if ":" not in e},
            "render_controllers": [f"controller.render.{stem}"]}}}
        with open(f"{entityBedrock}/{stem}.entity.json", "w") as file: file.write(json.dumps(client, indent=2))
        behavior = {"format_version": "1.21.50", "minecraft:entity": {
            "description": {"identifier": ident, "is_spawnable": False, "is_summonable": True, "is_experimental": False,
                            "properties": {"cobblemon:ball": {"type": "int", "range": [0, 63], "default": 0, "client_sync": True},
                                           "cobblemon:state": {"type": "int", "range": [0, 15], "default": 0, "client_sync": True},
                                           "cobblemon:shake": {"type": "int", "range": [0, 15], "default": 0, "client_sync": True}}},
            "components": {
                "minecraft:type_family": {"family": ["capture_ball", "inanimate"]},
                "minecraft:collision_box": {"width": 0.25, "height": 0.25},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                "minecraft:health": {"value": 1, "max": 1}}}}
        with open(f"{entitiesBedrock}/{stem}.behavior.json", "w") as file: file.write(json.dumps(behavior, indent=2))


def create_beam():
    """PokemonRenderer.renderBeam: a red beacon-style beam, a 0.03 block core in a 0.07 block glow at 0.4 alpha.
    One entity per beam, pointed and stretched by the properties the script sets each tick."""
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for x in range(16):
        for y in range(16): image.putpixel((x, y), (255, 26, 26, 255) if x < 8 else (255, 26, 26, 102))
    os.makedirs(f"{texturesEntityBedrock}/beam", exist_ok=True)
    image.save(f"{texturesEntityBedrock}/beam/recall_beam.png")
    def cube(radius, u):
        px = radius * 16
        face = {"uv": [u, 0], "uv_size": [8, 16]}
        # along -Z, the way a Bedrock model faces, so the entity's own yaw points it
        return {"origin": [-px, -px, -16], "size": [2 * px, 2 * px, 16], "uv": {f: dict(face) for f in ("north", "south", "east", "west", "up", "down")}}
    geo = {"format_version": "1.12.0", "minecraft:geometry": [{
        "description": {"identifier": "geometry.cobblemon_beam", "texture_width": 16, "texture_height": 16,
                        "visible_bounds_width": 64, "visible_bounds_height": 64, "visible_bounds_offset": [0, 0, 0]},
        "bones": [{"name": "yaw", "pivot": [0, 0, 0]},
                  {"name": "pitch", "parent": "yaw", "pivot": [0, 0, 0]},
                  {"name": "beam", "parent": "pitch", "pivot": [0, 0, 0], "cubes": [cube(0.03, 0), cube(0.07, 8)]}]}]}
    os.makedirs(f"{modelsBedrock}/beam", exist_ok=True)
    with open(f"{modelsBedrock}/beam/beam.geo.json", "w") as file: file.write(json.dumps(geo, indent=2))
    with open(f"{animationsBedrock}/beam.animation.json", "w") as file:
        file.write(json.dumps({"format_version": "1.8.0", "animations": {"animation.cobblemon_beam.aim": {"loop": True, "bones": {
            "pitch": {"rotation": ["q.property('cobblemon:pitch')", 0, 0]},
            "beam": {"scale": [1, 1, "math.max(q.property('cobblemon:length'), 0.001)"]}}}}}, indent=2))
    with open(f"{renderControllersBedrock}/beam.render_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {"controller.render.cobblemon_beam": {
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"], "ignore_lighting": True}}}, indent=2))
    with open(f"{entityBedrock}/beam.entity.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": "cobblemon:beam", "materials": {"default": "entity_alphablend"},
            "textures": {"default": "textures/entity/beam/recall_beam"}, "geometry": {"default": "geometry.cobblemon_beam"},
            "animations": {"aim": "animation.cobblemon_beam.aim"}, "scripts": {"animate": ["aim"]},
            "render_controllers": ["controller.render.cobblemon_beam"]}}}, indent=2))
    with open(f"{entitiesBedrock}/beam.behavior.json", "w") as file:
        file.write(json.dumps({"format_version": "1.21.50", "minecraft:entity": {
            "description": {"identifier": "cobblemon:beam", "is_spawnable": False, "is_summonable": True, "is_experimental": False,
                            "properties": {"cobblemon:length": {"type": "float", "range": [0.0, 64.0], "default": 0.0, "client_sync": True},
                                           "cobblemon:yaw": {"type": "float", "range": [-360.0, 360.0], "default": 0.0, "client_sync": True},
                                           "cobblemon:pitch": {"type": "float", "range": [-180.0, 180.0], "default": 0.0, "client_sync": True}}},
            "components": {
                "minecraft:type_family": {"family": ["beam", "inanimate"]},
                "minecraft:collision_box": {"width": 0.01, "height": 0.01},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
                "minecraft:health": {"value": 1, "max": 1}}}}, indent=2))


def create_ball_attachables():
    """Every ball, and every filled ball, is held as its 3D model (Cobblemon's poke_ball_model item model and its
    display transforms); the hotbar keeps the icon."""
    attachables = f"{resourcePack}/attachables"
    fresh(attachables)
    for model in ("poke_ball", "ancient_poke_ball"):
        with open(f"{modelsBedrock}/poke_ball/{model}.geo.json", encoding="utf-8") as file: geo = json.load(file)
        g = geo["minecraft:geometry"][0]
        g["description"]["identifier"] = f"geometry.{model}_held"
        for bone in g["bones"]:
            if bone["name"] == "poke_ball": bone["binding"] = "q.item_slot_to_bone_name(c.item_slot)"
            # Bedrock lowers a bound bone by 24 units, so the model is drawn that much higher (the trident's pivot)
            if "pivot" in bone: bone["pivot"] = [bone["pivot"][0], bone["pivot"][1] + 24, bone["pivot"][2]]
            for c in bone.get("cubes", []): c["origin"] = [c["origin"][0], c["origin"][1] + 24, c["origin"][2]]
            for name, loc in list(bone.get("locators", {}).items()):
                if isinstance(loc, list): bone["locators"][name] = [loc[0], loc[1] + 24, loc[2]]
                elif isinstance(loc, dict) and "offset" in loc: loc["offset"] = [loc["offset"][0], loc["offset"][1] + 24, loc["offset"][2]]
        with open(f"{modelsBedrock}/poke_ball/{model}_held.geo.json", "w") as file: file.write(json.dumps(geo, indent="\t"))
        with open(f"{animationsBedrock}/poke_ball/{model}_held.animation.json", "w") as file:
            file.write(json.dumps({"format_version": "1.8.0", "animations": {
                f"animation.{model}.held_first_person": {"loop": True, "bones": {"poke_ball": HELD_FIRST_PERSON}},
                f"animation.{model}.held_third_person": {"loop": True, "bones": {"poke_ball": HELD_THIRD_PERSON}}}}, indent=2))
    def attachable(item, info):
        return {"format_version": "1.10.0", "minecraft:attachable": {"description": {
            "identifier": item,
            "materials": {"default": "entity_alphatest", "enchanted": "entity_alphatest_glint"},
            "textures": {"default": f"textures/entity/poke_ball/{info['texture']}", "enchanted": "textures/misc/enchanted_item_glint"},
            "geometry": {"default": f"geometry.{info['model']}_held"},
            "animations": {"first": f"animation.{info['model']}.held_first_person", "third": f"animation.{info['model']}.held_third_person",
                           "held": "controller.animation.poke_ball.held"},
            "scripts": {"animate": ["held"]},
            "render_controllers": ["controller.render.item_default"]}}}
    with open(f"{animationControllersBedrock}/poke_ball_held.animation_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": {"controller.animation.poke_ball.held": {"initial_state": "first_person", "states": {
            "first_person": {"animations": ["first"], "transitions": [{"third_person": "!c.is_first_person"}]},
            "third_person": {"animations": ["third"], "transitions": [{"first_person": "c.is_first_person"}]}}}}}, indent=2))
    count = 0
    for info in poke_balls():
        with open(f"{attachables}/{info['name']}.json", "w") as file: file.write(json.dumps(attachable(info["item"], info), indent=2)); count += 1
    plain = poke_balls()[0]
    for path in glob.glob(f"{itemsBedrock}/balls/*.json"):
        pokemon = os.path.basename(path)[:-5]
        with open(f"{attachables}/filled_{pokemon}.json", "w") as file: file.write(json.dumps(attachable(f"cobblemon:poke_ball_{pokemon}", plain))); count += 1
    print(f"  {count} attachables hold the balls as their 3D model.")


# where the held ball sits, tuned against Cobblemon's poke_ball_model display (firstperson_righthand turns it 124 degrees)
HELD_FIRST_PERSON = {"position": [5.5, -1.5, 8], "rotation": [0, 124, 0], "scale": 0.35}
HELD_THIRD_PERSON = {"position": [-3.5, -12.5, -3], "rotation": [0, 37, 0], "scale": 0.5}


# ---------------------------------------------------------------------------
# NPCs. Cobblemon's trainer (data/cobblemon/npcs/standard.json, the battler preset) and Professor
# Sacchi (npcs/sacchi.json, dialogues/sacchi_interaction.json) become Bedrock NPCs on Cobblemon's
# own models and skins, with their dialogue as NPC scenes. A trainer battle sends out a Pokemon from
# the preset's pool that fights the player; the professor heals the Pokemon around the player.
# ---------------------------------------------------------------------------

NPCS = {
    "npc_trainer": {"name": "Trainer", "model": "trainer", "texture": "standard/trainer", "height": 1.8},
    "npc_sacchi": {"name": "Professor Sacchi", "model": "sacchi", "texture": "sacchi/sacchi", "height": 1.8},
}


def trainer_party():
    """The battler preset's pool as (pack folder, level range) pairs."""
    party = []
    path = f"{cobblemonData}/npc_presets/battler_test.json"
    if not os.path.exists(path): return party
    with open(path, encoding="utf-8") as file: preset = json.load(file)
    for entry in preset.get("party", {}).get("pool", []):
        pokemon = pokemon_for_species_name(entry.get("pokemon", ""))
        if pokemon: party.append(pokemon)
    return party


def render_npc_faces():
    """Each NPC's head and shoulders, from its model rendered the way the Pokemon portraits are, for the dialogue's
    portrait frame (DialoguePortraitWidget draws the speaker's face there)."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
    import render_portraits
    out = f"{uiTextures}/dialogue"
    os.makedirs(out, exist_ok=True)
    for npc in NPCS:
        try:
            image, _ = render_portraits.render_species(npc, 256, 4, 0, "fit", True)
        except Exception as error:
            print(f"  {npc}: no face ({error})"); continue
        left, top, right, bottom = image.getbbox()
        side = int((bottom - top) * 0.44)
        centre = (left + right) // 2
        image.crop((centre - side // 2, top - 2, centre - side // 2 + side, top - 2 + side)).resize((64, 64), Image.LANCZOS).save(f"{out}/face_{npc}.png")


def create_npcs():
    print("Creating NPCs...")
    os.makedirs(f"{animationsBedrock}/npcs", exist_ok=True); os.makedirs(f"{texturesEntityBedrock}/npcs", exist_ok=True)
    shutil.copyfile(f"{npcsMain}/animations/trainer_generic.animation.json", f"{animationsBedrock}/npcs/trainer_generic.animation.json")
    fix_animations()   # the NPC file was copied after the pass over the Pokemon files
    scenes = []
    party = trainer_party()
    for npc, info in NPCS.items():
        with open(f"{npcsMain}/models/{info['model']}.geo.json", encoding="utf-8") as file: geo = json.load(file)
        geo["minecraft:geometry"][0]["description"]["identifier"] = f"geometry.{npc}"
        os.makedirs(f"{modelsBedrock}/{npc}", exist_ok=True)
        with open(f"{modelsBedrock}/{npc}/{npc}.geo.json", "w") as file: file.write(json.dumps(geo, indent="\t"))
        os.makedirs(f"{texturesEntityBedrock}/npcs/{npc}", exist_ok=True)
        shutil.copyfile(f"{cobblemon}/textures/npcs/{info['texture']}.png", f"{texturesEntityBedrock}/npcs/{npc}/{npc}.png")
        behavior = {"format_version": "1.16.0", "minecraft:entity": {
            "description": {
                "identifier": f"cobblemon:{npc}", "is_spawnable": True, "is_summonable": True, "is_experimental": False, "spawn_category": "creature",
                "animations": {"dialogue": f"controller.animation.{npc}.dialogue"}, "scripts": {"animate": ["dialogue"]}
            },
            "components": {
                "minecraft:type_family": {"family": ["npc", "mob", "cobblemon_npc"]},
                "minecraft:nameable": {"always_show": True, "default_trigger": {"event": "minecraft:entity_spawned"}},
                "minecraft:collision_box": {"width": 0.6, "height": info["height"]},
                "minecraft:health": {"value": 20, "max": 20},
                "minecraft:persistent": {},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
                "minecraft:movement": {"value": 0.2},
                "minecraft:movement.basic": {},
                "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_water": True, "avoid_damage_blocks": True},
                "minecraft:jump.static": {},
                "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
                "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": False}]},
                "minecraft:behavior.float": {"priority": 0},
                "minecraft:behavior.look_at_player": {"priority": 1, "look_distance": 8, "probability": 0.5},
                "minecraft:behavior.random_stroll": {"priority": 6, "speed_multiplier": 0.8},
                "minecraft:npc": {"npc_data": {"skin_list": [{"variant": 0}], "portrait_offsets": {"scale": [1.75, 1.75, 1.75], "translate": [-7, 50, 0]}, "picker_offsets": {"scale": [1.7, 1.7, 1.7], "translate": [0, 20, 0]}}}
            },
            "events": {}
        }}
        with open(f"{entitiesBedrock}/{npc}.behavior.json", "w") as file: file.write(json.dumps(behavior, indent=4))
        client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
            "identifier": f"cobblemon:{npc}",
            "materials": {"default": "entity_alphatest"},
            "textures": {"default": f"textures/entity/npcs/{npc}/{npc}"},
            "geometry": {"default": f"geometry.{npc}"},
            "animations": {"idle": "animation.trainer_generic.idle", "blink": "animation.trainer_generic.blink", "look_at_target": "animation.common.look_at_target", "blink_quirk": f"controller.animation.{npc}.blink"},
            "scripts": {"animate": ["idle", "look_at_target", "blink_quirk"]},
            "render_controllers": [f"controller.render.{npc}"],
            "spawn_egg": {"base_color": "#d8a56f", "overlay_color": "#c8102e" if npc == "npc_trainer" else "#5b3a1f"}
        }}}
        with open(f"{entityBedrock}/{npc}.entity.json", "w") as file: file.write(json.dumps(client, indent=4))
        with open(f"{renderControllersBedrock}/{npc}.render_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {f"controller.render.{npc}": {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}}}, indent=4))
        with open(f"{animationControllersBedrock}/{npc}.animation_controllers.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": {f"controller.animation.{npc}.blink": {
                "initial_state": "open", "states": {"open": {"transitions": [{"blink": "math.random(0, 200) < 1"}]}, "blink": {"animations": ["blink"], "transitions": [{"open": "q.all_animations_finished"}]}}}}}, indent=4))
    # dialogue: the trainer's config text from npcs/standard.json, the professor's lines from her dialogue file
    with open(f"{cobblemonData}/npcs/standard.json", encoding="utf-8") as file: standard = json.load(file)
    texts = {c["variableName"]: c.get("defaultValue", "") for c in standard.get("config", []) if isinstance(c, dict)}
    battle_buttons = []
    for pokemon in party[:4]:
        battle_buttons.append({"name": display_name(species_for(pokemon)), "commands": [f"/scriptevent cobblemon:trainer {entity_id(pokemon).split(':')[1]}"]})
    scenes.append({"scene_tag": "cobblemon:npc_trainer", "npc_name": "Trainer", "text": texts.get("intro_text", "Would you like to challenge me?"),
                   "buttons": battle_buttons[:3] + [{"name": "Not now", "commands": []}]})
    scenes.append({"scene_tag": "cobblemon:npc_trainer.battle", "npc_name": "Trainer", "text": "Go! Show them what you've got!", "buttons": []})
    scenes.append({"scene_tag": "cobblemon:npc_sacchi", "npc_name": "Professor Sacchi",
                   "text": "Hello! You can call me Professor Sacchi, or just 'the professor' as many do!\nWould you like me to heal your Pokémon?",
                   "buttons": [{"name": "Yes please", "commands": ["/effect @e[family=pokemon,r=8] instant_health 1 3 true", "/effect @e[family=pokemon,r=8] regeneration 5 2 true", "/scriptevent cobblemon:heal go", "/dialogue open @s @initiator cobblemon:npc_sacchi.healed"]}, {"name": "No thanks", "commands": []}]})
    scenes.append({"scene_tag": "cobblemon:npc_sacchi.healed", "npc_name": "Professor Sacchi", "text": "There! Your Pokémon are fighting fit. Take care out there!", "buttons": []})
    with open(f"{dialogueBedrock}/npcs.dialogue.json", "w", encoding="utf-8") as file:
        file.write(json.dumps({"format_version": "1.17", "minecraft:npc_dialogue": {"scenes": scenes}}, indent=4, ensure_ascii=False))
    # main.js shows these scenes on Cobblemon's DialogueScreen (the NPC panel stays as the fallback for a world
    # builder); each NPC's face, rendered offline as the portraits are, fills the dialogue's portrait frame
    with open(f"{scriptsBedrock}/npc_dialogue.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the NPCs' dialogue scenes, by scene tag\n")
        file.write("export const NPC_SCENES = " + json.dumps({sc["scene_tag"]: sc for sc in scenes}, ensure_ascii=False) + ";\n")
    render_npc_faces()
    # a trainer sends out a Pokemon that fights the player for a minute, then leaves
    # each NPC points itself at its own scene
    controllers = {f"controller.animation.{npc}.dialogue": {"initial_state": "default", "states": {"default": {"on_entry": [f"/dialogue change @s cobblemon:{npc}"]}}}
                   for npc in NPCS}
    with open(f"{behaviorPack}/animation_controllers/dialogue.animation_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": controllers}, indent=4))
    # spawn rules: a trainer now and then on plains and in forests, the professor rarer
    for npc, weight in (("npc_trainer", 2), ("npc_sacchi", 1)):
        rule = {"format_version": "1.8.0", "minecraft:spawn_rules": {"description": {"identifier": f"cobblemon:{npc}", "population_control": "animal"}, "conditions": [{
            "minecraft:spawns_on_surface": {}, "minecraft:spawns_on_block_filter": "minecraft:grass_block",
            "minecraft:brightness_filter": {"min": 7, "max": 15, "adjust_for_weather": False},
            "minecraft:weight": {"default": weight}, "minecraft:herd": {"min_size": 1, "max_size": 1},
            "minecraft:biome_filter": {"any_of": [_tag("plains"), _tag("forest"), _tag("meadow")]}}]}}
        with open(f"{spawnRulesBedrock}/{npc}.json", "w") as file: file.write(json.dumps(rule, indent=4))
    print("Create NPCs complete.")


def add_battle(entity, species):
    """A Pokemon summoned with cobblemon:battle by a trainer attacks the nearest player for a minute."""
    groups = entity["minecraft:entity"].setdefault("component_groups", {})
    events = entity["minecraft:entity"].setdefault("events", {})
    groups["cobblemon:battling"] = {
        "minecraft:behavior.nearest_attackable_target": {"priority": 1, "must_see": False, "reselect_targets": True, "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": "player"}, "max_dist": 24}]},
        "minecraft:behavior.melee_attack": {"priority": 2, "track_target": True},
        "minecraft:timer": {"time": 60, "looping": False, "time_down_event": {"event": "cobblemon:vanish", "target": "self"}}
    }
    events["cobblemon:battle"] = {"remove": {"component_groups": ["cobblemon:wild"]}, "add": {"component_groups": ["cobblemon:battling"]}}


def bump_pack_versions():
    """A new pack version every run, or the client keeps the copy it cached from the server last time."""
    with open(f"{resourcePack}/manifest.json", encoding="utf-8") as file: rp = json.load(file)
    with open(f"{behaviorPack}/manifest.json", encoding="utf-8") as file: bp = json.load(file)
    version = rp["header"]["version"]; version[2] += 1
    rp["header"]["version"] = version
    for module in rp.get("modules", []): module["version"] = list(version)
    bp["header"]["version"] = list(version)
    for module in bp.get("modules", []): module["version"] = list(version)
    for dependency in bp.get("dependencies", []):
        if dependency.get("uuid") == rp["header"]["uuid"]: dependency["version"] = list(version)
    with open(f"{resourcePack}/manifest.json", "w", encoding="utf-8") as file: file.write(json.dumps(rp, indent="\t"))
    with open(f"{behaviorPack}/manifest.json", "w", encoding="utf-8") as file: file.write(json.dumps(bp, indent="\t"))
    print(f"Pack version {'.'.join(map(str, version))}; run tools/deploy.py to point the server world at it.")



# ---------------------------------------------------------------------------
# Turn-based battles. scripts/main.js runs them; this generates scripts/data.js from Cobblemon's
# species files and the Showdown move table and type chart inside data/cobblemon/showdown.zip.
# ---------------------------------------------------------------------------

scriptsBedrock = f"{behaviorPack}/scripts"


def showdown_moves():
    """{id: {name, type, power, accuracy, category, priority}} from Showdown's moves.js."""
    import zipfile
    with zipfile.ZipFile(f"{cobblemonData}/showdown.zip") as archive: text = archive.read("data/moves.js").decode("utf-8")
    moves = {}
    for match in re.finditer(r"^  (\w+): \{(.*?)^  \},?", text, re.S | re.M):
        body = match.group(2)
        def field(name, default=None):
            found = re.search(rf"^\s*{name}: ([^,\n]+)", body, re.M)
            return found.group(1).strip().strip('"') if found else default
        accuracy = field("accuracy", "100")
        def boosts(text):
            found = re.search(r"boosts: \{(.*?)\}", text, re.S)
            return {k: int(v) for k, v in re.findall(r"(atk|def|spa|spd|spe|accuracy|evasion): (-?\d+)", found.group(1))} if found else None
        move = {
            "name": field("name", match.group(1)), "type": field("type", "Normal").lower(), "power": int(field("basePower", "0") or 0),
            "accuracy": True if accuracy == "true" else int(accuracy), "category": field("category", "Status"), "priority": int(field("priority", "0") or 0),
            "pp": int(field("pp", "10") or 10), "target": field("target", "normal")
        }
        # the move's own effect: stat stages and a status condition, on its target or on the user for "self"
        top = re.sub(r"^    (secondary|self): \{.*?^    \},?|^    secondaries: \[.*?^    \],?", "", body, flags=re.S | re.M)
        if boosts(top): move["boosts"] = boosts(top)
        status = re.search(r'^    status: "(\w+)"', top, re.M)
        if status: move["status"] = status.group(1)
        flags = re.search(r"flags: \{([^}]*)\}", body)
        if flags:
            names = re.findall(r"(\w+): 1", flags.group(1))
            if "contact" in names: move["contact"] = True
            kept = [f for f in names if f in ("bite", "punch", "sound", "pulse", "slicing", "bullet", "powder")]
            if kept: move["flags"] = kept
        if re.search(r"^    (recoil|drain): \[", body, re.M): move["recoil" if "recoil:" in body else "drain"] = [int(x) for x in re.search(r"(?:recoil|drain): \[(\d+), (\d+)\]", body).groups()]
        if "ohko:" in body: move["ohko"] = True
        weather = re.search(r'^    weather: "(\w+)"', body, re.M)
        if weather: move["weather"] = {"raindance": "rain", "sunnyday": "sun", "sandstorm": "sand", "hail": "snow", "snow": "snow"}[weather.group(1).lower()]
        crit = re.search(r"^    critRatio: (\d+)", body, re.M)
        if crit: move["critRatio"] = int(crit.group(1))
        # a chance of a status or stat change on hit
        secondary = re.search(r"^    secondary: \{(.*?)^    \}", body, re.S | re.M)
        own = re.search(r"^    self: \{(.*?)^    \}", body, re.S | re.M)
        if own and boosts(own.group(1)): move["selfBoosts"] = boosts(own.group(1))
        if secondary:
            text = secondary.group(1)
            chance = re.search(r"chance: (\d+)", text)
            effect = {"chance": int(chance.group(1)) if chance else 100}
            status = re.search(r'status: "(\w+)"', text)
            if status: effect["status"] = status.group(1)
            if boosts(text): effect["boosts"] = boosts(text); effect["self"] = "self: {" in text
            if re.search(r"volatileStatus: ['\"]flinch['\"]", text): effect["flinch"] = True
            if len(effect) > 1: move["secondary"] = effect
        moves[match.group(1)] = move
    return moves


def showdown_typechart():
    """{defending type: {attacking type: multiplier}} from Showdown's typechart.js (0 normal, 1 weak, 2 resist, 3 immune)."""
    import zipfile
    with zipfile.ZipFile(f"{cobblemonData}/showdown.zip") as archive: text = archive.read("data/typechart.js").decode("utf-8")
    chart = {}
    for match in re.finditer(r"^  (\w+): \{\s*damageTaken: \{(.*?)\}", text, re.S | re.M):
        row = {}
        for attack, code in re.findall(r"(\w+): (\d)", match.group(2)):
            if attack[0].isupper(): row[attack.lower()] = {0: 1.0, 1: 2.0, 2: 0.5, 3: 0.0}[int(code)]
        chart[match.group(1).lower()] = row
    return chart


STAT_KEYS = {"hp": "hp", "attack": "atk", "defence": "def", "special_attack": "spa", "special_defence": "spd", "speed": "spe"}
KOTLIN_STATS = {"HP": "hp", "ATTACK": "atk", "DEFENCE": "def", "SPECIAL_ATTACK": "spa", "SPECIAL_DEFENCE": "spd", "SPEED": "spe"}


def time_ranges():
    """Cobblemon's named time ranges (TimeRange.kt) as {name: [[from, to], ...]} in day ticks."""
    with open(f"{kotlinMain}/api/spawning/TimeRange.kt", encoding="utf-8") as file: text = file.read()
    out = {}
    for m in re.finditer(r'"(\w+)" to TimeRange\(([^)]*)\)', text):
        out[m.group(1)] = [[int(a), int(b)] for a, b in re.findall(r"(\d+)\.\.(\d+)", m.group(2))]
    return out


def level_evolutions(species):
    """A species' level-up evolutions with their requirements, as the script checks them when it levels up:
    [{"to": entity id, "event": transformation event, "req": [...]}]. A requirement the port cannot check keeps the
    evolution from happening, as {"t": "never"}; a biome anticondition (the everywhere-else form) always holds."""
    out = []
    for evolution in species.get("evolutions", []):
        if evolution.get("variant") != "level_up": continue
        result = pokemon_for_species_name(evolution.get("result", ""))
        if not result: continue
        req = []
        for r in evolution.get("requirements", []):
            v = r.get("variant")
            if v == "level": req.append({"t": "level", "min": r.get("minLevel", 1)})
            elif v == "friendship": req.append({"t": "friendship", "min": r.get("amount", 160)})
            elif v == "time_range": req.append({"t": "time", "range": r.get("range", "any")})
            elif v == "held_item" and not str(r.get("itemCondition", "")).startswith("#"): req.append({"t": "held", "item": r.get("itemCondition")})
            elif v == "biome" and "biomeAnticondition" in r and "biomeCondition" not in r: pass
            elif v == "has_move": req.append({"t": "move", "move": re.sub(r"[^a-z0-9]", "", str(r.get("move", "")).lower())})
            elif v == "has_move_type": req.append({"t": "move_type", "type": str(r.get("type", "")).lower()})
            elif v == "party_member": req.append({"t": "party", "species": str(r.get("target", "")).split()[0].lower(), "contains": r.get("contains", True)})
            elif v == "weather": req.append({"t": "weather", "rain": r.get("isRaining"), "thunder": r.get("isThundering")})
            elif v == "moon_phase": req.append({"t": "moon", "phase": r.get("moonPhase")})
            elif v == "stat_compare": req.append({"t": "stat_gt", "hi": STAT_KEYS.get(r.get("highStat")), "lo": STAT_KEYS.get(r.get("lowStat"))})
            elif v == "stat_equal": req.append({"t": "stat_eq", "a": STAT_KEYS.get(r.get("statOne")), "b": STAT_KEYS.get(r.get("statTwo"))})
            elif v == "properties":
                target = str(r.get("target", ""))
                m = re.search(r"(gender|nature|nickname|cocoon_species)=(\S+)", target)
                if m: req.append({"t": "prop", "key": m.group(1), "value": m.group(2)})
                else: req.append({"t": "never", "why": target})
            else: req.append({"t": "never", "why": v})
        out.append({"to": entity_id(result), "event": f"cobblemon:evolve_to_{result}", "req": req})
    return out


def natures():
    """{nature: [raised stat, lowered stat]} from Natures.kt; the neutral natures raise and lower nothing."""
    path = f"{kotlinMain}/api/pokemon/Natures.kt"
    with open(path, encoding="utf-8") as file: text = file.read()
    out = {}
    for m in re.finditer(r'Nature\(cobblemonResource\("(\w+)"\),\s*"[^"]+",\s*(null|Stats\.(\w+)),\s*(null|Stats\.(\w+))', text):
        out[m.group(1)] = [KOTLIN_STATS.get(m.group(3)), KOTLIN_STATS.get(m.group(5))]
    return out


def ev_items():
    """Vitamins (10 EVs), feathers (1), mints (a nature) and the berries that lower an EV, from CobblemonItems.kt."""
    path = f"{kotlinMain}/CobblemonItems.kt"
    with open(path, encoding="utf-8") as file: text = file.read()
    evs = {}
    for m in re.finditer(r'create\("(\w+)",\s*VitaminItem\(Stats\.(\w+)', text): evs[f"cobblemon:{m.group(1)}"] = [KOTLIN_STATS[m.group(2)], 10, "minecraft:glass_bottle"]
    for m in re.finditer(r'create\("(\w+)",\s*FeatherItem\(Stats\.(\w+)', text): evs[f"cobblemon:{m.group(1)}"] = [KOTLIN_STATS[m.group(2)], 1, None]
    mints = {f"cobblemon:{m.group(1)}": m.group(2).lower() for m in re.finditer(r'mintItem\("(\w+)",\s*MintItem\(Natures\.(\w+)', text)}
    berries = {f"cobblemon:{m.group(1)}_berry": KOTLIN_STATS[m.group(2)]
               for m in re.finditer(r'berryItem\("(\w+)",\s*FriendshipRaisingBerryItem\([^,]+,\s*Stats\.(\w+)', text)}
    return evs, mints, berries


def create_battle_data():
    print("Creating battle data...")
    os.makedirs(scriptsBedrock, exist_ok=True)
    moves = showdown_moves(); chart = showdown_typechart()
    used = set(); table = {}
    for pokemon in pokemons:
        species = species_for(pokemon)
        if not species: continue
        level = max(5, spawn_level_by_name.get(species_key(species), 5))
        learnset = []
        for entry in species.get("moves", []):
            match = re.match(r"(\d+):(\w+)$", entry)
            if match and match.group(2) in moves and [int(match.group(1)), match.group(2)] not in learnset: learnset.append([int(match.group(1)), match.group(2)])
        learnset.sort(key=lambda e: e[0])
        learned = []
        for at, move in learnset:
            if at <= level and move not in learned: learned.append(move)
        # the four latest moves, keeping at least one that does damage
        known = learned[-4:]
        if not any(moves[m]["power"] for m in known):
            damaging = [m for m in learned if moves[m]["power"]]
            known = (known[1:] + damaging[-1:]) if damaging else known
        learned = known or ["tackle"]
        used.update(learned); used.update(m for _, m in learnset)
        abilities = [a for a in species.get("abilities", []) if not a.startswith("h:")]
        stats = species.get("baseStats", {})
        table[entity_id(pokemon)] = {
            "name": display_name(species), "level": level, "catchRate": catch_rate(species),
            "types": [t for t in (species.get("primaryType"), species.get("secondaryType")) if t],
            "stats": {"hp": stats.get("hp", 40), "atk": stats.get("attack", 40), "def": stats.get("defence", 40), "spa": stats.get("special_attack", 40), "spd": stats.get("special_defence", 40), "spe": stats.get("speed", 40)},
            "moves": learned,
            "weight": species.get("weight", 0), "ultraBeast": "ultra_beast" in species.get("labels", []), "legendary": "legendary" in species.get("labels", []), "mythical": "mythical" in species.get("labels", []),
            "ability": abilities[0] if abilities else None, "abilities": abilities, "hidden": [a[2:] for a in species.get("abilities", []) if a.startswith("h:")], "canEvolve": bool(species.get("evolutions")), "baseExp": species.get("baseExperienceYield", 50),
            "expGroup": species.get("experienceGroup", "medium_fast"), "learnset": learnset,
            "evYield": {STAT_KEYS[k]: v for k, v in species.get("evYield", {}).items() if v and k in STAT_KEYS},
            "friendship": species.get("baseFriendship", 50), "height": species.get("height", 0),
            "maleRatio": species.get("maleRatio", 0.5), "evolutions": level_evolutions(species),
            "variants": variant_battle_overrides(pokemon, species),
            # the cry the send-out and the Pokedex play, when the pack has one
            "cry": f"cobblemon.{species_key(species)}.cry" if os.path.exists(f"{soundsBedrock}/pokemon/{pokemon}/cry.ogg") else None,
            # the hitbox height in blocks, where PokemonRenderer draws the label (half a block above it)
            "labelHeight": round(species.get("hitbox", {}).get("height", 1.0) * species.get("baseScale", 1.0), 2)
        }
    with open(f"{scriptsBedrock}/data.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py from Cobblemon's species files and Showdown's move table and type chart\n")
        file.write("export const POKEMON = " + json.dumps(table, ensure_ascii=False) + ";\n")
        file.write("export const MOVES = " + json.dumps({m: moves[m] for m in sorted(used)}, ensure_ascii=False) + ";\n")
        file.write("export const TYPES = " + json.dumps(chart) + ";\n")
        # Cobblemon's move descriptions, for the Summary's Moves tab
        file.write("export const MOVE_DESC = " + json.dumps({m: lang[f"cobblemon.move.{m}.desc"] for m in sorted(used) if f"cobblemon.move.{m}.desc" in lang}, ensure_ascii=False) + ";\n")
        import zipfile
        with zipfile.ZipFile(f"{cobblemonData}/showdown.zip") as archive: ability_text = archive.read("data/abilities.js").decode("utf-8")
        ability_names = {}
        for block in re.finditer(r"^  (\w+): \{(.*?)^  \},?", ability_text, re.S | re.M):
            found = re.search(r'name: "([^"]+)"', block.group(2))
            if found: ability_names[block.group(1)] = found.group(1)
        file.write("export const ABILITY_NAMES = " + json.dumps(ability_names) + ";" + chr(10))
        # Cobblemon's own ability descriptions, for the Summary's Info tab
        file.write("export const ABILITY_DESC = " + json.dumps({a: lang[f"cobblemon.ability.{a}.desc"] for a in ability_names if f"cobblemon.ability.{a}.desc" in lang}, ensure_ascii=False) + ";" + chr(10))
        file.write("export const NATURES = " + json.dumps(natures()) + ";" + chr(10))
        file.write("export const TIME_RANGES = " + json.dumps(time_ranges()) + ";" + chr(10))
        balls = {}
        for b in poke_balls():
            fx = b["name"].replace("_", "")
            balls[b["item"]] = {"name": b["display"], "mult": b["mult"], "rule": b["rule"], "ancient": b["model"] != "poke_ball",
                                "tex": [x["name"] for x in ball_model_textures(b["model"])].index(b["name"]),
                                "fx": fx if os.path.isdir(f"{particlesBedrock}/balls/{fx}") else None}
        file.write("export const BALLS = " + json.dumps(balls, ensure_ascii=False) + ";\n")
    print(f"Create battle data complete: {len(table)} Pokemon, {len(used)} moves.")


def ensure_script_module():
    """The behavior pack manifest declares the battle script and the modules it imports."""
    with open(f"{behaviorPack}/manifest.json", encoding="utf-8") as file: bp = json.load(file)
    modules = [m for m in bp.get("modules", []) if m.get("type") != "script"]
    modules.append({"description": "Battles", "type": "script", "language": "javascript", "uuid": "3f9c1b2e-7d4a-4c6e-9a1b-2e5f8c7d6a41", "entry": "scripts/main.js", "version": list(bp["header"]["version"])})
    bp["modules"] = modules
    dependencies = [d for d in bp.get("dependencies", []) if "module_name" not in d]
    dependencies += [{"module_name": "@minecraft/server", "version": "2.6.0"}, {"module_name": "@minecraft/server-ui", "version": "2.0.0"}]
    bp["dependencies"] = dependencies
    with open(f"{behaviorPack}/manifest.json", "w", encoding="utf-8") as file: file.write(json.dumps(bp, indent="\t"))


def add_battle_states(entity):
    """Frozen in place while a turn-based battle runs; captured outright from the battle's ball throw."""
    groups = entity["minecraft:entity"].setdefault("component_groups", {})
    events = entity["minecraft:entity"].setdefault("events", {})
    groups["cobblemon:in_battle"] = {"minecraft:movement": {"value": 0.0}}
    events["cobblemon:battle_start"] = {"add": {"component_groups": ["cobblemon:in_battle"]}}
    events["cobblemon:battle_end"] = {"remove": {"component_groups": ["cobblemon:in_battle"]}}
    events["cobblemon:capture"] = {"remove": {"component_groups": ["cobblemon:wild", "cobblemon:in_battle"]}, "add": {"component_groups": ["cobblemon:captured"]}}


# ---------------------------------------------------------------------------
# Ambient particles, server side. Client-side emitters attached through the resource pack (animation
# keyframes or controller states) never showed on this server, while the same particles fired by
# /particle did. So each ambient effect gets a one-second twin, cobblemon:<name>_ambient, and every
# Pokemon that carries one gets a looping behavior-pack animation whose timeline fires /particle at the
# locator's offset once a second. Commands from an entity's timeline run as that entity.
# ---------------------------------------------------------------------------

behaviorAnimationsBedrock = f"{behaviorPack}/animations"


def locator_offset(pokemon, pokemonName, locator):
    """A locator's position in blocks, relative to the entity, from its geometry (model units are 1/16 block)."""
    geometry = geometry_for(pokemon, pokemonName)[len("geometry."):]
    path = f"{modelsBedrock}/{pokemon}/{geometry}.geo.json"
    scale = (species_for(pokemon) or {}).get("baseScale", 1.0)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        for geo in data.get("minecraft:geometry", []):
            for bone in geo.get("bones", []):
                point = bone.get("locators", {}).get(locator)
                if isinstance(point, dict): point = point.get("offset")
                if isinstance(point, list) and len(point) >= 3: return [round(-point[0] / 16 * scale, 2), round(point[1] / 16 * scale, 2), round(point[2] / 16 * scale, 2)]
    height = (species_for(pokemon) or {}).get("hitbox", {}).get("height", 1.0) * scale
    return [0, round(height / 2, 2), 0]


def create_ambient_particles():
    print("Creating ambient particles...")
    load_particle_ids()
    twins = set(); animations = {}
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        effects = [e for entries in ambient_particles(pokemon, pokemonName).values() for e in entries]
        if not effects: continue
        commands = []
        for effect in {(e["effect"], e["locator"]) for e in effects}:
            name, locator = effect
            twins.add(name)
            x, y, z = locator_offset(pokemon, pokemonName, locator)
            commands.append(f"/particle cobblemon:{name}_ambient ~{x} ~{y} ~{z}")
        # a controller that ping-pongs between two states on the half second; on_entry commands are
        # the one server-side trigger proven to run here (the dialogue controllers use it)
        animations[f"controller.animation.{pokemon}.ambient"] = {"initial_state": "a", "states": {
            "a": {"on_entry": commands, "transitions": [{"b": "math.mod(q.life_time, 1.0) >= 0.5"}]},
            "b": {"transitions": [{"a": "math.mod(q.life_time, 1.0) < 0.5"}]}
        }}
    with open(f"{behaviorPack}/animation_controllers/ambient.animation_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "animation_controllers": animations}, indent=4))
    for name in sorted(twins):
        source = particle_ids.get(f"cobblemon:{name}")
        if not source: continue
        path = next((os.path.join(root, f) for root, _, files in os.walk(particlesBedrock) for f in files if f == os.path.basename(source)), None)
        if not path: continue
        with open(path, encoding="utf-8") as file: data = json.load(file)
        effect = data["particle_effect"]; effect["description"]["identifier"] = f"cobblemon:{name}_ambient"
        components = effect.get("components", {})
        for key in ("minecraft:emitter_lifetime_expression", "minecraft:emitter_lifetime_looping", "minecraft:emitter_lifetime_events"): components.pop(key, None)
        effect.pop("events", None)   # a sub-emitter spawned by an event has no lifetime of its own and never dies
        components["minecraft:emitter_lifetime_once"] = {"active_time": 1.05}
        with open(f"{particlesBedrock}/{name}_ambient.particle.json", "w", encoding="utf-8") as file: file.write(json.dumps(data, indent="\t"))
    print(f"Create ambient particles complete: {len(animations)} Pokemon, {len(twins)} particle twins.")


# ---------------------------------------------------------------------------
# Structures. Cobblemon's worldgen structures (ruins, habitats, fishing boats, shipwreck coves) are Java
# jigsaw structures: a start pool of template pieces that grow more pieces. Bedrock places whole
# .mcstructure files through features, so each worldgen structure becomes a feature that places one of its
# start pool's pieces, converted by tools/nbt_to_mcstructure.py, and a feature rule that scatters it over the
# structure's biomes at about the rate its structure set spaces it.
# ---------------------------------------------------------------------------

structuresMain = f"{cobblemonData}/structure"
worldgenMain = f"{cobblemonData}/worldgen"
structuresBedrock = f"{behaviorPack}/structures/cobblemon"
featuresBedrock = f"{behaviorPack}/features"
featureRulesBedrock = f"{behaviorPack}/feature_rules"
# biome tags and ids a structure names that the spawn rules never needed
STRUCTURE_BIOMES = {
    "#cobblemon:has_block/sand": _any(_tag("desert"), _all(_tag("beach"), _tag("stone", False))),
    "#cobblemon:has_block/red_sand": _tag("mesa"),
    "#c:is_snowy_plains": _all(_tag("ice_plains"), _tag("mutated", False)),
    "minecraft:ice_spikes": _all(_tag("ice_plains"), _tag("mutated")),
    "minecraft:deep_ocean": _all(_tag("ocean"), _tag("deep")),
}
STRUCTURE_REPLACEABLE = ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern",
                         "minecraft:snow_layer", "minecraft:water", "minecraft:seagrass", "minecraft:dandelion", "minecraft:poppy"]


def structure_key(location):
    """'cobblemon:ruins/ancient_dais_ruins' -> 'ruins_ancient_dais_ruins', the flat name a Bedrock structure takes."""
    return re.sub(r"[^a-z0-9_]", "_", location.split(":", 1)[-1].lower())


def structure_spacing():
    """Each worldgen structure's share of chunks: spacing squared times its set's total weight over its own."""
    odds = {}
    for path in glob.glob(f"{worldgenMain}/structure_set/**/*.json", recursive=True):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        spacing = data.get("placement", {}).get("spacing", 32)
        entries = data.get("structures", [])
        total = sum(e.get("weight", 1) for e in entries) or 1
        for entry in entries: odds[entry["structure"]] = round(spacing * spacing * total / entry.get("weight", 1))
    return odds


def create_structures():
    """Convert the start pieces and write a feature and feature rule per worldgen structure."""
    print("Creating structures...")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
    from nbt_to_mcstructure import convert, load_invalid, parse_processors, PACK_BLOCKS
    PACK_BLOCKS.update(os.path.basename(f)[:-len(".json")] for f in glob.glob(f"{blocksBedrock}/*.json"))
    # the folders start fresh in create_blocks, which writes the apricorn trees into them first
    invalid = load_invalid(); unmapped = {}; odds = structure_spacing()
    placed, skipped = 0, []
    for path in sorted(glob.glob(f"{worldgenMain}/structure/**/*.json", recursive=True)):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        structure = "cobblemon:" + os.path.relpath(path, f"{worldgenMain}/structure").replace(os.sep, "/")[:-len(".json")]
        name = structure_key(structure)
        biomes = data.get("biomes")
        biome_list = [biomes] if isinstance(biomes, str) else biomes or []
        biome_filter = biome_filter_for(biome_list) or next((STRUCTURE_BIOMES[b] for b in biome_list if b in STRUCTURE_BIOMES), None)
        pool_path = f"{worldgenMain}/template_pool/{data.get('start_pool', '').split(':', 1)[-1]}.json"
        if data.get("type") != "minecraft:jigsaw" or not os.path.exists(pool_path) or biome_filter is None:
            skipped.append(name); continue
        with open(pool_path, encoding="utf-8") as file: pool = json.load(file)
        pieces = []
        for element in pool.get("elements", []):
            inner = element.get("element", {})
            if inner.get("element_type") == "minecraft:list_pool_element": inner = (inner.get("elements") or [{}])[0]
            location = inner.get("location")
            if not location: continue
            source = f"{structuresMain}/{location.split(':', 1)[-1]}.nbt"
            if not os.path.exists(source): continue
            piece = structure_key(location)
            processors = inner.get("processors")
            if isinstance(processors, str):
                processor_path = f"{worldgenMain}/processor_list/{processors.split(':', 1)[-1]}.json"
                processors = json.load(open(processor_path, encoding="utf-8")) if os.path.exists(processor_path) else {}
            if not os.path.exists(f"{structuresBedrock}/{piece}.mcstructure"):
                convert(source, f"{structuresBedrock}/{piece}.mcstructure", invalid, unmapped, parse_processors((processors or {}).get("processors", [])))
            pieces.append((piece, element.get("weight", 1)))
        if not pieces: skipped.append(name); continue
        in_water = any(w in name for w in ("fishing_boat", "shipwreck", "deep_sea", "iceberg"))
        constraints = {"block_intersection": {"block_allowlist": STRUCTURE_REPLACEABLE}}
        if not in_water: constraints.update({"grounded": {}, "unburied": {}})
        features = []
        for piece, weight in pieces:
            identifier = f"cobblemon:{piece}_piece"
            with open(f"{featuresBedrock}/{piece}_piece.json", "w") as file:
                file.write(json.dumps({"format_version": "1.13.0", "minecraft:structure_template_feature": {
                    "description": {"identifier": identifier}, "structure_name": f"cobblemon:{piece}",
                    "adjustment_radius": 4, "facing_direction": "random", "constraints": constraints}}, indent=4))
            features.append([identifier, weight])
        with open(f"{featuresBedrock}/{name}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:weighted_random_feature": {
                "description": {"identifier": f"cobblemon:{name}"}, "features": features}}, indent=4))
        with open(f"{featureRulesBedrock}/{name}_rule.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:feature_rules": {
                "description": {"identifier": f"cobblemon:{name}_rule", "places_feature": f"cobblemon:{name}"},
                "conditions": {"placement_pass": "surface_pass", "minecraft:biome_filter": biome_filter},
                "distribution": {"iterations": 1, "scatter_chance": {"numerator": 1, "denominator": max(64, odds.get(structure, 1024))},
                                 "x": {"distribution": "uniform", "extent": [0, 15]},
                                 "y": "query.heightmap(variable.worldx, variable.worldz)",
                                 "z": {"distribution": "uniform", "extent": [0, 15]}}}}, indent=4))
        placed += 1
    formations = create_fossil_formations(convert, parse_processors, invalid, unmapped)
    print(f"Fossil formations: {formations}")
    if unmapped: print("Blocks with no Bedrock equivalent, placed as air:", ", ".join(f"{k} ({v})" for k, v in sorted(unmapped.items())))
    print(f"Create structures complete: {placed} structures, {len(os.listdir(structuresBedrock))} pieces; skipped {len(skipped)}: {', '.join(skipped)}")


# ---------------------------------------------------------------------------
# Blocks: berry bushes and the healing machine. Cobblemon draws them from Java block models
# (assets/cobblemon/models/block), which java_model_geometry() turns into Bedrock block geometry: each
# element a cube with its faces' UVs, mirrored on x as Bedrock geometry is, each texture a named material
# instance. A berry bush has four stages (sprout, young, flowering, ripe); the ripe one carries the berry's
# own fruit model at each of its growth points. scripts/main.js grows the bush on random ticks and hands out
# berries when a ripe one is used; the healing machine heals the player's Pokemon around it.
# ---------------------------------------------------------------------------

modelsJavaMain = f"{cobblemon}/models"
berriesMain = f"{cobblemonData}/berries"
blocksBedrock = f"{behaviorPack}/blocks"
blockModelsBedrock = f"{resourcePack}/models/blocks"
texturesBlocksBedrock = f"{resourcePack}/textures/blocks/cobblemon"
lootBlocksBedrock = f"{behaviorPack}/loot_tables/blocks"
# vanilla Java textures a Cobblemon model borrows, by their Bedrock file
VANILLA_TEXTURES = {"block/farmland_moist": "textures/blocks/farmland_wet", "block/farmland": "textures/blocks/farmland_dry"}
BERRY_SOILS = ["minecraft:grass_block", "minecraft:dirt", "minecraft:farmland", "minecraft:podzol", "minecraft:coarse_dirt",
               "minecraft:dirt_with_roots", "minecraft:moss_block", "minecraft:mud", "minecraft:muddy_mangrove_roots"]
terrain_textures = {}


def java_texture(ref):
    """A Java texture reference as a terrain texture key, copying Cobblemon's file into the pack."""
    ref = ref.split("minecraft:", 1)[-1]
    if not ref.startswith("cobblemon:"):
        path = VANILLA_TEXTURES.get(ref, "textures/blocks/" + ref.split("/")[-1])
        key = "cobblemon_vanilla_" + re.sub(r"[^a-z0-9_]", "_", ref)
    else:
        rel = ref.split(":", 1)[1]
        source = f"{cobblemon}/textures/{rel}.png"
        if not os.path.exists(source): return None
        os.makedirs(os.path.dirname(f"{texturesBlocksBedrock}/{rel}"), exist_ok=True)
        shutil.copyfile(source, f"{texturesBlocksBedrock}/{rel}.png")
        path = f"textures/blocks/cobblemon/{rel}"
        key = "cobblemon_" + re.sub(r"[^a-z0-9_]", "_", rel)
    terrain_textures[key] = {"textures": path}
    return key


def vanilla_template_elements(parent):
    """The elements of Minecraft's own template models a Cobblemon model may name as its parent."""
    full = lambda faces: [{"from": [0, 0, 0], "to": [16, 16, 16], "faces": {f: {"texture": t} for f, t in faces.items()}}]
    plane = lambda f, t, a, b: {"from": f, "to": t, "faces": {a: {"texture": "#crop"}, b: {"texture": "#crop"}}}
    parent = parent.split(":", 1)[-1]
    if parent == "block/orientable":
        return full({"north": "#front", "south": "#side", "east": "#side", "west": "#side", "up": "#top", "down": "#bottom"})
    if parent == "block/orientable_with_bottom":
        return full({"north": "#front", "south": "#side", "east": "#side", "west": "#side", "up": "#top", "down": "#bottom"})
    if parent == "block/crop":
        return [plane([4, -1, 0], [4, 15, 16], "east", "west"), plane([12, -1, 0], [12, 15, 16], "east", "west"),
                plane([0, -1, 4], [16, 15, 4], "north", "south"), plane([0, -1, 12], [16, 15, 12], "north", "south")]
    if parent == "block/cross":
        cross = lambda angle: {"from": [0.8, 0, 8], "to": [15.2, 16, 8], "rotation": {"origin": [8, 8, 8], "axis": "y", "angle": angle},
                               "faces": {"north": {"texture": "#cross"}, "south": {"texture": "#cross"}}}
        return [cross(45), cross(-45)]
    return None


def java_model(name):
    """A Java block model with its parents' elements and textures filled in, and the elements of Minecraft's own
    template parents (orientable, crop, cross) where the model has none of its own."""
    path = f"{modelsJavaMain}/{name.split(':', 1)[-1]}.json"
    if not os.path.exists(path): return None
    with open(path, encoding="utf-8") as file: model = json.load(file)
    parent = model.get("parent")
    if parent and parent.startswith("cobblemon:"):
        base = java_model(parent) or {}
        model = {"textures": {**base.get("textures", {}), **model.get("textures", {})}, "elements": model.get("elements", base.get("elements", []))}
    elif parent and not model.get("elements"):
        elements = vanilla_template_elements(parent)
        if elements:
            textures = dict(model.get("textures", {}))
            textures.setdefault("bottom", textures.get("top"))
            model = {"textures": textures, "elements": elements}
    return model


def java_model_cubes(model):
    """Cubes for a Java model's elements, and the material instance each texture reference became."""
    textures = model.get("textures", {})
    def resolve(ref, depth=0):
        while isinstance(ref, str) and ref.startswith("#") and depth < 5: ref = textures.get(ref[1:]); depth += 1
        return ref
    instances, cubes = {}, []
    for element in model.get("elements", []):
        (x1, y1, z1), (x2, y2, z2) = element["from"], element["to"]
        if y2 <= 0: continue
        y1 = max(y1, 0)   # Bedrock block geometry stops at the block's floor
        cube = {"origin": [8 - x2, y1, z1 - 8], "size": [x2 - x1, y2 - y1, z2 - z1], "uv": {}}
        rotation = element.get("rotation")
        if rotation and rotation.get("angle"):
            axis = rotation.get("axis", "y"); angle = rotation["angle"]
            cube["rotation"] = [angle if axis == "x" else 0, -angle if axis == "y" else 0, -angle if axis == "z" else 0]
            ox, oy, oz = rotation.get("origin", [8, 8, 8])
            cube["pivot"] = [8 - ox, oy, oz - 8]
        for face, info in element.get("faces", {}).items():
            texture = resolve(info.get("texture"))
            if not texture: continue
            if texture not in instances:
                key = java_texture(texture)
                if not key: continue
                instances[texture] = (f"t{len(instances)}", key)
            default = {"north": [x1, 16 - y2, x2, 16 - y1], "south": [x1, 16 - y2, x2, 16 - y1], "east": [z1, 16 - y2, z2, 16 - y1],
                       "west": [z1, 16 - y2, z2, 16 - y1], "up": [x1, z1, x2, z2], "down": [x1, z1, x2, z2]}[face]
            u1, v1, u2, v2 = info.get("uv", default)
            cube["uv"][face] = {"uv": [u1, v1], "uv_size": [u2 - u1, v2 - v1], "material_instance": instances[texture][0]}
        if cube["uv"]: cubes.append(cube)
    return cubes, {name: key for name, key in instances.values()}


def fruit_cubes(berry, points):
    """The berry's own fruit model at each growth point, its box UVs laid out per face on a 16 by 16 grid."""
    path = f"{cobblemon}/bedrock/berries/{berry}.geo.json"
    if not os.path.exists(path) or not points: return [], None
    with open(path, encoding="utf-8") as file: geo = json.load(file)["minecraft:geometry"][0]
    tw, th = geo["description"].get("texture_width", 16), geo["description"].get("texture_height", 16)
    fu, fv = 16 / tw, 16 / th
    cubes = []
    for point in points:
        px, py, pz = point["position"]["x"], point["position"]["y"], point["position"]["z"]
        for bone in geo.get("bones", []):
            for cube in bone.get("cubes", []):
                (ox, oy, oz), (sx, sy, sz) = cube["origin"], cube["size"]
                u, v = cube.get("uv", [0, 0]) if isinstance(cube.get("uv"), list) else (0, 0)
                faces = {"north": (u + sz, v + sz, sx, sy), "east": (u, v + sz, sz, sy), "south": (u + 2 * sz + sx, v + sz, sx, sy),
                         "west": (u + sz + sx, v + sz, sz, sy), "up": (u + sz, v, sx, sz), "down": (u + sz + sx, v, sx, sz)}
                cubes.append({"origin": [ox + 8 - px, oy + py, oz + pz - 8], "size": [sx, sy, sz],
                              "uv": {f: {"uv": [a * fu, b * fv], "uv_size": [w * fu, h * fv], "material_instance": "fruit"} for f, (a, b, w, h) in faces.items()}})
    return cubes, java_texture(f"cobblemon:berries/{berry.replace('_berry', '')}")


BLOCK_LIMIT = (-13.5, 29.5)   # Bedrock rejects block geometry past 30 pixels either side of the block (with a little margin)


def fit_block(cubes):
    """Trim cubes to the space Bedrock allows a block, keeping any that still have volume; tall bushes (Tamato, Lum)
    lose the top of their canopy rather than the whole model."""
    low, high = BLOCK_LIMIT
    kept = []
    for cube in cubes:
        origin, size = list(cube["origin"]), list(cube["size"])
        for axis in range(3):
            lo_bound, hi_bound = (0, high) if axis == 1 else (low - 8, high - 8)
            start, end = max(origin[axis], lo_bound), min(origin[axis] + size[axis], hi_bound)
            if end < start or (end == start and size[axis] > 0): break
            origin[axis], size[axis] = start, end - start
        else:
            if cube.get("rotation") and not corners_inside(origin, size, cube["rotation"], cube.get("pivot", [0, 0, 0])): continue
            kept.append(dict(cube, origin=origin, size=size))
    return kept


def corners_inside(origin, size, rotation, pivot):
    """Whether a rotated cube's corners stay inside Bedrock's block bounds (rotation about one axis, as Java allows)."""
    low, high = BLOCK_LIMIT
    axis = next((i for i, a in enumerate(rotation) if a), None)
    if axis is None: return True
    angle = math.radians(rotation[axis]); c, s = math.cos(angle), math.sin(angle)
    for dx in (0, size[0]):
        for dy in (0, size[1]):
            for dz in (0, size[2]):
                p = [origin[0] + dx - pivot[0], origin[1] + dy - pivot[1], origin[2] + dz - pivot[2]]
                i, j = [(1, 2), (0, 2), (0, 1)][axis]
                p[i], p[j] = p[i] * c - p[j] * s, p[i] * s + p[j] * c
                x, y, z = p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]
                if not (low - 8 <= x <= high - 8 and low <= y <= high and low - 8 <= z <= high - 8): return False
    return True


def write_block_geometry(identifier, cubes):
    cubes = fit_block(cubes)
    os.makedirs(blockModelsBedrock, exist_ok=True)
    with open(f"{blockModelsBedrock}/{identifier.split('.', 1)[1]}.geo.json", "w") as file:
        file.write(json.dumps({"format_version": "1.12.0", "minecraft:geometry": [{
            "description": {"identifier": identifier, "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0]},
            "bones": [{"name": "block", "pivot": [0, 0, 0], "cubes": cubes}]}]}, indent=1))


def material_instances(instances, first=None):
    result = {name: {"texture": key, "render_method": "alpha_test", "ambient_occlusion": False, "face_dimming": False} for name, key in instances.items()}
    if result: result["*"] = dict(result[first or next(iter(result))])
    return result


def berry_bushes():
    """Every berry with its bush models, as (berry, data): 'oran_berry', the berry's data file."""
    result = []
    for path in sorted(glob.glob(f"{berriesMain}/*.json")):
        berry = os.path.basename(path)[:-len(".json")]
        base = berry.replace("_berry", "")
        if not all(os.path.exists(f"{modelsJavaMain}/block/berries/{base}_{stage}.json") for stage in ("sprout", "young", "mature")): continue
        with open(path, encoding="utf-8") as file: result.append((berry, json.load(file)))
    return result


def create_blocks():
    print("Creating blocks...")
    for folder in (blocksBedrock, blockModelsBedrock, texturesBlocksBedrock, lootBlocksBedrock, f"{behaviorPack}/recipes",
                   structuresBedrock, featuresBedrock, featureRulesBedrock): fresh(folder)
    terrain_textures.clear()
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/berries", exist_ok=True)
    berries = {}
    for berry, data in berry_bushes():
        base = berry.replace("_berry", ""); bush = f"cobblemon:{berry}_bush"
        permutations = []
        for stage, model_name in enumerate(("sprout", "young", "mature", "mature")):
            cubes, instances = java_model_cubes(java_model(f"cobblemon:block/berries/{base}_{model_name}") or {})
            if stage == 3:
                fruit, fruit_key = fruit_cubes(berry, data.get("growthPoints", []))
                if fruit_key: cubes = cubes + fruit; instances["fruit"] = fruit_key
            geometry = f"geometry.cobblemon_{berry}_{stage}"
            write_block_geometry(geometry, cubes)
            permutations.append({"condition": f"q.block_state('cobblemon:stage') == {stage}", "components": {
                "minecraft:geometry": geometry, "minecraft:material_instances": material_instances(instances)}})
        with open(f"{lootBlocksBedrock}/{berry}_bush.json", "w") as file:
            file.write(json.dumps({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{berry}"}]}]}, indent=4))
        definition = {"format_version": "1.21.90", "minecraft:block": {
            "description": {"identifier": bush, "menu_category": {"category": "nature", "is_hidden_in_commands": False},
                            "states": {"cobblemon:stage": [0, 1, 2, 3]}},
            "components": {
                "minecraft:geometry": f"geometry.cobblemon_{berry}_0",
                "minecraft:material_instances": permutations[0]["components"]["minecraft:material_instances"],
                "minecraft:collision_box": False,
                "minecraft:selection_box": {"origin": [-7, 0, -7], "size": [14, 16, 14]},
                "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.2},
                "minecraft:destructible_by_explosion": {"explosion_resistance": 0},
                "minecraft:light_dampening": 0,
                "minecraft:loot": f"loot_tables/blocks/{berry}_bush.json",
                "minecraft:placement_filter": {"conditions": [{"allowed_faces": ["up"], "block_filter": BERRY_SOILS}]},
                "cobblemon:berry_growth": {}},
            "permutations": permutations}}
        with open(f"{blocksBedrock}/{berry}_bush.json", "w") as file: file.write(json.dumps(definition, indent=2))
        icon = f"{cobblemon}/textures/item/berries/{berry}.png"
        if os.path.exists(icon):
            shutil.copyfile(icon, f"{texturesItemsBedrock}/{berry}.png")
            itemTextureData["texture_data"][berry] = {"textures": [f"textures/items/{berry}"]}
        item = {"format_version": "1.20.50", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{berry}", "menu_category": {"category": "nature"}},
            "components": {"minecraft:icon": berry, "minecraft:display_name": {"value": f"item.cobblemon:{berry}.name"}, "minecraft:max_stack_size": 64,
                           "minecraft:block_placer": {"block": bush, "use_on": BERRY_SOILS}}}}
        with open(f"{itemsBedrock}/berries/{berry}.json", "w") as file: file.write(json.dumps(item, indent=4))
        yield_range = data.get("baseYield", {"min": 1, "max": 3})
        berries[bush] = {"item": f"cobblemon:{berry}", "min": yield_range.get("min", 1), "max": yield_range.get("max", 3)}
    # the healing machine, facing the player who places it
    cubes, instances = java_model_cubes(java_model("cobblemon:block/healing_machine_0") or {})
    write_block_geometry("geometry.cobblemon_healing_machine", cubes)
    turns = {"north": 180, "south": 0, "east": 90, "west": 270}
    machine = {"format_version": "1.21.90", "minecraft:block": {
        "description": {"identifier": "cobblemon:healing_machine", "menu_category": {"category": "equipment"},
                        "traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}}},
        "components": {
            "minecraft:geometry": "geometry.cobblemon_healing_machine",
            "minecraft:material_instances": material_instances(instances),
            "minecraft:collision_box": {"origin": [-8, 0, -8], "size": [16, 14, 16]},
            "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 14, 16]},
            "minecraft:destructible_by_mining": {"seconds_to_destroy": 1.5},
            "minecraft:light_dampening": 0, "minecraft:light_emission": 4,
            "cobblemon:healing_machine": {}},
        "permutations": [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}'",
                          "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}} for d, r in turns.items()]}}
    with open(f"{blocksBedrock}/healing_machine.json", "w") as file: file.write(json.dumps(machine, indent=2))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    fossil_items = create_fossil_blocks()
    apricorn_trees = create_apricorns()
    building_blocks = create_building_blocks()
    # the PC, two blocks tall like the tank, its screen lit while someone uses it
    machine_block("pc", "PC", {"cobblemon:part": ["bottom", "top"], "cobblemon:on": [False, True]},
                  [("q.block_state('cobblemon:part') == 'bottom'", ["pc_bottom"]),
                   ("q.block_state('cobblemon:part') == 'top' && !q.block_state('cobblemon:on')", ["pc_top"]),
                   ("q.block_state('cobblemon:part') == 'top' && q.block_state('cobblemon:on')", ["pc_top_on"])], component="cobblemon:pc")
    # the pasture, the same shape, its lamp lit while it has Pokemon out
    machine_block("pasture", "Pasture", {"cobblemon:part": ["bottom", "top"], "cobblemon:on": [False, True]},
                  [("q.block_state('cobblemon:part') == 'bottom'", ["pasture_bottom"]),
                   ("q.block_state('cobblemon:part') == 'top' && !q.block_state('cobblemon:on')", ["pasture_top_off"]),
                   ("q.block_state('cobblemon:part') == 'top' && q.block_state('cobblemon:on')", ["pasture_top_on"])], component="cobblemon:pasture")
    fossils = create_fossil_display()
    create_machine_recipes()
    with open(f"{resourcePack}/textures/terrain_texture.json", "w") as file:
        file.write(json.dumps({"resource_pack_name": "cobblemon", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
                               "texture_data": terrain_textures}, indent=2))
    with open(f"{scriptsBedrock}/blocks.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: berry bushes by block id, with the berry item and Cobblemon's base yield\n")
        file.write("export const BERRIES = " + json.dumps(berries) + ";\n")
        file.write("export const FOSSILS = " + json.dumps(fossils) + ";\n")
        file.write("export const APRICORN_TREES = " + json.dumps({"variants": TREE_VARIANTS, "origins": apricorn_trees}) + ";\n")
    with open(f"{textsBedrock}/en_US.lang", "a", encoding="utf-8") as file:
        for name in building_blocks:
            file.write(f"tile.cobblemon:{name}.name={lang.get('block.cobblemon.' + name, name.replace('_', ' ').title())}" + chr(10))
    print(f"Create blocks complete: {len(berries)} berry bushes, the healing machine, the fossil machine, {len(fossil_items)} fossils and {len(building_blocks)} building blocks.")


# ---------------------------------------------------------------------------
# Fossils. Cobblemon revives a fossil in a machine of three blocks: the Fossil Analyzer holds the fossils, the
# Restoration Tank (two blocks tall) takes 128 points of natural material, and the Monitor shows the progress.
# Once both are in, the Pokemon grows for twelve minutes, an embryo and then its fetus floating in the tank, and a
# Poke Ball used on the machine takes it out. data/cobblemon/fossils pairs the fossils with the result, and
# natural_materials gives each item's worth. scripts/main.js runs the machine; this writes its blocks, items and
# the fetus display entity.
# ---------------------------------------------------------------------------

fossilsMain = f"{cobblemonData}/fossils"
fossilModelsMain = f"{cobblemon}/bedrock/fossils"
MAX_FOSSILS = 2                      # CobblemonConfig.maxInsertedFossilItems
MATERIAL_TO_START = 128
REVIVE_SECONDS = 12 * 60             # TIME_TO_TAKE, twelve minutes
PROTECTION_SECONDS = 5 * 60          # the reviver alone may take the Pokemon for five minutes
# item tags in natural_materials, as the Bedrock items they stand for
DYES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
MATERIAL_TAGS = {"#c:dyes": [f"minecraft:{d}_dye" for d in DYES], "#minecraft:wart_blocks": ["minecraft:nether_wart_block", "minecraft:warped_wart_block"]}


def fossil_recipes():
    """[(result pack folder, [fossil item ids])] from data/cobblemon/fossils."""
    recipes = []
    for path in sorted(glob.glob(f"{fossilsMain}/*.json")):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        pokemon = pokemon_for_species_name(data["result"])
        if pokemon: recipes.append((pokemon, data["fossils"]))
    return recipes


def natural_materials():
    """{item id: [worth, item given back]} for every natural material this pack has."""
    known = {f"cobblemon:{berry}" for berry, _ in berry_bushes()} | {"cobblemon:moomoo_milk", "cobblemon:revival_herb", "cobblemon:shed_shell"}
    materials = {}
    for path in sorted(glob.glob(f"{cobblemonData}/natural_materials/*.json")):
        with open(path, encoding="utf-8") as file: entries = json.load(file)
        for entry in entries:
            if "tag" in entry:
                items = sorted(known - {"cobblemon:moomoo_milk", "cobblemon:revival_herb", "cobblemon:shed_shell"}) if entry["tag"] == "#cobblemon:berries" else MATERIAL_TAGS.get(entry["tag"], [])
            else:
                items = [entry["item"]]
            for item in items:
                if item.startswith("cobblemon:") and item not in known: continue
                materials[item] = [entry["content"], entry.get("returnItem")]
    return materials


def first_frame(path):
    """An animated Java texture is a strip of square frames with a .mcmeta beside it; Bedrock gets the first frame."""
    if not os.path.exists(path + ".mcmeta"): return
    image = Image.open(path)
    if image.height > image.width: image.crop((0, 0, image.width, image.width)).save(path)


def combine_models(*names):
    """Java block models drawn together as one, their texture keys kept apart."""
    elements, textures = [], {}
    for n, name in enumerate(names):
        model = java_model(f"cobblemon:block/{name}") or {}
        for key, value in model.get("textures", {}).items():
            textures[f"m{n}_{key}"] = value if not (isinstance(value, str) and value.startswith("#")) else "#m" + str(n) + "_" + value[1:]
        for element in model.get("elements", []):
            element = json.loads(json.dumps(element))
            for face in element.get("faces", {}).values():
                if isinstance(face.get("texture"), str) and face["texture"].startswith("#"): face["texture"] = f"#m{n}_" + face["texture"][1:]
            if element.get("name") == "screen_overlay":   # drawn on the screen itself in Java; a hair in front here, or the two flicker
                element["from"][2] -= 0.05; element["to"][2] -= 0.05
            elements.append(element)
    return {"textures": textures, "elements": elements}


def machine_block(name, display, states, variants, extra=None, collision=(16, 16), component="cobblemon:fossil_machine"):
    """A facing machine block: one geometry per state combination named in variants [(condition, [model names])]."""
    permutations = []
    base = None
    for index, (condition, models) in enumerate(variants):
        cubes, instances = java_model_cubes(combine_models(*models))
        for cube in cubes:
            for face in cube["uv"].values(): face["material_instance"] = f"v{index}_{face['material_instance']}"
        instances = {f"v{index}_{k}": v for k, v in instances.items()}
        for key in instances.values(): first_frame(f"{texturesBlocksBedrock}/" + terrain_textures[key]["textures"][len("textures/blocks/cobblemon/"):] + ".png")
        geometry = f"geometry.cobblemon_{name}_{index}"
        write_block_geometry(geometry, cubes)
        materials = material_instances(instances)
        for key, material in materials.items():   # the tank's fluid is see-through, as it is in Java
            if "fluid" in material["texture"]: material["render_method"] = "blend"
        components = {"minecraft:geometry": geometry, "minecraft:material_instances": materials}
        if base is None: base = components
        permutations.append({"condition": condition, "components": components})
    turns = {"north": 180, "south": 0, "east": 90, "west": 270}
    permutations += [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}'", "components": {"minecraft:transformation": {"rotation": [0, r, 0]}}} for d, r in turns.items()]
    width, height = collision
    definition = {"format_version": "1.21.90", "minecraft:block": {
        "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "equipment"}, "states": states,
                        "traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}}},
        "components": {**base,
            "minecraft:collision_box": {"origin": [-width / 2, 0, -width / 2], "size": [width, height, width]},
            "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 16, 16]},
            "minecraft:destructible_by_mining": {"seconds_to_destroy": 1.5},
            "minecraft:light_dampening": 0, "minecraft:light_emission": 3,
            component: {}, **(extra or {})},
        "permutations": permutations}}
    with open(f"{blocksBedrock}/{name}.json", "w") as file: file.write(json.dumps(definition, indent=2))


def create_fossil_blocks():
    """The three machine blocks and the fossil items, called from create_blocks while the terrain atlas is open."""
    fills = [f"restoration_tank_fluid_chunked_{n}" for n in range(1, 9)]
    machine_block("fossil_analyzer", "Fossil Analyzer", {"cobblemon:on": [False, True]},
                  [("!q.block_state('cobblemon:on')", ["fossil_analyzer"]), ("q.block_state('cobblemon:on')", ["fossil_analyzer_scanning"])])
    tank = [("q.block_state('cobblemon:part') == 'top'", ["restoration_tank_upper"])]
    tank += [(f"q.block_state('cobblemon:part') == 'bottom' && q.block_state('cobblemon:fill') == {n}", ["restoration_tank_lower"] + ([fills[n - 1]] if n else [])) for n in range(9)]
    machine_block("restoration_tank", "Restoration Tank", {"cobblemon:part": ["bottom", "top"], "cobblemon:fill": list(range(9))}, tank)
    screens = ["off", "grid", "music", "locked"] + [f"scanning_{n}" for n in range(9)]
    machine_block("monitor", "Monitor", {"cobblemon:screen": screens},
                  [(f"q.block_state('cobblemon:screen') == '{sc}'", ["monitor" if sc == "off" else f"monitor_{sc}"]) for sc in screens])
    # fossil items
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/fossils", exist_ok=True)
    names = sorted({f.split(":")[1] for _, fossils in fossil_recipes() for f in fossils})
    for name in names:
        icon = f"{cobblemon}/textures/item/fossils/{name}.png"
        if os.path.exists(icon):
            shutil.copyfile(icon, f"{texturesItemsBedrock}/{name}.png")
            itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        item = {"format_version": "1.20.50", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "items"}},
            "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"}, "minecraft:max_stack_size": 64}}}
        with open(f"{itemsBedrock}/fossils/{name}.json", "w") as file: file.write(json.dumps(item, indent=4))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    return names


def create_fossil_display():
    """cobblemon:fossil_display, what floats in the tank: variant 0 to 2 are the embryo stages, then one fetus per
    result in recipe order; mark_variant 0 to 4 grows the fetus from half size to Cobblemon's 0.9."""
    recipes = fossil_recipes()
    stages = ["embryo_stage1", "embryo_stage2", "embryo_stage3"] + [f"{p[p.index('_')+1:]}_fetus" for p, _ in recipes]
    stages = [st if os.path.exists(f"{fossilModelsMain}/models/{st}.geo.json") else "substitute_fetus" for st in stages]
    os.makedirs(f"{modelsBedrock}/fossils", exist_ok=True); os.makedirs(f"{animationsBedrock}/fossils", exist_ok=True); os.makedirs(f"{texturesEntityBedrock}/fossils", exist_ok=True)
    textures, animations = {}, {}
    for n, stage in enumerate(stages):
        shutil.copyfile(f"{fossilModelsMain}/models/{stage}.geo.json", f"{modelsBedrock}/fossils/{stage}.geo.json")
        with open(f"{fossilModelsMain}/variations/{stage}.json", encoding="utf-8") as file: variation = json.load(file)["variations"][0]
        texture = os.path.basename(variation["texture"])[:-len(".png")]
        shutil.copyfile(f"{cobblemon}/textures/fossils/{texture}.png", f"{texturesEntityBedrock}/fossils/{texture}.png")
        textures[f"t{n}"] = f"textures/entity/fossils/{texture}"
        anim = f"{fossilModelsMain}/animations/{stage}.animation.json"
        if os.path.exists(anim):
            shutil.copyfile(anim, f"{animationsBedrock}/fossils/{stage}.animation.json")
            with open(anim, encoding="utf-8") as file: names = list(json.load(file)["animations"])
            sleep = next((a for a in names if a.endswith(".sleep")), None)
            if sleep: animations[f"sleep_{n}"] = sleep
    client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "cobblemon:fossil_display",
        "materials": {"default": "entity_alphatest"},
        "textures": textures,
        "geometry": {f"g{n}": f"geometry.{stage}" for n, stage in enumerate(stages)},
        "animations": animations,
        "scripts": {"scale": "0.5 + query.mark_variant * 0.1", "animate": [{k: f"query.variant == {k.split('_')[1]}"} for k in animations]},
        "render_controllers": ["controller.render.fossil_display"]}}}
    with open(f"{entityBedrock}/fossil_display.entity.json", "w") as file: file.write(json.dumps(client, indent=2))
    with open(f"{renderControllersBedrock}/fossil_display.render_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {"controller.render.fossil_display": {
            "arrays": {"textures": {"Array.skin": [f"Texture.t{n}" for n in range(len(stages))]}, "geometries": {"Array.geo": [f"Geometry.g{n}" for n in range(len(stages))]}},
            "geometry": "Array.geo[query.variant]", "materials": [{"*": "Material.default"}], "textures": ["Array.skin[query.variant]"]}}}, indent=2))
    groups = {f"cobblemon:stage_{n}": {"minecraft:variant": {"value": n}} for n in range(len(stages))}
    groups.update({f"cobblemon:growth_{g}": {"minecraft:mark_variant": {"value": g}} for g in range(5)})
    events = {f"cobblemon:stage_{n}": {"remove": {"component_groups": [f"cobblemon:stage_{m}" for m in range(len(stages)) if m != n]}, "add": {"component_groups": [f"cobblemon:stage_{n}"]}} for n in range(len(stages))}
    events.update({f"cobblemon:growth_{g}": {"remove": {"component_groups": [f"cobblemon:growth_{h}" for h in range(5) if h != g]}, "add": {"component_groups": [f"cobblemon:growth_{g}"]}} for g in range(5)})
    behavior = {"format_version": "1.16.0", "minecraft:entity": {
        "description": {"identifier": "cobblemon:fossil_display", "is_spawnable": False, "is_summonable": True, "is_experimental": False},
        "component_groups": groups, "events": events,
        "components": {
            "minecraft:type_family": {"family": ["fossil_display", "inanimate"]},
            "minecraft:collision_box": {"width": 0.1, "height": 0.1},
            "minecraft:physics": {"has_gravity": False, "has_collision": False},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": False}]},
            "minecraft:persistent": {}, "minecraft:health": {"value": 1, "max": 1}, "minecraft:knockback_resistance": {"value": 1.0},
            "minecraft:variant": {"value": 0}, "minecraft:mark_variant": {"value": 0}}}}
    with open(f"{entitiesBedrock}/fossil_display.behavior.json", "w") as file: file.write(json.dumps(behavior, indent=2))
    table = {"results": [{"entity": entity_id(p), "fossils": f, "stage": 3 + n} for n, (p, f) in enumerate(recipes)],
             "fossilItems": sorted({x for _, f in recipes for x in f}), "materials": natural_materials(),
             "maxFossils": MAX_FOSSILS, "materialToStart": MATERIAL_TO_START, "reviveSeconds": REVIVE_SECONDS, "protectionSeconds": PROTECTION_SECONDS}
    return table


def create_machine_recipes():
    """Cobblemon's crafting recipes for the three machine blocks, its common tags as the Bedrock items. The tank's
    Revive is not an item here, so the Revival Herb takes its place."""
    os.makedirs(f"{behaviorPack}/recipes", exist_ok=True)
    tags = {"c:ingots/iron": "minecraft:iron_ingot", "c:ingots/copper": "minecraft:copper_ingot", "c:dusts/redstone": "minecraft:redstone",
            "c:gems/amethyst": "minecraft:amethyst_shard", "c:crops/wheat": "minecraft:wheat"}
    bedrock_tags = {"minecraft:planks", "minecraft:logs", "minecraft:wool"}   # item tags Bedrock recipes take as they are
    swaps = {"cobblemon:revive": "cobblemon:revival_herb"}
    for name in ("fossil_analyzer", "restoration_tank", "monitor", "pc", "pasture"):
        with open(f"{cobblemonData}/recipe/{name}.json", encoding="utf-8") as file: recipe = json.load(file)
        key = {}
        for letter, ingredient in recipe["key"].items():
            if ingredient.get("tag") in bedrock_tags: key[letter] = {"tag": ingredient["tag"]}; continue
            item = tags.get(ingredient.get("tag", ""), ingredient.get("item"))
            key[letter] = {"item": swaps.get(item, item)}
        with open(f"{behaviorPack}/recipes/{name}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.20.10", "minecraft:recipe_shaped": {
                "description": {"identifier": f"cobblemon:{name}"}, "tags": ["crafting_table"],
                "pattern": recipe["pattern"], "key": key, "result": {"item": f"cobblemon:{name}"},
                # the recipe book shows it once the player holds any of its ingredients
                "unlock": [{"item": v["item"]} for v in key.values() if "item" in v]}}, indent=2))


# ---------------------------------------------------------------------------
# Fossil formations. Cobblemon buries 23 kinds of prehistoric formation (a birch tree turned to stone, a frozen
# pond, hydrothermal vents), each a few templates from data/cobblemon/structure/fossils, in the biomes its code
# gives them (CobblemonPlacedFeatures), about one chunk in 300. Their processors turn a share of the gravel and
# sand into suspicious blocks that a brush turns out from Cobblemon's archaeology loot tables, where the fossils
# are. Each becomes a feature and feature rule here, its templates converted with the air left out so they sit
# in the ground, and the loot tables are converted to loot_tables/fossils.
# ---------------------------------------------------------------------------

FORMATION_BIOMES = {   # CobblemonPlacedFeatures.kt
    "prehistoric_birch_trees": "#cobblemon:has_birch_log", "prehistoric_dripstone_oasis": "#cobblemon:is_dripstone",
    "prehistoric_enhydro_agate": "#cobblemon:is_lush", "prehistoric_eroded_pillars": "#cobblemon:has_red_sand",
    "prehistoric_frozen_pond": "#cobblemon:is_glacial", "prehistoric_frozen_spike": "#cobblemon:is_glacial",
    "prehistoric_hydrothermal_vents": "#cobblemon:is_temperate_ocean", "prehistoric_lush_den": "#cobblemon:is_jungle",
    "prehistoric_mossy_ponds": "#cobblemon:is_lush", "prehistoric_mud_pits": "#cobblemon:is_jungle",
    "prehistoric_oak_trees": "#cobblemon:has_oak_log", "prehistoric_powdered_deposit": "#cobblemon:is_snowy",
    "prehistoric_rooted_pits": "#cobblemon:is_swamp", "prehistoric_sandy_den": "#cobblemon:has_sand",
    "prehistoric_spruce_trees": "#cobblemon:has_spruce_log", "prehistoric_submerged_impact": "#cobblemon:is_temperate_ocean",
    "prehistoric_submerged_spike": "#cobblemon:is_frozen_ocean", "prehistoric_preserved_skeleton": "#cobblemon:is_frozen_ocean",
    "prehistoric_sunscorched_den": "#cobblemon:has_red_sand", "prehistoric_sunscorched_remains": "#cobblemon:has_red_sand",
    "prehistoric_suspicious_mounds": "#cobblemon:is_plains", "prehistoric_underwater_fissure": "#cobblemon:is_temperate_ocean",
    "prehistoric_vibrant_hydrothermal_vents": "#cobblemon:is_warm_ocean",
}
FORMATION_FILTERS = {   # the tags the spawn rules never needed
    "#cobblemon:has_birch_log": _tag("birch"), "#cobblemon:has_spruce_log": _tag("taiga"),
    "#cobblemon:has_oak_log": _any(_all(_tag("forest"), _tag("birch", False), _tag("taiga", False)), _tag("plains"), _tag("swamp")),
    "#cobblemon:has_sand": _any(_tag("desert"), _all(_tag("beach"), _tag("stone", False))), "#cobblemon:has_red_sand": _tag("mesa"),
}
lootFossilsBedrock = f"{behaviorPack}/loot_tables/fossils"
# the biome ids each formation's tag covers, for scripts/main.js, which picks the formation a brushed block is in
FORMATION_BIOME_IDS = {
    "#cobblemon:has_birch_log": "birch", "#cobblemon:is_dripstone": "dripstone", "#cobblemon:is_lush": "lush",
    "#cobblemon:has_red_sand": "mesa|badlands", "#cobblemon:is_glacial": "frozen|ice|jagged|snowy_slopes|glacier",
    "#cobblemon:is_temperate_ocean": "^(minecraft:)?(deep_)?(lukewarm_)?ocean$", "#cobblemon:is_jungle": "jungle|bamboo",
    "#cobblemon:has_oak_log": "forest|plains|swamp|meadow", "#cobblemon:is_snowy": "snow|ice|frozen|grove|cold",
    "#cobblemon:is_swamp": "swamp", "#cobblemon:has_sand": "desert|beach", "#cobblemon:has_spruce_log": "taiga|grove",
    "#cobblemon:is_frozen_ocean": "frozen_ocean", "#cobblemon:is_plains": "plains|meadow", "#cobblemon:is_warm_ocean": "warm_ocean",
}
brush_loot = {}
# what a buried formation may replace: the ground it is buried in
FORMATION_REPLACEABLE = [f"minecraft:{b}" for b in ("air", "stone", "dirt", "grass_block", "coarse_dirt", "dirt_with_roots", "podzol", "mud", "clay",
    "gravel", "sand", "red_sand", "sandstone", "red_sandstone", "hardened_clay", "granite", "diorite", "andesite", "tuff", "deepslate",
    "calcite", "dripstone_block", "moss_block", "snow", "snow_layer", "ice", "packed_ice", "blue_ice", "water", "seagrass", "kelp",
    "short_grass", "tall_grass", "fern", "mycelium", "coal_ore", "iron_ore", "copper_ore", "cobblestone", "mossy_cobblestone")]


def defined_items():
    """Every item id the behavior pack defines, so loot tables name only items that exist."""
    ids = set()
    for path in glob.glob(f"{itemsBedrock}/**/*.json", recursive=True):
        with open(path, encoding="utf-8") as file: ids.add(json.load(file)["minecraft:item"]["description"]["identifier"])
    return ids


def convert_loot_table(data, items):
    """A Java loot table as a Bedrock one: item entries and simple counts; items the pack lacks are left out."""
    pools = []
    for pool in data.get("pools", []):
        entries = []
        for entry in pool.get("entries", []):
            name = entry.get("name", "")
            if entry.get("type") != "minecraft:item" or (name.startswith("cobblemon:") and name not in items): continue
            converted = {"type": "item", "name": name, "weight": entry.get("weight", 1)}
            for function in entry.get("functions", []):
                count = function.get("count")
                if function.get("function") == "minecraft:set_count" and isinstance(count, dict) and "min" in count:
                    converted.setdefault("functions", []).append({"function": "set_count", "count": {"min": count["min"], "max": count["max"]}})
                elif function.get("function") == "minecraft:set_count" and isinstance(count, (int, float)):
                    converted.setdefault("functions", []).append({"function": "set_count", "count": count})
            entries.append(converted)
        if entries: pools.append({"rolls": pool.get("rolls", 1) if isinstance(pool.get("rolls", 1), (int, float)) else 1, "entries": entries})
    return {"pools": pools}


def create_fossil_formations(convert, parse_processors, invalid, unmapped):
    """Loot tables, templates, features and feature rules for the fossil formations; returns how many."""
    items = defined_items()
    fresh(lootFossilsBedrock)
    for path in glob.glob(f"{cobblemonData}/loot_table/fossils/**/*.json", recursive=True):
        rel = os.path.relpath(path, f"{cobblemonData}/loot_table/fossils").replace(os.sep, "/")
        with open(path, encoding="utf-8") as file: table = convert_loot_table(json.load(file), items)
        os.makedirs(os.path.dirname(f"{lootFossilsBedrock}/{rel}"), exist_ok=True)
        with open(f"{lootFossilsBedrock}/{rel}", "w") as file: file.write(json.dumps(table, indent=2))
        # the same table for the script: [item, weight, least, most]
        brush_loot.setdefault("tables", {})[f"loot_tables/fossils/{rel}"] = [
            [e["name"], e["weight"]] + next(([f["count"]["min"], f["count"]["max"]] if isinstance(f["count"], dict) else [f["count"], f["count"]]
                                              for f in e.get("functions", []) if f["function"] == "set_count"), [1, 1])
            for pool in table["pools"] for e in pool["entries"]]
    loot_path = lambda name: f"loot_tables/{name.split(':', 1)[-1]}.json"
    count = 0
    brush_loot["formations"] = []
    for path in sorted(glob.glob(f"{worldgenMain}/configured_feature/fossils/*.json")):
        name = os.path.basename(path)[:-len(".json")]
        with open(path, encoding="utf-8") as file: config = json.load(file)["config"]
        biome_filter = biome_filter_for([FORMATION_BIOMES.get(name, "")]) or FORMATION_FILTERS.get(FORMATION_BIOMES.get(name, ""))
        if not biome_filter: continue
        processors = []
        processor_path = f"{worldgenMain}/processor_list/{config.get('cobblemon_processors', '').split(':', 1)[-1]}.json"
        if os.path.exists(processor_path):
            with open(processor_path, encoding="utf-8") as file: processors = parse_processors(json.load(file).get("processors", []))
        features, counts = [], {}
        for template in config.get("cobblemon_structures", []):
            source = f"{structuresMain}/{template.split(':', 1)[-1]}.nbt"
            if not os.path.exists(source): continue
            piece = structure_key(template)
            convert(source, f"{structuresBedrock}/{piece}.mcstructure", invalid, unmapped, processors, air_as_void=True, loot_path=loot_path, loot_counts=counts)
            with open(f"{featuresBedrock}/{piece}_piece.json", "w") as file:
                file.write(json.dumps({"format_version": "1.13.0", "minecraft:structure_template_feature": {
                    "description": {"identifier": f"cobblemon:{piece}_piece"}, "structure_name": f"cobblemon:{piece}",
                    # Cobblemon's own structure feature places a formation wherever its roll lands, with no check of what
                    # it buries itself in; grounded, which a buried piece always is, is the loosest Bedrock allows
                    "adjustment_radius": 0, "facing_direction": "random", "constraints": {"grounded": {}}}}, indent=2))
            features.append([f"cobblemon:{piece}_piece", 1])
        if not features: continue
        brush_loot["formations"].append({"name": name, "biomes": FORMATION_BIOME_IDS.get(FORMATION_BIOMES[name], "."), "tables": counts})
        feature = f"fossils_{name}"
        with open(f"{featuresBedrock}/{feature}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:weighted_random_feature": {"description": {"identifier": f"cobblemon:{feature}"}, "features": features}}, indent=2))
        # buried four to twenty blocks under the top solid block, as Java's two downward offsets put it
        with open(f"{featureRulesBedrock}/{feature}_rule.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:feature_rules": {
                "description": {"identifier": f"cobblemon:{feature}_rule", "places_feature": f"cobblemon:{feature}"},
                "conditions": {"placement_pass": "underground_pass", "minecraft:biome_filter": biome_filter},
                "distribution": {"iterations": 1, "scatter_chance": {"numerator": 1, "denominator": 300},
                                 "x": {"distribution": "uniform", "extent": [0, 15]},
                                 "y": "query.above_top_solid(variable.worldx, variable.worldz) - 4 - math.random_integer(0, 16)",
                                 "z": {"distribution": "uniform", "extent": [0, 15]}}}}, indent=2))
        count += 1
    with open(f"{scriptsBedrock}/fossil_loot.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: each fossil formation's biomes and how many of its suspicious blocks give from each loot table" + chr(10))
        file.write("// and those loot tables as [item, weight, least, most]" + chr(10))
        file.write("export const FORMATIONS = " + json.dumps(brush_loot["formations"]) + ";" + chr(10))
        file.write("export const BRUSH_LOOT = " + json.dumps(brush_loot.get("tables", {})) + ";" + chr(10))
    return count


# ---------------------------------------------------------------------------
# Fishing. Cobblemon's Poke Rods (data/cobblemon/pokerods, one per ball) cast a bobber that is that ball; after a
# wait (100 to 600 ticks, shortened by Lure) something bites, and 85 times in 100 it is a Pokemon from the fishing
# spawns (spawnablePositionType "fishing") of the biome, otherwise the Poke Rod loot table: junk 66, Cobblemon
# treasure 17, vanilla treasure 17, which carries the Poke Rod Smithing Template one time in six.
# PokeRodFishingBobberEntity.kt has the timings; scripts/main.js runs the cast, the bite and the catch from
# scripts/fishing.js, which this writes, with the vanilla biome tags the spawns' biome filters are tested against.
# ---------------------------------------------------------------------------

rodsMain = f"{cobblemonData}/pokerods"
vanillaBiomes = "C:/GitHub/bedrock-server/behavior_packs/vanilla/biomes"


def poke_rods():
    """[(rod name, ball item)] with the plain Poke Rod first."""
    rods = []
    for path in sorted(glob.glob(f"{rodsMain}/*.json")):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        rods.append((os.path.basename(path)[:-len(".json")], data.get("pokeBallId", "cobblemon:poke_ball")))
    rods.sort(key=lambda r: r[0] != "poke_rod")
    return rods


def vanilla_biome_tags():
    """{biome id: [tags]} from the server's vanilla biome definitions."""
    tags = {}
    for path in glob.glob(f"{vanillaBiomes}/*.json"):
        with open(path, encoding="utf-8") as file: text = re.sub(r"//[^\n]*", "", file.read())
        try: data = json.loads(text)["minecraft:biome"]
        except Exception: continue
        tags[data["description"]["identifier"]] = data.get("components", {}).get("minecraft:tags", {}).get("tags", [])
    return tags


def fishing_spawns():
    """Cobblemon's fishing spawns as the script tests them; those that need a structure, nearby blocks or a slime
    chunk are left out, as the spawn rules leave them out."""
    spawns = []
    for path in sorted(glob.glob(f"{cobblemonData}/spawn_pool_world/*.json")):
        with open(path, encoding="utf-8") as file: pool = json.load(file)
        for spawn in pool.get("spawns", []):
            if spawn.get("spawnablePositionType") != "fishing": continue
            condition, anti = spawn.get("condition", {}) or {}, spawn.get("anticondition", {}) or {}
            if condition.get("structures") or condition.get("neededNearbyBlocks") or condition.get("isSlimeChunk"): continue
            pokemon = pokemon_for_species_name(spawn.get("pokemon", ""))
            biome = biome_filter_for(condition.get("biomes", ["#cobblemon:is_overworld"]))
            if not pokemon or not biome: continue
            not_biome = biome_filter_for(anti.get("biomes", [])) if anti.get("biomes") else None
            low, _, high = str(spawn.get("level", "5-30")).partition("-")
            entry = {"entity": entity_id(pokemon), "bucket": spawn.get("bucket", "common"), "weight": spawn.get("weight", 1),
                     "level": [int(low), int(high or low)], "biome": biome}
            if not_biome: entry["notBiome"] = not_biome
            for key in ("canSeeSky", "minLureLevel", "maxLureLevel", "timeRange", "moonPhase", "isRaining", "minY", "maxY", "rodType", "bait"):
                if key in condition: entry[key] = condition[key]
            spawns.append(entry)
    return spawns


def create_fishing():
    print("Creating fishing...")
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/rods", exist_ok=True)
    balls = poke_balls(); ball_index = {b["item"]: n for n, b in enumerate(balls)}
    rods = {}
    for rod, ball in poke_rods():
        icon = f"{cobblemon}/textures/item/fishing/{rod}.png"
        if os.path.exists(icon):
            shutil.copyfile(icon, f"{texturesItemsBedrock}/{rod}.png")
            itemTextureData["texture_data"][rod] = {"textures": [f"textures/items/{rod}"]}
        item = {"format_version": "1.21.90", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{rod}", "menu_category": {"category": "equipment"}},
            "components": {
                "minecraft:icon": rod, "minecraft:display_name": {"value": f"item.cobblemon:{rod}.name"},
                "minecraft:max_stack_size": 1, "minecraft:hand_equipped": True,
                "minecraft:durability": {"max_durability": 64},
                "minecraft:enchantable": {"slot": "fishing_rod", "value": 1},
                # a long use that the script cuts short, so a click registers as a use (Bedrock ignores use on a plain item)
                "minecraft:use_modifiers": {"use_duration": 3600, "movement_modifier": 1.0},
                "minecraft:use_animation": "none"}}}
        with open(f"{itemsBedrock}/rods/{rod}.json", "w") as file: file.write(json.dumps(item, indent=2))
        rods[f"cobblemon:{rod}"] = ball_index.get(ball, 0)
    # the template that makes them
    shutil.copyfile(f"{cobblemon}/textures/item/pokerod_smithing_template.png", f"{texturesItemsBedrock}/pokerod_smithing_template.png")
    itemTextureData["texture_data"]["pokerod_smithing_template"] = {"textures": ["textures/items/pokerod_smithing_template"]}
    with open(f"{itemsBedrock}/pokerod_smithing_template.json", "w") as file:
        file.write(json.dumps({"format_version": "1.21.90", "minecraft:item": {
            "description": {"identifier": "cobblemon:pokerod_smithing_template", "menu_category": {"category": "items"}},
            "components": {"minecraft:icon": "pokerod_smithing_template", "minecraft:display_name": {"value": "item.cobblemon:pokerod_smithing_template.name"},
                           "minecraft:max_stack_size": 64, "minecraft:tags": {"tags": ["minecraft:transform_templates"]}}}}, indent=2))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    # recipes: each rod is a smithing transform of a fishing rod with its ball; the template copies itself
    for rod, ball in poke_rods():
        with open(f"{behaviorPack}/recipes/{rod}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.20.10", "minecraft:recipe_smithing_transform": {
                "description": {"identifier": f"cobblemon:{rod}"}, "tags": ["smithing_table"],
                "template": "cobblemon:pokerod_smithing_template", "base": "minecraft:fishing_rod", "addition": ball, "result": f"cobblemon:{rod}"}}, indent=2))
    with open(f"{behaviorPack}/recipes/pokerod_smithing_template.json", "w") as file:
        file.write(json.dumps({"format_version": "1.20.10", "minecraft:recipe_shaped": {
            "description": {"identifier": "cobblemon:pokerod_smithing_template"}, "tags": ["crafting_table"],
            "pattern": ["#S#", "#C#", "###"], "key": {"#": {"item": "minecraft:gold_ingot"}, "C": {"item": "minecraft:prismarine_shard"}, "S": {"item": "cobblemon:pokerod_smithing_template"}},
            "result": {"item": "cobblemon:pokerod_smithing_template", "count": 2}, "unlock": [{"item": "cobblemon:pokerod_smithing_template"}]}}, indent=2))
    # the bobber: the rod's ball, half size, floating
    textures = {f"b{n}": f"textures/entity/poke_ball/{b['texture']}" for n, b in enumerate(balls)}
    client = {"format_version": "1.10.0", "minecraft:client_entity": {"description": {
        "identifier": "cobblemon:poke_bobber", "materials": {"default": "entity_alphatest"}, "textures": textures,
        "geometry": {"poke_ball": "geometry.poke_ball", "ancient_poke_ball": "geometry.ancient_poke_ball"},
        "scripts": {"scale": "0.5"}, "render_controllers": ["controller.render.poke_bobber"]}}}
    with open(f"{entityBedrock}/poke_bobber.entity.json", "w") as file: file.write(json.dumps(client, indent=2))
    with open(f"{renderControllersBedrock}/poke_bobber.render_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {"controller.render.poke_bobber": {
            "arrays": {"textures": {"Array.skin": [f"Texture.b{n}" for n in range(len(balls))]},
                       "geometries": {"Array.geo": [f"Geometry.{b['model']}" for b in balls]}},
            "geometry": "Array.geo[query.variant]", "materials": [{"*": "Material.default"}], "textures": ["Array.skin[query.variant]"]}}}, indent=2))
    groups = {f"cobblemon:ball_{n}": {"minecraft:variant": {"value": n}} for n in range(len(balls))}
    events = {f"cobblemon:ball_{n}": {"add": {"component_groups": [f"cobblemon:ball_{n}"]}} for n in range(len(balls))}
    behavior = {"format_version": "1.16.0", "minecraft:entity": {
        "description": {"identifier": "cobblemon:poke_bobber", "is_spawnable": False, "is_summonable": True, "is_experimental": False},
        "component_groups": groups, "events": events,
        "components": {
            "minecraft:type_family": {"family": ["poke_bobber", "inanimate"]},
            "minecraft:collision_box": {"width": 0.25, "height": 0.25},
            "minecraft:physics": {}, "minecraft:buoyant": {"base_buoyancy": 1.0, "apply_gravity": True, "simulate_waves": True, "big_wave_probability": 0.03, "big_wave_speed": 10.0,
                                                          "liquid_blocks": ["minecraft:water", "minecraft:flowing_water"]},
            "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": False}]},
            "minecraft:health": {"value": 1, "max": 1}, "minecraft:variant": {"value": 0},
            "minecraft:conditional_bandwidth_optimization": {}}}}
    with open(f"{entitiesBedrock}/poke_bobber.behavior.json", "w") as file: file.write(json.dumps(behavior, indent=2))
    with open(f"{cobblemonData}/loot_table/fishing/pokerod_treasure.json", encoding="utf-8") as file:
        treasure = [e["name"] for p in json.load(file)["pools"] for e in p["entries"] if e.get("name")]
    spawns = fishing_spawns()
    with open(f"{scriptsBedrock}/fishing.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: Poke Rods and their bobber ball, Cobblemon's fishing spawns, the vanilla biome tags" + chr(10))
        file.write("export const RODS = " + json.dumps(rods) + ";" + chr(10))
        file.write("export const FISHING_SPAWNS = " + json.dumps(spawns) + ";" + chr(10))
        file.write("export const BIOME_TAGS = " + json.dumps(vanilla_biome_tags()) + ";" + chr(10))
        file.write("export const BUCKETS = " + json.dumps(BUCKET_WEIGHTS) + ";" + chr(10))
        file.write("export const ROD_TREASURE = " + json.dumps(treasure) + ";" + chr(10))
    print(f"Create fishing complete: {len(rods)} rods, {len(spawns)} fishing spawns.")


# ---------------------------------------------------------------------------
# The Pokedex. Cobblemon's seven Pokedex items, crafted from apricorns, copper, iron and a screen material, and its
# regional dexes (data/cobblemon/dexes: Kanto to Paldea, the National dex their union). scripts/main.js keeps each
# player's register of seen and caught Pokemon and shows it; this writes the items, recipes and scripts/dex.js.
# ---------------------------------------------------------------------------

POKEDEX_COLOURS = ["red", "yellow", "green", "blue", "pink", "black", "white"]
# the cobblemon:pokedex_screen tag, as the Bedrock items it holds (Bright Powder is not ported)
POKEDEX_SCREENS = ["minecraft:glow_ink_sac", "minecraft:redstone", "minecraft:glowstone_dust", "minecraft:blaze_powder",
                   "minecraft:prismarine_shard", "minecraft:amethyst_shard"]


def dex_regions():
    """[(region name, [pack folders in dex order])], the National dex first."""
    dexes = {}
    for path in glob.glob(f"{cobblemonData}/dexes/*.json"):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        dexes[data["id"]] = data
    def entries(dex_id):
        dex = dexes[dex_id]
        if "subDexIds" in dex: return [e for sub in dex["subDexIds"] for e in entries(sub)]
        return dex.get("entries", [])
    regions = []
    for dex in sorted(dexes.values(), key=lambda d: d.get("sortOrder", 99)):
        seen, folders = set(), []
        for entry in entries(dex["id"]):
            pokemon = pokemon_for_species_name(entry.split(":")[-1].split("-")[0])
            if pokemon and pokemon not in seen: seen.add(pokemon); folders.append(pokemon)
        if folders:
            name = lang.get(f"cobblemon.ui.pokedex.region.{dex['id'].split(':')[-1]}", dex["id"].split(":")[-1].title())
            regions.append((name, folders))
    return regions


def create_pokedex():
    print("Creating the Pokedex...")
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/pokedex", exist_ok=True)
    for colour in POKEDEX_COLOURS:
        name = f"pokedex_{colour}"
        shutil.copyfile(f"{cobblemon}/textures/item/pokedexes/{name}.png", f"{texturesItemsBedrock}/{name}.png")
        itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        with open(f"{itemsBedrock}/pokedex/{name}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.90", "minecraft:item": {
                "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "equipment"}},
                "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"},
                               "minecraft:max_stack_size": 1, "minecraft:use_modifiers": {"use_duration": 3600, "movement_modifier": 1.0},
                               "minecraft:use_animation": "none"}}}, indent=2))
        with open(f"{cobblemonData}/recipe/{name}.json", encoding="utf-8") as file: recipe = json.load(file)
        apricorn = recipe["key"]["A"]["item"]
        for n, screen in enumerate(POKEDEX_SCREENS):
            with open(f"{behaviorPack}/recipes/{name}_{n}.json", "w") as file:
                file.write(json.dumps({"format_version": "1.20.10", "minecraft:recipe_shaped": {
                    "description": {"identifier": f"cobblemon:{name}_{n}"}, "tags": ["crafting_table"], "pattern": recipe["pattern"],
                    "key": {"S": {"item": screen}, "C": {"item": "minecraft:copper_ingot"}, "I": {"item": "minecraft:iron_ingot"}, "A": {"item": apricorn}},
                    "result": {"item": f"cobblemon:{name}"}, "unlock": [{"item": apricorn}]}}, indent=2))
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    regions = dex_regions()
    national = regions[0][1]
    index = {p: n for n, p in enumerate(national)}
    info = {}
    for pokemon in national:
        species = species_for(pokemon) or {}
        # DropsScrollingWidget's lines: "<amount>× <item> <chance>%", from the species' drop entries
        drops = []
        for entry in species.get("drops", {}).get("entries", []):
            item = entry.get("item", "")
            if not item: continue
            ns, _, path = item.partition(":")
            name = lang.get(f"item.cobblemon.{path}") or lang.get(f"block.cobblemon.{path}") or path.replace("_", " ").title()
            amount = str(entry.get("quantityRange", entry.get("quantity", "1")))
            text = f"{amount.replace('-', '-')}x {name}" + (f" {entry['percentage']:g}%" if "percentage" in entry else "")
            drops.append(text)
        info[entity_id(pokemon)] = {"n": species.get("nationalPokedexNumber", 0), "d": lang.get(f"cobblemon.species.{species_key(species)}.desc", "") if species else "",
                                    "h": species.get("height", 0), "w": species.get("weight", 0), "dr": drops}
    with open(f"{scriptsBedrock}/dex.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the regional dexes (National first) as indexes into NATIONAL, and each entry's number, text and size" + chr(10))
        file.write("export const NATIONAL = " + json.dumps([entity_id(p) for p in national]) + ";" + chr(10))
        file.write("export const REGIONS = " + json.dumps([{"name": name, "entries": [index[p] for p in folders if p in index]} for name, folders in regions]) + ";" + chr(10))
        file.write("export const DEX_INFO = " + json.dumps(info, ensure_ascii=False) + ";" + chr(10))
    print(f"Create Pokedex complete: {len(regions)} dexes, {len(national)} entries.")


# ---------------------------------------------------------------------------
# Apricorns. Seven colours of fruit grow on apricorn trees, which Cobblemon builds in code (ApricornTreeFeature):
# a five-block trunk, leaves in four layers with random extenders, and up to eight fruits hanging off the second
# layer, their ages random in worldgen and 0 on a grown sapling. port.py runs the same algorithm to write tree
# structures per colour; a feature rule scatters them by Cobblemon's sparse, normal and dense biome tags; a
# sapling (planted from an Apricorn Sprout) grows into one. A fruit ripens a stage on one random tick in five
# (ApricornBlock), is picked when ripe (an apricorn, and a sprout one time in ten) and starts again.
# ---------------------------------------------------------------------------

APRICORN_COLOURS = ["black", "blue", "green", "pink", "red", "white", "yellow"]
TREE_VARIANTS = 6


def full_block(identifier, textures, extra=None, states=None, permutations=None, render="opaque", category="construction", loot=None):
    """A cube block: textures is {"*": key} or per face (up, down, north...). Writes behavior block and terrain textures."""
    instances = {face: {"texture": java_texture(ref), "render_method": render} for face, ref in textures.items()}
    definition = {"format_version": "1.21.90", "minecraft:block": {
        "description": {"identifier": identifier, "menu_category": {"category": category}, **({"states": states} if states else {})},
        "components": {"minecraft:geometry": "minecraft:geometry.full_block", "minecraft:material_instances": instances,
                       "minecraft:destructible_by_mining": {"seconds_to_destroy": 1.0}, **({"minecraft:loot": loot} if loot else {}), **(extra or {})}}}
    if permutations: definition["minecraft:block"]["permutations"] = permutations
    with open(f"{blocksBedrock}/{identifier.split(':')[1]}.json", "w") as file: file.write(json.dumps(definition, indent=2))


def pillar_block(identifier, side, end, extra=None):
    """A log: its end texture on the faces its axis runs through, turned by the face it was placed against."""
    full_block(identifier, {"*": side, "up": end, "down": end}, extra={
        **(extra or {})}, permutations=[
        {"condition": "q.block_state('minecraft:block_face') == 'north' || q.block_state('minecraft:block_face') == 'south'", "components": {"minecraft:transformation": {"rotation": [90, 0, 0]}}},
        {"condition": "q.block_state('minecraft:block_face') == 'east' || q.block_state('minecraft:block_face') == 'west'", "components": {"minecraft:transformation": {"rotation": [0, 0, 90]}}}])
    path = f"{blocksBedrock}/{identifier.split(':')[1]}.json"
    with open(path, encoding="utf-8") as file: data = json.load(file)
    data["minecraft:block"]["description"]["traits"] = {"minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}
    with open(path, "w") as file: file.write(json.dumps(data, indent=2))


def apricorn_tree(rng, colour, generating):
    """{(x, y, z): (block, states)} for one tree from ApricornTreeFeature, the sapling at (0, 0, 0)."""
    blocks = {}
    leaf = ("cobblemon:apricorn_leaves", {})
    def put(pos, state):
        if pos not in blocks or blocks[pos][0] == "cobblemon:apricorn_leaves": blocks[pos] = state
    def clear(pos, state):
        if pos not in blocks or blocks[pos][0] == "cobblemon:apricorn_leaves": blocks[pos] = state
    for y in range(5): blocks[(0, y, 0)] = ("cobblemon:apricorn_log", {"minecraft:block_face": "up"})
    dirs = {"north": (0, -1), "east": (1, 0), "south": (0, 1), "west": (-1, 0)}
    opposite = {"north": "south", "south": "north", "east": "west", "west": "east"}
    for dx, dz in dirs.values():
        for y in range(1, 5): clear((dx, y, dz), leaf)
    d = list(dirs.values())[rng.randrange(4)]
    one = (d[0] * 2, 1, d[1] * 2); off = rng.choice([-1, 1])
    two = (one[0] + off, 1, one[2]) if d[0] == 0 else (one[0], 1, one[2] + off)
    clear(one, leaf); clear(two, leaf)
    for cx, cz in ((1, 1), (-1, -1), (1, -1), (-1, 1)):
        for y in range(1, 5): clear((cx, y, cz), leaf)
    spots = []
    for name, (dx, dz) in dirs.items():
        here = []
        for y in (2, 3):
            pos = (dx * 2, y, dz * 2); clear(pos, leaf)
            here.append((opposite[name], (pos[0] + dx, y, pos[2] + dz)))
        spots.append(here)
    for cx, cz in ((1, 2), (-1, 2), (1, -2), (-2, 1), (2, 1), (-2, -1), (-1, -2), (2, -1)):
        here = []
        for y in (2, 3):
            pos = (cx, y, cz); clear(pos, leaf)
            for name, (dx, dz) in dirs.items():
                fruit = (cx + dx, y, cz + dz)
                if fruit not in blocks: here.append((opposite[name], fruit))
        spots.append(here)
    top = (0, 5, 0); clear(top, leaf)
    for dx, dz in dirs.values(): clear((dx, 5, dz), leaf)
    used = []
    for _ in range(rng.randint(2, 3)):
        name = rng.choice([n for n in dirs if n not in used]); used.append(name); dx, dz = dirs[name]
        one = (dx * 2, 6, dz * 2); off = rng.choice([-1, 1])
        two = (one[0] + off, 6, one[2]) if dx == 0 else (one[0], 6, one[2] + off)
        for pos in ([one, two] if rng.randrange(3) == 0 else [rng.choice([one, two])]): clear(pos, leaf)
    candidates = [sp for sp in spots if sp]
    rng.shuffle(candidates)
    for group in candidates[:8]:
        facing, pos = rng.choice(group)
        dx, dz = dirs[facing]
        if blocks.get((pos[0] + dx, pos[1], pos[2] + dz), ("",))[0] == "cobblemon:apricorn_leaves" and pos not in blocks:
            blocks[pos] = (f"cobblemon:{colour}_apricorn", {"cobblemon:age": rng.randrange(4) if generating else 0, "cobblemon:facing": facing})
    return blocks


def write_tree(path, blocks):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
    from nbt_to_mcstructure import Tag, compound, int_list, write_nbt, STRING, INT, LIST, COMPOUND
    xs, ys, zs = zip(*blocks)
    ox, oy, oz = min(xs), min(ys), min(zs)
    sx, sy, sz = max(xs) - ox + 1, max(ys) - oy + 1, max(zs) - oz + 1
    palette, keys, layer = [], [], [-1] * (sx * sy * sz)
    for (x, y, z), (name, states) in blocks.items():
        key = (name, json.dumps(states, sort_keys=True))
        if key not in keys:
            keys.append(key)
            tags = {k: Tag(INT, v) if isinstance(v, int) else Tag(STRING, v) for k, v in states.items()}
            palette.append(compound(name=Tag(STRING, name), states=Tag(COMPOUND, tags), version=Tag(INT, 18168865)))
        layer[((x - ox) * sy + (y - oy)) * sz + (z - oz)] = keys.index(key)
    root = compound(format_version=Tag(INT, 1), size=int_list([sx, sy, sz]),
                    structure=compound(block_indices=Tag(LIST, [int_list(layer), int_list([-1] * len(layer))], LIST), entities=Tag(LIST, [], COMPOUND),
                                       palette=compound(default=compound(block_palette=Tag(LIST, palette, COMPOUND), block_position_data=Tag(COMPOUND, {})))),
                    structure_world_origin=int_list([0, 0, 0]))
    with open(path, "wb") as file: file.write(write_nbt(root))
    return (ox, oy, oz)


def create_apricorns():
    """Wood, leaves, fruit, saplings, sprouts, apricorn items and the tree structures and feature rules."""
    import random
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    def item(name, icon_path, extra=None, category="nature"):
        shutil.copyfile(icon_path, f"{texturesItemsBedrock}/{name}.png")
        itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        os.makedirs(f"{itemsBedrock}/apricorns", exist_ok=True)
        with open(f"{itemsBedrock}/apricorns/{name}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.90", "minecraft:item": {
                "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": category}},
                "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"}, "minecraft:max_stack_size": 64, **(extra or {})}}}, indent=2))
    wood = "cobblemon:block/wood/"
    os.makedirs(lootBlocksBedrock, exist_ok=True)
    def self_loot(name):
        with open(f"{lootBlocksBedrock}/{name}.json", "w") as file:
            file.write(json.dumps({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{name}"}]}]}))
        return f"loot_tables/blocks/{name}.json"
    pillar_block("cobblemon:apricorn_log", wood + "apricorn_log", wood + "apricorn_log_top", {"cobblemon:strippable": {}, "minecraft:loot": self_loot("apricorn_log")})
    pillar_block("cobblemon:stripped_apricorn_log", wood + "stripped_apricorn_log", wood + "stripped_apricorn_log_top", {"minecraft:loot": self_loot("stripped_apricorn_log")})
    pillar_block("cobblemon:apricorn_wood", wood + "apricorn_log", wood + "apricorn_log", {"cobblemon:strippable": {}, "minecraft:loot": self_loot("apricorn_wood")})
    pillar_block("cobblemon:stripped_apricorn_wood", wood + "stripped_apricorn_log", wood + "stripped_apricorn_log", {"minecraft:loot": self_loot("stripped_apricorn_wood")})
    full_block("cobblemon:apricorn_planks", {"*": wood + "apricorn_planks"}, loot=self_loot("apricorn_planks"))
    # leaves: Cobblemon's table drops 1 or 2 sticks one time in fifty; shears or Silk Touch keep the leaves, which
    # Bedrock loot cannot tell apart from other tools, so the script does that when they break. They draw one side
    # of each face, so two leaves side by side do not fight over the face they share
    with open(f"{lootBlocksBedrock}/apricorn_leaves.json", "w") as file:
        file.write(json.dumps({"pools": [{"rolls": 1, "conditions": [{"condition": "random_chance", "chance": 0.02}],
                                          "entries": [{"type": "item", "name": "minecraft:stick", "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]}]}]}))
    full_block("cobblemon:apricorn_leaves", {"*": wood + "apricorn_leaves"}, render="alpha_test_single_sided", category="nature", loot="loot_tables/blocks/apricorn_leaves.json",
               extra={"minecraft:light_dampening": 1, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.3}})
    for colour in APRICORN_COLOURS:
        item(f"{colour}_apricorn", f"{cobblemon}/textures/item/{colour}_apricorn.png")
        item(f"{colour}_apricorn_seed", f"{cobblemon}/textures/item/wood/{colour}_apricorn_seed.png",
             {"minecraft:block_placer": {"block": f"cobblemon:{colour}_apricorn_sapling", "use_on": ["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:moss_block", "minecraft:mud", "minecraft:farmland"]}})
        # the sapling: a cross of its texture
        with open(f"{lootBlocksBedrock}/{colour}_apricorn_sapling.json", "w") as file:
            file.write(json.dumps({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{colour}_apricorn_seed"}]}]}))
        with open(f"{blocksBedrock}/{colour}_apricorn_sapling.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.90", "minecraft:block": {
                "description": {"identifier": f"cobblemon:{colour}_apricorn_sapling", "menu_category": {"category": "nature"}},
                "components": {"minecraft:geometry": "minecraft:geometry.cross",
                               "minecraft:material_instances": {"*": {"texture": java_texture(f"cobblemon:block/crops/{colour}_apricorn_sapling"), "render_method": "alpha_test", "face_dimming": False, "ambient_occlusion": False}},
                               "minecraft:collision_box": False, "minecraft:selection_box": {"origin": [-6, 0, -6], "size": [12, 13, 12]},
                               "minecraft:destructible_by_mining": {"seconds_to_destroy": 0}, "minecraft:light_dampening": 0,
                               "minecraft:loot": f"loot_tables/blocks/{colour}_apricorn_sapling.json",
                               "minecraft:placement_filter": {"conditions": [{"allowed_faces": ["up"], "block_filter": ["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:moss_block", "minecraft:mud", "minecraft:farmland"]}]},
                               "cobblemon:apricorn_sapling": {}}}}, indent=2))
        # the fruit: stage models 0 to 2 are shared, 3 is the colour's own; it faces the leaf it hangs from
        permutations = []
        base = None
        for age in range(4):
            model = java_model(f"cobblemon:block/apricorn_stage_{age}" if age < 3 else f"cobblemon:block/{colour}_apricorn")
            if age == 3:
                model = {"textures": {**(java_model("cobblemon:block/apricorn_stage_3") or {}).get("textures", {}), **model.get("textures", {})},
                         "elements": (java_model("cobblemon:block/apricorn_stage_3") or {}).get("elements", [])}
            cubes, instances = java_model_cubes(model)
            geometry = f"geometry.cobblemon_{colour}_apricorn_{age}"
            write_block_geometry(geometry, cubes)
            components = {"minecraft:geometry": geometry, "minecraft:material_instances": material_instances(instances)}
            base = base or components
            permutations.append({"condition": f"q.block_state('cobblemon:age') == {age}", "components": components})
        # Java turns the model clockwise from south by 90 per step (east 270, north 180, west 90); Bedrock turns the other way
        for facing, java_y in (("south", 0), ("west", 90), ("north", 180), ("east", 270)):
            permutations.append({"condition": f"q.block_state('cobblemon:facing') == '{facing}'", "components": {"minecraft:transformation": {"rotation": [0, -java_y % 360, 0]}}})
        with open(f"{blocksBedrock}/{colour}_apricorn.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.90", "minecraft:block": {
                "description": {"identifier": f"cobblemon:{colour}_apricorn", "menu_category": {"category": "nature", "is_hidden_in_commands": False},
                                "states": {"cobblemon:age": [0, 1, 2, 3], "cobblemon:facing": ["south", "west", "north", "east"]}},
                "components": {**base, "minecraft:collision_box": False, "minecraft:selection_box": {"origin": [-4, 2, 2], "size": [8, 10, 6]},
                               "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.2}, "minecraft:light_dampening": 0,
                               "minecraft:loot": "loot_tables/empty.json", "cobblemon:apricorn": {}},
                "permutations": permutations}}, indent=2))
    for stone in ("tumblestone", "sky_tumblestone", "black_tumblestone"):
        item(stone, f"{cobblemon}/textures/item/{stone}.png", category="items")
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    # trees: worldgen variants (fruit at random ages) and sapling variants (unripe fruit)
    rng = random.Random(1234)
    origins = {}
    for colour in APRICORN_COLOURS:
        for kind, generating in (("wild", True), ("grown", False)):
            for n in range(TREE_VARIANTS):
                name = f"apricorn_tree_{colour}_{kind}_{n}"
                origins[name] = write_tree(f"{structuresBedrock}/{name}.mcstructure", apricorn_tree(rng, colour, generating))
    # feature rules: apricorn_trees is one chunk in 8, times 0.1 (baseApricornTreeGenerationChance) times the
    # biome's multiplier, sparse 0.1, normal 1, dense 10
    for density, multiplier in (("sparse", 0.1), ("normal", 1.0), ("dense", 10.0)):
        with open(f"{cobblemonData}/tags/worldgen/biome/has_feature/apricorns_{density}.json", encoding="utf-8") as file:
            biome_filter = biome_filter_for(json.load(file)["values"])
        if not biome_filter: continue
        colour_features = []
        for colour in APRICORN_COLOURS:
            pieces = []
            for n in range(TREE_VARIANTS):
                name = f"apricorn_tree_{colour}_wild_{n}"
                with open(f"{featuresBedrock}/{name}.json", "w") as file:
                    file.write(json.dumps({"format_version": "1.13.0", "minecraft:structure_template_feature": {
                        "description": {"identifier": f"cobblemon:{name}"}, "structure_name": f"cobblemon:{name}", "adjustment_radius": 1, "facing_direction": "random",
                        "constraints": {"grounded": {}, "unburied": {}, "block_intersection": {"block_allowlist": ["minecraft:air", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:snow_layer"]}}}}, indent=2))
                pieces.append([f"cobblemon:{name}", 1])
            with open(f"{featuresBedrock}/apricorn_tree_{colour}.json", "w") as file:
                file.write(json.dumps({"format_version": "1.13.0", "minecraft:weighted_random_feature": {"description": {"identifier": f"cobblemon:apricorn_tree_{colour}"}, "features": pieces}}, indent=2))
            colour_features.append([f"cobblemon:apricorn_tree_{colour}", 1])
        with open(f"{featuresBedrock}/apricorn_trees.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:weighted_random_feature": {"description": {"identifier": "cobblemon:apricorn_trees"}, "features": colour_features}}, indent=2))
        with open(f"{featureRulesBedrock}/apricorn_trees_{density}_rule.json", "w") as file:
            file.write(json.dumps({"format_version": "1.13.0", "minecraft:feature_rules": {
                "description": {"identifier": f"cobblemon:apricorn_trees_{density}_rule", "places_feature": "cobblemon:apricorn_trees"},
                "conditions": {"placement_pass": "surface_pass", "minecraft:biome_filter": biome_filter},
                "distribution": {"iterations": 1, "scatter_chance": {"numerator": 1, "denominator": max(1, round(8 / (0.1 * multiplier)))},
                                 "x": {"distribution": "uniform", "extent": [0, 15]}, "y": "query.heightmap(variable.worldx, variable.worldz)",
                                 "z": {"distribution": "uniform", "extent": [0, 15]}}}}, indent=2))
    with open(f"{behaviorPack}/loot_tables/empty.json", "w") as file: file.write(json.dumps({"pools": []}))
    return origins


# ---------------------------------------------------------------------------
# Recipes. Every Cobblemon recipe whose result and ingredients are items this pack has (or vanilla ones) becomes a
# Bedrock recipe: shaped, shapeless, the furnace family and stonecutting. Cobblemon's item tags are resolved to
# their first item the pack has, and the common (c:) tags to the vanilla item they stand for.
# ---------------------------------------------------------------------------

COMMON_TAGS = {"c:ingots/iron": "minecraft:iron_ingot", "c:ingots/copper": "minecraft:copper_ingot", "c:ingots/gold": "minecraft:gold_ingot",
               "c:ingots/netherite": "minecraft:netherite_ingot", "c:dusts/redstone": "minecraft:redstone", "c:dusts/glowstone": "minecraft:glowstone_dust",
               "c:gems/amethyst": "minecraft:amethyst_shard", "c:gems/diamond": "minecraft:diamond", "c:gems/emerald": "minecraft:emerald",
               "c:gems/quartz": "minecraft:quartz", "c:gems/prismarine": "minecraft:prismarine_shard", "c:strings": "minecraft:string",
               "c:crops/wheat": "minecraft:wheat", "c:storage_blocks/iron": "minecraft:iron_block", "c:rods/wooden": "minecraft:stick",
               "c:leathers": "minecraft:leather", "c:slimeballs": "minecraft:slime_ball", "c:eggs": "minecraft:egg", "c:bones": "minecraft:bone",
               "c:feathers": "minecraft:feather", "c:obsidians": "minecraft:obsidian", "c:chests": "minecraft:chest",
               "minecraft:wool": "minecraft:white_wool", "minecraft:logs": "minecraft:oak_log", "c:glass_blocks": "minecraft:glass",
               "c:cobblestones": "minecraft:cobblestone", "c:stones": "minecraft:stone", "c:sands": "minecraft:sand", "c:gravels": "minecraft:gravel",
               "c:concretes": "minecraft:white_concrete", "c:nuggets/iron": "minecraft:iron_nugget", "c:nuggets/gold": "minecraft:gold_nugget",
               "c:gems/lapis": "minecraft:lapis_lazuli", "c:fertilizers": "minecraft:bone_meal", "c:slime_balls": "minecraft:slime_ball",
               "c:tools/shield": "minecraft:shield", "c:seeds": "minecraft:wheat_seeds", "c:rods/blaze": "minecraft:blaze_rod",
               "c:raw_materials/gold": "minecraft:raw_gold", "c:raw_materials/iron": "minecraft:raw_iron", "c:bricks/normal": "minecraft:brick",
               "c:buckets/empty": "minecraft:bucket", "c:chains": "minecraft:chain", "c:chests/wooden": "minecraft:chest", "minecraft:buttons": "minecraft:wooden_button", "c:ender_pearls": "minecraft:ender_pearl", "c:gunpowders": "minecraft:gunpowder",
               **{f"c:dyes/{colour}": f"minecraft:{colour}_dye" for colour in ("white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
                                                                            "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black")}}
BEDROCK_TAGS = {"minecraft:planks", "minecraft:logs", "minecraft:wool", "minecraft:wooden_slabs", "minecraft:stone_crafting_materials"}


def create_recipes():
    print("Creating recipes...")
    items = defined_items() | {f"cobblemon:{os.path.basename(pth)[:-5]}" for pth in glob.glob(f"{blocksBedrock}/*.json")}
    tag_cache = {}
    def resolve_tag(tag):
        if tag in tag_cache: return tag_cache[tag]
        result = None
        if tag in COMMON_TAGS: result = COMMON_TAGS[tag]
        elif tag.startswith("cobblemon:"):
            path = f"{cobblemonData}/tags/item/{tag.split(':', 1)[1]}.json"
            if os.path.exists(path):
                with open(path, encoding="utf-8") as file: values = json.load(file).get("values", [])
                for value in values:
                    value = value if isinstance(value, str) else value.get("id", "")
                    candidate = resolve_tag(value[1:]) if value.startswith("#") else value
                    if candidate and (candidate.startswith("minecraft:") or candidate in items): result = candidate; break
        tag_cache[tag] = result
        return result
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
    from nbt_to_mcstructure import BLOCK_NAMES
    def bedrock_item(item_id):
        """Java's name for a vanilla item where Bedrock calls it something else (magma_block is magma)."""
        if item_id and item_id.startswith("minecraft:"):
            name = item_id.split(":", 1)[1]
            renamed = BLOCK_NAMES.get(name, name)
            if renamed not in ("air", "water", "lava"): return f"minecraft:{renamed}"
        return item_id
    def ingredient(entry):
        if isinstance(entry, list): entry = entry[0] if entry else {}
        if isinstance(entry, str): entry = {"tag": entry[1:]} if entry.startswith("#") else {"item": entry}
        if "tag" in entry:
            if entry["tag"] in BEDROCK_TAGS: return {"tag": entry["tag"]}
            item_id = resolve_tag(entry["tag"])
        else: item_id = entry.get("item")
        item_id = bedrock_item(item_id)
        if not item_id or not (item_id.startswith("minecraft:") or item_id in items): return None
        return {"item": item_id}
    made, skipped = 0, 0
    missing = collections.Counter()
    for path in sorted(glob.glob(f"{cobblemonData}/recipe/*.json")):
        name = os.path.basename(path)[:-len(".json")]
        if os.path.exists(f"{behaviorPack}/recipes/{name}.json"): continue   # written by its own feature
        with open(path, encoding="utf-8") as file: recipe = json.load(file)
        kind = recipe.get("type", "")
        result = recipe.get("result", {})
        result_id = result if isinstance(result, str) else result.get("id") or result.get("item")
        if not result_id or not (result_id.startswith("minecraft:") or result_id in items): skipped += 1; missing[f"result {result_id}"] += 1; continue
        out = {"item": result_id, **({"count": result["count"]} if isinstance(result, dict) and result.get("count", 1) > 1 else {})}
        description = {"identifier": f"cobblemon:{name}"}
        body = None
        if kind == "minecraft:crafting_shaped":
            key = {k: ingredient(v) for k, v in recipe["key"].items()}
            if all(key.values()):
                body = {"minecraft:recipe_shaped": {"description": description, "tags": ["crafting_table"], "pattern": recipe["pattern"], "key": key, "result": out,
                                                    "unlock": [v for v in key.values() if "item" in v][:1] or [{"context": "AlwaysUnlocked"}]}}
        elif kind == "minecraft:crafting_shapeless":
            parts = [ingredient(v) for v in recipe["ingredients"]]
            if all(parts):
                body = {"minecraft:recipe_shapeless": {"description": description, "tags": ["crafting_table"], "ingredients": parts, "result": out,
                                                       "unlock": [v for v in parts if "item" in v][:1] or [{"context": "AlwaysUnlocked"}]}}
        elif kind in ("minecraft:smelting", "minecraft:blasting", "minecraft:smoking", "minecraft:campfire_cooking"):
            source = ingredient(recipe["ingredient"])
            tags = {"minecraft:smelting": ["furnace"], "minecraft:blasting": ["blast_furnace"], "minecraft:smoking": ["smoker"], "minecraft:campfire_cooking": ["campfire", "soul_campfire"]}[kind]
            if source and "item" in source:
                body = {"minecraft:recipe_furnace": {"description": description, "tags": tags, "input": source["item"], "output": out["item"]}}
        elif kind == "minecraft:stonecutting":
            source = ingredient(recipe["ingredient"])
            if source and "item" in source:
                body = {"minecraft:recipe_shapeless": {"description": description, "tags": ["stonecutter"], "ingredients": [source],
                                                       "result": {"item": result_id, "count": recipe.get("count", 1)}, "unlock": [source]}}
        if not body:
            skipped += 1
            raw = json.dumps(recipe.get("key", recipe.get("ingredients", recipe.get("ingredient", {}))))
            for key, ref in re.findall(r'"(item|id|tag)": "([^"]+)"', raw):
                if not ingredient({"tag": ref} if key == "tag" else {"item": ref}): missing[f"ingredient {'#' if key == 'tag' else ''}{ref}"] += 1
            continue
        with open(f"{behaviorPack}/recipes/{name}.json", "w") as file: file.write(json.dumps({"format_version": "1.20.10", **body}, indent=2))
        made += 1
    print(f"Create recipes complete: {made} Cobblemon recipes, {skipped} left out for items the pack does not have.")
    print("  missing: " + ", ".join(f"{k} ({n})" for k, n in missing.most_common(40)))


# ---------------------------------------------------------------------------
# Items. Every Cobblemon item the pack has not made elsewhere, with a flat icon (its layers composited) and a name
# in the lang file, becomes an item: held items, medicine, candies, mints, food, gems, sweets and the rest.
# CobblemonItems.kt says which are held items and what each food restores; data/cobblemon/mechanics has the heal
# amounts. scripts/main.js gives medicine, candies and held items their use on a Pokemon and in battle, from
# scripts/items.js, which this writes.
# ---------------------------------------------------------------------------

kotlinMain = f"{cobblemonRepo}/common/src/main/kotlin/com/cobblemon/mod/common"
FLAT_PARENTS = {"minecraft:item/generated", "item/generated", "minecraft:item/handheld", "item/handheld", "cobblemon:item/handheld_rotated"}
# medicine by item: heal (HP, or "max"), revive (share of max HP), cures status, restores PP (per move, "all" moves)
MEDICINE = {"potion": {"heal": "potionRestoreAmount"}, "super_potion": {"heal": "superPotionRestoreAmount"}, "hyper_potion": {"heal": "hyperPotionRestoreAmount"},
            "max_potion": {"heal": "max"}, "full_restore": {"heal": "max", "cure": True}, "full_heal": {"cure": True},
            "antidote": {"cure": ["psn", "tox"]}, "burn_heal": {"cure": ["brn"]}, "ice_heal": {"cure": ["frz"]}, "paralyze_heal": {"cure": ["par"]}, "awakening": {"cure": ["slp"]},
            "revive": {"revive": 0.5}, "max_revive": {"revive": 1.0}, "revival_herb": {"revive": 1.0},
            "ether": {"pp": 10}, "max_ether": {"pp": 999}, "elixir": {"pp": 10, "all": True}, "max_elixir": {"pp": 999, "all": True},
            "remedy": {"heal": "normal"}, "fine_remedy": {"heal": "fine"}, "superb_remedy": {"heal": "superb"}, "energy_root": {"heal": "root"},
            "heal_powder": {"cure": True}, "berry_juice": {"heal": 20}, "oran_berry": {"heal": 10}, "sitrus_berry": {"heal": "quarter"},
            "lum_berry": {"cure": True}, "cheri_berry": {"cure": ["par"]}, "chesto_berry": {"cure": ["slp"]}, "pecha_berry": {"cure": ["psn", "tox"]},
            "rawst_berry": {"cure": ["brn"]}, "aspear_berry": {"cure": ["frz"]}, "leppa_berry": {"pp": 10}}
CANDIES = {"exp_candy_xs": 100, "exp_candy_s": 800, "exp_candy_m": 3000, "exp_candy_l": 10000, "exp_candy_xl": 30000, "rare_candy": "level"}


def item_registry():
    """{item name: {"factory", "food": [nutrition, saturation], "stack"}} from CobblemonItems.kt."""
    path = f"{kotlinMain}/CobblemonItems.kt"
    if not os.path.exists(path): return {}
    with open(path, encoding="utf-8") as file: text = file.read()
    registry = {}
    for statement in re.split(r"\n    (?=val |private fun |fun |@JvmField)", text):
        match = re.match(r"val \w+\s*(?::[^=]+)?=\s*(\w+)\(\s*\"([a-z0-9_]+)\"", statement)
        if not match: continue
        factory, name = match.groups()
        entry = {"factory": factory}
        nutrition = re.search(r"nutrition\((\d+)\)", statement); saturation = re.search(r"saturationModifier\(([\d.]+)[fF]?\)", statement)
        regional = re.match(r"val \w+\s*(?::[^=]+)?=\s*regionalFoodItem\(\s*\"[a-z0-9_]+\",\s*(\d+),\s*(\d+),\s*([\d.]+)[fF]?", statement)
        food_item = re.search(r"foodItem\((\d+),\s*([\d.]+)[fF]?\)", statement)
        if regional: entry["stack"] = int(regional.group(1)); entry["food"] = [int(regional.group(2)), float(regional.group(3))]
        elif nutrition and saturation: entry["food"] = [int(nutrition.group(1)), float(saturation.group(1))]
        elif food_item: entry["food"] = [int(food_item.group(1)), float(food_item.group(2))]
        stack = re.search(r"stacksTo\((\d+)\)", statement)
        if stack: entry["stack"] = int(stack.group(1))
        registry[name] = entry
    return registry


def flat_icon(name):
    """The item's icon as one image: its model's layers drawn over each other. None for a model that is not flat."""
    path = f"{cobblemon}/models/item/{name}.json"
    if not os.path.exists(path): return None
    with open(path, encoding="utf-8") as file: model = json.load(file)
    if model.get("parent") not in FLAT_PARENTS: return None
    layers = [v for k, v in sorted(model.get("textures", {}).items()) if k.startswith("layer")]
    image = None
    for ref in layers:
        source = f"{cobblemon}/textures/{ref.split(':', 1)[-1]}.png"
        if not os.path.exists(source): return None
        layer = Image.open(source).convert("RGBA")
        if layer.height > layer.width: layer = layer.crop((0, 0, layer.width, layer.width))   # an animated strip: its first frame
        image = layer if image is None else Image.alpha_composite(image.resize(layer.size) if image.size != layer.size else image, layer)
    return image


def create_general_items():
    print("Creating items...")
    registry = item_registry()
    have = defined_items()
    itemTexturePath = f"{resourcePack}/textures/item_texture.json"
    with open(itemTexturePath, encoding="utf-8") as file: itemTextureData = json.load(file)
    os.makedirs(f"{itemsBedrock}/general", exist_ok=True)
    made = []
    for path in sorted(glob.glob(f"{cobblemon}/models/item/*.json")):
        name = os.path.basename(path)[:-len(".json")]
        if f"cobblemon:{name}" in have or f"item.cobblemon.{name}" not in lang: continue
        icon = flat_icon(name)
        if icon is None: continue
        icon.save(f"{texturesItemsBedrock}/{name}.png")
        itemTextureData["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
        info = registry.get(name, {})
        components = {"minecraft:icon": name, "minecraft:display_name": {"value": f"item.cobblemon:{name}.name"},
                      "minecraft:max_stack_size": info.get("stack", 64)}
        if info.get("food"):
            nutrition, saturation = info["food"]
            components["minecraft:food"] = {"nutrition": nutrition, "saturation_modifier": saturation, "can_always_eat": False}
            components["minecraft:use_modifiers"] = {"use_duration": 1.6, "movement_modifier": 0.35}
            components["minecraft:use_animation"] = "eat"
        category = "equipment" if "eldItem" in info.get("factory", "") or name in MEDICINE else "items"
        with open(f"{itemsBedrock}/general/{name}.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.90", "minecraft:item": {
                "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": category}}, "components": components}}, indent=2))
        made.append(name)
    with open(itemTexturePath, "w", encoding="utf-8") as file: file.write(json.dumps(itemTextureData, indent=4))
    # what the script needs: held items, medicine with Cobblemon's amounts, candies
    mechanics = {}
    for f in ("potions", "remedies"):
        with open(f"{cobblemonData}/mechanics/{f}.json", encoding="utf-8") as file: mechanics[f] = json.load(file)
    defined = defined_items()
    medicine = {}
    for name, effect in MEDICINE.items():
        if f"cobblemon:{name}" not in defined: continue
        effect = dict(effect)
        heal = effect.get("heal")
        if heal in mechanics["potions"]: effect["heal"] = int(mechanics["potions"][heal])
        elif heal in mechanics["remedies"]["remedies"]: effect["heal"] = int(mechanics["remedies"]["remedies"][heal]["healingAmount"])
        medicine[f"cobblemon:{name}"] = effect
    held = held_item_ids(defined)
    with open(f"{scriptsBedrock}/items.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: held items (CobblemonItems.kt), medicine with its amounts (mechanics), candies" + chr(10))
        file.write("export const HELD_ITEMS = " + json.dumps(held) + ";" + chr(10))
        file.write("export const HOLD_BLACKLIST = " + json.dumps(sorted(item_tag("held/blacklisted_items_to_hold"))) + ";" + chr(10))
        file.write("export const MEDICINE = " + json.dumps(medicine) + ";" + chr(10))
        evs, mints, ev_berries = ev_items()
        file.write("export const EV_ITEMS = " + json.dumps({k: v for k, v in evs.items() if k in defined}) + ";" + chr(10))
        file.write("export const MINTS = " + json.dumps({k: v for k, v in mints.items() if k in defined}) + ";" + chr(10))
        file.write("export const EV_BERRIES = " + json.dumps({k: v for k, v in ev_berries.items() if k in defined}) + ";" + chr(10))
        file.write("export const CANDIES = " + json.dumps({f"cobblemon:{k}": v for k, v in CANDIES.items() if f"cobblemon:{k}" in defined}) + ";" + chr(10))
        # CobblemonTooltipGenerator: the gray lines under an item's name, its ".tooltip" key then "_1", "_2" and on,
        # shown as the item's lore, wrapped to Bedrock's 50 characters a line (the colour code counts)
        tooltips = {}
        for item in sorted(defined):
            key = f"item.cobblemon.{item.split(':', 1)[1]}.tooltip"
            texts = ([lang[key]] if key in lang else []) + [lang[f"{key}_{i}"] for i in range(1, 20) if f"{key}_{i}" in lang]
            lines = [line for text in texts for line in textwrap.wrap(text, 46)][:20]
            if lines: tooltips[item] = lines
        file.write("export const TOOLTIPS = " + json.dumps(tooltips, ensure_ascii=False) + ";" + chr(10))
    print(f"Create items complete: {len(made)} items, {len(held)} held items, {len(medicine)} medicines.")
    return made


# ---------------------------------------------------------------------------
# Building blocks. Every Cobblemon block whose model is one of the standard shapes, and which the pack has not
# made elsewhere: cubes, columns, cross plants (clusters, flowers), slabs, stairs, walls and fences. Tumblestone
# blocks, bricks and polished stone, the type gem blocks, the evolution stone ores and blocks, apricorn and
# saccharine wood. Each drops what Cobblemon's block loot table gives, or itself.
# ---------------------------------------------------------------------------

def block_model_of(name):
    """(parent, textures) of the first model a Cobblemon block's blockstate uses, with its parents' textures merged."""
    path = f"{cobblemon}/blockstates/{name}.json"
    if not os.path.exists(path): return None, {}
    with open(path, encoding="utf-8") as file: state = json.load(file)
    ref = None
    for v in state.get("variants", {}).values(): ref = (v if isinstance(v, dict) else v[0])["model"]; break
    if ref is None:
        for m in state.get("multipart", []): a = m["apply"]; ref = (a if isinstance(a, dict) else a[0])["model"]; break
    if not ref: return None, {}
    model_path = f"{cobblemon}/models/{ref.split(':', 1)[-1]}.json"
    if not os.path.exists(model_path): return None, {}
    with open(model_path, encoding="utf-8") as file: model = json.load(file)
    textures = dict(model.get("textures", {}))
    parent = model.get("parent", "")
    # a Cobblemon parent (a slab's full variant, a wall's post) lends its textures
    while parent.startswith("cobblemon:"):
        pp = f"{cobblemon}/models/{parent.split(':', 1)[-1]}.json"
        if not os.path.exists(pp): break
        with open(pp, encoding="utf-8") as file: pm = json.load(file)
        textures = {**pm.get("textures", {}), **textures}
        parent = pm.get("parent", "")
    return parent, textures


def block_loot(name):
    """A Bedrock loot table path for the block: Cobblemon's, converted, or the block itself."""
    path = f"{cobblemonData}/loot_table/blocks/{name}.json"
    table = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        table = convert_loot_table(data, defined_items() | {f"cobblemon:{name}"})
        if not table["pools"]: table = None
    if table is None: table = {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{name}"}]}]}
    with open(f"{lootBlocksBedrock}/{name}.json", "w") as file: file.write(json.dumps(table))
    return f"loot_tables/blocks/{name}.json"


# ---------------------------------------------------------------------------
# Wood pieces and joining fences. Fences and walls carry a state per side that the script sets from their
# neighbours, and each side is a bone the state shows. Apricorn and saccharine doors (a two-part block), trapdoors,
# fence gates, buttons and pressure plates, from Cobblemon's textures and vanilla's shapes; buttons and plates give
# a redstone signal while pressed.
# ---------------------------------------------------------------------------

SIDES = ("north", "east", "south", "west")
TURN = {"north": 0, "west": 90, "south": 180, "east": 270}


def cube_uv(origin, size):
    (x, y, z), (w, h, d) = origin, size
    v = max(0, 16 - (y + h))
    return {"north": {"uv": [x + 8, v], "uv_size": [w, h]}, "south": {"uv": [x + 8, v], "uv_size": [w, h]},
            "east": {"uv": [z + 8, v], "uv_size": [d, h]}, "west": {"uv": [z + 8, v], "uv_size": [d, h]},
            "up": {"uv": [x + 8, z + 8], "uv_size": [w, d]}, "down": {"uv": [x + 8, z + 8], "uv_size": [w, d]}}


def write_bone_geometry(identifier, bones):
    """A block geometry of named bones, each a list of (origin, size) boxes in block space, -8..8 across."""
    os.makedirs(blockModelsBedrock, exist_ok=True)
    out = [{"name": name, "pivot": [0, 0, 0], "cubes": [{"origin": o, "size": sz, "uv": cube_uv(o, sz)} for o, sz in boxes]} for name, boxes in bones.items()]
    with open(f"{blockModelsBedrock}/{identifier.split('.', 1)[1]}.geo.json", "w") as file:
        file.write(json.dumps({"format_version": "1.12.0", "minecraft:geometry": [{
            "description": {"identifier": identifier, "texture_width": 16, "texture_height": 16,
                            "visible_bounds_width": 3, "visible_bounds_height": 3, "visible_bounds_offset": [0, 1, 0]},
            "bones": out}]}, indent=1))


def union_box(boxes):
    lo = [min(o[i] for o, sz in boxes) for i in range(3)]
    hi = [max(o[i] + sz[i] for o, sz in boxes) for i in range(3)]
    return {"origin": lo, "size": [hi[i] - lo[i] for i in range(3)]}


def connecting_block(name, texture, wide, base):
    """A fence or wall: a post, and an arm to each side the script finds something to join."""
    if wide:
        post = [([-4, 0, -4], [8, 16, 8])]
        arms = {"north": [([-3, 0, -8], [6, 14, 4])], "east": [([4, 0, -3], [4, 14, 6])], "south": [([-3, 0, 4], [6, 14, 4])], "west": [([-8, 0, -3], [4, 14, 6])]}
    else:
        post = [([-2, 0, -2], [4, 16, 4])]
        arms = {"north": [([-1, 6, -8], [2, 3, 6]), ([-1, 12, -8], [2, 3, 6])], "east": [([2, 6, -1], [6, 3, 2]), ([2, 12, -1], [6, 3, 2])],
                "south": [([-1, 6, 2], [2, 3, 6]), ([-1, 12, 2], [2, 3, 6])], "west": [([-8, 6, -1], [6, 3, 2]), ([-8, 12, -1], [6, 3, 2])]}
    geometry = f"geometry.cobblemon_{'wall' if wide else 'fence'}"
    write_bone_geometry(geometry, {"post": post, **arms})
    permutations = []
    for mask in range(1, 16):
        on = [side for i, side in enumerate(SIDES) if mask & (1 << i)]
        box = union_box(post + [b for side in on for b in arms[side]])
        condition = " && ".join(f"q.block_state('cobblemon:{side}') == {'true' if side in on else 'false'}" for side in SIDES)
        permutations.append({"condition": condition, "components": {"minecraft:collision_box": dict(box, size=[box["size"][0], 16, box["size"][2]]), "minecraft:selection_box": box}})
    post_box = union_box(post)
    with open(f"{blocksBedrock}/{name}.json", "w") as file:
        file.write(json.dumps({"format_version": "1.26.40", "minecraft:block": {
            "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.walls" if wide else "minecraft:itemGroup.name.fence"},
                            "states": {f"cobblemon:{side}": [False, True] for side in SIDES}},
            "components": {"minecraft:geometry": {"identifier": geometry, "bone_visibility": {side: f"q.block_state('cobblemon:{side}')" for side in SIDES}},
                           "minecraft:material_instances": {"*": {"texture": java_texture(texture)}},
                           "minecraft:collision_box": post_box, "minecraft:selection_box": post_box, "minecraft:light_dampening": 0, **base},
            "permutations": permutations}}, indent=2))


def wood_piece(identifier, description, components, permutations):
    name = identifier.split(":", 1)[1]
    with open(f"{blocksBedrock}/{name}.json", "w") as file:
        file.write(json.dumps({"format_version": "1.26.40", "minecraft:block": {"description": {"identifier": identifier, **description},
                                                                                 "components": components, "permutations": permutations}}, indent=2))


def placer_item(name, block):
    """An item that places a block and stands in for its own item, with Cobblemon's flat icon."""
    icon = flat_icon(name)
    if icon is None: return
    icon.save(f"{texturesItemsBedrock}/{name}.png")
    path = f"{resourcePack}/textures/item_texture.json"
    with open(path, encoding="utf-8") as file: data = json.load(file)
    data["texture_data"][name] = {"textures": [f"textures/items/{name}"]}
    with open(path, "w", encoding="utf-8") as file: file.write(json.dumps(data, indent=4))
    os.makedirs(f"{itemsBedrock}/wood", exist_ok=True)
    with open(f"{itemsBedrock}/wood/{name}.json", "w") as file:
        file.write(json.dumps({"format_version": "1.21.90", "minecraft:item": {
            "description": {"identifier": f"cobblemon:{name}", "menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.door"}},
            "components": {"minecraft:icon": name, "minecraft:display_name": {"value": f"tile.cobblemon:{name}.name"},
                           "minecraft:block_placer": {"block": block, "replace_block_item": True}}}}, indent=2))


def create_wood_pieces():
    made = []
    for wood in ("apricorn", "saccharine"):
        planks = java_texture(f"cobblemon:block/wood/{wood}_planks")
        wood_base = lambda n: {"minecraft:destructible_by_mining": {"seconds_to_destroy": 1.5}, "minecraft:loot": block_loot(n),
                               "minecraft:flammable": {"catch_chance_modifier": 5, "destroy_chance_modifier": 20}}
        open_state = {"cobblemon:open": [False, True]}

        # door: part 0 the bottom, part 1 the top; closed it stands on the side toward whoever placed it, open it
        # swings a quarter turn against its hinge
        name = f"{wood}_door"
        write_bone_geometry("geometry.cobblemon_door", {"door": [([-8, 0, -8], [16, 16, 3])]})
        bottom, top = java_texture(f"cobblemon:block/wood/{wood}_door_bottom"), java_texture(f"cobblemon:block/wood/{wood}_door_top")
        perms = []
        for d, r in TURN.items():
            for opened in (False, True):
                perms.append({"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}' && q.block_state('cobblemon:open') == {str(opened).lower()}",
                              "components": {"minecraft:transformation": {"rotation": [0, (r + (90 if opened else 0)) % 360, 0]}}})
        perms.append({"condition": "q.block_state('minecraft:multi_block_part') == 1",
                      "components": {"minecraft:material_instances": {"*": {"texture": top, "render_method": "alpha_test"}}}})
        wood_piece(f"cobblemon:{name}", {"states": open_state, "traits": {
            "minecraft:multi_block": {"enabled_states": ["minecraft:multi_block_part"], "parts": 2, "direction": "up"},
            "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}}},
            {"minecraft:geometry": "geometry.cobblemon_door", "minecraft:material_instances": {"*": {"texture": bottom, "render_method": "alpha_test"}},
             "minecraft:collision_box": {"origin": [-8, 0, -8], "size": [16, 16, 3]}, "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 16, 3]},
             "minecraft:movable": {"movement_type": "popped"}, "minecraft:light_dampening": 0, "cobblemon:door": {}, **wood_base(name)}, perms)
        placer_item(name, f"cobblemon:{name}")
        made.append(name)

        # trapdoor: a slab-thin board in the lower or upper half; open, it stands against its hinge side
        name = f"{wood}_trapdoor"
        write_bone_geometry("geometry.cobblemon_trapdoor", {"low": [([-8, 0, -8], [16, 3, 16])], "high": [([-8, 13, -8], [16, 3, 16])], "open": [([-8, 0, -8], [16, 16, 3])]})
        perms = []
        for d, r in TURN.items():
            for half in ("bottom", "top"):
                for opened in (False, True):
                    box = {"origin": [-8, 0, -8], "size": [16, 16, 3]} if opened else {"origin": [-8, 0 if half == "bottom" else 13, -8], "size": [16, 3, 16]}
                    perms.append({"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}' && q.block_state('minecraft:vertical_half') == '{half}' && q.block_state('cobblemon:open') == {str(opened).lower()}",
                                  "components": {"minecraft:transformation": {"rotation": [0, r, 0]}, "minecraft:collision_box": box, "minecraft:selection_box": box}})
        wood_piece(f"cobblemon:{name}", {"menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.trapdoor"}, "states": open_state, "traits": {
            "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]},
            "minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]}}},
            {"minecraft:geometry": {"identifier": "geometry.cobblemon_trapdoor", "bone_visibility": {
                "low": "!q.block_state('cobblemon:open') && q.block_state('minecraft:vertical_half') == 'bottom'",
                "high": "!q.block_state('cobblemon:open') && q.block_state('minecraft:vertical_half') == 'top'",
                "open": "q.block_state('cobblemon:open')"}},
             "minecraft:material_instances": {"*": {"texture": java_texture(f"cobblemon:block/wood/{wood}_trapdoor"), "render_method": "alpha_test"}},
             "minecraft:light_dampening": 0, "cobblemon:trapdoor": {}, **wood_base(name)}, perms)
        made.append(name)

        # fence gate: two posts and the rails between them, which swing back to the posts when it opens
        name = f"{wood}_fence_gate"
        posts = [([-8, 5, -1], [2, 11, 2]), ([6, 5, -1], [2, 11, 2])]
        rails = [([-6, 6, -1], [12, 3, 2]), ([-6, 12, -1], [12, 3, 2]), ([-2, 9, -1], [4, 3, 2])]
        swung = [([-8, 6, 1], [2, 3, 6]), ([-8, 12, 1], [2, 3, 6]), ([6, 6, 1], [2, 3, 6]), ([6, 12, 1], [2, 3, 6])]
        write_bone_geometry("geometry.cobblemon_fence_gate", {"posts": posts, "shut": rails, "swung": swung})
        perms = [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}' && q.block_state('cobblemon:open') == {str(opened).lower()}",
                  "components": {"minecraft:transformation": {"rotation": [0, r, 0]},
                                 "minecraft:collision_box": False if opened else {"origin": [-8, 0, -2], "size": [16, 16, 4]}}}
                 for d, r in TURN.items() for opened in (False, True)]
        wood_piece(f"cobblemon:{name}", {"menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.fenceGate"}, "states": open_state, "traits": {
            "minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"]}}},
            {"minecraft:geometry": {"identifier": "geometry.cobblemon_fence_gate", "bone_visibility": {"shut": "!q.block_state('cobblemon:open')", "swung": "q.block_state('cobblemon:open')"}},
             "minecraft:material_instances": {"*": {"texture": planks}}, "minecraft:selection_box": {"origin": [-8, 0, -2], "size": [16, 16, 4]},
             "minecraft:light_dampening": 0, "cobblemon:fence_gate": {}, **wood_base(name)}, perms)
        made.append(name)

        # button: on the face it was placed against, pressed for 30 ticks by a click, powering redstone meanwhile
        name = f"{wood}_button"
        write_bone_geometry("geometry.cobblemon_button", {"up": [([-3, 0, -2], [6, 2, 4])], "down": [([-3, 0, -2], [6, 1, 4])]})
        faces = {"up": [0, 0, 0], "down": [180, 0, 0], "north": [-90, 0, 0], "south": [90, 0, 0], "east": [0, 0, 90], "west": [0, 0, -90]}
        perms = [{"condition": f"q.block_state('minecraft:block_face') == '{f}'", "components": {"minecraft:transformation": {"rotation": rot}}} for f, rot in faces.items()]
        # pressed, it powers redstone around it and strongly powers the block it is on, as a vanilla button does
        perms.append({"condition": "q.block_state('cobblemon:powered')", "components": {"minecraft:redstone_producer": {"power": 15, "strongly_powered_face": "down", "transform_relative": True}}})
        wood_piece(f"cobblemon:{name}", {"menu_category": {"category": "items", "group": "minecraft:itemGroup.name.buttons"}, "states": {"cobblemon:powered": [False, True]}, "traits": {
            "minecraft:placement_position": {"enabled_states": ["minecraft:block_face"]}}},
            {"minecraft:geometry": {"identifier": "geometry.cobblemon_button", "bone_visibility": {"up": "!q.block_state('cobblemon:powered')", "down": "q.block_state('cobblemon:powered')"}},
             "minecraft:material_instances": {"*": {"texture": planks}}, "minecraft:collision_box": False,
             "minecraft:selection_box": {"origin": [-3, 0, -2], "size": [6, 2, 4]}, "minecraft:light_dampening": 0,
             "cobblemon:button": {}, "minecraft:redstone_producer": {"power": 0}, **wood_base(name), "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5}}, perms)
        made.append(name)

        # pressure plate: pressed while something stands on it
        name = f"{wood}_pressure_plate"
        write_bone_geometry("geometry.cobblemon_pressure_plate", {"up": [([-7, 0, -7], [14, 1, 14])], "down": [([-7, 0, -7], [14, 0.5, 14])]})
        wood_piece(f"cobblemon:{name}", {"menu_category": {"category": "items", "group": "minecraft:itemGroup.name.pressurePlate"}, "states": {"cobblemon:powered": [False, True]}},
            {"minecraft:geometry": {"identifier": "geometry.cobblemon_pressure_plate", "bone_visibility": {"up": "!q.block_state('cobblemon:powered')", "down": "q.block_state('cobblemon:powered')"}},
             "minecraft:material_instances": {"*": {"texture": planks}}, "minecraft:collision_box": {"origin": [-7, 0, -7], "size": [14, 1, 14]},
             "minecraft:selection_box": {"origin": [-7, 0, -7], "size": [14, 1, 14]}, "minecraft:light_dampening": 0,
             "cobblemon:pressure_plate": {}, "minecraft:tick": {"interval_range": [10, 10], "looping": True}, "minecraft:redstone_producer": {"power": 0}, **wood_base(name), "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5}},
            [{"condition": "q.block_state('cobblemon:powered')", "components": {"minecraft:redstone_producer": {"power": 15, "strongly_powered_face": "down"}}}])
        made.append(name)
    return made


def item_tag(path, seen=None):
    """An item tag's values with the tags it names resolved, as a set of item ids."""
    seen = seen or set()
    file_path = f"{cobblemonData}/tags/item/{path}.json"
    if path in seen or not os.path.exists(file_path): return set()
    seen.add(path)
    with open(file_path, encoding="utf-8") as file: values = json.load(file).get("values", [])
    out = set()
    for v in values:
        v = v if isinstance(v, str) else v.get("id", "")
        if v.startswith("#cobblemon:"): out |= item_tag(v[len("#cobblemon:"):], seen)
        elif not v.startswith("#"): out.add(v)
    return out


def held_item_ids(defined):
    """What a right-click gives a Pokemon to hold: Cobblemon's held/is_held_item tag, the items it shows on the face or
    hat, and every berry; the summary's Give button takes anything else but containers."""
    return sorted((item_tag("held/is_held_item") | item_tag("held/visibility/face") | item_tag("held/visibility/hat")) & defined
                  | {i for i in defined if i.endswith("_berry")})


def item_icon_path(item):
    """The texture path of a pack item's icon, from its minecraft:icon and item_texture.json."""
    name = item.split(":", 1)[1]
    matches = glob.glob(f"{itemsBedrock}/**/{name}.json", recursive=True)
    if not matches: return None
    with open(matches[0], encoding="utf-8") as file: components = json.load(file)["minecraft:item"]["components"]
    icon = components.get("minecraft:icon")
    key = icon if isinstance(icon, str) else (icon or {}).get("texture") or (icon or {}).get("textures", {}).get("default")
    with open(f"{resourcePack}/textures/item_texture.json", encoding="utf-8") as file: data = json.load(file)["texture_data"]
    entry = data.get(key, {}).get("textures")
    return (entry[0] if isinstance(entry, list) else entry) if entry else None


# vanilla items a Pokemon may be given from the summary and is drawn holding, as Cobblemon draws any held item;
# their textures come from Mojang's bedrock-samples texture lists (fetched into the git-ignored java/ folder)
VANILLA_HELD = ["poppy", "dandelion", "blue_orchid", "allium", "azure_bluet", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip",
                "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose", "torchflower", "apple", "golden_apple", "carrot", "golden_carrot",
                "bread", "cookie", "melon_slice", "sweet_berries", "glow_berries", "cooked_beef", "cooked_chicken", "cooked_cod", "cod", "salmon",
                "pumpkin_pie", "honey_bottle", "diamond", "emerald", "gold_ingot", "iron_ingot", "netherite_ingot", "copper_ingot", "amethyst_shard",
                "stick", "bone", "feather", "egg", "string", "slime_ball", "ender_pearl", "blaze_rod", "nether_star", "heart_of_the_sea",
                "nautilus_shell", "totem_of_undying", "name_tag", "lead", "compass", "clock", "book", "paper", "wheat", "sugar_cane", "bamboo",
                "wooden_sword", "stone_sword", "iron_sword", "golden_sword", "diamond_sword", "netherite_sword", "wooden_pickaxe", "iron_pickaxe",
                "diamond_pickaxe", "iron_axe", "diamond_axe", "iron_shovel", "fishing_rod", "bow", "trident", "shears", "stone", "glowstone_dust"]
VANILLA_TEXTURE_NAMES = {"poppy": "flower_rose", "dandelion": "flower_dandelion", "blue_orchid": "flower_blue_orchid", "allium": "flower_allium",
                         "azure_bluet": "flower_houstonia", "red_tulip": "flower_tulip_red", "orange_tulip": "flower_tulip_orange",
                         "white_tulip": "flower_tulip_white", "pink_tulip": "flower_tulip_pink", "oxeye_daisy": "flower_oxeye_daisy",
                         "cornflower": "flower_cornflower", "lily_of_the_valley": "flower_lily_of_the_valley", "wither_rose": "flower_wither_rose",
                         "torchflower": "torchflower", "melon_slice": "melon", "sugar_cane": "reeds", "honey_bottle": "honey_bottle",
                         "fishing_rod": "fishing_rod_uncast", "bow": "bow_standby", "wooden_sword": "wood_sword", "wooden_pickaxe": "wood_pickaxe",
                         "golden_sword": "gold_sword", "golden_apple": "apple_golden", "golden_carrot": "carrot_golden", "cod": "fish_raw",
                         "cooked_cod": "fish_cooked", "salmon": "fish_salmon_raw", "slime_ball": "slimeball", "ender_pearl": "ender_pearl",
                         "heart_of_the_sea": "heartofthesea_closed", "totem_of_undying": "totem", "clock": "clock_item", "compass": "compass_item",
                         "book": "book_normal", "glow_berries": "glow_berries", "stone": "stone"}


def vanilla_texture_paths():
    """Every texture path Mojang's item and terrain texture lists name, by file name."""
    out = {}
    for name in ("item_texture", "terrain_texture"):
        path = os.path.join(pwd, "java", "bedrock-samples", f"{name}.json")
        if not os.path.exists(path):
            try: urllib.request.urlretrieve(f"https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/{name}.json", path)
            except Exception as error: print(f"  no {name}.json: {error}"); continue
        with open(path, encoding="utf-8") as file: text = re.sub(r"//.*", "", file.read())
        for entry in json.loads(text)["texture_data"].values():
            textures = entry.get("textures")
            for t in textures if isinstance(textures, list) else [textures]:
                t = t.get("path") if isinstance(t, dict) else t
                if isinstance(t, str): out.setdefault(t.rsplit("/", 1)[-1], t)
    return out


def vanilla_held_icons():
    """[(item id, texture path)] for the vanilla items a Pokemon is drawn holding."""
    paths, out = vanilla_texture_paths(), []
    for name in VANILLA_HELD:
        words = name.split("_")
        for candidate in (VANILLA_TEXTURE_NAMES.get(name), name, "_".join(reversed(words))):
            if candidate and candidate in paths: out.append((f"minecraft:{name}", paths[candidate])); break
    return out


def create_held_display():
    """Each Pokemon's held item on its model: a second render pass over its held geometry, whose texture is the held
    item's icon, picked by the cobblemon:held_index property the script sets; the quad shown is the face or hat one
    for the items Cobblemon's visibility tags put there, when the model has that locator, and the hand one otherwise."""
    tags = {}
    for kind in ("face", "hat", "hidden"):
        with open(f"{cobblemonData}/tags/item/held/visibility/{kind}.json", encoding="utf-8") as tag:
            tags[kind] = [v for v in json.load(tag).get("values", []) if not v.startswith("#")]
    registry, defined = item_registry(), defined_items()
    held = held_item_ids(defined)
    order = [i for i in held if i not in tags["face"] and i not in tags["hat"]] + [i for i in held if i in tags["face"]] + [i for i in held if i in tags["hat"]]
    order = [i for i in order if i not in tags["hidden"] and item_icon_path(i)]
    vanilla = vanilla_held_icons()
    face_from = 1 + sum(1 for i in order if i not in tags["face"] and i not in tags["hat"])
    hat_from = face_from + sum(1 for i in order if i in tags["face"])
    # the vanilla items go after the hat items, so they are held in the hand
    vanilla_from = 1 + len(order)
    paths = [item_icon_path(i) for i in order] + [t for _, t in vanilla]
    order = order + [i for i, _ in vanilla]
    with open(f"{scriptsBedrock}/held_display.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the index of each held item's icon on the model (0 shows nothing)" + chr(10))
        file.write("export const HELD_INDEX = " + json.dumps({i: n + 1 for n, i in enumerate(order)}) + ";" + chr(10))
        file.write("export const HELD_ICONS = " + json.dumps(paths) + ";" + chr(10))
    made = 0
    for path in glob.glob(f"{entityBedrock}/*.entity.json"):
        pokemon = os.path.basename(path)[:-len(".entity.json")]
        with open(path, encoding="utf-8") as file: entity = json.load(file)
        desc = entity["minecraft:client_entity"]["description"]
        rc_path = f"{renderControllersBedrock}/{pokemon}.render_controllers.json"
        if not os.path.exists(rc_path) or not desc.get("render_controllers"): continue
        # which held geometries exist, and which spots each has
        spots = {}
        for key, geo in desc.get("geometry", {}).items():
            for model in glob.glob(f"{modelsBedrock}/{pokemon}/*.json"):
                with open(model, encoding="utf-8") as file: geos = json.load(file).get("minecraft:geometry", [])
                for g in geos:
                    if g["description"]["identifier"] == geo + ".held": spots[key] = {b["name"] for b in g["bones"] if b["name"].startswith("held_item")}
        if not spots: continue
        with open(rc_path, encoding="utf-8") as file: rc = json.load(file)
        main_name = desc["render_controllers"][0] if isinstance(desc["render_controllers"][0], str) else next(iter(desc["render_controllers"][0]))
        main = rc["render_controllers"].get(main_name)
        if not main: continue
        geo_array = main.get("arrays", {}).get("geometries", {}).get("Array.geo") or [main.get("geometry", "Geometry.default")]
        held_array = []
        for g in geo_array:
            key = g.split(".", 1)[1] if g.startswith("Geometry.") else None
            held_array.append(f"Geometry.{key}_held" if key in spots else f"Geometry.{next(iter(spots))}_held")
        for key in spots: desc["geometry"][f"{key}_held"] = desc["geometry"][key] + ".held"
        for n, tex in enumerate(paths): desc["textures"][f"held_{n + 1}"] = tex
        desc.setdefault("textures", {}).setdefault("blank", "textures/entity/blank")
        desc["materials"]["held"] = "entity_alphatest"
        index = "q.property('cobblemon:held_index')"
        some = next(iter(spots.values()))
        face_here = "held_item_face" in some; hat_here = "held_item_hat" in some
        hand = (f"{index} > 0 && ({index} < {face_from} || {index} >= {vanilla_from}" + ("" if face_here else f" || ({index} >= {face_from} && {index} < {hat_from})")
                + ("" if hat_here else f" || ({index} >= {hat_from} && {index} < {vanilla_from})") + ")")
        visibility = [{"*": False}, {"held_item": hand}]
        if face_here: visibility.append({"held_item_face": f"{index} >= {face_from} && {index} < {hat_from}"})
        if hat_here: visibility.append({"held_item_hat": f"{index} >= {hat_from} && {index} < {vanilla_from}"})
        name = main_name + "_held"
        rc["render_controllers"][name] = {
            "materials": [{"*": "Material.held"}],
            "arrays": {"textures": {"Array.held": ["Texture.blank"] + [f"Texture.held_{n + 1}" for n in range(len(paths))]},
                       "geometries": {"Array.geo": held_array}},
            "geometry": "Array.geo[query.variant]" if len(held_array) > 1 else held_array[0],
            "textures": [f"Array.held[{index}]"],
            "part_visibility": visibility}
        controllers = [c for c in desc["render_controllers"] if (c if isinstance(c, str) else next(iter(c))) != name]
        desc["render_controllers"] = controllers + [{name: f"{index} > 0"}]
        with open(rc_path, "w", encoding="utf-8") as file: file.write(json.dumps(rc, indent=4))
        with open(path, "w", encoding="utf-8") as file: file.write(json.dumps(entity, indent=4))
        made += 1
    print(f"Create held item display complete: {len(order)} item icons on {made} Pokemon.")


# ---------------------------------------------------------------------------
# Model blocks. Every other Cobblemon block with a Java element model: placed medicine, vitamins and held items,
# plaques, gilded chests, teacups, the display case, campfire pots, mints and the rest. Each blockstate variant
# becomes a permutation with its own geometry and the variant's rotation; facing is the placement direction, a
# floor, wall or ceiling face the face placed on, amount grows when the same item is used on the block, age grows
# on random ticks, and open toggles on a click. An item that places its block (Cobblemon's ItemNameBlockItem)
# keeps its identifier and places cobblemon:<name>_block.
# ---------------------------------------------------------------------------

FACE_OF = {"up": "floor", "down": "ceiling"}


def blockstate_variants(name):
    path = f"{cobblemon}/blockstates/{name}.json"
    if not os.path.exists(path): return None
    with open(path, encoding="utf-8") as file: state = json.load(file)
    if "variants" not in state: return None
    out = []
    for key, value in state["variants"].items():
        v = value if isinstance(value, dict) else value[0]
        props = dict(kv.split("=", 1) for kv in key.split(",") if "=" in kv)
        out.append((props, v["model"], v.get("x", 0), v.get("y", 0)))
    return out


def state_value(text):
    return True if text == "true" else False if text == "false" else int(text) if text.isdigit() else text


def model_block(name, identifier, items, category="items"):
    """A block from a Cobblemon blockstate of element models, or False when its models are not elements."""
    variants = blockstate_variants(name)
    if not variants: return False
    props = sorted({k for p, *_ in variants for k in p})
    horizontal = "facing" in props and all(p.get("facing") in ("north", "south", "east", "west") for p, *_ in variants)
    placed_on_face = "face" in props
    custom = [k for k in props if k not in ("facing", "face") or (k == "facing" and not horizontal)]
    states = {}
    for k in custom:
        values = sorted({state_value(p[k]) for p, *_ in variants if k in p}, key=lambda v: (str(type(v)), v))
        if k in ("waterlogged", "powered", "lit", "open", "occupied", "active", "dispensed", "empty"):
            values = sorted(values, key=lambda v: v is not False)
        states[f"cobblemon:{k}"] = values
    geometries, permutations, base = {}, [], None
    for props_v, model_ref, rx, ry in variants:
        model = java_model(model_ref)
        if not model or not model.get("elements"): continue
        if model_ref not in geometries:
            cubes, instances = java_model_cubes(model)
            if not cubes: continue
            gid = f"geometry.cobblemon_{name}_{len(geometries)}"
            write_block_geometry(gid, cubes)
            geometries[model_ref] = (gid, material_instances(instances))
        gid, materials = geometries[model_ref]
        conds = []
        for k, v in props_v.items():
            if k == "facing" and horizontal:
                if placed_on_face and props_v.get("face") == "wall": conds.append(f"q.block_state('minecraft:block_face') == '{v}'")
                else: conds.append(f"q.block_state('minecraft:cardinal_direction') == '{v}'")
            elif k == "face":
                if v == "wall": conds.append("q.block_state('minecraft:block_face') != 'up' && q.block_state('minecraft:block_face') != 'down'")
                else: conds.append(f"q.block_state('minecraft:block_face') == '{'up' if v == 'floor' else 'down'}'")
            else:
                sv = state_value(v)
                conds.append(f"q.block_state('cobblemon:{k}') == {json.dumps(sv) if isinstance(sv, str) else str(sv).lower()}".replace('"', "'"))
        # Java turns a variant clockwise seen from above; Bedrock turns the other way
        components = {"minecraft:geometry": gid, "minecraft:material_instances": materials,
                      "minecraft:transformation": {"rotation": [-rx % 360, -ry % 360, 0]}}
        if "amount" in props_v:
            components["minecraft:loot"] = block_loot_count(name, int(props_v["amount"]), items)
        if base is None: base = components
        permutations.append({"condition": " && ".join(conds) or "1", "components": components})
    if not permutations: return False
    traits = {}
    if horizontal: traits["minecraft:placement_direction"] = {"enabled_states": ["minecraft:cardinal_direction"]}
    if placed_on_face: traits["minecraft:placement_position"] = {"enabled_states": ["minecraft:block_face"]}
    extra = {}
    if "amount" in props: extra["cobblemon:stackable"] = {}
    if "age" in props: extra["cobblemon:grows"] = {}
    if "open" in props: extra["cobblemon:openable"] = {}
    definition = {"format_version": "1.21.90", "minecraft:block": {
        "description": {"identifier": identifier, "menu_category": {"category": category}, "states": states, **({"traits": traits} if traits else {})},
        "components": {**{k: v for k, v in base.items() if k != "minecraft:transformation"},
                       "minecraft:collision_box": {"origin": [-6, 0, -6], "size": [12, 8, 12]}, "minecraft:selection_box": {"origin": [-7, 0, -7], "size": [14, 12, 14]},
                       "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5}, "minecraft:light_dampening": 0,
                       "minecraft:loot": block_loot(name) if "amount" not in props else base["minecraft:loot"], **extra},
        "permutations": [pm for pm in permutations if pm["condition"] != "1"] or permutations}}
    with open(f"{blocksBedrock}/{identifier.split(':', 1)[1]}.json", "w") as file: file.write(json.dumps(definition, indent=2))
    return True


def block_loot_count(name, count, items):
    """A loot table dropping count of the block's item, for a stack of placed items."""
    table = {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{name}", "functions": [{"function": "set_count", "count": count}]}]}]}
    with open(f"{lootBlocksBedrock}/{name}_{count}.json", "w") as file: file.write(json.dumps(table))
    return f"loot_tables/blocks/{name}_{count}.json"


GILDED_COLOURS = ["", "black_", "blue_", "green_", "pink_", "white_", "yellow_"]


def create_gilded_chests():
    """Gilded chests as entities: a Bedrock custom block cannot hold items, so the chest block Cobblemon's item
    places is swapped by the script for an entity drawn with Cobblemon's own block-entity model, texture and lid
    animations (bedrock/block_entities), holding GildedChestBlockEntity's 27 slots. Breaking it drops the chest
    item and what it holds."""
    src = f"{cobblemon}/bedrock/block_entities"
    os.makedirs(f"{resourcePack}/models/entity/gilded_chest", exist_ok=True)
    shutil.copyfile(f"{src}/models/gilded_chest.geo.json", f"{resourcePack}/models/entity/gilded_chest/gilded_chest.geo.json")
    os.makedirs(f"{animationsBedrock}/gilded_chest", exist_ok=True)
    shutil.copyfile(f"{src}/animations/gilded_chest.animation.json", f"{animationsBedrock}/gilded_chest/gilded_chest.animation.json")
    os.makedirs(f"{resourcePack}/textures/entity/gilded_chest", exist_ok=True)
    controller = {"format_version": "1.10.0", "animation_controllers": {"controller.animation.gilded_chest.lid": {"initial_state": "closed", "states": {
        "closed": {"transitions": [{"opening": "q.property('cobblemon:open')"}]},
        "opening": {"animations": ["opening"], "transitions": [{"open": "q.all_animations_finished"}, {"closing": "!q.property('cobblemon:open')"}]},
        "open": {"animations": ["open"], "transitions": [{"closing": "!q.property('cobblemon:open')"}]},
        "closing": {"animations": ["closing"], "transitions": [{"closed": "q.all_animations_finished"}, {"opening": "q.property('cobblemon:open')"}]}}}}}
    with open(f"{animationControllersBedrock}/gilded_chest.animation_controllers.json", "w") as file: file.write(json.dumps(controller, indent=2))
    with open(f"{renderControllersBedrock}/gilded_chest.render_controllers.json", "w") as file:
        file.write(json.dumps({"format_version": "1.10.0", "render_controllers": {"controller.render.gilded_chest": {
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}}}, indent=2))
    made = []
    for colour in GILDED_COLOURS:
        name = f"{colour}gilded_chest"
        texture = f"{cobblemon}/textures/block/functional/{name}.png"
        if not os.path.exists(texture): continue
        shutil.copyfile(texture, f"{resourcePack}/textures/entity/gilded_chest/{name}.png")
        identifier = f"cobblemon:{name}_entity"
        with open(f"{entityBedrock}/{name}_entity.entity.json", "w") as file:
            file.write(json.dumps({"format_version": "1.10.0", "minecraft:client_entity": {"description": {
                "identifier": identifier, "materials": {"default": "entity_alphatest"},
                "textures": {"default": f"textures/entity/gilded_chest/{name}"}, "geometry": {"default": "geometry.gilded_chest"},
                "animations": {"opening": "animation.gilded_chest.opening", "open": "animation.gilded_chest.open", "closing": "animation.gilded_chest.closing",
                               "lid": "controller.animation.gilded_chest.lid"},
                "scripts": {"animate": ["lid"]}, "render_controllers": ["controller.render.gilded_chest"]}}}, indent=2))
        loot = f"{behaviorPack}/loot_tables/entities/{name}_entity.json"
        os.makedirs(os.path.dirname(loot), exist_ok=True)
        with open(loot, "w") as file: file.write(json.dumps({"pools": [{"rolls": 1, "entries": [{"type": "item", "name": f"cobblemon:{name}"}]}]}))
        with open(f"{behaviorPack}/entities/{name}_entity.json", "w") as file:
            file.write(json.dumps({"format_version": "1.21.50", "minecraft:entity": {
                "description": {"identifier": identifier, "is_spawnable": False, "is_summonable": True, "is_experimental": False,
                                "properties": {"cobblemon:open": {"type": "bool", "default": False, "client_sync": True}}},
                "components": {
                    "minecraft:type_family": {"family": ["inanimate", "gilded_chest"]},
                    "minecraft:inventory": {"container_type": "container", "inventory_size": 27},
                    "minecraft:collision_box": {"width": 0.9, "height": 0.9},
                    "minecraft:health": {"value": 1, "max": 1},
                    # only a player breaks it, and it takes a hit, not fire or falling
                    "minecraft:damage_sensor": {"triggers": [{"on_damage": {"filters": {"test": "is_family", "subject": "other", "value": "player"}}, "deals_damage": "yes"},
                                                             {"cause": "all", "deals_damage": "no"}]},
                    "minecraft:loot": {"table": f"loot_tables/entities/{name}_entity.json"},
                    "minecraft:knockback_resistance": {"value": 1.0}, "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                    "minecraft:physics": {}, "minecraft:persistent": {}, "minecraft:nameable": {}, "minecraft:movement": {"value": 0}}}}, indent=2))
        made.append(name)
    return made


# ---------------------------------------------------------------------------
# Battle screen. Cobblemon draws its battle overlay in code (BattleOverlay, BattleGeneralActionSelection,
# BattleMoveSelection) on the textures in textures/gui/battle; here the same textures and positions are a JSON UI
# layout for the battle's server forms. main.js titles a battle form "cbm:battle_menu" or "cbm:battle_moves" and packs
# both Pokemon's name, level, health and status into its body as fixed-width fields, which the layout slices out.
# ---------------------------------------------------------------------------

guiMain = f"{cobblemon}/textures/gui"
uiTextures = f"{resourcePack}/textures/ui/cobblemon"
# ElementalTypes.kt: each type's hue, and its column in types.png and types_small.png
TYPE_HUES = [("normal", 0xE8E8DA), ("fire", 0xFF6E21), ("water", 0x3FA5FF), ("grass", 0x62D14F), ("electric", 0xFFD314), ("ice", 0x54F2F2),
             ("fighting", 0xEF565D), ("poison", 0xD651FF), ("ground", 0xF4A453), ("flying", 0xB8B2FF), ("psychic", 0xFF5E9E), ("bug", 0xD3D319),
             ("rock", 0xB7A16E), ("ghost", 0x9C80F7), ("dragon", 0x7580FF), ("dark", 0x587DA0), ("steel", 0xABD1F4), ("fairy", 0xFF7FE5)]
# the body's fields, [start, end) in characters: a "~" then, for the ally and then the foe, name, level, health in
# 2% steps (00 to 50), health text and status
# (a field of digits alone is read as a number, which a label will not show, so the level carries its "Lv." and the
# health step an "h")
# The health texts ("45/45", "100%") start with a colour code instead, and sit at the end of the body, so the colour
# code's second byte cannot shift any other field.
BATTLE_FIELDS = {"name": (1, 15), "level": (15, 21), "hp": (21, 24), "status": (24, 27), "icon": (27, 32), "gender": (32, 33), "owned": (33, 34)}
BATTLE_SIDE = 33
BATTLE_HPTEXT = 1 + 2 * BATTLE_SIDE   # the ally's, 12 characters, then the foe's, 9
BATTLE_LOG = BATTLE_HPTEXT + 12 + 9
# BattleSwitchPokemonSelection's tiles: each button's text carries its Pokemon as fixed-width fields
SWITCH_FIELDS = {"name": (0, 12), "level": (12, 18), "hp": (18, 21), "status": (21, 24), "icon": (24, 29), "ball": (29, 32)}
SWITCH_HPTEXT = 32   # the health as a number runs from here to the end   # the battle log's last lines run from here to the end


def depletable_red_green(ratio):
    """RenderHelper.getDepletableRedGreen: the health bar's red and green for a share of health."""
    r = -2 * ratio + 2 if ratio > 0.2 else 1.0
    g = 1.0 if ratio > 0.5 else ratio / 0.5 if ratio > 0.2 else 0.0
    return r, g


# The Summary, after client/gui/summary: the 331 by 161 base with the portrait window, level, name, ball, gender and
# types on the left; the Info, Moves and Stats tabs in the middle on their own panels; the party on the right, each
# slot a button that opens that Pokemon's summary. main.js fills the body field by field in this order, each field
# padded to its width in bytes (JSON UI's '%.Ns' counts bytes), and numbers carry a leading colour code so they are
# never read as numbers. The last field, the held item's icon, runs to the end.
SUMMARY_LAYOUT = [("tab", 1), ("level", 6), ("name", 16), ("gender", 1), ("ball", 3), ("type1", 3), ("type2", 3), ("status", 3),
                  ("dex", 7), ("species", 16), ("types", 20), ("ot", 16), ("nature", 18), ("ability", 20), ("exp", 12), ("tonext", 12), ("expbar", 3),
                  ("friendship", 6)] \
    + [(f"m{n}{k}", w) for n in range(4) for k, w in (("name", 16), ("type", 3), ("pp", 9), ("sel", 1))] \
    + [("mpower", 8), ("macc", 8), ("meff", 8), ("mdesc", 160)] \
    + [(f"s{k}{v}", w) for k in ("hp", "atk", "def", "spa", "spd", "spe") for v, w in (("val", 6), ("iv", 5), ("ev", 6), ("mark", 1))] \
    + [(f"p{n}{k}", w) for n in range(6) for k, w in (("name", 12), ("level", 7), ("hp", 3), ("gender", 1), ("state", 1), ("icon", 5))] \
    + [("desc", 120), ("evolve", 6), ("portrait", 5), ("side", 1)]     + [(f"e{n}{k}", w) for n in range(3) for k, w in (("slot", 1), ("name", 12), ("type1", 3), ("type2", 3), ("icon", 5))]     + [("ksel", 3), ("ktitle", 48), ("kdesc", 120)] + [(f"k{i}", 3) for i in range(30)] \
    + [("stab", 1), ("hex", 7)] + [(f"ln{i}", 12) for i in range(6)] + [(f"lv{i}", 12) for i in range(6)] + [(f"hm{i}", 1) for i in range(6)] \
    + [("item", 0)]
SWAP_SLOTS = 20   # MoveSwapScreen's list: the moves it can relearn, and Forget
STAT_ROWS = [("hp", "HP"), ("atk", "Attack"), ("def", "Defence"), ("spa", "Sp. Atk"), ("spd", "Sp. Def"), ("spe", "Speed")]


def summary_offsets():
    out, at = {}, 0
    for name, width in SUMMARY_LAYOUT: out[name] = (at, at + width); at += width
    return out


HEX_STEPS = 12   # the polygon's vertices go out in 12 steps of the radius, the least 5 of its 48 as drawStatPolygon keeps it


def stat_wedges(folder):
    """drawStatPolygon's triangles, one for each pair of neighbouring vertices at each pair of steps (letters a to m),
    white at 60 percent for the layout to tint: centre 67, 70 of StatWidget, radius 48, the first vertex at the top."""
    import math
    os.makedirs(folder, exist_ok=True)
    k, size = 2, 96   # drawn at twice the size, into the 96 by 96 box the layout places at 19, 22
    for i in range(6):
        a0, a1 = math.radians(-90 + 60 * i), math.radians(-90 + 60 * (i + 1))
        for s0 in range(HEX_STEPS + 1):
            for s1 in range(HEX_STEPS + 1):
                r0, r1 = (max(st / HEX_STEPS, 5 / 48) * 48 for st in (s0, s1))
                cx = cy = size / 2
                pts = [(cx * k, cy * k), ((cx + r0 * math.cos(a0)) * k, (cy + r0 * math.sin(a0)) * k), ((cx + r1 * math.cos(a1)) * k, (cy + r1 * math.sin(a1)) * k)]
                img = Image.new("RGBA", (size * k, size * k), (0, 0, 0, 0))
                ImageDraw.Draw(img).polygon(pts, fill=(255, 255, 255, 153))
                img.save(f"{folder}/w{i}_{chr(97 + s0)}{chr(97 + s1)}.png", optimize=True)


def cobblemon_marks():
    """Cobblemon's marks (data/cobblemon/marks): each one's code (its place in the list in two base-36 digits, since
    many share an indexNumber or have none), its sort order (the indexNumber), name, title
    with the Pokemon's name in it, title colour, description, chance group, chance and the aspects that give it."""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = []
    for k, path in enumerate(sorted(glob.glob(f"{cobblemonData}/marks/*.json"))):
        with open(path, encoding="utf-8") as file: mark = json.load(file)
        key = os.path.basename(path)[:-5]
        n = int(mark.get("indexNumber", 999))
        title = lang.get(mark.get("title", ""), "")
        out.append({"id": f"cobblemon:{key}", "code": "k" + digits[k // 36] + digits[k % 36], "index": n,
                    "name": lang.get(mark["name"], key), "title": title.replace("%1$s", "{}"), "colour": mark.get("titleColor", "FFFFFF"),
                    "desc": lang.get(mark.get("description", ""), ""), "group": mark.get("group"), "chance": mark.get("chance", 0),
                    "texture": mark.get("texture", "")})
    return out


def create_summary_ui():
    S = f"{uiTextures}/summary"
    os.makedirs(S, exist_ok=True)
    src = f"{guiMain}/summary"
    for name in ("summary_base", "summary_info_base", "summary_moves_base", "summary_stats_other_base", "portrait_background",
                 "summary_party_background", "type_spacer", "type_spacer_double", "summary_stats_icon_increase", "summary_stats_icon_decrease"):
        shutil.copyfile(f"{src}/{name}.png", f"{S}/{name.replace('summary_', '')}.png")
    blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    for name in ("blank", "stat_n", "t--", "x--", "sel_n", "b--"): blank.save(f"{S}/{name}.png")
    shutil.copyfile(f"{src}/summary_move_selected_overlay.png", f"{S}/sel_y.png")
    for key in ("power", "accuracy", "effect"):
        shutil.copyfile(f"{src}/summary_moves_icon_{key}.png", f"{S}/icon_{key[:3] if key != 'power' else key}.png")
    shutil.copyfile(f"{S}/stats_icon_increase.png", f"{S}/stat_u.png"); shutil.copyfile(f"{S}/stats_icon_decrease.png", f"{S}/stat_d.png")
    for name in ("summary_stats_chart", "summary_stats_chart_base"): shutil.copyfile(f"{src}/{name}.png", f"{S}/{name.replace('summary_', '')}.png")
    marker = Image.open(f"{src}/summary_stats_tab_marker.png").convert("RGBA")
    for i, letter in enumerate("sveo"):
        for page in "sveo": (marker if page == letter else blank).save(f"{S}/smark{i}_{page}.png")
    stat_wedges(f"{S}/hex")
    # MarksWidget: the base, the 16 by 16 slot (a hover frame below) and every mark's icon, named by marks_code
    shutil.copyfile(f"{src}/summary_marks_base.png", f"{S}/marks_base.png")
    slot = Image.open(f"{src}/summary_mark_slot.png").convert("RGBA")
    slot.crop((0, 0, 16, 16)).save(f"{S}/mkslot.png"); slot.crop((0, 16, 16, 32)).save(f"{S}/mkslot_hover.png")
    for mark in cobblemon_marks():
        path = f"{cobblemon}/textures/gui/mark/{mark['texture'].split('/')[-1]}"
        if os.path.exists(path): shutil.copyfile(path, f"{S}/mk_{mark['code']}.png")
    blank.save(f"{S}/mk_kzz.png")   # codes carry a letter first, so "12" is never read as a number
    def two(image):   # a texture with a normal frame over a hover frame
        return image.crop((0, 0, image.width, image.height // 2)), image.crop((0, image.height // 2, image.width, image.height))
    # tabs: the tab with its icon drawn at half size, at twice the resolution so the icon keeps its pixels
    tab = Image.open(f"{src}/summary_tab.png").convert("RGBA")
    for name in ("info", "moves", "stats", "marks"):
        icon = Image.open(f"{src}/summary_tab_icon_{name}.png").convert("RGBA")
        for state, lift in (("", 0), ("_hover", 40), ("_on", 70), ("_on_hover", 70)):
            big = tab.resize((78, 26), Image.NEAREST)
            if lift: big = Image.merge("RGBA", [c.point(lambda v, l=lift: min(255, v + l)) for c in big.split()[:3]] + [big.split()[3]])
            big.alpha_composite(icon, (31, 7))
            big.save(f"{S}/tab_{name}{state}.png")
    for state, name in (("n", "summary_party_slot"), ("x", "summary_party_slot_fainted"), ("e", "summary_party_slot_empty")):
        normal, hover = two(Image.open(f"{src}/{name}.png").convert("RGBA"))
        normal.save(f"{S}/pslot_{state}.png"); hover.save(f"{S}/pslot_{state}_hover.png")
    normal, hover = two(Image.open(f"{guiMain}/common/back_button.png").convert("RGBA"))
    icon = Image.open(f"{guiMain}/common/back_button_icon.png").convert("RGBA").resize((10, 5))
    for frame, name in ((normal, "exit"), (hover, "exit_hover")):
        frame = frame.copy(); frame.alpha_composite(icon, (8, 4)); frame.save(f"{S}/{name}.png")
    Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(f"{S}/item.png"); Image.new("RGBA", (16, 16), (255, 255, 255, 70)).save(f"{S}/item_hover.png")
    Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(f"{S}/none.png"); Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(f"{S}/none_hover.png")
    Image.new("RGBA", (16, 16), (255, 255, 255, 50)).save(f"{S}/name_hover.png"); Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(f"{S}/name.png")
    normal, hover = two(Image.open(f"{src}/summary_evolve_button.png").convert("RGBA")); normal.save(f"{S}/evolve.png"); hover.save(f"{S}/evolve_hover.png")
    # MarkingButton: each marking's 12 by 12 frames, its three states down and the hover across
    for i in range(6):
        sheet = Image.open(f"{src}/icon_marking_{i}.png").convert("RGBA")
        for state in range(3):
            sheet.crop((0, state * 12, 12, state * 12 + 12)).save(f"{S}/mark{i}_{state}.png")
            sheet.crop((12, state * 12, 24, state * 12 + 12)).save(f"{S}/mark{i}_{state}_hover.png")
        blank.save(f"{S}/mark{i}_n.png")
    # EvolutionSelectScreen: the scroll list's background and overlay, the slot and its Evolve button
    normal, hover = two(Image.open(f"{src}/summary_evolve_select_button.png").convert("RGBA")); normal.save(f"{S}/evsel.png"); hover.save(f"{S}/evsel_hover.png")
    for name, out in (("summary_scroll_background", "scroll_bg"), ("summary_scroll_overlay", "scroll_overlay"), ("summary_evolve_slot", "evslot_y")):
        shutil.copyfile(f"{src}/{name}.png", f"{S}/{out}.png")
    blank.save(f"{S}/evslot_n.png")
    for d in ("up", "down"):
        normal, hover = two(Image.open(f"{src}/summary_move_reorder_{d}.png").convert("RGBA")); normal.save(f"{S}/{d}.png"); hover.save(f"{S}/{d}_hover.png")
    # move tiles tinted by type, as the battle's are; the party health bar in 38 steps; the experience bar in 55
    move = Image.open(f"{src}/summary_move.png").convert("RGBA").crop((0, 0, 108, 22))
    overlay = Image.open(f"{src}/summary_move_overlay.png").convert("RGBA")
    for n, (type_name, hue) in enumerate(TYPE_HUES):
        rgb = ((hue >> 16) & 255, (hue >> 8) & 255, hue & 255)
        tinted = Image.new("RGBA", move.size); px, out = move.load(), tinted.load()
        for x in range(move.width):
            for y in range(move.height):
                r, g, b, a = px[x, y]; out[x, y] = (r * rgb[0] // 255, g * rgb[1] // 255, b * rgb[2] // 255, a)
        tinted.alpha_composite(overlay.crop((0, 0, 108, 22)))
        tinted.save(f"{S}/move_t{n:02d}.png")
        shutil.copyfile(f"{uiTextures}/types/{type_name}.png", f"{S}/t{n:02d}.png")
    blank.save(f"{S}/move_t--.png")
    # MoveSwapScreen: the condensed move slot (91 by 18, a hover frame below) tinted by type under its overlay; the
    # Forget slot on its empty frame with its icon; SwapMoveButton's swap and add buttons
    condensed = Image.open(f"{src}/summary_move_condensed.png").convert("RGBA")
    cover = Image.open(f"{src}/summary_move_overlay_condensed.png").convert("RGBA")
    for n, (type_name, hue) in enumerate(TYPE_HUES):
        rgb = ((hue >> 16) & 255, (hue >> 8) & 255, hue & 255)
        for state, top in (("", 0), ("_hover", 18)):
            frame = condensed.crop((0, top, 91, top + 18)); tinted = Image.new("RGBA", frame.size); px, out = frame.load(), tinted.load()
            for x in range(frame.width):
                for y in range(frame.height):
                    r, g, b, a = px[x, y]; out[x, y] = (r * rgb[0] // 255, g * rgb[1] // 255, b * rgb[2] // 255, a)
            tinted.alpha_composite(cover)
            tinted.save(f"{S}/swap_t{n:02d}{state}.png")
    empty = Image.open(f"{src}/summary_move_condensed_empty.png").convert("RGBA")
    icon = Image.open(f"{src}/summary_move_condensed_empty_icon.png").convert("RGBA")
    for state, top in (("", 0), ("_hover", 18)):
        frame = empty.crop((0, top, 100, top + 18)); frame.alpha_composite(icon.crop((0, top // 18 * 14, 14, top // 18 * 14 + 14)), (100 // 2 - 7 + 9 - 9, 18 // 2 - 4 - 3))
        frame.save(f"{S}/swap_forget{state}.png")
    for name in ("swap", "add"):
        normal, hover = two(Image.open(f"{src}/summary_move_{name}.png").convert("RGBA")); normal.save(f"{S}/mv{name}.png"); hover.save(f"{S}/mv{name}_hover.png")
    for step in range(38):
        r, g = depletable_red_green(step / 37)
        bar = Image.new("RGBA", (37, 1), (0, 0, 0, 0))
        for x in range(step): bar.putpixel((x, 0), (round(r * 0.8 * 255), round(g * 0.8 * 255), 69, 255))
        bar.save(f"{S}/q{step:02d}.png")
    for step in range(56):
        bar = Image.new("RGBA", (55, 1), (0, 0, 0, 0))
        for x in range(step): bar.putpixel((x, 0), (51, 166, 214, 255))
        bar.save(f"{S}/x{step:02d}.png")
    for n, info in enumerate(poke_balls()):
        icon = f"{texturesItemsBedrock}/{info['name']}.png"
        if os.path.exists(icon): shutil.copyfile(icon, f"{S}/b{n:02d}.png")
    for g, name in (("m", "party_gender_male"), ("f", "party_gender_female")): shutil.copyfile(f"{guiMain}/party/{name}.png", f"{S}/g{g}.png")
    blank.save(f"{S}/go.png")
    for status in ("brn", "par", "psn", "tox", "slp", "frz", "fnt"):
        Image.open(f"{guiMain}/battle/battle_status_{status}.png").crop((35, 0, 74, 7)).save(f"{S}/st{status}.png")
    blank.save(f"{S}/stnon.png")   # no status

    T = "textures/ui/cobblemon/summary"
    offsets = summary_offsets()
    def field(name):
        a, b = offsets[name]
        if name == "item": return f"(#form_text - ('%.{a}s' * #form_text))"
        return f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def bound(source, target):
        return [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": source, "target_property_name": target}]
    def label(name, source, offset, scale=1.0, size=(100, 10), align="left", color=(1, 1, 1), shadow=True, layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": shadow, "color": list(color), "text": "#value",
                       "bindings": bound(source, "#value")}}
    def fixed(name, text, offset, scale=1.0, size=(100, 10), align="left", layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": True, "text": text}}
    def image(name, texture, offset, size, layer=3):
        return {name: {"type": "image", "texture": f"{T}/{texture}", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": False,
                       "anchor_from": "top_left", "anchor_to": "top_left"}}
    def picture(name, source, offset, size, layer=4, prefix=""):
        # one literal and one field: a concatenation inside another one does not resolve
        return {name: {"type": "image", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": False,
                       "anchor_from": "top_left", "anchor_to": "top_left", "bindings": bound(f"('{T}/{prefix}' + {source})", "#texture")}}
    def tab_panel(name, tab, base, controls):
        return {name: {"type": "panel", "size": [134, 148], "offset": [77, 12], "anchor_from": "top_left", "anchor_to": "top_left",
                       "bindings": bound(f"({field('tab')} = '{tab}')", "#visible"),
                       "controls": [image("base", base, (0, 0), (134, 148), 2)] + controls}}
    # Info: InfoOneLineWidget rows of 15, the label at 8 and the value at 53, 6 down within the row
    rows = [("Pokedex No.", "dex"), ("Species", "species"), ("Type", "types"), ("OT", "ot"), ("Nature", "nature"), ("Ability", "ability")]
    info = []
    for n, (text, key) in enumerate(rows):
        info += [fixed(f"l{n}", text, (8, n * 15 + 5.5), 0.62), label(f"v{n}", field(key), (53, n * 15 + 5.5), 0.62, size=(80, 10))]
    info += [label("desc", field("desc"), (8, 94.5), 0.5, size=(118, 24), shadow=False),
             fixed("exp_l", "Exp. Points", (72.5, 125), 0.5), label("exp", field("exp"), (72.5, 125), 0.5, size=(54.5, 5), align="right"),
             fixed("next_l", "To Next Lv.", (72.5, 137), 0.5), label("next", field("tonext"), (72.5, 137), 0.5, size=(54.5, 5), align="right"),
             picture("expbar", field("expbar"), (72, 131), (55, 1)),
             fixed("friend_l", "Friendship", (8, 125), 0.5), label("friend", field("friendship"), (8, 137), 0.5)]
    # Moves: MoveSlotWidget tiles of 108 by 22, 13 in and 25 apart, the type icon at 2, the name at 28, the PP at 93
    moves = []
    for n in range(4):
        y = 6 + 25 * n
        moves += [picture(f"tile{n}", field(f"m{n}type"), (13, y), (108, 22), 3, "move_"),
                  picture(f"type{n}", field(f"m{n}type"), (15, y + 2), (18, 18), 4),
                  label(f"name{n}", field(f"m{n}name"), (41, y + 3), 0.75, size=(80, 10)),
                  label(f"pp{n}", field(f"m{n}pp"), (13 + 60, y + 13), 0.5, size=(45, 5), align="right")]
    for n, (key, text) in enumerate((("power", "Power"), ("acc", "Accuracy"), ("eff", "Effect"))):
        y = 115 + 11 * n
        moves += [image(f"icon_{key}", f"icon_{key}", (7, y - 0.5), (5, 5), 4), fixed(f"label_{key}", text, (14, y), 0.5),
                  label(f"value_{key}", field(f"m{key}" if key != "power" else "mpower"), (14, y), 0.5, size=(48.5, 5), align="right")]
    moves += [label("move_desc", field("mdesc"), (70, 115), 0.5, size=(60, 30), shadow=False)]
    for n in range(4):
        moves.append(picture(f"sel{n}", field(f"m{n}sel"), (12, 5 + 25 * n), (110, 24), 5, "sel_"))
    # Stats: one row a stat, its value, then IV and EV, with the nature's arrow
    # StatWidget: the chart (83 by 96 at 25.5, 22) and the stat polygon over it, drawn from six wedges (one a pair of
    # neighbouring vertices, pre-rendered at each pair of 13 steps and tinted by the page); each vertex's label and value
    # at hexagonVerticesOffset, the nature's arrows, then the Stat, IVs, EVs and Other tabs along the bottom
    stats = [image("chart", "stats_chart", (25.5, 22), (83, 96), 3)]
    for page, colour in (("s", (50 / 255, 215 / 255, 1.0)), ("v", (216 / 255, 100 / 255, 1.0)), ("e", (1.0, 1.0, 100 / 255))):
        wedges = []
        for i in range(6):
            src_field = f"(('%.{offsets['hex'][0] + i + 2}s' * #form_text) - ('%.{offsets['hex'][0] + i}s' * #form_text))"
            wedges.append({f"w{page}{i}": {"type": "image", "offset": [19, 22], "size": [96, 96], "layer": 4, "keep_ratio": False, "color": list(colour),
                                           "anchor_from": "top_left", "anchor_to": "top_left", "bindings": bound(f"('{T}/hex/w{i}_' + {src_field})", "#texture")}})
        stats.append({f"poly_{page}": {"type": "panel", "size": [134, 148], "anchor_from": "top_left", "anchor_to": "top_left",
                                       "bindings": bound(f"({field('stab')} = '{page}')", "#visible"), "controls": wedges}})
    vertex = []
    for i, (vx, vy) in enumerate(((67, 10.5), (122, 42.5), (122, 93.5), (67, 124.5), (12, 93.5), (12, 42.5))):
        vertex += [label(f"hl{i}", field(f"ln{i}"), (vx - 20, vy), 0.5, size=(40, 5), align="center", layer=6),
                   label(f"hv{i}", field(f"lv{i}"), (vx - 20, vy + 5.5), 0.5, size=(40, 5), align="center", layer=6)]
    # the nature's arrows beside the stat it raises and lowers (renderModifiedStatIcon), in the vertices' order
    for i, (mx, my) in enumerate(((65, 6), (120, 38), (120, 89), (65, 120), (10, 89), (10, 38))):
        vertex.append(picture(f"hm{i}", field(f"hm{i}"), (mx, my), (4, 3), 6, "stat_"))
    # a copy for each polygon page: a "not" in this binding never hid it on the Other page
    for page in "sve":
        stats.append({f"vertices_{page}": {"type": "panel", "size": [134, 148], "anchor_from": "top_left", "anchor_to": "top_left",
                                           "bindings": bound(f"({field('stab')} = '{page}')", "#visible"),
                                           "controls": [{f"{next(iter(c))}_{page}": next(iter(c.values()))} for c in vertex]}})
    for i, name in enumerate(("Stat", "IVs", "EVs", "Other")):
        stats.append(fixed(f"stab{i}", name, (31 + 24 * i - 12, 143), 0.5, size=(24, 5), align="center"))
        stats.append(picture(f"smark{i}", field("stab"), (31 + 24 * i - 2, 140), (4, 2), 6, f"smark{i}_"))
    # the Other page: friendship, as StatWidget's other bars show it
    stats.append({"other": {"type": "panel", "size": [134, 148], "anchor_from": "top_left", "anchor_to": "top_left",
                            "bindings": bound(f"({field('stab')} = 'o')", "#visible"), "controls": [
        image("other_base", "stats_other_base", (0, 0), (134, 148), 3),
        fixed("friend_l", "Friendship", (20, 20), 0.5, size=(60, 5)),
        label("friend_v", field("friendship"), (90, 20), 0.5, size=(30, 5), align="right")]}})
    # MarksWidget: the chosen mark's icon at 12, 12 with its description beside it, the title (or the name) centred at 38,
    # then MarksScrollingWidget's rows of six 16 by 16 slots from 9, 45, 20 apart and 19 down; a slot is a button
    marks = [image("marks_base", "marks_base", (0, 0), (134, 148), 2),
             picture("ksel", field("ksel"), (12, 12), (16, 16), 4, "mk_"),
             label("kdesc", field("kdesc"), (38, 11), 0.5, size=(85, 24), shadow=True),
             label("ktitle", field("ktitle"), (0, 38), 0.5, size=(134, 5), align="center")]
    for i in range(30):
        x, y = 9 + 20 * (i % 6), 45 + 3 + 19 * (i // 6)
        marks += [image(f"kslot{i}", "mkslot", (x, y), (16, 16), 3), picture(f"k{i}", field(f"k{i}"), (x, y), (16, 16), 4, "mk_")]
    # the party, PartyWidget's slots: two columns 51 apart, rows 32 apart, the right column 8 lower
    party = [image("party_base", "party_background", (216, 24), (114, 113), 2)]
    for n in range(6):
        x, y = 216 + 6 + (51 if n % 2 else 0), 24 + 7 + 32 * (n // 2) + (8 if n % 2 else 0)
        party += [{f"pmodel{n}": {"type": "image", "offset": [x + 2, y - 1], "size": [22, 22], "layer": 8, "keep_ratio": True, "anchor_from": "top_left",
                                 "anchor_to": "top_left", "bindings": bound(f"('textures/ui/cobblemon/icons/' + {field(f'p{n}icon')})", "#texture")}},
                  label(f"pname{n}", field(f"p{n}name"), (x + 4, y + 20), 0.5, size=(40, 5), shadow=False, layer=8),
                  label(f"plevel{n}", field(f"p{n}level"), (x + 21, y + 13), 0.5, size=(20, 5), align="center", layer=8),
                  picture(f"php{n}", field(f"p{n}hp"), (x + 4, y + 25), (37, 1), 8),
                  picture(f"pgender{n}", field(f"p{n}gender"), (x + 40, y + 20), (2.5, 3.5), 8, "g")]
    # the buttons, each at its place by its index among the form's buttons
    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}]}
    def button(index, offset, size):
        return {f"button_{index}": {"type": "button", "size": list(size), "offset": list(offset), "anchor_from": "top_left", "anchor_to": "top_left",
                                    "collection_index": index, "layer": 5,
                                    "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                    "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                        {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                    "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                                    "controls": [{"default": face("")}, {"hover": face("_hover")}, {"pressed": face("_hover")}]}}
    buttons = [button(0, (78, -1), (39, 13)), button(1, (109, -1), (39, 13)), button(2, (140, -1), (39, 13))]
    for n in range(6):
        buttons.append(button(3 + n, (216 + 6 + (51 if n % 2 else 0), 24 + 7 + 32 * (n // 2) + (8 if n % 2 else 0)), (46, 27)))
    buttons += [button(9, (3, 104), (16, 16)), button(10, (302, 145), (26, 13))]
    buttons += [button(11 + n, (77 + 13, 12 + 6 + 25 * n), (108, 22)) for n in range(4)]
    # the evolve button (Summary's SummaryButton at 12, 145), the reorder arrows left of each move tile
    # (ReorderMoveButton, 11.5 out, 6 and 13 down, at half size) and the name, which renames
    buttons.append(button(15, (12, 145), (54, 15)))
    for n in range(4):
        buttons += [button(16 + 2 * n, (90 - 11.5, 18 + 25 * n + 6), (4, 3)), button(17 + 2 * n, (90 - 11.5, 18 + 25 * n + 13), (4, 3))]
    buttons.append(button(24, (12, 14), (56, 9)))
    buttons += [button(28 + i, (29 + 7 * i, 102), (6, 6)) for i in range(6)]
    buttons += [button(34 + n, (77 + 13 + 114.5, 12 + 6 + 25 * n + 6.5), (6, 9)) for n in range(4)]
    stat_tab_buttons = [button(38 + SWAP_SLOTS + i, (77 + 31 + 24 * i - 12, 12 + 140), (24, 9)) for i in range(4)]
    # the Marks tab (171, -1), then its 30 slots, then the chosen mark's icon, which clears the choice
    stat_tab_buttons += [button(42 + SWAP_SLOTS, (171, -1), (39, 13))]
    stat_tab_buttons += [button(43 + SWAP_SLOTS + i, (77 + 9 + 20 * (i % 6), 12 + 48 + 19 * (i // 6)), (16, 16)) for i in range(30)]
    stat_tab_buttons += [button(73 + SWAP_SLOTS, (77 + 12, 12 + 12), (16, 16))]
    # EvolutionSelectScreen in place of the party (Summary's side screen at 216, 23): a SummaryScrollList of 108 by 112
    # under "Evolution", its slots 91 by 25 and 30 apart from 4 down, each with the species, its types, the Evolve
    # button (40 by 10 at 23, 13) and the portrait; shown while the side field is "e"
    evolve = [image("list_bg", "scroll_bg", (0, 0), (108, 112), 1)]
    evolve_frame = [image("list_overlay", "scroll_overlay", (0, -3), (108, 118), 6),
                    fixed("list_label", "Evolution", (32.5 - 50, -13.5), 1.0, size=(100, 10), align="center", layer=7)]
    evolve_buttons = []
    for n in range(3):
        x, y = 7.5, 4 + 30 * n
        evolve += [picture(f"eslot{n}", field(f"e{n}slot"), (x, y), (91, 25), 2, "evslot_"),
                   label(f"ename{n}", field(f"e{n}name"), (x + 4, y + 2), 0.75, size=(60, 10), layer=4),
                   picture(f"etype1{n}", field(f"e{n}type1"), (x + 2.5, y + 13.5), (9, 9), 4),
                   picture(f"etype2{n}", field(f"e{n}type2"), (x + 12, y + 13.5), (9, 9), 4),
                   {f"emodel{n}": {"type": "image", "offset": [x + 64, y - 1], "size": [26, 26], "layer": 3, "keep_ratio": True, "anchor_from": "top_left",
                                   "anchor_to": "top_left", "bindings": bound(f"('textures/ui/cobblemon/icons/' + {field(f'e{n}icon')})", "#texture")}}]
        select = button(25 + n, (x + 23, y + 13), (40, 10))
        body = select[f"button_{25 + n}"]
        for state in body["controls"]:
            face_ = next(iter(state.values()))
            face_["controls"] = [{"text": {"type": "label", "text": "#form_button_text", "font_scale_factor": 0.5, "size": [40, 5], "text_alignment": "center",
                                           "shadow": True, "layer": 1, "bindings": [{"binding_name": "#form_button_text", "binding_type": "collection",
                                                                                     "binding_collection_name": "form_buttons"}]}}]
        evolve_buttons.append(select)
    def swap_face(state):
        text = {"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}
        tex = {"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"}
        def part(a, b): return f"(('%.{b}s' * #form_button_text) - ('%.{a}s' * #form_button_text))"
        def tlabel(name, source, x, y, w=40):
            return {name: {"type": "label", "text": "#value", "shadow": True, "font_scale_factor": 0.5, "size": [w, 5], "offset": [x, y], "layer": 3,
                           "anchor_from": "top_left", "anchor_to": "top_left", "bindings": [text, {"binding_type": "view", "source_property_name": source, "target_property_name": "#value"}]}}
        def ticon(name, texture, x, y):
            return {name: {"type": "image", "texture": f"{T}/{texture}", "size": [5, 5], "offset": [x, y], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left",
                           "bindings": [tex, {"binding_type": "view", "source_property_name": "(not ((#form_button_texture - 'forget') = #form_button_texture))",
                                              "target_property_name": "#visible"}]}}
        stats = {"stats": {"type": "panel", "size": ["100%", "100%"], "layer": 3, "bindings": [tex, {"binding_type": "view",
                           "source_property_name": "((#form_button_texture - 'forget') = #form_button_texture)", "target_property_name": "#visible"}], "controls": [
            {"type_icon": {"type": "image", "size": [18, 18], "offset": [-9, 0], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                           "bindings": [tex, {"binding_type": "view", "source_property_name": f"('{T}/' + ((#form_button_texture - '{T}/swap_') - '_hover'))", "target_property_name": "#texture"}]}},
            tlabel("name", part(0, 16), 14, 3.5, 70),
            {"ip": {"type": "image", "texture": f"{T}/icon_power", "size": [5, 5], "offset": [10, 11], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left"}},
            {"ia": {"type": "image", "texture": f"{T}/icon_acc", "size": [5, 5], "offset": [30, 11], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left"}},
            {"ie": {"type": "image", "texture": f"{T}/icon_eff", "size": [5, 5], "offset": [53.5, 11], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left"}},
            tlabel("power", part(16, 23), 16.5, 12), tlabel("acc", part(23, 32), 37, 12), tlabel("eff", part(32, 41), 60.5, 12),
            tlabel("pp", f"(#form_button_text - ('%.41s' * #form_button_text))", 76, 12, 20)]}}
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [tex, {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}],
                "controls": [stats]}
    def swap_slot(index, y):
        body = button(index, (8.5, y), (91, 18))[f"button_{index}"]
        body["controls"] = [{"default": swap_face("")}, {"hover": swap_face("_hover")}, {"pressed": swap_face("_hover")}]
        body["bindings"] = body["bindings"] + [{"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                                               {"binding_type": "view", "source_property_name": "(not (#form_button_text = ''))", "target_property_name": "#visible"}]
        return {f"button_{index}": body}
    swap_count = SWAP_SLOTS
    swap_content = {"type": "panel", "size": [108, 21 * swap_count + 6], "controls": [
        {"slots": {"type": "collection_panel", "size": [108, 21 * swap_count + 6], "collection_name": "form_buttons",
                   "controls": [swap_slot(38 + n, 3 + 21 * n) for n in range(swap_count)]}}]}
    swap_panel = {"swap_panel": {"type": "panel", "size": [108, 112], "offset": [216, 23], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 10,
                                 "bindings": bound(f"({field('side')} = 's')", "#visible"), "controls": [
        image("list_bg", "scroll_bg", (0, 0), (108, 112), 1),
        {"scroll@common.scrolling_panel": {"size": [108, 112], "layer": 3, "$show_background": False,
                                             "$scrolling_content": "server_form.cobblemon_summary_swap", "$scroll_size": [3, "100% - 4px"],
                                             "$scrolling_pane_size": ["100%", "100%"], "$scrolling_pane_offset": [0, 0], "$scroll_bar_right_padding_size": [0, 0]}},
        image("list_overlay", "scroll_overlay", (0, -3), (108, 118), 6),
        fixed("list_label", "Switch Move", (32.5 - 50, -13.5), 1.0, size=(100, 10), align="center", layer=7)]}}
    evolve_panel = {"evolve_panel": {"type": "panel", "size": [108, 112], "offset": [216, 23], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 10,
                                     "bindings": bound(f"({field('side')} = 'e')", "#visible"),
                                     "controls": [{"list": {"type": "panel", "size": [108, 112], "clips_children": True, "controls": evolve}}] + evolve_frame + [
                                                  {"select": {"type": "collection_panel", "size": [108, 112], "collection_name": "form_buttons", "layer": 5,
                                                              "controls": evolve_buttons}}]}}
    left = [image("portrait", "portrait_background", (6, 32), (66, 66), 1), image("base", "base", (0, 0), (331, 161), 2),
            {"model": {"type": "image", "offset": [9, 35], "size": [60, 60], "layer": 3, "keep_ratio": True, "anchor_from": "top_left", "anchor_to": "top_left",
                       "bindings": bound(f"('textures/ui/cobblemon/icons/' + {field('portrait')})", "#texture")}},
            fixed("lv", "Lv.", (6, 4.5)), label("level", field("level"), (19, 4.5), size=(30, 10)),
            label("name", field("name"), (12, 15), 0.75, size=(76, 10)),
            picture("ball", field("ball"), (3.5, 15), (8, 8)),
            picture("gender", field("gender"), (69, 15), (5, 7), prefix="g"),
            picture("status", field("status"), (34, 4), (39, 7), prefix="st"),
            image("types_bg", "type_spacer_double", (5.5, 126), (67, 12)),
            picture("type1", field("type1"), (21, 123), (18, 18), 5), picture("type2", field("type2"), (39, 123), (18, 18), 5),
            {"item_icon": {"type": "image", "offset": [3, 104], "size": [16, 16], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                           "bindings": bound(field("item"), "#texture")}},
            fixed("item_l", "Held Item", (24, 114.5), 0.5),
            label("evolve", field("evolve"), (12, 148.5), 1.0, size=(54, 10), align="center", layer=9)]
    summary = {"type": "panel", "size": [331, 161], "anchor_from": "center", "anchor_to": "center",
               "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                            "source_property_name": "(not ((#title_text - 'cbm:summary') = #title_text))", "target_property_name": "#visible"}],
               "controls": left + [tab_panel("info", "i", "info_base", info), tab_panel("moves", "m", "moves_base", moves),
                                   tab_panel("stats", "s", "stats_chart_base", stats), tab_panel("marks", "k", "marks_base", marks)] + party + [evolve_panel, swap_panel] +
                           [{"buttons": {"type": "collection_panel", "size": [331, 161], "collection_name": "form_buttons", "controls": buttons + stat_tab_buttons}}]}
    with open(f"{scriptsBedrock}/marks.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: Cobblemon's marks by id: [code, name, title, colour, description, group, chance, order]\n")
        file.write("export const MARKS = " + json.dumps({m["id"]: [m["code"], m["name"], m["title"], m["colour"], m["desc"], m["group"], m["chance"], m["index"]]
                                                          for m in cobblemon_marks()}, ensure_ascii=False) + ";\n")
    with open(f"{scriptsBedrock}/summary_layout.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the Summary form's body, field by field, and each field's width in bytes\n")
        file.write("export const SUMMARY_LAYOUT = " + json.dumps(SUMMARY_LAYOUT) + ";\n")
    return {"cobblemon_summary": summary, "cobblemon_summary_swap": swap_content}


# The PC, after PCGUI and StorageWidget: the 349 by 205 base, the chosen Pokemon's portrait, level, name, ball, gender,
# types, held item, nature, ability and moves on the left; the box screen with its wallpaper, grid and 30 slots in the
# middle; the party panel's six slots on the right. Every slot is a button: choose a Pokemon, then a slot to move it,
# swap it, deposit it or withdraw it. The slots show the Pokemon's box icon (the pack's spawn egg icons), since a
# JSON UI screen cannot draw a model.
PC_LAYOUT = [("level", 6), ("name", 16), ("gender", 1), ("ball", 3), ("type1", 3), ("type2", 3), ("portrait", 5), ("nature", 18), ("ability", 20)] \
    + [(f"move{n}", 16) for n in range(4)] + [("box", 12)] + [(f"b{n}", 5) for n in range(30)] + [(f"p{n}", 5) for n in range(6)] \
    + [(f"s{n}", 1) for n in range(36)] + [(f"q{n}", 1) for n in range(30)] \
    + [("count", 9)] + [(f"r{n}{k}", w) for n in range(4) for k, w in (("icon", 5), ("level", 7), ("name", 12), ("gender", 1), ("slot", 1), ("move", 1))] \
    + [("wall", 3), ("wmode", 1), ("opts", 1)] + [(f"mark{i}", 1) for i in range(6)] \
    + [("page", 1)] + [(f"sv{i}", 6) for i in range(6)] + [("filter", 30), ("rel", 1)] + [("item", 0)]
# PCBoxWallpaperRepository's wallpapers in its order, each with a three-letter code: the eleven basic ones, then the
# six Cobblemon unlocks (unlockable_pc_box_wallpapers) with the biome or capture that unlocks them
PC_WALLPAPERS = [(f"w{n:02d}", f"basic/wallpaper_basic_{n:02d}", None) for n in range(1, 12)] + [
    ("cav", "biome/wallpaper_biome_cave", "biome_cave"), ("for", "biome/wallpaper_biome_forest", "biome_forest"),
    ("nth", "biome/wallpaper_biome_nether", "biome_nether"), ("ocn", "biome/wallpaper_biome_ocean", "biome_ocean"),
    ("end", "biome/wallpaper_biome_the_end", "biome_the_end"), ("alp", "misc/wallpaper_pokemon_alpha", "pokemon_alpha")]


def portrait_code(number, variant):
    """A portrait's texture name: "i", the National number and the variant, each in two base-36 digits."""
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    b36 = lambda n: digits[n // 36] + digits[n % 36]
    return f"i{b36(number)}{b36(variant)}"


def pokemon_icons():
    """Each species' portrait as textures/ui/cobblemon/icons/i<national number>: Cobblemon's own model rendered offline
    (tools/render_portraits.py) posed as its PROFILE pose and turned as drawProfilePokemon turns it, since a JSON UI
    screen cannot draw a model; the spawn egg icon stands in for a species that does not render."""
    folder = f"{uiTextures}/icons"
    os.makedirs(folder, exist_ok=True)
    sys.path.insert(0, os.path.join(pwd, "tools"))
    import render_portraits
    # one portrait a variant (its shiny and form textures and models), named by portrait_code: "i", then the National
    # number and the variant in two base-36 digits each, so the field keeps its five bytes
    variants = {}
    for path in glob.glob(f"{entitiesBedrock}/[0-9]*.behavior.json"):
        with open(path, encoding="utf-8") as file: events = json.load(file)["minecraft:entity"].get("events", {})
        variants[os.path.basename(path)[:-len(".behavior.json")]] = max(1, sum(1 for key in events if key.startswith("cobblemon:set_variant_")))
    for old in glob.glob(f"{folder}/i[0-9]*.png"): os.remove(old)
    failures = render_portraits.render_all(folder, lambda name, v: f"{portrait_code(int(name.split('_', 1)[0]), v)}.png", variants=variants)
    for name, error in failures: print(f"  no portrait for {name}: {error}")
    for name, count in variants.items():
        number = int(name.split("_", 1)[0]); base = f"{folder}/{portrait_code(number, 0)}.png"
        if not os.path.exists(base):
            egg = f"{texturesItemsBedrock}/{name}_spawn_egg.png"
            if os.path.exists(egg): Image.open(egg).convert("RGBA").save(base)
        for v in range(1, count):   # a variant that did not render shows the base look
            if not os.path.exists(f"{folder}/{portrait_code(number, v)}.png") and os.path.exists(base): shutil.copyfile(base, f"{folder}/{portrait_code(number, v)}.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{folder}/i----.png")
    return len(glob.glob(f"{folder}/i*.png")) - 1


def create_pc_ui():
    P = f"{uiTextures}/pc"
    os.makedirs(P, exist_ok=True)
    src = f"{guiMain}/pc"
    for name in ("pc_base", "portrait_background", "info_box", "party_panel", "pc_screen_grid", "pc_screen_overlay", "type_spacer_single",
                 "type_spacer_double", "pc_pointer"):
        shutil.copyfile(f"{src}/{name}.png", f"{P}/{name.replace('pc_', '')}.png")
    # every wallpaper at the screen's size, its glow (drawn 17 out on every side) and its preview slot for the list:
    # WallpaperEntry's thumbnail inside pc_screen_overlay_preview (the "new" frame for one not yet seen)
    preview, preview_new = (Image.open(f"{src}/{name}.png").convert("RGBA") for name in ("pc_screen_overlay_preview", "pc_screen_overlay_preview_new"))
    blank1 = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    for code, path, _ in PC_WALLPAPERS:
        folder, name = path.split("/")
        wall = Image.open(f"{src}/wallpaper/{path}.png").convert("RGBA")
        wall.save(f"{P}/wp_{code}.png")
        glow = f"{src}/wallpaper/{folder}/glow/{name}.png"
        (shutil.copyfile(glow, f"{P}/glow_{code}.png") if os.path.exists(glow) else blank1.save(f"{P}/glow_{code}.png"))
        thumb = wall.resize((54, 48), Image.LANCZOS)
        for suffix, overlay in (("", preview), ("_new", preview_new)):
            for state, top in (("", 0), ("_hover", 50)):
                slot = Image.new("RGBA", (56, 50), (0, 0, 0, 0)); slot.alpha_composite(thumb, (1, 1))
                slot.alpha_composite(overlay.crop((0, top, 56, top + 50)))
                slot.save(f"{P}/wps_{code}{suffix}{state}.png")
    shutil.copyfile(f"{src}/wallpaper_scroll_background.png", f"{P}/wallpaper_scroll_background.png")
    # the info box's IV and EV pages (PCGUI's currentStatIndex), and the arrow that turns them
    for page, name in (("i", "info_box"), ("v", "info_box_stats"), ("e", "info_box_stats")): shutil.copyfile(f"{src}/{name}.png", f"{P}/ibox_{page}.png")
    arrow = Image.open(f"{src}/info_arrow.png").convert("RGBA")
    arrow.crop((0, 0, 10, 16)).save(f"{P}/info_arrow.png"); arrow.crop((0, 16, 10, 32)).save(f"{P}/info_arrow_hover.png")
    for name, out in (("pc_icon_options", "options"), ("pc_button_set_wallpaper", "set_wallpaper"),
                      *[(f"pc_button_sort_{k}{r}", f"sort_{k}{r}") for k in ("name", "level", "type", "pokedex_number", "gender") for r in ("", "_reverse")]):
        image = Image.open(f"{src}/{name}.png").convert("RGBA")
        normal, lit = image.crop((0, 0, image.width, image.height // 2)), image.crop((0, image.height // 2, image.width, image.height))
        normal.save(f"{P}/{out}.png"); lit.save(f"{P}/{out}_hover.png"); lit.save(f"{P}/{out}_on.png"); lit.save(f"{P}/{out}_on_hover.png")
    for name in ("none", "none_hover"): blank1.save(f"{P}/{name}.png")
    Image.open(f"{src}/pc_icon_filter.png").convert("RGBA").crop((0, 0, 16, 16)).save(f"{P}/filter_icon.png")
    for name in ("bar", "bar_hover"): blank1.save(f"{P}/{name}.png")
    def two(path):
        image = Image.open(path).convert("RGBA")
        return image.crop((0, 0, image.width, image.height // 2)), image.crop((0, image.height // 2, image.width, image.height))
    for name, file in (("prev", "pc_arrow_previous"), ("next", "pc_arrow_next"), ("release", "pc_release_button")):
        normal, hover = two(f"{src}/{file}.png"); normal.save(f"{P}/{name}.png"); hover.save(f"{P}/{name}_hover.png")
    overlay = Image.open(f"{src}/pc_slot_overlay.png").convert("RGBA")
    Image.new("RGBA", (25, 25), (0, 0, 0, 0)).save(f"{P}/slot.png"); overlay.save(f"{P}/slot_hover.png")
    overlay.save(f"{P}/slot_on.png"); overlay.save(f"{P}/slot_on_hover.png")
    for sel in ("n", "y"): (Image.open(f"{src}/pc_pointer.png").convert("RGBA") if sel == "y" else Image.new("RGBA", (1, 1), (0, 0, 0, 0))).save(f"{P}/sel_{sel}.png")
    # the pasture panel (PastureWidget, PasturePokemonScrollList, RecallButton)
    pas = f"{guiMain}/pasture"
    blank1 = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    for name in ("pasture_panel", "pasture_scroll_overlay"): shutil.copyfile(f"{pas}/{name}.png", f"{P}/{name}.png")
    shutil.copyfile(f"{pas}/pc_slot_icon_pasture.png", f"{P}/mark_y.png"); blank1.save(f"{P}/mark_n.png")
    for kind, name in (("o", "pasture_slot_owner"), ("n", "pasture_slot")):
        normal, hover = two(f"{pas}/{name}.png"); normal.save(f"{P}/row_{kind}.png"); hover.save(f"{P}/row_{kind}_hover.png")
    Image.new("RGBA", (62, 29), (0, 0, 0, 0)).save(f"{P}/row_e.png"); Image.new("RGBA", (62, 29), (255, 255, 255, 40)).save(f"{P}/row_e_hover.png")
    two(f"{pas}/pasture_slot_icon_move.png")[0].save(f"{P}/move_y.png"); blank1.save(f"{P}/move_n.png")
    normal, hover = two(f"{pas}/pasture_button.png"); normal.save(f"{P}/recall_all.png"); hover.save(f"{P}/recall_all_hover.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{P}/page.png"); Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{P}/page_hover.png")
    icons = pokemon_icons()

    T = "textures/ui/cobblemon"
    offsets, at = {}, 0
    for name, width in PC_LAYOUT: offsets[name] = (at, at + width); at += width
    def field(name):
        a, b = offsets[name]
        if name == "item": return f"(#form_text - ('%.{a}s' * #form_text))"
        return f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def bound(source, target):
        return [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": source, "target_property_name": target}]
    def label(name, source, offset, scale=1.0, size=(100, 10), align="left", shadow=True, layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": shadow, "text": "#value", "bindings": bound(source, "#value")}}
    def fixed(name, text, offset, scale=1.0, size=(100, 10), align="left", layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": True, "text": text}}
    def image(name, texture, offset, size, layer=3):
        return {name: {"type": "image", "texture": f"{T}/{texture}", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": False,
                       "anchor_from": "top_left", "anchor_to": "top_left"}}
    def picture(name, folder, source, offset, size, layer=4, keep=False):
        return {name: {"type": "image", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": keep,
                       "anchor_from": "top_left", "anchor_to": "top_left", "bindings": bound(f"('{T}/{folder}' + {source})", "#texture")}}
    def while_(mode, control, key="wmode"):
        name, body = next(iter(control.items()))
        return {name: {**body, "bindings": body.get("bindings", [{"binding_name": "#form_text"}]) + [
            {"binding_type": "view", "source_property_name": f"({field(key)} = '{mode}')", "target_property_name": "#visible"}]}}
    controls = [image("portrait_bg", "pc/portrait_background", (6, 27), (66, 66), 1), image("base", "pc/base", (0, 0), (349, 205), 2),
                picture("portrait", "icons/", field("portrait"), (9, 30), (60, 60), 3, True),
                fixed("lv", "Lv.", (6, 1.5)), label("level", field("level"), (19, 1.5), size=(40, 10)),
                label("name", field("name"), (12, 11.5), 0.75, size=(76, 10)),
                picture("ball", "summary/", field("ball"), (3.5, 12), (8, 8)),
                picture("gender", "summary/g", field("gender"), (69, 11.5), (5, 7)),
                image("types_bg", "pc/type_spacer_double", (9, 118.5), (63, 6)),
                picture("type1", "summary/", field("type1"), (22.5, 112), (18, 18), 5), picture("type2", "summary/", field("type2"), (40.5, 112), (18, 18), 5),
                {"item_icon": {"type": "image", "offset": [3, 98], "size": [16, 16], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                               "bindings": bound(field("item"), "#texture")}},
                fixed("item_l", "Held Item", (24, 108.5), 0.5),
                *[picture(f"mark{i}", f"summary/mark{i}_", field(f"mark{i}"), (29 + 7 * i, 96.5), (6, 6), 5) for i in range(6)],
                picture("info_box", "pc/ibox_", field("page"), (9, 128), (63, 69))]
    info_page = [fixed("nature_l", "Nature", (9, 129.5), 0.5, size=(63, 5), align="center"),
                 label("nature", field("nature"), (9, 137), 0.5, size=(63, 5), align="center"),
                 fixed("ability_l", "Ability", (9, 146.5), 0.5, size=(63, 5), align="center"),
                 label("ability", field("ability"), (9, 154), 0.5, size=(63, 5), align="center"),
                 fixed("moves_l", "Moves", (9, 163.5), 0.5, size=(63, 5), align="center")]
    info_page += [label(f"move{n}", field(f"move{n}"), (9, 170.5 + 7 * n), 0.5, size=(63, 5), align="center") for n in range(4)]
    # the IV and EV pages: the heading, then HP to Speed 10 apart, each value centred at 65
    stat_page = []
    for i, text in enumerate(("HP", "Atk", "Def", "Sp.Atk", "Sp.Def", "Speed")):
        stat_page += [fixed(f"stat_l{i}", text, (13, 139 + 10 * i), 0.5, size=(40, 5)),
                      label(f"stat_v{i}", field(f"sv{i}"), (65 - 10, 139 + 10 * i), 0.5, size=(20, 5), align="center")]
    def page_panel(name, pages, children):
        return {name: {"type": "panel", "size": [349, 205], "anchor_from": "top_left", "anchor_to": "top_left",
                       "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                    "source_property_name": " or ".join(f"({field('page')} = '{pg}')" for pg in pages), "target_property_name": "#visible"}],
                       "controls": children}}
    # one panel a page: a visibility binding with "or" in it never shows
    controls += [page_panel("info_page", "i", info_page), page_panel("iv_page", "v", stat_page), page_panel("ev_page", "e", stat_page),
                 page_panel("iv_head", "v", [fixed("iv_l", "IVs", (9, 129.5), 0.5, size=(63, 5), align="center")]),
                 page_panel("ev_head", "e", [fixed("ev_l", "EVs", (9, 129.5), 0.5, size=(63, 5), align="center")])]
    # the box screen at StorageWidget's place, and its 30 slots in 6 columns of 27
    controls += [picture("wallpaper", "pc/wp_", field("wall"), (85, 27), (174, 155), 2), picture("glow", "pc/glow_", field("wall"), (68, 10), (208, 189), 3),
                 while_("n", image("grid", "pc/screen_grid", (92, 38), (160, 133), 3), "opts"),
                 while_("y", image("grid_opts", "pc/screen_grid", (92, 43), (160, 133), 3), "opts"),
                 image("overlay", "pc/screen_overlay", (85, 27), (174, 155), 4),
                 label("box", field("box"), (126, 12), 0.75, size=(92, 10), align="center"),
                 # FilterWidget: its icon 9 to the left, the filter (or "Filter") centred over the bar
                 image("filter_icon", "pc/filter_icon", (117, 186), (8, 8), 5),
                 label("filter", field("filter"), (126, 185), 0.75, size=(91, 10), align="center", layer=6)]
    slots = [(92 + 27 * (n % 6), 38 + 27 * (n // 6)) for n in range(30)]
    slots += [(278 + (31 if n % 2 else 0), 35 + 31 * (n // 2) + (8 if n % 2 else 0)) for n in range(6)]
    for n, (x, y) in enumerate(slots[:30]):
        for opts, dy in (("n", 0), ("y", 5)):
            controls += [while_(opts, c, "opts") for c in (picture(f"icon{n}{opts}", "icons/", field(f"b{n}"), (x + 1, y + 1 + dy), (23, 23), 5, True),
                                                             picture(f"pointer{n}{opts}", "pc/sel_", field(f"s{n}"), (x + 7, y - 6 + dy), (11, 8), 7),
                                                             picture(f"mark{n}{opts}", "pc/mark_", field(f"q{n}"), (x + 15, y + 15 + dy), (10, 10), 6))]
    party_controls = [image("party_panel", "pc/party_panel", (267, 8), (82, 169), 2)]
    for n, (x, y) in enumerate(slots[30:], 30):
        party_controls += [picture(f"icon{n}", "icons/", field(f"p{n - 30}"), (x + 1, y + 1), (23, 23), 5, True),
                           picture(f"pointer{n}", "pc/sel_", field(f"s{n}"), (x + 7, y - 6), (11, 8), 7)]
    # the pasture panel at the party panel's place: the list 6 in and 31 down, rows of 29 three apart, four at a time
    rows = [(277, 41 + 32 * n) for n in range(4)]
    pasture_controls = [image("pasture_panel", "pc/pasture_panel", (267, 8), (82, 169), 2),
                        image("scroll_overlay", "pc/pasture_scroll_overlay", (273, 26), (70, 131), 5),
                        fixed("title", "Pasture", (267, 11.5), 1.0, size=(63, 10), align="center"),
                        label("count", field("count"), (273, 32), 1.0, size=(70, 10), align="center", layer=12)]
    for n, (x, y) in enumerate(rows):
        # above the row buttons, whose faces are the slot texture
        pasture_controls += [picture(f"ricon{n}", "icons/", field(f"r{n}icon"), (x + 11, y), (22, 22), 20, True),
                             label(f"rlevel{n}", field(f"r{n}level"), (x + 29, y + 17), 0.5, size=(30, 5), align="right", layer=21),
                             label(f"rname{n}", field(f"r{n}name"), (x + 11, y + 24), 0.5, size=(45, 5), shadow=False, layer=21),
                             picture(f"rgender{n}", "summary/g", field(f"r{n}gender"), (x + 56.5, y + 24), (2.5, 3.5), 21),
                             picture(f"rmove{n}", "pc/move_", field(f"r{n}move"), (x + 2, y + 11), (7, 7), 21)]
    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}]}
    def button(index, offset, size):
        return {f"button_{index}": {"type": "button", "size": list(size), "offset": list(offset), "anchor_from": "top_left", "anchor_to": "top_left",
                                    "collection_index": index, "layer": 6,
                                    "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                    "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                        {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                    "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                                    "controls": [{"default": face("")}, {"hover": face("_hover")}, {"pressed": face("_hover")}]}}
    buttons = [while_("n", button(n, (x, y), (25, 25)), "opts") for n, (x, y) in enumerate(slots[:30])]
    box_opts = [while_("y", button(n, (x, y + 5), (25, 25)), "opts") for n, (x, y) in enumerate(slots[:30])]
    buttons += [while_("n", button(n, (x, y), (25, 25))) for n, (x, y) in enumerate(slots[30:], 30)]
    buttons += [button(36, (117, 9), (14, 14)), button(37, (220, 9), (14, 14)), button(38, (279, 151), (58, 16)), button(39, (320, 186), (26, 13))]
    # PCGUI's options button (218, 186), and while the options show the set-wallpaper button (242, 31)
    # IconButton draws its texture at half size
    buttons += [button(40, (218, 186), (8, 8)), button(41, (242, 31), (10, 10))]
    info_arrow = [button(42 + len(PC_WALLPAPERS) + 5, (1, 157), (10, 16)),
                  button(42 + len(PC_WALLPAPERS) + 6, (126, 183), (91, 14)),     # the filter
                  button(42 + len(PC_WALLPAPERS) + 7, (126, 10), (92, 12))]      # the box name, which renames the box
    # PokemonSortMode's five sort buttons, 12 apart from (92, 31), while the options show
    buttons += [button(42 + len(PC_WALLPAPERS) + n, (92 + 12 * n, 31), (10, 10)) for n in range(5)]
    # WallpapersScrollingWidget in the party's place (274, 29, 68 by 146): a slot of 56 by 50 every 54, 4 in, scrolling
    count = len(PC_WALLPAPERS)
    wall_buttons = [button(42 + n, (4, 4 + 54 * n), (56, 50)) for n in range(count)]
    wall_content = {"type": "panel", "size": [64, 54 * count + 4], "controls": [
        {"slots": {"type": "collection_panel", "size": [64, 54 * count + 4], "collection_name": "form_buttons", "controls": wall_buttons}}]}
    wall_panel = while_("y", {"wallpapers": {"type": "panel", "size": [68, 148], "offset": [274, 28], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 8,
        "controls": [{"bg": {"type": "image", "texture": f"{T}/pc/wallpaper_scroll_background", "size": [68, 148], "layer": 1}},
                     {"title": {"type": "label", "text": "Wallpaper", "shadow": True, "size": [100, 10], "text_alignment": "center", "layer": 2,
                                "anchor_from": "top_left", "anchor_to": "top_left", "offset": [23 - 50, -17]}},
                     {"scroll@common.scrolling_panel": {"size": [68, 146], "offset": [0, 1], "layer": 3, "$show_background": False,
                                                          "$scrolling_content": "server_form.cobblemon_pc_wallpapers", "$scroll_size": [3, "100% - 4px"],
                                                          "$scrolling_pane_size": ["100%", "100%"], "$scrolling_pane_offset": [0, 0],
                                                          "$scroll_bar_right_padding_size": [0, 0]}}]}})
    # the pasture's buttons: the box slots, the arrows, the exit, then the four rows, Recall All and the page turn on the count
    pasture_buttons = [button(n, (x, y), (25, 25)) for n, (x, y) in enumerate(slots[:30])]
    pasture_buttons += [button(30, (117, 9), (14, 14)), button(31, (220, 9), (14, 14)), button(32, (320, 186), (26, 13))]
    pasture_buttons += [button(33 + n, (x, y), (62, 29)) for n, (x, y) in enumerate(rows)]
    pasture_buttons += [button(37, (273, 161), (70, 17)), button(38, (283, 30), (50, 12))]
    def screen(title, extra, buttons_here):
        return {"type": "panel", "size": [349, 205], "anchor_from": "center", "anchor_to": "center",
                "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                             "source_property_name": f"(not ((#title_text - '{title}') = #title_text))", "target_property_name": "#visible"}],
                "controls": controls + extra + [{"buttons": {"type": "collection_panel", "size": [349, 205], "collection_name": "form_buttons", "controls": buttons_here}}]}
    pc = screen("cbm:pc", [while_("n", c) for c in party_controls] + [wall_panel], buttons + box_opts + info_arrow)
    pasture = screen("cbm:pasture", pasture_controls + [fixed("recall_all_l", "Recall All", (273, 165), 1.0, size=(70, 10), align="center", layer=12)], pasture_buttons)
    with open(f"{scriptsBedrock}/pc_layout.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the PC form's body, field by field, and each field's width in bytes\n")
        file.write("export const PC_LAYOUT = " + json.dumps(PC_LAYOUT) + ";\n")
    print(f"  PC screen: Cobblemon's PC on its own textures, {icons} Pokemon portraits")
    with open(f"{scriptsBedrock}/pc_layout.js", "a", encoding="utf-8") as file:
        file.write("export const PC_WALLPAPERS = " + json.dumps([[c, u] for c, _, u in PC_WALLPAPERS]) + ";\n")
    return {"cobblemon_pc": pc, "cobblemon_pasture": pasture, "cobblemon_pc_wallpapers": wall_content}


# The Pokedex, after PokedexGUI: the dex's own coloured base under the screen, the region with its arrows, seen and
# caught counts, a page of 25 entry slots (EntriesScrollingWidget's rows of five) with page arrows, and the chosen
# entry's PokemonInfoWidget: number, name, caught icon, types, the portrait over the platform, the cry button, and the
# Info, Abilities and Stats tabs below it. Entries show the species' box icon where Cobblemon draws its model.
DEX_TABS = "iazsdm"   # PokedexGUI's tabs: info, abilities, size, stats, drops, moves
DEX_LAYOUT = [("colour", 1), ("region", 12), ("seen", 8), ("caught", 8), ("filter", 12), ("search", 30)] \
    + [(f"e{n}{k}", w) for n in range(25) for k, w in (("icon", 5), ("num", 7), ("state", 1), ("sel", 1))] \
    + [("num", 7), ("name", 16), ("caughtmark", 1), ("type1", 3), ("type2", 3), ("portrait", 5), ("platform", 3), ("tab", 1),
       ("line1", 40), ("line2", 40)] + [(f"stat{k}", 14) for k in ("hp", "atk", "def", "spa", "spd", "spe")] + [("desc", 0)]


def create_pokedex_ui():
    D = f"{uiTextures}/pokedex"
    os.makedirs(D, exist_ok=True)
    src = f"{guiMain}/pokedex"
    # one letter a colour, so the field fills its width exactly (a texture path cannot carry padding)
    for colour, letter in (("red", "r"), ("blue", "b"), ("green", "g"), ("pink", "p"), ("yellow", "y"), ("black", "k"), ("white", "w")):
        shutil.copyfile(f"{src}/pokedex_base_{colour}.png", f"{D}/base_{letter}.png")
    for name in ("pokedex_screen", "pokedex_screen_info_overlay", "pokedex_screen_info_viewport", "pokedex_slot", "caught_icon",
                 "globe_icon", "pokedex_screen_bar_category", "category_icon", "platform_base", "type_bar", "type_bar_double", "select_arrow"):
        shutil.copyfile(f"{src}/{name}.png", f"{D}/{name.replace('pokedex_', '')}.png")
    for n, (type_name, _) in enumerate(TYPE_HUES):
        platform = f"{src}/platform_base_{type_name}.png"
        if os.path.exists(platform): shutil.copyfile(platform, f"{D}/p{n:02d}.png")
    shutil.copyfile(f"{src}/platform_base.png", f"{D}/p--.png")
    Image.open(f"{src}/pokedex_screen_poke_ball.png").convert("RGBA").crop((0, 0, 109, 68)).save(f"{D}/poke_ball.png")
    seen = Image.open(f"{src}/caught_seen_icon.png").convert("RGBA")
    seen.crop((0, 0, 14, 14)).save(f"{D}/seen_icon.png"); seen.crop((0, 14, 14, 28)).save(f"{D}/owned_icon.png")
    blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    # an entry's state: unknown shows the ? icon, seen the box icon, caught the box icon and the small ball
    shutil.copyfile(f"{src}/pokedex_slot_unknown.png", f"{D}/q_u.png"); blank.save(f"{D}/q_s.png"); blank.save(f"{D}/q_c.png")
    shutil.copyfile(f"{src}/caught_icon_small.png", f"{D}/c_c.png"); blank.save(f"{D}/c_s.png"); blank.save(f"{D}/c_u.png")
    shutil.copyfile(f"{src}/caught_icon.png", f"{D}/cm_y.png"); blank.save(f"{D}/cm_n.png")
    select = Image.open(f"{src}/slot_select.png").convert("RGBA")
    blank25 = Image.new("RGBA", (25, 25), (0, 0, 0, 0))
    blank25.save(f"{D}/slot.png"); select.crop((0, 25, 25, 50)).save(f"{D}/slot_hover.png")
    select.crop((0, 0, 25, 25)).save(f"{D}/slot_on.png"); select.crop((0, 0, 25, 25)).save(f"{D}/slot_on_hover.png")
    for name in ("info", "abilities", "size", "stats", "drops", "moves"):
        normal = Image.open(f"{src}/tab_{name}.png").convert("RGBA")
        normal.crop((0, 0, 16, 16)).save(f"{D}/tab_{name}.png"); normal.crop((0, 16, 16, 32)).save(f"{D}/tab_{name}_hover.png")
        normal.crop((0, 16, 16, 32)).save(f"{D}/tab_{name}_on.png"); normal.crop((0, 16, 16, 32)).save(f"{D}/tab_{name}_on_hover.png")
    for name in ("arrow_up", "arrow_down"):
        image = Image.open(f"{src}/{name}.png").convert("RGBA")
        image.save(f"{D}/{name}.png"); image.save(f"{D}/{name}_hover.png")
    sound = Image.open(f"{src}/button_sound.png").convert("RGBA")
    sound.save(f"{D}/cry.png"); sound.save(f"{D}/cry_hover.png")
    blank.save(f"{D}/none.png"); blank.save(f"{D}/none_hover.png")
    for letter in DEX_TABS:
        for tab in DEX_TABS + "x": (Image.open(f"{src}/select_arrow.png").convert("RGBA") if tab == letter else blank).save(f"{D}/t{letter}_{tab}.png")
    # PokemonInfoWidget's form arrows, a normal frame over a hover one
    for name in ("forms_arrow_left", "forms_arrow_right"):
        frames = Image.open(f"{src}/{name}.png").convert("RGBA")
        frames.crop((0, 0, 10, 16)).save(f"{D}/{name}.png"); frames.crop((0, 16, 10, 32)).save(f"{D}/{name}_hover.png")
    # SearchWidget's bar and icon, and the search-by button's four faces (species, abilities, moves, drops)
    for name in ("pokedex_screen_bar_search", "search_icon"): shutil.copyfile(f"{src}/{name}.png", f"{D}/{name.replace('pokedex_', '')}.png")
    for name in ("species", "abilities", "moves", "drops"):
        face = Image.open(f"{src}/tab_{name}.png").convert("RGBA")
        face.crop((0, 0, 16, 16)).save(f"{D}/by_{name}.png"); face.crop((0, 16, 16, 32)).save(f"{D}/by_{name}_hover.png")
    bar = Image.open(f"{src}/pokedex_screen_bar_category.png").convert("RGBA")
    Image.new("RGBA", bar.size, (0, 0, 0, 0)).save(f"{D}/filter.png"); Image.new("RGBA", bar.size, (255, 255, 255, 40)).save(f"{D}/filter_hover.png")

    T = "textures/ui/cobblemon"
    offsets, at = {}, 0
    for name, width in DEX_LAYOUT: offsets[name] = (at, at + width); at += width
    def field(name):
        a, b = offsets[name]
        if name == "desc": return f"(#form_text - ('%.{a}s' * #form_text))"
        return f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def bound(source, target):
        return [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": source, "target_property_name": target}]
    def label(name, source, offset, scale=1.0, size=(100, 10), align="left", shadow=True, layer=6, color=(1, 1, 1)):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": shadow, "color": list(color), "text": "#value", "bindings": bound(source, "#value")}}
    GREY = (0x60 / 255, 0x6B / 255, 0x6E / 255)   # InfoTextScrollWidget's text colour
    def image(name, texture, offset, size, layer=3):
        return {name: {"type": "image", "texture": f"{T}/{texture}", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": False,
                       "anchor_from": "top_left", "anchor_to": "top_left"}}
    def picture(name, folder, source, offset, size, layer=4, keep=False):
        return {name: {"type": "image", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": keep,
                       "anchor_from": "top_left", "anchor_to": "top_left", "bindings": bound(f"('{T}/{folder}' + {source})", "#texture")}}
    controls = [picture("base", "pokedex/base_", field("colour"), (-2, 4), (350, 200), 1),
                image("screen", "pokedex/screen", (0, 0), (345, 207), 2),
                image("globe", "pokedex/globe_icon", (26, 15), (7, 7)), label("region", field("region"), (36, 14), 1.0, size=(58, 10)),
                image("seen_icon", "pokedex/seen_icon", (252, 15), (7, 7)), label("seen", field("seen"), (262, 14), size=(30, 10)),
                image("owned_icon", "pokedex/owned_icon", (290, 15), (7, 7)), label("caught", field("caught"), (300, 14), size=(30, 10)),
                image("search_bar", "pokedex/screen_bar_search", (26, 28), (139, 11)),
                image("search_icon", "pokedex/search_icon", (27.5, 29), (7, 7), 4),
                label("search", field("search"), (37, 29.5), 1.0, size=(220, 10), layer=5),   # wide, so the padding never ellipsizes
                image("category", "pokedex/screen_bar_category", (26, 180), (139, 11)),
                image("filter_icon", "pokedex/category_icon", (29, 182), (7, 7)), label("filter", field("filter"), (39, 181), size=(100, 10))]
    slots = [(27 + 27 * (n % 5), 39 + 3 + 3 + 27 * (n // 5)) for n in range(25)]
    for n, (x, y) in enumerate(slots):
        controls += [image(f"slot{n}", "pokedex/slot", (x, y), (25, 25), 3),
                     picture(f"icon{n}", "icons/", field(f"e{n}icon"), (x + 1, y + 2), (23, 21), 4, True),
                     picture(f"unknown{n}", "pokedex/q_", field(f"e{n}state"), (x + 8.5, y + 9), (8, 10), 4),
                     picture(f"caught{n}", "pokedex/c_", field(f"e{n}state"), (x + 18, y + 1.5), (5.5, 5.5), 5),
                     label(f"num{n}", field(f"e{n}num"), (x + 1.5, y + 2.5), 0.5, size=(20, 5), layer=5)]
    # the entry: PokemonInfoWidget at 180, 28
    ix, iy = 180, 28
    controls += [image("info_overlay", "pokedex/screen_info_overlay", (ix, iy), (139, 163), 3),
                 label("entry_num", field("num"), (ix + 3, iy + 2), 0.8, size=(24, 10)), label("entry_name", field("name"), (ix + 26, iy + 1), size=(100, 10)),
                 picture("caught_mark", "pokedex/cm_", field("caughtmark"), (ix + 129, iy + 2), (7, 7), 5),
                 image("type_bar", "pokedex/type_bar_double", (ix, iy + 14), (139, 25), 4),
                 picture("type1", "summary/", field("type1"), (ix + 3, iy + 17), (18, 18), 5), picture("type2", "summary/", field("type2"), (ix + 21, iy + 17), (18, 18), 5),
                 image("viewport", "pokedex/screen_info_viewport", (ix, iy + 24), (139, 70), 3),
                 image("poke_ball", "pokedex/poke_ball", (ix + 15, iy + 25), (109, 68), 4),
                 picture("platform", "pokedex/", field("platform"), (ix + 13, iy + 66), (113, 27), 5),
                 picture("portrait", "icons/", field("portrait"), (ix + 40, iy + 30), (60, 48), 6, True),
                 label("line1", field("line1"), (ix + 7, iy + 109), 0.5, size=(125, 5), shadow=False, layer=7, color=GREY),
                 label("line2", field("line2"), (ix + 7, iy + 116), 0.5, size=(125, 5), shadow=False, layer=7, color=GREY),
                 label("desc", field("desc"), (ix + 7, iy + 109), 0.5, size=(125, 40), shadow=False, layer=7, color=GREY)]
    for n, (key, text) in enumerate((("hp", "HP"), ("atk", "Attack"), ("def", "Defence"), ("spa", "Sp. Atk"), ("spd", "Sp. Def"), ("spe", "Speed"))):
        controls.append(label(f"stat{key}", field(f"stat{key}"), (ix + 7 + 62 * (n % 2), iy + 109 + 8 * (n // 2)), 0.5, size=(60, 5), shadow=False, layer=7, color=GREY))
    # the select arrow over the chosen tab: one picture a tab, the arrow in the one whose letter matches
    for n, letter in enumerate(DEX_TABS):
        controls.append(picture(f"tab_arrow{n}", f"pokedex/t{letter}_", field("tab"), (191.5 + 22 * n, 177), (6, 3), 6))
    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}]}
    def button(index, offset, size):
        return {f"button_{index}": {"type": "button", "size": list(size), "offset": list(offset), "anchor_from": "top_left", "anchor_to": "top_left",
                                    "collection_index": index, "layer": 8,
                                    "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                    "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                        {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                    "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                                    "controls": [{"default": face("")}, {"hover": face("_hover")}, {"pressed": face("_hover")}]}}
    buttons = [button(n, (x, y), (25, 25)) for n, (x, y) in enumerate(slots)]
    buttons += [button(25, (95, 14.5), (4, 6)), button(26, (95, 19.5), (4, 6)),        # region up and down
                button(27, (160, 44), (4, 6)), button(28, (160, 170), (4, 6)),          # page up and down
                button(29, (190.5, 181.5), (8, 8)), button(30, (212.5, 181.5), (8, 8)), button(31, (256.5, 181.5), (8, 8)),   # info, abilities, stats
                button(32, (ix + 114, iy + 81), (22, 10)), button(33, (26, 180), (139, 11)),
                button(34, (26, 28), (126, 11)), button(35, (154.5, 29.5), (8, 8)),        # the search bar, and search by
                button(36, (234.5, 181.5), (8, 8)), button(37, (278.5, 181.5), (8, 8)), button(38, (300.5, 181.5), (8, 8)),   # size, drops, moves
                button(39, (ix + 18, iy + 55.5), (5, 8)), button(40, (ix + 116, iy + 55.5), (5, 8))]                         # the form arrows
    dex = {"type": "panel", "size": [345, 207], "anchor_from": "center", "anchor_to": "center",
           "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                        "source_property_name": "(not ((#title_text - 'cbm:pokedex') = #title_text))", "target_property_name": "#visible"}],
           "controls": controls + [{"buttons": {"type": "collection_panel", "size": [345, 207], "collection_name": "form_buttons", "controls": buttons}}]}
    with open(f"{scriptsBedrock}/dex_layout.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py: the Pokedex form's body, field by field, and each field's width in bytes\n")
        file.write("export const DEX_LAYOUT = " + json.dumps(DEX_LAYOUT) + ";\n")
    return {"cobblemon_pokedex": dex}


# Starter selection, after StarterSelectionScreen and StarterConfig: the 239 by 197 base, the chosen starter's portrait
# on the ball background and its type's platform, its name, dex number, type and dex text, the categories on the right
# three at a time (CategoryList's containers of up to three starters) with arrows, and the I choose you! button.
STARTER_LAYOUT = [("name", 16), ("dex", 12), ("type1", 3), ("type2", 3), ("portrait", 5), ("platform", 3)] \
    + [(f"c{k}{f}", w) for k in range(3) for f, w in (("name", 16),)] + [(f"c{k}p{n}{f}", w) for k in range(3) for n in range(3) for f, w in (("icon", 5), ("sel", 1))] \
    + [("desc", 0)]


def starter_categories():
    """StarterConfig's default categories, in order: [{name, pokemon: [{id, level, ball}]}]."""
    text = open(f"{kotlinMain}/config/starter/StarterConfig.kt", encoding="utf-8").read()
    by_name = {species["name"].lower(): pokemon for pokemon in pokemons if (species := species_for(pokemon))}
    out = []
    for block in re.findall(r"StarterCategory\((.*?)\n        \)", text, re.S):
        key = re.search(r'displayName = "([^"]+)"', block).group(1)
        entries = []
        for spec in re.findall(r'PokemonProperties\.parse\("([^"]+)"\)', block):
            words = spec.split()
            pokemon = by_name.get(words[0].lower())
            if not pokemon: continue
            props = dict(w.split("=", 1) for w in words[1:] if "=" in w)
            entries.append({"id": entity_id(pokemon), "level": int(props.get("level", 10)), "ball": f"cobblemon:{props.get('pokeball', 'poke_ball')}"})
        if entries: out.append({"name": lang.get(key, key.rsplit(".", 1)[-1].title()), "pokemon": entries})
    return out


def create_starter_ui():
    St = f"{uiTextures}/starter"
    os.makedirs(St, exist_ok=True)
    src = f"{guiMain}/starterselection"
    for name in ("base", "background", "platform_base", "selection_container", "selection_container_edge", "selection_container_footer",
                 "selection_container_header", "type_spacer_single"):
        shutil.copyfile(f"{src}/{name}.png", f"{St}/{name}.png")
    Image.open(f"{src}/background_poke_ball.png").convert("RGBA").crop((0, 0, 109, 109)).save(f"{St}/ball.png")
    for n, (type_name, _) in enumerate(TYPE_HUES):
        platform = f"{src}/starter_platform_base_{type_name}.png"
        if os.path.exists(platform): shutil.copyfile(platform, f"{St}/p{n:02d}.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{St}/p--.png")
    for kind, name in (("", "starter_selection"), ("_on", "starter_selection_active")):
        image = Image.open(f"{src}/{name}.png").convert("RGBA")
        image.crop((0, 0, 25, 25)).save(f"{St}/slot{kind}.png"); image.crop((0, 25, 25, 50)).save(f"{St}/slot{kind}_hover.png")
    Image.new("RGBA", (25, 25), (0, 0, 0, 0)).save(f"{St}/none.png"); Image.new("RGBA", (25, 25), (0, 0, 0, 0)).save(f"{St}/none_hover.png")
    choose = Image.open(f"{src}/choose_button.png").convert("RGBA")
    choose.crop((0, 0, 106, 14)).save(f"{St}/choose.png"); choose.crop((0, 14, 106, 28)).save(f"{St}/choose_hover.png")
    categories = starter_categories()
    with open(f"{scriptsBedrock}/starters.js", "w", encoding="utf-8") as file:
        file.write("// generated by port.py from Cobblemon's StarterConfig: the starter categories, and the Starter screen's body layout\n")
        file.write("export const STARTERS = " + json.dumps(categories) + ";\n")
        file.write("export const STARTER_LAYOUT = " + json.dumps(STARTER_LAYOUT) + ";\n")

    T = "textures/ui/cobblemon"
    offsets, at = {}, 0
    for name, width in STARTER_LAYOUT: offsets[name] = (at, at + width); at += width
    def field(name):
        a, b = offsets[name]
        if name == "desc": return f"(#form_text - ('%.{a}s' * #form_text))"
        return f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def bound(source, target):
        return [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": source, "target_property_name": target}]
    def label(name, source, offset, scale=1.0, size=(100, 10), align="left", shadow=True, layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": shadow, "text": "#value", "bindings": bound(source, "#value")}}
    def fixed(name, text, offset, scale=1.0, size=(100, 10), align="left", layer=6):
        return {name: {"type": "label", "anchor_from": "top_left", "anchor_to": "top_left", "offset": list(offset), "size": list(size), "layer": layer,
                       "font_scale_factor": scale, "text_alignment": align, "shadow": True, "text": text}}
    def image(name, texture, offset, size, layer=3):
        return {name: {"type": "image", "texture": f"{T}/{texture}", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": False,
                       "anchor_from": "top_left", "anchor_to": "top_left"}}
    def picture(name, folder, source, offset, size, layer=4, keep=False):
        return {name: {"type": "image", "offset": list(offset), "size": list(size), "layer": layer, "keep_ratio": keep,
                       "anchor_from": "top_left", "anchor_to": "top_left", "bindings": bound(f"('{T}/{folder}' + {source})", "#texture")}}
    controls = [image("background", "starter/background", (6, 17), (118, 100), 1), image("ball", "starter/ball", (10.5, 12.5), (109, 109), 2),
                image("platform", "starter/platform_base", (8.5, 88), (113, 32), 2), picture("type_platform", "starter/", field("platform"), (8.5, 82), (113, 30), 3),
                picture("portrait", "icons/", field("portrait"), (30, 30), (70, 60), 4, True),
                image("base", "starter/base", (0, 0), (239, 197), 5),
                image("type_spacer", "starter/type_spacer_single", (47, 123), (36, 12), 6),
                picture("type1", "summary/", field("type1"), (47, 120), (18, 18), 7), picture("type2", "summary/", field("type2"), (65, 120), (18, 18), 7),
                label("name", field("name"), (14, 3), 0.8, size=(64, 10), layer=7), label("dex", field("dex"), (79, 3), 0.8, size=(44, 10), layer=7),
                fixed("title", "Starter Selection", (127, 12), 0.8, size=(90, 10), align="center", layer=7),
                label("desc", field("desc"), (8, 143), 0.5, size=(114, 32), shadow=False, layer=7),
                fixed("choose_l", "I choose you!", (13, 182), 1.0, size=(106, 10), align="center", layer=12)]
    slots = []
    for k in range(3):
        top = 27 + 44 * k
        controls += [image(f"header{k}", "starter/selection_container_header", (138, top), (89, 7), 6),
                     label(f"cname{k}", field(f"c{k}name"), (138, top), 0.5, size=(89, 5), align="center", layer=7),
                     image(f"edge{k}", "starter/selection_container_edge", (138, top + 7), (89, 1), 6),
                     image(f"inner{k}", "starter/selection_container", (138, top + 8), (89, 31), 6),
                     image(f"edge2{k}", "starter/selection_container_edge", (138, top + 39), (89, 1), 6),
                     image(f"footer{k}", "starter/selection_container_footer", (138, top + 40), (89, 1), 6)]
        for n in range(3):
            x, y = 138 + 5 + n * 27, top + 11
            slots.append((x, y))
            controls.append(picture(f"icon{k}{n}", "icons/", field(f"c{k}p{n}icon"), (x + 1, y + 1), (23, 23), 20, True))   # above the slot buttons
    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}]}
    def button(index, offset, size):
        return {f"button_{index}": {"type": "button", "size": list(size), "offset": list(offset), "anchor_from": "top_left", "anchor_to": "top_left",
                                    "collection_index": index, "layer": 7,
                                    "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                    "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                        {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                    "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                                    "controls": [{"default": face("")}, {"hover": face("_hover")}, {"pressed": face("_hover")}]}}
    buttons = [button(n, xy, (25, 25)) for n, xy in enumerate(slots)]
    buttons += [button(9, (13, 180), (106, 14)), button(10, (210, 181), (26, 13)), button(11, (229, 30), (4, 6)), button(12, (229, 164), (4, 6))]
    starter = {"type": "panel", "size": [239, 197], "anchor_from": "center", "anchor_to": "center",
               "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                            "source_property_name": "(not ((#title_text - 'cbm:starter') = #title_text))", "target_property_name": "#visible"}],
               "controls": controls + [{"buttons": {"type": "collection_panel", "size": [239, 197], "collection_name": "form_buttons", "controls": buttons}}]}
    print(f"  starter selection: {len(categories)} categories from StarterConfig")
    return {"cobblemon_starter": starter}


# The interact wheel, after InteractWheelGUI and createPokemonInteractGui: the 170 by 170 base with eight buttons around
# it on Cobblemon's own button and icon textures, a disabled option drawn dim. Cobblemon's four options keep their
# places (held item north, cosmetic item north-east, ride west, shoulder north-west); the port puts the Summary east
# and Stay or Follow south, the keys it has no other way to reach. The hovered option's name shows in the middle.
WHEEL = [("north", (55, 0), (60, 27)), ("northeast", (109, 12), (49, 49)), ("east", (143, 55), (27, 60)), ("southeast", (109, 109), (49, 49)),
         ("south", (55, 143), (60, 27)), ("southwest", (12, 109), (49, 49)), ("west", (0, 55), (27, 60)), ("northwest", (12, 12), (49, 49))]
WHEEL_ICON = {"north": (22, 5.5), "south": (22, 5.5), "west": (5.5, 22), "east": (5.5, 22), "northwest": (14.5, 14.5), "northeast": (18.5, 14.5),
              "southeast": (18.5, 18.5), "southwest": (14.5, 18.5)}


# DialogueScreen: the 196 by 74 box 30 above the middle, the name plate over it, the portrait frame at its left with
# the box's arrow, and the options 7 below it, side by side (96 wide, 4 apart) or stacked (196 wide, 4 apart). The
# title carries the speaker's name after "cbm:dialogue"; the body the face's texture name, the layout ("h" side by
# side, "v" stacked, "n" none, when a click on the box goes on), then the text. The layout comes after the face: a
# slice subtracts the whole prefix, so a one-letter prefix would take that letter out of everything after it.
DIALOGUE_FIELDS = {"face": (0, 16), "layout": (16, 17)}
DIALOGUE_TEXT = 17


def create_dialogue_ui():
    D = f"{uiTextures}/dialogue"
    os.makedirs(D, exist_ok=True)
    src = f"{guiMain}/dialogue"
    box = Image.open(f"{src}/dialogue_box.png").convert("RGBA")
    box.crop((0, 0, 196, 74)).save(f"{D}/box.png")
    box.crop((196, 0, 202, 11)).save(f"{D}/arrow.png")
    for name in ("dialogue_name", "dialogue_portrait_background", "dialogue_portrait_left"):
        shutil.copyfile(f"{src}/{name}.png", f"{D}/{name[len('dialogue_'):]}.png")
    for name, out in (("dialogue_button", "button"), ("dialogue_button_full", "button_full")):
        frames = Image.open(f"{src}/{name}.png").convert("RGBA")
        h = frames.height // 3
        frames.crop((0, 0, frames.width, h)).save(f"{D}/{out}.png"); frames.crop((0, h, frames.width, h * 2)).save(f"{D}/{out}_hover.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{D}/none.png"); Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{D}/none_hover.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{D}/face_.png")

    T = "textures/ui/cobblemon/dialogue"
    def field(name):
        if name == "text": return f"(#form_text - ('%.{DIALOGUE_TEXT}s' * #form_text))"
        a, b = DIALOGUE_FIELDS[name]
        return f"('%.{b}s' * #form_text)" if a == 0 else f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def at(x, y, w, h):   # a top-left position relative to the screen's middle, as a centred control's offset
        return {"anchor_from": "center", "anchor_to": "center", "offset": [x + w / 2, y + h / 2], "size": [w, h]}
    def image(name, texture, x, y, w, h, layer):
        return {name: {"type": "image", "texture": f"{T}/{texture}", "layer": layer, "keep_ratio": False, **at(x, y, w, h)}}
    bx, by = -98, -30 - 37
    controls = [
        image("box", "box", bx, by, 196, 74, 1),
        image("name_plate", "name", bx, by - 17 + 1, 196, 17, 2),
        {"name": {"type": "label", "text": "#value", "shadow": True, "text_alignment": "center", "layer": 3, **at(bx, by - 17 + 1 + 5, 196, 10),
                  "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view", "source_property_name": "(#title_text - 'cbm:dialogue')", "target_property_name": "#value"}]}},
        # the text: DialogueBox's lines of 168 in the box's grey
        {"text": {"type": "label", "text": "#value", "shadow": False, "color": [0.3, 0.3, 0.3], "layer": 3, **at(bx + 14, by + 6, 168, 62),
                  "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": field("text"), "target_property_name": "#value"}]}},
        image("portrait_bg", "portrait_background", bx - 38 + 1, by - 17 + 1, 38, 36, 2),
        {"face": {"type": "image", "layer": 3, "keep_ratio": True, **at(bx - 38 + 1 + 3, by - 17 + 1 + 3, 32, 30),
                  "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                               "source_property_name": f"('{T}/face_' + ({field('face')} - ' '))", "target_property_name": "#texture"}]}},
        image("portrait_frame", "portrait_left", bx - 38 + 1, by - 17 + 1, 38, 36, 4),
        image("arrow", "arrow", bx - 38 + 1 + 38 - 6, by - 17 + 1 + 36 - 6, 6, 11, 5)]

    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 1, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}],
                "controls": [{"label": {"type": "label", "text": "#form_button_text", "shadow": True, "layer": 2, "text_alignment": "center",
                                        "size": ["100%", 10], "offset": [0, 1],
                                        "bindings": [{"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}]}}]}
    def button(index, x, y, w, h, layout):
        return {f"b{layout}{index}": {"type": "button", "collection_index": index, "layer": 6, **at(x, y, w, h),
                                      "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                      "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                          {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                      "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"},
                                                   {"binding_name": "#form_text"}, {"binding_type": "view",
                                                    "source_property_name": f"({field('layout')} = '{layout}')", "target_property_name": "#visible"}],
                                      "controls": [{"default": face("")}, {"hover": face("_hover")}, {"pressed": face("_hover")}]}}
    buttons = [button(n, -(4 + 96) / 2 * 1 - 48 + n * 100, by + 74 + 7, 96, 21, "h") for n in range(2)]
    buttons += [button(n, bx, by + 74 + 7 + n * 25, 196, 21, "v") for n in range(6)]
    buttons += [button(0, bx, by, 196, 74, "n")]   # a scene with no options goes on with a click on the box
    dialogue = {"type": "panel", "size": ["100%", "100%"],
                "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                             "source_property_name": "(not ((#title_text - 'cbm:dialogue') = #title_text))", "target_property_name": "#visible"}],
                "controls": controls + [{"buttons": {"type": "collection_panel", "size": ["100%", "100%"], "collection_name": "form_buttons", "controls": buttons}}]}
    return {"cobblemon_dialogue": dialogue}


def create_interact_ui():
    W = f"{uiTextures}/interact"
    fresh(W)
    src = f"{guiMain}/interact"
    shutil.copyfile(f"{src}/interact_wheel_base.png", f"{W}/base.png")
    def dim(image, alpha=0.45):
        out = image.copy(); out.putalpha(out.getchannel("A").point(lambda v: int(v * alpha))); return out
    # each option's icon is drawn onto its button (at twice the size, so the icons' half-pixel offsets land on a
    # pixel), one texture per button, icon and state, since a form button carries a single texture
    icons = {key: Image.open(f"{src}/interact_wheel_icon_{name}.png").convert("RGBA") for key, name in
             (("held", "held_item"), ("cosmetic", "cosmetic_item"), ("ride", "ride"), ("shoulder", "shoulder"), ("battle", "battle"))}
    # the port's own two: the Summary's info tab icon, and the pasture's move icon for Stay and Follow
    icons["summary"] = Image.open(f"{guiMain}/summary/summary_tab_icon_info.png").convert("RGBA")
    move = Image.open(f"{guiMain}/pasture/pasture_slot_icon_move.png").convert("RGBA")
    icons["follow"] = move.crop((0, 0, move.width, move.height // 2))
    for name, _, (w, h) in WHEEL:
        frames = Image.open(f"{src}/interact_wheel_button_{name}.png").convert("RGBA")
        normal, hover = (frames.crop((0, top, w, top + h)).resize((w * 2, h * 2), Image.NEAREST) for top in (0, h))
        Image.new("RGBA", (w, h), (0, 0, 0, 0)).save(f"{W}/{name}_none.png"); Image.new("RGBA", (w, h), (0, 0, 0, 0)).save(f"{W}/{name}_none_hover.png")
        ix, iy = WHEEL_ICON[name]
        for key, icon in icons.items():
            icon = icon.resize((32, 32), Image.NEAREST)
            for state, frame in (("", normal), ("_hover", hover)):
                out = frame.copy(); out.alpha_composite(icon, (int(ix * 2), int(iy * 2)))
                out.save(f"{W}/{name}_{key}{state}.png")
                dim(out).save(f"{W}/{name}_{key}_off{state}.png")

    T = "textures/ui/cobblemon"
    def face(state):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2, "keep_ratio": False,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}]}
    controls = [{"base": {"type": "image", "texture": f"{T}/interact/base", "size": [170, 170], "layer": 1}}]
    buttons = []
    for index, (name, (x, y), (w, h)) in enumerate(WHEEL):
        # the hovered option's name, in the middle of the wheel
        tip = {"type": "label", "text": "#form_button_text", "size": [120, 10], "layer": 9, "text_alignment": "center", "shadow": True,
               "anchor_from": "center", "anchor_to": "center", "offset": [85 - (x + w / 2), 85 - (y + h / 2)],
               "bindings": [{"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}]}
        hover = face("_hover"); hover["controls"] = [{"tip": tip}]
        buttons.append({f"button_{index}": {"type": "button", "size": [w, h], "offset": [x, y], "anchor_from": "top_left", "anchor_to": "top_left",
                                            "collection_index": index, "layer": 5, "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                                            "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                                                {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                                            "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                                            "controls": [{"default": face("")}, {"hover": hover}, {"pressed": face("_hover")}]}})
    wheel = {"type": "panel", "size": [170, 170], "anchor_from": "center", "anchor_to": "center",
             "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                          "source_property_name": "(not ((#title_text - 'cbm:interact') = #title_text))", "target_property_name": "#visible"}],
             "controls": controls + [{"buttons": {"type": "collection_panel", "size": [170, 170], "collection_name": "form_buttons", "controls": buttons}}]}
    return {"cobblemon_interact": wheel}


def create_battle_ui():
    for folder in ("battle", "types"): os.makedirs(f"{uiTextures}/{folder}", exist_ok=True)
    def frames(name, height):
        image = Image.open(f"{guiMain}/battle/{name}.png").convert("RGBA")
        return image.crop((0, 0, image.width, height)), image.crop((0, height, image.width, height * 2))
    for option in ("fight", "bag", "switch", "run", "forfeit"):
        normal, hover = frames(f"battle_menu_{option}", 26)
        normal.save(f"{uiTextures}/battle/menu_{option}.png"); hover.save(f"{uiTextures}/battle/menu_{option}_hover.png")
    normal, hover = frames("battle_back", 34)
    normal.save(f"{uiTextures}/battle/back.png"); hover.save(f"{uiTextures}/battle/back_hover.png")
    # BattleMoveSelection: the move tile tinted by its type's hue, the overlay over it, half opacity when it cannot be picked
    tile, tile_hover = frames("battle_move", 24)
    overlay = Image.open(f"{guiMain}/battle/battle_move_overlay.png").convert("RGBA")
    small = Image.open(f"{guiMain}/types_small.png").convert("RGBA")
    for n, (type_name, hue) in enumerate(TYPE_HUES):
        rgb = ((hue >> 16) & 255, (hue >> 8) & 255, hue & 255)
        for suffix, base in (("", tile), ("_hover", tile_hover)):
            tinted = Image.new("RGBA", base.size)
            px, out = base.load(), tinted.load()
            for x in range(base.width):
                for y in range(base.height):
                    r, g, b, a = px[x, y]
                    out[x, y] = (r * rgb[0] // 255, g * rgb[1] // 255, b * rgb[2] // 255, a)
            tinted.alpha_composite(overlay)
            tinted.save(f"{uiTextures}/battle/move_{type_name}{suffix}.png")
            faded = tinted.copy(); faded.putalpha(faded.getchannel("A").point(lambda v: v // 2))
            faded.save(f"{uiTextures}/battle/move_{type_name}_off{suffix}.png")
        small.crop((n * 18, 0, n * 18 + 18, 18)).save(f"{uiTextures}/types/{type_name}.png")
    for name in ("battle_info_base", "battle_info_base_flipped", "battle_info_underlay"):
        shutil.copyfile(f"{guiMain}/battle/{name}.png", f"{uiTextures}/battle/{name[len('battle_'):]}.png")
    for status in ("brn", "par", "psn", "tox", "slp", "frz", "fnt"):
        shutil.copyfile(f"{guiMain}/battle/battle_status_{status}.png", f"{uiTextures}/battle/status_{status}.png")
    Image.new("RGBA", (4, 4), (255, 255, 255, 255)).save(f"{uiTextures}/white.png")
    shutil.copyfile(f"{guiMain}/battle/battle_log.png", f"{uiTextures}/battle/log.png")
    shutil.copyfile(f"{guiMain}/battle/battle_owned_indicator.png", f"{uiTextures}/battle/owned_y.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{uiTextures}/battle/owned_n.png")
    # the switch screen: the underlay, the slot frames (a fainted Pokemon's greyed, the one in battle held on its
    # second frame), the status bars and a 90-pixel health bar per step, as the tile draws them
    shutil.copyfile(f"{guiMain}/battle/selection_underlay.png", f"{uiTextures}/battle/underlay.png")
    for name, out in (("party_select", "pselect"), ("party_select_disabled", "pselect_off")):
        normal, hover = frames(name, 29)
        normal.save(f"{uiTextures}/battle/{out}.png"); hover.save(f"{uiTextures}/battle/{out}_hover.png")
    frames("party_select_disabled", 29)[0].save(f"{uiTextures}/battle/pselect_off_hover.png")
    for suffix in ("", "_hover"): frames("party_select_disabled", 29)[1].save(f"{uiTextures}/battle/pselect_on{suffix}.png")
    frames("party_select_disabled", 29)[1].crop((0, 0, 94, 22)).save(f"{uiTextures}/battle/pselect_empty.png")
    for status in ("brn", "par", "psn", "tox", "slp", "frz"):
        shutil.copyfile(f"{guiMain}/interact/party_select_status_{status}.png", f"{uiTextures}/battle/pstatus_{status.upper()}.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{uiTextures}/battle/pstatus_NON.png")
    for step in range(51):
        width = round(90 * step / 50)
        bar = Image.new("RGBA", (90, 1), (0, 0, 0, 0))
        if width:
            r, g = depletable_red_green(step / 50)
            bar.paste((int(r * 0.8 * 255), int(g * 0.8 * 255), int(0.27 * 255), 255), (0, 0, width, 1))
        bar.save(f"{uiTextures}/battle/hpbar_h{step:02d}.png")

    T = "textures/ui/cobblemon"
    def field(side, name):
        if name == "hptext":
            if side == 1: return f"(('%.{BATTLE_LOG}s' * #form_text) - ('%.{BATTLE_HPTEXT + 12}s' * #form_text))"
            return f"(('%.{BATTLE_HPTEXT + 12}s' * #form_text) - ('%.{BATTLE_HPTEXT}s' * #form_text))"
        a, b = BATTLE_FIELDS[name]
        a, b = a + side * BATTLE_SIDE, b + side * BATTLE_SIDE
        return f"(('%.{b}s' * #form_text) - ('%.{a}s' * #form_text))"
    def text_label(name, source, offset, anchor="top_left", scale=1.0, color=(1, 1, 1)):
        return {name: {"type": "label", "anchor_from": anchor, "anchor_to": anchor, "offset": offset, "size": [100, 10],
                       "font_scale_factor": scale, "shadow": True, "color": list(color), "text": "#value", "layer": 4,
                       "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view", "source_property_name": source, "target_property_name": "#value"}]}}
    def info_tile(side):
        # BattleOverlay.drawBattleTile: the ally's tile at the top left, the foe's flipped at the top right
        reversed_ = side == 1
        info_x = 7 if reversed_ else 28 + 5 + 7
        controls = [
            {"base": {"type": "image", "texture": f"{T}/battle/{'info_base_flipped' if reversed_ else 'info_base'}", "size": [140, 40], "layer": 1}},
            {"portrait": {"type": "image", "texture": f"{T}/battle/info_underlay", "size": [28, 28], "layer": 2,
                          "anchor_from": "top_left", "anchor_to": "top_left", "offset": [140 - 28 - 5 if reversed_ else 5, 8]}},
            # the Pokemon's portrait in the tile's window, Cobblemon's model rendered offline
            {"model": {"type": "image", "size": [26, 26], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left",
                       "offset": [140 - 28 - 5 + 1 if reversed_ else 6, 9], "keep_ratio": True,
                       "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                    "source_property_name": f"('textures/ui/cobblemon/icons/' + {field(side, 'icon')})", "target_property_name": "#texture"}]}},
            # the name moves 7 right when the species is caught, to make room for BattleOverlay's caught indicator
            {"name": {**text_label("name", field(side, "name"), [info_x, 7])["name"], "bindings": text_label("name", field(side, "name"), [info_x, 7])["name"]["bindings"]
                      + [{"binding_type": "view", "source_property_name": f"({field(side, 'owned')} = 'n')", "target_property_name": "#visible"}]}},
            {"name_owned": {**text_label("name_owned", field(side, "name"), [info_x + 7, 7])["name_owned"],
                            "bindings": text_label("name_owned", field(side, "name"), [info_x + 7, 7])["name_owned"]["bindings"]
                            + [{"binding_type": "view", "source_property_name": f"({field(side, 'owned')} = 'y')", "target_property_name": "#visible"}]}},
            {"owned": {"type": "image", "size": [5, 5], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left", "offset": [7, 9],   # x + 7, y + 9 on either tile, at half size
                       "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                    "source_property_name": f"('{T}/battle/owned_' + {field(side, 'owned')})", "target_property_name": "#texture"}]}},
            {"gender": {"type": "image", "size": [5, 7], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left", "offset": [info_x + 58, 8],
                        "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                     "source_property_name": f"('{T}/summary/g' + {field(side, 'gender')})", "target_property_name": "#texture"}]}},
            text_label("level", field(side, "level"), [info_x + 66, 7]),
            {"hp_text": {**text_label("hp_text", field(side, "hptext"), [info_x + (39.5 if not reversed_ else 44.5) - 50, 22], scale=0.5)["hp_text"], "text_alignment": "center"}},
        ]
        # the health bar: 97 pixels at full health, its colour depleting from green through yellow to red
        for step in range(51):
            ratio = step / 50
            width = round(97 * ratio)
            if width == 0: continue
            r, g = depletable_red_green(ratio)
            x = info_x - 2 if not reversed_ else info_x - 2 + (97 - width)
            controls.append({f"hp_{step:02d}": {"type": "image", "texture": f"{T}/white", "size": [width, 4], "keep_ratio": False, "offset": [x, 22], "layer": 3,
                                                "anchor_from": "top_left", "anchor_to": "top_left", "color": [r * 0.8, g * 0.8, 0.27],
                                                "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                                             "source_property_name": f"({field(side, 'hp')} = 'h{step:02d}')", "target_property_name": "#visible"}]}})
        for status in ("brn", "par", "psn", "tox", "slp", "frz", "fnt"):
            controls.append({f"status_{status}": {"type": "image", "texture": f"{T}/battle/status_{status}", "size": [74, 7], "layer": 3,
                                                  "anchor_from": "top_left", "anchor_to": "top_left", "offset": [info_x - 2, 30],
                                                  "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                                                               "source_property_name": f"({field(side, 'status')} = '{status}')", "target_property_name": "#visible"}]}})
        return {f"info_{side}": {"type": "panel", "size": [140, 40], "anchor_from": "top_right" if reversed_ else "top_left",
                                 "anchor_to": "top_right" if reversed_ else "top_left", "offset": [-12 if reversed_ else 12, 10], "controls": controls}}

    def face(state, label_controls):
        return {"type": "image", "size": ["100%", "100%"], "layer": 2,
                "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                             {"binding_type": "view", "source_property_name": f"(#form_button_texture + '{state}')", "target_property_name": "#texture"}],
                "controls": label_controls}
    def button_label(name, source, offset, scale=1.0, anchor="top_left", size=(90, 10), align="left"):
        return {name: {"type": "label", "anchor_from": anchor, "anchor_to": anchor, "offset": offset, "size": list(size), "text_alignment": align,
                       "font_scale_factor": scale, "shadow": True, "text": "#value", "layer": 3,
                       "bindings": [{"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                                    {"binding_type": "view", "source_property_name": source, "target_property_name": "#value"}]}}
    def button(size, labels):
        return {"type": "button", "size": size, "layer": 2,
                "default_control": "default", "hover_control": "hover", "pressed_control": "pressed",
                "button_mappings": [{"from_button_id": "button.menu_select", "to_button_id": "button.form_button_click", "mapping_type": "pressed"},
                                    {"from_button_id": "button.menu_ok", "to_button_id": "button.form_button_click", "mapping_type": "focused"}],
                "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}],
                "controls": [{"default": face("", labels)}, {"hover": face("_hover", labels)}, {"pressed": face("_hover", labels)}]}
    shown = {"binding_type": "view", "source_property_name": "(not (#form_button_text = ''))", "target_property_name": "#visible"}
    text_binding = {"binding_name": "#form_button_text", "binding_type": "collection", "binding_collection_name": "form_buttons"}
    # BattleOptionTile: 90 by 26, the label 6 in and 8 down
    menu_item = {"type": "panel", "size": [93, 29], "bindings": [text_binding, shown],
                 "controls": [{"tile": {**button([90, 26], [button_label("label", "#form_button_text", [6, 8])]), "anchor_from": "top_left", "anchor_to": "top_left"}}]}
    # BattleMoveTile: 92 by 24, the type icon 9 out to the left, the name 17 in, the PP at the right; Back below
    move_labels = [button_label("name", "('%.16s' * #form_button_text)", [17, 3]),
                   # the PP, centred at 75 across and 14 down, gold at half or less and red when out (its colour code leads the text)
                   button_label("pp", "(#form_button_text - ('%.16s' * #form_button_text))", [75 - 20, 14], size=(40, 10), align="center"),
                   {"type_icon": {"type": "image", "size": [18, 18], "offset": [-9, 3], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                                  "bindings": [{"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                                               {"binding_type": "view", "source_property_name": f"('{T}/types/' + ((#form_button_texture - '{T}/battle/move_') - '_off'))", "target_property_name": "#texture"}]}}]
    is_back = f"(not ((#form_button_texture - 'battle/back') = #form_button_texture))"
    move_item = {"type": "panel", "size": [105, 29], "bindings": [text_binding, shown], "controls": [
        {"move": {**button([92, 24], move_labels), "anchor_from": "top_left", "anchor_to": "top_left", "offset": [9, 0],
                  "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"},
                               {"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                               {"binding_type": "view", "source_property_name": f"(not {is_back})", "target_property_name": "#visible"}]}},
        {"back": {**button([29, 17], []), "anchor_from": "top_left", "anchor_to": "top_left", "offset": [-8, 4],
                  "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"},
                               {"binding_name": "#form_button_texture", "binding_type": "collection", "binding_collection_name": "form_buttons"},
                               {"binding_type": "view", "source_property_name": is_back, "target_property_name": "#visible"}]}}]}
    # BattleMessagePane: the 169 by 55 log frame 12 in from the right and 30 up from the bottom, its text box 6 in,
    # 153 by 46, showing the last lines (Bedrock's font drawn at 0.8 to fit Cobblemon's 146-pixel lines) with the newest at the bottom
    battle_log = {"log": {"type": "panel", "size": [169, 55], "anchor_from": "bottom_right", "anchor_to": "bottom_right", "offset": [-12, -30], "controls": [
        {"frame": {"type": "image", "texture": f"{T}/battle/log", "size": [169, 55], "layer": 1}},
        {"box": {"type": "panel", "size": [153, 46], "offset": [5, 6], "anchor_from": "top_left", "anchor_to": "top_left", "clips_children": True, "controls": [
            {"lines": {"type": "label", "size": [146, "default"], "anchor_from": "bottom_left", "anchor_to": "bottom_left", "offset": [1, -1], "layer": 3,
                       "shadow": True, "font_scale_factor": 0.8, "text": "#value", "bindings": [{"binding_name": "#form_text"}, {"binding_type": "view",
                       "source_property_name": f"(#form_text - ('%.{BATTLE_LOG}s' * #form_text))", "target_property_name": "#value"}]}}]}}]}}
    # BattleSwitchPokemonSelection: the underlay across the screen, "Party", and six 94 by 29 tiles two by three
    # from the middle (4 apart across, 2 down), each with its level, name, portrait, ball, health bar and number and
    # status; the Back button at the bottom left when the switch is not forced
    def tile_field(name):
        if name == "hptext": return f"(#form_button_text - ('%.{SWITCH_HPTEXT}s' * #form_button_text))"
        a, b = SWITCH_FIELDS[name]
        return f"(('%.{b}s' * #form_button_text) - ('%.{a}s' * #form_button_text))"
    def tile_image(name, size, offset, source, layer=4):
        return {name: {"type": "image", "size": size, "offset": offset, "layer": layer, "anchor_from": "top_left", "anchor_to": "top_left",
                       "bindings": [text_binding, {"binding_type": "view", "source_property_name": source, "target_property_name": "#texture"}]}}
    tile_labels = [button_label("level", tile_field("level"), [5, 4]), button_label("name", tile_field("name"), [5, 12]),
                   tile_image("portrait", [26, 26], [62, 0], f"('{T}/icons/' + {tile_field('icon')})", 3),
                   tile_image("ball", [9, 11], [85, -3], f"('{T}/party/' + {tile_field('ball')})", 5),
                   tile_image("hp", [90, 1], [1, 22], f"('{T}/battle/hpbar_' + {tile_field('hp')})"),
                   button_label("hptext", tile_field("hptext"), [14 - 20, 24], scale=0.5, size=(40, 6), align="center"),
                   tile_image("status", [37, 5], [27, 24], f"('{T}/battle/pstatus_' + {tile_field('status')})"),
                   # no status leaves the field "NON", which the label subtracts away
                   button_label("status_text", f"({tile_field('status')} - 'NON')", [32, 24.5], scale=0.5, size=(20, 5))]
    switch_buttons = []
    for index in range(6):
        column, row = index % 2, index // 2
        offset = [1 + column * 98, 34 + row * 31]
        switch_buttons.append({f"empty_{index}": {"type": "image", "texture": f"{T}/battle/pselect_empty", "size": [94, 22], "offset": offset, "layer": 1,
                                                  "anchor_from": "top_left", "anchor_to": "top_left"}})
        switch_buttons.append({f"slot_{index}": {**button([94, 29], tile_labels), "collection_index": index, "offset": offset,
                                                 "anchor_from": "top_left", "anchor_to": "top_left",
                                                 "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}, text_binding, shown]}})
    switch_screen = {"switch": {"type": "panel", "size": ["100%", "100%"],
                                "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                                             "source_property_name": "(not ((#title_text - 'cbm:battle_switch') = #title_text))", "target_property_name": "#visible"}],
                                "controls": [
        {"underlay": {"type": "image", "texture": f"{T}/battle/underlay", "size": ["100%", 148], "keep_ratio": False, "layer": 1}},
        {"title": {"type": "label", "text": "Party", "shadow": True, "size": [100, 10], "text_alignment": "center", "offset": [0, 17 - 74 + 5], "layer": 2}},
        {"tiles": {"type": "collection_panel", "collection_name": "form_buttons", "size": [192, 148], "layer": 2, "controls": switch_buttons}},
        {"back_panel": {"type": "collection_panel", "collection_name": "form_buttons", "size": ["100%", "100%"], "layer": 5, "controls": [
            {"back": {**button([29, 17], []), "collection_index": 6, "anchor_from": "bottom_left", "anchor_to": "bottom_left", "offset": [9, -5],
                      "bindings": [{"binding_type": "collection_details", "binding_collection_name": "form_buttons"}, text_binding, shown]}}]}}]}}
    def grid(name, template, item_size, offset, marker):
        return {name: {"type": "grid", "size": [item_size[0] * 2, item_size[1] * 3], "grid_dimensions": [2, 3],
                       "grid_item_template": f"server_form.{template}", "collection_name": "form_buttons",
                       "anchor_from": "bottom_left", "anchor_to": "top_left", "offset": offset,
                       "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                                    "source_property_name": f"(not ((#title_text - '{marker}') = #title_text))", "target_property_name": "#visible"}]}}
    ui = {
        "namespace": "server_form",
        # the vanilla panel is sized 0 by 0 at the centre; the battle layout anchors to the screen's corners
        "main_screen_content": {"size": ["100%", "100%"], "modifications": [{"array_name": "controls", "operation": "insert_back", "value": {
            "cobblemon_battle_factory": {"type": "panel", "factory": {"name": "server_form_factory", "control_ids": {"long_form": "@server_form.cobblemon_forms"}}}}}]},
        # the vanilla form stays for every other form
        "long_form": {"modifications": [{"array_name": "bindings", "operation": "insert_back", "value": [
            {"binding_name": "#title_text"}, {"binding_type": "view", "source_property_name": "((#title_text - 'cbm:') = #title_text)", "target_property_name": "#visible"}]}]},
        "cobblemon_forms": {"type": "panel", "size": ["100%", "100%"], "controls": [{"battle@server_form.cobblemon_battle": {}}, {"summary@server_form.cobblemon_summary": {}},
                                                                                       {"pc@server_form.cobblemon_pc": {}}, {"pasture@server_form.cobblemon_pasture": {}},
                                                                                       {"pokedex@server_form.cobblemon_pokedex": {}}, {"starter@server_form.cobblemon_starter": {}},
                                                                                       {"interact@server_form.cobblemon_interact": {}},
                                                                                       {"dialogue@server_form.cobblemon_dialogue": {}}]},
        "cobblemon_battle": {"type": "panel", "size": ["100%", "100%"],
                             "bindings": [{"binding_name": "#title_text"}, {"binding_type": "view",
                                          "source_property_name": "(not ((#title_text - 'cbm:battle') = #title_text))", "target_property_name": "#visible"}],
                             "controls": [info_tile(0), info_tile(1), battle_log, switch_screen,
                                          grid("menu_grid", "cobblemon_menu_item", [93, 29], [12, -85], "cbm:battle_menu"),
                                          grid("move_grid", "cobblemon_move_item", [105, 29], [11, -84], "cbm:battle_moves")]},
        "cobblemon_menu_item": menu_item,
        "cobblemon_move_item": move_item,
    }
    ui.update(create_summary_ui())
    ui.update(create_pc_ui())
    ui.update(create_pokedex_ui())
    ui.update(create_starter_ui())
    ui.update(create_interact_ui())
    ui.update(create_dialogue_ui())
    os.makedirs(f"{resourcePack}/ui", exist_ok=True)
    with open(f"{resourcePack}/ui/server_form.json", "w", encoding="utf-8") as file: file.write(json.dumps(ui, indent=2))
    print("  battle screen: Cobblemon's battle tiles and move tiles as a JSON UI layout")


# ---------------------------------------------------------------------------
# Party HUD, after PartyOverlay: six 62 by 30 slots down the middle of the left edge, each with its level, name,
# gender, a vertical health bar and experience bar, the ball it was caught in, and the fainted slot when it has
# fainted. main.js sends the party as a title starting "cbm:party" with one fixed-width record per slot; the HUD
# keeps the last such title (bedrock.dev's preserved title pattern) and hides the vanilla title for it. The bars
# and ball icons are textures picked by name from the record, since a field of digits alone is read as a number.
# ---------------------------------------------------------------------------

PARTY_MARKER = "cbm:party"
# The Pokedex scanner (PokedexScannerRenderer), a second HUD layer on its own preserved title: the overlay's state, the
# inner ring's pace, the middle ring's segments, which side each info frame is on and the text on each side, the
# registered frame, the unknown mark and pointers, then the registered text to the end
SCAN_MARKER = "cbm:scan"
SCAN_FIELDS = {"state": (0, 2), "outer": (2, 4), "ring": (4, 6), "seg": (6, 8), **{f"f{k}": (8 + k, 9 + k) for k in range(4)},
               **{f"t{k}{side}": (12 + 40 * k + (20 if side == "r" else 0), 32 + 40 * k + (20 if side == "r" else 0)) for k in range(4) for side in "lr"},
               "reg": (172, 173), "unknown": (173, 174)}
SCAN_TEXT = 174
PARTY_FIELDS = {"name": (0, 12), "level": (12, 18), "hp": (18, 21), "exp": (21, 24), "ball": (24, 27), "state": (27, 28), "gender": (28, 29), "icon": (29, 34),
                "note": (34, 36), "exp_text": (36, 46), "held": (46, 49)}
PARTY_RECORD = 49   # a title drops line breaks, so the level is one line, "Lv.16", where Cobblemon stacks "Lv." over the number


def scan_code(n):
    """A frame number as a letter and a digit (7 is "a7", 23 is "c3"): a field of digits alone is read as a number,
    which drops a leading zero from the texture's name."""
    return chr(97 + n // 10) + str(n % 10)


def create_scan_hud():
    """PokedexScannerRenderer as a HUD layer: scanlines, borders, corners and notch across the screen; the outer and
    inner rings turning (frames rotated as renderScanRings turns them, picked by the script), the middle ring's segments
    filling with the scan, the four info frames at their places with the level, species, size and types, the
    registered frame, and the unknown mark and pointers while a scan runs."""
    src, out = f"{guiMain}/pokedex/scan", f"{uiTextures}/scan"
    fresh(out)
    blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    def load(name): return Image.open(f"{src}/{name}.png").convert("RGBA")
    corners = load("overlay_corners")
    parts = {"lines": load("overlay_scanlines"), "top": load("overlay_border_top"), "bottom": load("overlay_border_bottom"),
             "left": load("overlay_border_left"), "right": load("overlay_border_right"), "notch": load("overlay_notch"),
             "tl": corners.crop((0, 0, 4, 4)), "tr": corners.crop((4, 0, 8, 4)), "bl": corners.crop((0, 4, 4, 8)), "br": corners.crop((4, 4, 8, 8))}
    for name, image in parts.items(): image.save(f"{out}/{name}_on.png"); blank.save(f"{out}/{name}_of.png")
    # the outer and inner rings, turned anticlockwise in 15 degree steps; the script picks the frame for the angle
    # renderScanRings has reached (the outer half a degree an update, the inner one idle and ten on a Pokemon)
    for ring in ("outer", "inner"):
        image = load(f"scan_ring_{ring}")
        for n in range(24): image.rotate(n * 15, resample=Image.NEAREST).save(f"{out}/{ring}_{scan_code(n)}.png")
        blank.save(f"{out}/{ring}_of.png")
    # the middle ring: a 100 by 1 spoke every 4.5 degrees, as many as the scan leaves (40 before it, then fewer)
    spoke = load("scan_ring_middle")
    for count in range(41):
        ring = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        line = Image.new("RGBA", (100, 100), (0, 0, 0, 0)); line.alpha_composite(spoke, (0, 50))
        for i in range(count): ring.alpha_composite(line.rotate(-i * 4.5, resample=Image.NEAREST))
        ring.save(f"{out}/mid_{scan_code(count)}.png")
    blank.save(f"{out}/mid_of.png")
    # the info frames at full focus (the last of their ten frames), a pair of images a frame, one a side
    for k in range(4):
        for side, name in (("l", "left"), ("r", "right")):
            frame = load(f"scan_info_frame_{name}_{k}")
            h = frame.height // 10
            frame.crop((0, h * 9, frame.width, h * 10)).save(f"{out}/frame{k}{side}_{side}.png")
            for other in "lrx":
                if other != side: blank.save(f"{out}/frame{k}{side}_{other}.png")
    center = load("scan_info_frame")
    center.crop((0, 16 * 5, 128, 16 * 6)).save(f"{out}/center_y.png"); blank.save(f"{out}/center_n.png")
    load("scan_unknown").save(f"{out}/unknown_y.png"); blank.save(f"{out}/unknown_n.png")
    pointer = load("pointer")
    pointer.crop((0, 0, 6, 10)).save(f"{out}/pointerl_y.png"); pointer.crop((6, 0, 12, 10)).save(f"{out}/pointerr_y.png")
    blank.save(f"{out}/pointerl_n.png"); blank.save(f"{out}/pointerr_n.png")

    T = "textures/ui/cobblemon/scan"
    def field(name):
        if name == "text": return f"(#preserved_text - ('%.{len(SCAN_MARKER) + SCAN_TEXT}s' * #preserved_text))"
        a, b = SCAN_FIELDS[name]
        a, b = len(SCAN_MARKER) + a, len(SCAN_MARKER) + b
        return f"(('%.{b}s' * #preserved_text) - ('%.{a}s' * #preserved_text))"
    def from_data(source, target):
        return {"binding_type": "view", "source_control_name": "data_control", "resolve_sibling_scope": True,
                "source_property_name": source, "target_property_name": target}
    def part(name, texture, source, size, anchor, offset=(0, 0), layer=1, **extra):
        # before any scan record arrives the field is empty and the name is the bare prefix, which draws nothing
        blank.save(f"{out}/{texture}.png")
        return {name: {"type": "image", "size": size, "offset": list(offset), "anchor_from": anchor, "anchor_to": anchor, "layer": layer, "keep_ratio": False,
                       "bindings": [from_data(f"('{T}/{texture}' + {field(source)})", "#texture")], **extra}}
    def text(name, source, offset, size=(92, 10), scale=1.0):
        return {name: {"type": "label", "size": list(size), "offset": list(offset), "anchor_from": "center", "anchor_to": "center", "layer": 6,
                       "text_alignment": "center", "shadow": True, "font_scale_factor": scale, "text": "#value", "bindings": [from_data(source, "#value")]}}
    controls = [
        {"data_control": {"type": "panel", "size": [0, 0], "property_bag": {"#preserved_text": ""}, "bindings": [
            {"binding_name": "#hud_title_text_string"},
            {"binding_name": "#hud_title_text_string", "binding_name_override": "#preserved_text", "binding_condition": "visibility_changed"},
            {"binding_type": "view", "source_property_name":
                f"(not (#hud_title_text_string = #preserved_text) and not ((#hud_title_text_string - '{SCAN_MARKER}') = #hud_title_text_string))",
             "target_property_name": "#visible"}]}},
        part("lines", "lines_", "state", ["100%", "100%"], "top_left", tiled=True),
        part("tl", "tl_", "state", [4, 4], "top_left", layer=2), part("tr", "tr_", "state", [4, 4], "top_right", layer=2),
        part("bl", "bl_", "state", [4, 4], "bottom_left", layer=2), part("br", "br_", "state", [4, 4], "bottom_right", layer=2),
        part("top", "top_", "state", ["100% - 8px", 3], "top_middle", layer=2), part("bottom", "bottom_", "state", ["100% - 8px", 3], "bottom_middle", layer=2),
        part("left", "left_", "state", [3, "100% - 8px"], "left_middle", layer=2), part("right", "right_", "state", [3, "100% - 8px"], "right_middle", layer=2),
        part("notch", "notch_", "state", [200, 12], "top_middle", layer=3),
        part("outer", "outer_", "outer", [116, 116], "center", layer=4),
        part("inner", "inner_", "ring", [84, 84], "center", layer=4),
        part("middle", "mid_", "seg", [100, 100], "center", layer=4),
        part("center", "center_", "reg", [128, 16], "center", layer=5),
        text("registered", field("text"), (0, -3), size=(128, 10)),
        part("unknown", "unknown_", "unknown", [34, 46], "center", (0, 2), layer=5),
        part("pointer_l", "pointerl_", "unknown", [6, 10], "center", (-30 - 3, 0), layer=5),
        part("pointer_r", "pointerr_", "unknown", [6, 10], "center", (30 + 3, 0), layer=5)]
    # renderInfoFrames: each frame at its place for its side, its text centred in it
    for k in range(4):
        inner = k in (1, 2)
        w, h = (120, 20) if inner else (92, 55)
        y = {0: -80, 1: -26, 2: 6, 3: 25}[k]
        for side in "lr":
            x = (-177 if inner else -120) + (0 if side == "l" else (234 if inner else 148))
            controls.append(part(f"frame{k}{side}", f"frame{k}{side}_", f"f{k}", [w, h], "center", (x + w / 2, y + h / 2), layer=5))
            text_x = x + (((120 - 28) / 2 + (0 if side == "l" else 28)) if inner else 92 / 2)
            text_y = y + {0: 5, 1: 4, 2: 8, 3: 42}[k]
            controls.append(text(f"text{k}{side}", field(f"t{k}{side}"), (text_x, text_y + 5)))
    return {"cobblemon_scan": {"type": "panel", "size": ["100%", "100%"], "controls": controls}}


def create_party_hud():
    party = f"{uiTextures}/party"
    os.makedirs(party, exist_ok=True)
    for state, name in (("n", "party_slot"), ("x", "party_slot_fainted")):
        shutil.copyfile(f"{guiMain}/party/{name}.png", f"{party}/slot_{state}.png")
    for state in ("n", "x"): shutil.copyfile(f"{guiMain}/party/party_slot_portrait_background.png", f"{party}/portrait_{state}.png")
    # an empty slot's record (state "e", ball "bxx") draws nothing: a view binding cannot hide these parts
    for name in ("slot_e", "portrait_e", "bxx"): Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{party}/{name}.png")
    # named by the record's gender field, which the texture binding appends to the folder
    shutil.copyfile(f"{guiMain}/party/party_gender_male.png", f"{party}/m.png")
    shutil.copyfile(f"{guiMain}/party/party_gender_female.png", f"{party}/f.png")
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{party}/o.png")   # genderless, and an empty slot
    # the held item's icon (PartyOverlay's renderScaledGuiItemIcon, half size at 12, 14): each icon the model can show,
    # named by its HELD_INDEX as "h" and two letters, since digits alone read as a number; vanilla items have no copy
    with open(f"{scriptsBedrock}/held_display.js", encoding="utf-8") as file:
        icons = json.loads(re.search(r"HELD_ICONS = (\[.*?\]);", file.read()).group(1))
    for n, icon in enumerate(icons, 1):
        source = f"{resourcePack}/{icon}.png"
        target = f"{party}/h{chr(97 + n // 26)}{chr(97 + n % 26)}.png"
        if os.path.exists(source): shutil.copyfile(source, target)
        else: Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(target)   # a vanilla item's icon is not in the pack
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(f"{party}/hzz.png")
    # the slot's pop-ups, two places: the first holds the evolution or the new move, the second the evolution when
    # both show ("nv" evolution, "nm" new move, "vm" both, "nn" none)
    evo, move = f"{guiMain}/party/party_slot_notification_evolution.png", f"{guiMain}/party/party_slot_notification_new_move.png"
    blank = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    for note, first, second in (("nv", evo, None), ("nm", move, None), ("vm", move, evo), ("nn", None, None)):
        (shutil.copyfile(first, f"{party}/a{note}.png") if first else blank.save(f"{party}/a{note}.png"))
        (shutil.copyfile(second, f"{party}/b{note}.png") if second else blank.save(f"{party}/b{note}.png"))
    # the bars, 18 steps tall, filled from the bottom: health in getDepletableRedGreen's colours, experience in Cobblemon's blue
    for step in range(19):
        ratio = step / 18
        r, g = depletable_red_green(ratio)
        for kind, width, colour in (("h", 2, (round(r * 0.8 * 255), round(g * 0.8 * 255), round(0.27 * 255), 255)), ("e", 1, (51, 166, 214, 255))):
            bar = Image.new("RGBA", (width, 18), (0, 0, 0, 0))
            for y in range(18 - step, 18):
                for x in range(width): bar.putpixel((x, y), colour)
            bar.save(f"{party}/{kind}{step:02d}.png")
    for n, info in enumerate(poke_balls()):
        icon = f"{guiMain}/ball/{info['name']}.png"
        if not os.path.exists(icon): icon = f"{guiMain}/ball/poke_ball.png"
        image = Image.open(icon).convert("RGBA")
        image.crop((0, 0, image.width, image.height // 2)).save(f"{party}/b{n:02d}.png")

    T = "textures/ui/cobblemon/party"
    def field(slot, name):
        a, b = PARTY_FIELDS[name]
        a, b = len(PARTY_MARKER) + slot * PARTY_RECORD + a, len(PARTY_MARKER) + slot * PARTY_RECORD + b
        return f"(('%.{b}s' * #preserved_text) - ('%.{a}s' * #preserved_text))"
    def from_data(source, target):
        return {"binding_type": "view", "source_control_name": "data_control", "resolve_sibling_scope": True,
                "source_property_name": source, "target_property_name": target}
    def picture(name, slot, kind, size, offset, layer=2):
        return {name: {"type": "image", "size": size, "offset": offset, "layer": layer, "anchor_from": "top_left", "anchor_to": "top_left",
                       "keep_ratio": False, "bindings": [from_data(f"('{T}/' + {field(slot, kind)})", "#texture")]}}
    def shown(slot, control):
        name, body = next(iter(control.items()))
        state = field(slot, "state")
        body = dict(body); body["bindings"] = body.get("bindings", []) + [from_data(f"(({state} = 'n') or ({state} = 'x'))", "#visible")]
        return {name: body}
    def slot_panel(slot):
        return {f"slot_{slot}": {"type": "panel", "size": [62, 30], "controls": [
            {"data_control": {"type": "panel", "size": [0, 0], "property_bag": {"#preserved_text": ""}, "bindings": [
                {"binding_name": "#hud_title_text_string"},
                {"binding_name": "#hud_title_text_string", "binding_name_override": "#preserved_text", "binding_condition": "visibility_changed"},
                {"binding_type": "view", "source_property_name":
                    f"(not (#hud_title_text_string = #preserved_text) and not ((#hud_title_text_string - '{PARTY_MARKER}') = #hud_title_text_string))",
                 "target_property_name": "#visible"}]}},
            # every part is a sibling of data_control, which is how a view binding finds it, and shows only for a filled slot
            *[c for c in (
                {"slot": {"type": "image", "size": [62, 30], "layer": 1, "bindings": [from_data(f"('{T}/slot_' + {field(slot, 'state')})", "#texture")]}},
                {"portrait": {"type": "image", "size": [21, 21], "offset": [22, 2], "layer": 2, "anchor_from": "top_left", "anchor_to": "top_left",
                              "bindings": [from_data(f"('{T}/portrait_' + {field(slot, 'state')})", "#texture")]}},
                {"model": {"type": "image", "size": [19, 19], "offset": [23, 3], "layer": 3, "anchor_from": "top_left", "anchor_to": "top_left",
                           "keep_ratio": True, "bindings": [from_data(f"('textures/ui/cobblemon/icons/' + {field(slot, 'icon')})", "#texture")]}},
                {"level": {"type": "label", "size": [20, 6], "offset": [1, 14.5], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 3,
                           "font_scale_factor": 0.5, "text_alignment": "left", "shadow": True, "text": "#value",
                           "bindings": [from_data(field(slot, "level"), "#value")]}},
                {"name": {"type": "label", "size": [60, 5], "offset": [2.5, 24.5], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 3,
                          "font_scale_factor": 0.5, "shadow": False, "text": "#value", "bindings": [from_data(field(slot, "name"), "#value")]}},
                picture("gender", slot, "gender", [2.5, 3.5], [40, 25], 3),
                picture("hp", slot, "hp", [2, 18], [46, 5]),
                picture("exp", slot, "exp", [1, 18], [49, 5]),
                picture("ball", slot, "ball", [9, 11], [43.5, 22], 3),
                picture("held", slot, "held", [8, 8], [12, 14], 4),
                # PartyOverlay's pop-ups beside the slot at half size: the new move or evolution 56.5 in and 4 down (under
                # the gained experience), and the evolution at 78 when both show; the experience gained 57 in, 17 down
                {"note_a": {"type": "image", "size": [18.5, 10], "offset": [56.5, 4], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                            "keep_ratio": False, "bindings": [from_data(f"('{T}/a' + {field(slot, 'note')})", "#texture")]}},
                {"note_b": {"type": "image", "size": [18.5, 10], "offset": [78, 4], "layer": 4, "anchor_from": "top_left", "anchor_to": "top_left",
                            "keep_ratio": False, "bindings": [from_data(f"('{T}/b' + {field(slot, 'note')})", "#texture")]}},
                {"exp_text": {"type": "label", "size": [40, 5], "offset": [57, 17], "anchor_from": "top_left", "anchor_to": "top_left", "layer": 4,
                              "font_scale_factor": 0.5, "shadow": True, "text": "#value", "bindings": [from_data(field(slot, "exp_text"), "#value")]}})]]}}
    hud = {
        "namespace": "hud",
        "root_panel": {"modifications": [{"array_name": "controls", "operation": "insert_back", "value": {
            # a full-screen panel, so the slots sit at the screen's own left edge as PartyOverlay's do
            "cobblemon_party": {"type": "panel", "size": ["100%", "100%"], "controls": [{"slots": {
                "type": "stack_panel", "orientation": "vertical", "size": [62, 200], "anchor_from": "left_middle", "anchor_to": "left_middle",
                "offset": [2.5, 0],   # the HUD's root panel reaches 2.5 past the screen's left edge
                "controls": [c for n in range(6) for c in ([slot_panel(n)] + ([{f"gap_{n}": {"type": "panel", "size": [62, 4]}}] if n < 5 else []))]}}]}}}]},
        # a title carrying the party is data, not something to show
        "hud_title_text": {"modifications": [{"array_name": "bindings", "operation": "insert_back", "value": [
            {"binding_name": "#hud_title_text_string", "binding_type": "global"},
            {"binding_type": "view", "source_property_name": f"(((#hud_title_text_string - '{PARTY_MARKER}') = #hud_title_text_string) and "
                                                             f"((#hud_title_text_string - '{SCAN_MARKER}') = #hud_title_text_string))", "target_property_name": "#visible"}]}]},
    }
    hud.update(create_scan_hud())
    hud["root_panel"]["modifications"].append({"array_name": "controls", "operation": "insert_back", "value": {"cobblemon_scan@hud.cobblemon_scan": {}}})
    with open(f"{resourcePack}/ui/hud_screen.json", "w", encoding="utf-8") as file: file.write(json.dumps(hud, indent=2))
    print("  party HUD: Cobblemon's party slots down the left edge")


def create_model_blocks():
    """The Cobblemon blocks with element models the pack has not made elsewhere."""
    made, placers = [], 0
    existing = {os.path.basename(f)[:-len(".json")] for f in glob.glob(f"{blocksBedrock}/*.json")}
    items = defined_items()
    for path in sorted(glob.glob(f"{cobblemon}/blockstates/*.json")):
        name = os.path.basename(path)[:-len(".json")]
        if name in existing or name.startswith("potted_") or f"{name}_block" in existing: continue
        backed = f"cobblemon:{name}" in items
        identifier = f"cobblemon:{name}_block" if backed else f"cobblemon:{name}"
        try:
            if not model_block(name, identifier, items, "items" if backed else "construction"): continue
        except Exception as error:
            print(f"  {name}: {error}"); continue
        made.append(identifier.split(":", 1)[1])
        if backed:
            # the item places its block, as Cobblemon's ItemNameBlockItem does
            for item_path in glob.glob(f"{itemsBedrock}/**/{name}.json", recursive=True):
                with open(item_path, encoding="utf-8") as file: item = json.load(file)
                components = item["minecraft:item"]["components"]
                if "minecraft:block_placer" in components: continue
                components["minecraft:block_placer"] = {"block": identifier}
                with open(item_path, "w", encoding="utf-8") as file: file.write(json.dumps(item, indent=2))
                placers += 1
    with open(f"{resourcePack}/textures/terrain_texture.json", "w") as file:
        file.write(json.dumps({"resource_pack_name": "cobblemon", "texture_name": "atlas.terrain", "padding": 8, "num_mip_levels": 4,
                               "texture_data": terrain_textures}, indent=2))
    with open(f"{textsBedrock}/en_US.lang", "a", encoding="utf-8") as file:
        for block in made:
            name = block[:-len("_block")] if block.endswith("_block") else block
            label = lang.get(f"block.cobblemon.{name}") or lang.get(f"item.cobblemon.{name}") or name.replace("_", " ").title()
            file.write(f"tile.cobblemon:{block}.name={label}" + chr(10))
    chests = create_gilded_chests()
    create_battle_ui()
    create_party_hud()
    with open(f"{textsBedrock}/en_US.lang", "a", encoding="utf-8") as file:
        for chest in chests:
            file.write(f"entity.cobblemon:{chest}_entity.name={lang.get('block.cobblemon.' + chest, chest.replace('_', ' ').title())}" + chr(10))
    print(f"Create model blocks complete: {len(made)} blocks, {placers} items that place theirs, {len(chests)} gilded chests.")
    return made


def create_building_blocks():
    made = create_wood_pieces()
    existing = {os.path.basename(f)[:-len(".json")] for f in glob.glob(f"{blocksBedrock}/*.json")}
    for path in sorted(glob.glob(f"{cobblemon}/blockstates/*.json")):
        name = os.path.basename(path)[:-len(".json")]
        if name in existing or name.startswith("potted_"): continue
        parent, tex = block_model_of(name)
        parent = (parent or "").split(":", 1)[-1]
        identifier = f"cobblemon:{name}"
        base = {"minecraft:destructible_by_mining": {"seconds_to_destroy": 1.5}, "minecraft:loot": block_loot(name)}
        try:
            if parent in ("block/cube_all",) and "all" in tex:
                render = "alpha_test_single_sided" if "leaves" in name else "opaque"
                full_block(identifier, {"*": tex["all"]}, extra=base, render=render)
            elif parent in ("block/cube_column", "block/cube_column_horizontal") and "side" in tex and "end" in tex:
                full_block(identifier, {"*": tex["side"], "up": tex["end"], "down": tex["end"]}, extra=base)
            elif parent == "block/cross" and "cross" in tex:
                with open(f"{blocksBedrock}/{name}.json", "w") as file:
                    file.write(json.dumps({"format_version": "1.21.90", "minecraft:block": {
                        "description": {"identifier": identifier, "menu_category": {"category": "nature"}},
                        "components": {"minecraft:geometry": "minecraft:geometry.cross",
                                       "minecraft:material_instances": {"*": {"texture": java_texture(tex["cross"]), "render_method": "alpha_test", "face_dimming": False, "ambient_occlusion": False}},
                                       "minecraft:collision_box": False, "minecraft:selection_box": {"origin": [-6, 0, -6], "size": [12, 13, 12]},
                                       "minecraft:light_dampening": 0, **base, "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.5}}}}, indent=2))
            elif name.endswith("_slab") and ("bottom" in tex or "side" in tex or "all" in tex):
                side = tex.get("side", tex.get("all", tex.get("bottom"))); top = tex.get("top", side); bottom = tex.get("bottom", top)
                for half, y in (("bottom", 0), ("top", 8)):
                    cube = {"origin": [-8, y, -8], "size": [16, 8, 16], "uv": {
                        f: {"uv": [0, 8 - y], "uv_size": [16, 8], "material_instance": "side"} for f in ("north", "south", "east", "west")}}
                    cube["uv"]["up"] = {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "top"}
                    cube["uv"]["down"] = {"uv": [0, 0], "uv_size": [16, 16], "material_instance": "bottom"}
                    write_block_geometry(f"geometry.cobblemon_slab_{half}", [cube])
                instances = {"*": {"texture": java_texture(side)}, "side": {"texture": java_texture(side)}, "top": {"texture": java_texture(top)}, "bottom": {"texture": java_texture(bottom)}}
                with open(f"{blocksBedrock}/{name}.json", "w") as file:
                    file.write(json.dumps({"format_version": "1.21.90", "minecraft:block": {
                        "description": {"identifier": identifier, "menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.slab"},
                                        "traits": {"minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]}}},
                        "components": {"minecraft:geometry": "geometry.cobblemon_slab_bottom", "minecraft:material_instances": instances,
                                       "minecraft:collision_box": {"origin": [-8, 0, -8], "size": [16, 8, 16]}, "minecraft:selection_box": {"origin": [-8, 0, -8], "size": [16, 8, 16]},
                                       "minecraft:light_dampening": 0, **base},
                        "permutations": [{"condition": "q.block_state('minecraft:vertical_half') == 'top'", "components": {
                            "minecraft:geometry": "geometry.cobblemon_slab_top",
                            "minecraft:collision_box": {"origin": [-8, 8, -8], "size": [16, 8, 16]}, "minecraft:selection_box": {"origin": [-8, 8, -8], "size": [16, 8, 16]}}}]}}, indent=2))
            elif name.endswith("_stairs") and ("side" in tex or "all" in tex or "bottom" in tex):
                side = tex.get("side", tex.get("all", tex.get("bottom"))); top = tex.get("top", side); bottom = tex.get("bottom", top)
                cubes = [{"origin": [-8, 0, -8], "size": [16, 8, 16]}, {"origin": [-8, 8, 0], "size": [16, 8, 8]}]
                for cube in cubes:
                    (x, y, z), (w, h, d) = cube["origin"], cube["size"]
                    u, v = x + 8, 16 - (y + h)
                    cube["uv"] = {"north": {"uv": [u, v], "uv_size": [w, h], "material_instance": "side"}, "south": {"uv": [u, v], "uv_size": [w, h], "material_instance": "side"},
                                  "east": {"uv": [z + 8, v], "uv_size": [d, h], "material_instance": "side"}, "west": {"uv": [z + 8, v], "uv_size": [d, h], "material_instance": "side"},
                                  "up": {"uv": [u, z + 8], "uv_size": [w, d], "material_instance": "top"}, "down": {"uv": [u, z + 8], "uv_size": [w, d], "material_instance": "bottom"}}
                write_block_geometry("geometry.cobblemon_stairs", cubes)
                turns = {"north": 180, "south": 0, "east": 90, "west": 270}
                with open(f"{blocksBedrock}/{name}.json", "w") as file:
                    file.write(json.dumps({"format_version": "1.21.90", "minecraft:block": {
                        "description": {"identifier": identifier, "menu_category": {"category": "construction", "group": "minecraft:itemGroup.name.stairs"},
                                        "traits": {"minecraft:placement_direction": {"enabled_states": ["minecraft:cardinal_direction"], "y_rotation_offset": 180},
                                                   "minecraft:placement_position": {"enabled_states": ["minecraft:vertical_half"]}}},
                        "components": {"minecraft:geometry": "geometry.cobblemon_stairs",
                                       "minecraft:material_instances": {"*": {"texture": java_texture(side)}, "side": {"texture": java_texture(side)}, "top": {"texture": java_texture(top)}, "bottom": {"texture": java_texture(bottom)}},
                                       "minecraft:light_dampening": 0, **base},
                        "permutations": [{"condition": f"q.block_state('minecraft:cardinal_direction') == '{d}' && q.block_state('minecraft:vertical_half') == '{h}'",
                                          "components": {"minecraft:transformation": {"rotation": [180 if h == "top" else 0, r, 0]}}}
                                         for d, r in turns.items() for h in ("bottom", "top")]}}, indent=2))
            elif (name.endswith("_wall") or name.endswith("_fence")) and ("wall" in tex or "texture" in tex or "all" in tex):
                connecting_block(name, tex.get("wall", tex.get("texture", tex.get("all"))), name.endswith("_wall"), base)
            else:
                continue
        except Exception as error:
            print(f"  {name}: {error}"); continue
        made.append(name)
    return made


def main():
    global pokemons
    fix_only = "--fix" in sys.argv
    get_cobblemon()
    if not fix_only:
        copy_animations()
        copy_models()
        copy_textures()
    load_cobblemon_data()
    fix_animations()
    fix_models()
    pokemons = sorted(d for d in next(os.walk(texturesEntityBedrock))[1] if re.match(r"\d{4}_", d))   # not the npcs and poke_ball folders
    if not fix_only:
        download_spawn_egg_textures()
    copy_cries()
    copy_particles()
    create_texts()
    create_animation_controllers()
    create_render_controllers()
    create_client_entities()
    create_behavior_entities()
    create_ambient_particles()
    create_loot_tables()
    create_spawn_rules()
    create_sounds()
    create_items()
    create_poke_ball_entity()
    create_npcs()
    create_blocks()
    create_fishing()
    create_pokedex()
    general_items = create_general_items()
    create_held_display()
    write_item_names(general_items)
    create_model_blocks()
    create_recipes()
    create_structures()
    create_battle_data()
    ensure_script_module()
    bump_pack_versions()


if __name__ == "__main__":
    main()
