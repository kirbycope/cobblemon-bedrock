"""Convert Cobblemon's Java structure templates (.nbt) to Bedrock structures (.mcstructure).

    python tools/nbt_to_mcstructure.py <in.nbt> <out.mcstructure>     one file
    python tools/nbt_to_mcstructure.py --names <folder>                every block name the folder's
                                                                        structures would use, as JSON

port.py imports convert() and runs it over data/cobblemon/structure. A Java template is gzipped big-endian
NBT: a size, a palette of block states and a list of blocks by position. A Bedrock structure is little-endian
NBT: the same size, two layers of palette indices in x, y, z order (-1 for structure void), and a palette of
Bedrock block names and states. Java names become Bedrock names through BLOCK_NAMES, and the states Bedrock
spells differently (log axis, stair facing, slab half, leaves that must not decay) through convert_states();
any other state is dropped and Bedrock uses the block's default. Names listed in tools/bedrock_blocks.json as
invalid (found by placing each one on the server) become air.
"""
import gzip
import io
import json
import os
import random
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# NBT
# ---------------------------------------------------------------------------

END, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, BYTE_ARRAY, STRING, LIST, COMPOUND, INT_ARRAY, LONG_ARRAY = range(13)


class Tag:
    """A value with its NBT type, for writing; reading returns plain Python values."""
    def __init__(self, kind, value, item_kind=None):
        self.kind, self.value, self.item_kind = kind, value, item_kind


def read_nbt(data, little=False):
    stream = io.BytesIO(data)
    order = "<" if little else ">"

    def unpack(fmt, size): return struct.unpack(order + fmt, stream.read(size))[0]

    def read_string(): return stream.read(unpack("H", 2)).decode("utf-8", "replace")

    def payload(kind):
        if kind == BYTE: return unpack("b", 1)
        if kind == SHORT: return unpack("h", 2)
        if kind == INT: return unpack("i", 4)
        if kind == LONG: return unpack("q", 8)
        if kind == FLOAT: return unpack("f", 4)
        if kind == DOUBLE: return unpack("d", 8)
        if kind == BYTE_ARRAY: return list(stream.read(unpack("i", 4)))
        if kind == STRING: return read_string()
        if kind == LIST:
            item_kind = unpack("b", 1); count = unpack("i", 4)
            return [payload(item_kind) for _ in range(count)]
        if kind == COMPOUND:
            result = {}
            while True:
                child = unpack("b", 1)
                if child == END: return result
                name = read_string(); result[name] = payload(child)
        if kind == INT_ARRAY: return [unpack("i", 4) for _ in range(unpack("i", 4))]
        if kind == LONG_ARRAY: return [unpack("q", 8) for _ in range(unpack("i", 4))]
        raise ValueError(f"unknown NBT tag {kind}")

    kind = unpack("b", 1); read_string()
    return payload(kind)


def write_nbt(root, little=True):
    out = io.BytesIO()
    order = "<" if little else ">"

    def pack(fmt, value): out.write(struct.pack(order + fmt, value))

    def write_string(text):
        data = text.encode("utf-8"); pack("H", len(data)); out.write(data)

    def payload(tag):
        kind, value = tag.kind, tag.value
        if kind == BYTE: pack("b", value)
        elif kind == SHORT: pack("h", value)
        elif kind == INT: pack("i", value)
        elif kind == LONG: pack("q", value)
        elif kind == FLOAT: pack("f", value)
        elif kind == STRING: write_string(value)
        elif kind == LIST:
            pack("b", tag.item_kind if value else (tag.item_kind or END)); pack("i", len(value))
            for item in value: payload(item)
        elif kind == COMPOUND:
            for name, child in value.items():
                pack("b", child.kind); write_string(name); payload(child)
            pack("b", END)
        else: raise ValueError(f"cannot write NBT tag {kind}")

    pack("b", COMPOUND); write_string(""); payload(root)
    return out.getvalue()


def compound(**children): return Tag(COMPOUND, dict(children))


def int_list(values): return Tag(LIST, [Tag(INT, v) for v in values], INT)


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

# Java name -> Bedrock name, where they differ
BLOCK_NAMES = {
    "cave_air": "air", "void_air": "air", "dirt_path": "grass_path", "snow_block": "snow", "snow": "snow_layer",
    "cobweb": "web", "magma_block": "magma", "nether_bricks": "nether_brick", "red_nether_bricks": "red_nether_brick",
    "terracotta": "hardened_clay", "jack_o_lantern": "lit_pumpkin", "powered_rail": "golden_rail", "spawner": "mob_spawner",
    "note_block": "noteblock", "lily_pad": "waterlily", "slime_block": "slime", "melon": "melon_block",
    "end_stone_bricks": "end_bricks", "bricks": "brick_block", "sugar_cane": "reeds", "wall_torch": "torch",
    "soul_wall_torch": "soul_torch", "redstone_wall_torch": "redstone_torch", "iron_bars": "iron_bars",
    "oak_sign": "standing_sign", "oak_wall_sign": "wall_sign", "rose_bush": "rose_bush", "nether_quartz_ore": "quartz_ore",
    "quartz_block": "quartz_block", "stone_slab": "normal_stone_slab", "moving_piston": "air", "piston_head": "air",
    "tripwire": "trip_wire", "grass": "short_grass", "water": "water", "lava": "lava",
    "carved_pumpkin": "carved_pumpkin", "frosted_ice": "frosted_ice", "bubble_column": "water",
    # Bedrock's own names, checked against the server with /setblock (the Radical Gyms structures used these)
    "stone_stairs": "normal_stone_stairs", "cobblestone_stairs": "stone_stairs", "dead_bush": "deadbush",
    "end_stone_brick_stairs": "end_brick_stairs", "oak_button": "wooden_button", "oak_pressure_plate": "wooden_pressure_plate", "prismarine_brick_stairs": "prismarine_bricks_stairs",
    "waxed_copper_block": "waxed_copper",
    # Bedrock 1.26's names, from Mojang's own list (bedrock-samples mojang-blocks.json, tools/check_structures.py): a name
    # Bedrock does not know loads as the "?" block
    "rooted_dirt": "dirt_with_roots", "oak_trapdoor": "trapdoor", "flowering_azalea_leaves": "azalea_leaves_flowered",
    "chain": "iron_chain", "tall_seagrass": "seagrass", "cave_vines_plant": "cave_vines", "small_dripleaf": "small_dripleaf_block",
    "repeater": "unpowered_repeater", "comparator": "unpowered_comparator",
    "dirt_block": "dirt",   # a jigsaw's final_state in Cobblemon's flowerbed clearings, which Java does not know either
    # the growing plants' body blocks, which Bedrock does not split from their heads (the feature habitats and coves)
    "kelp_plant": "kelp", "twisting_vines_plant": "twisting_vines", "weeping_vines_plant": "weeping_vines",
    "big_dripleaf_stem": "big_dripleaf",
}
# Cobblemon blocks with a vanilla stand-in; the rest (berries, relic coins) become air until they are ported
COBBLEMON_BLOCKS = {"gilded_chest": "chest", "gimmighoul_chest": "chest", "apricorn_planks": "oak_planks", "habitat_block": "grass_block"}
PACK_BLOCKS = set()   # names of Cobblemon blocks the pack defines; port.py fills it before converting
# the CobbleFurnies blocks the pack defines, each with its Java properties' Bedrock states (port.py's FURNITURE_STATES)
FURNITURE = {}
TWO_PART = {"lower": 0, "upper": 1, "bottom": 0, "top": 1}
FACING_WEIRDO = {"east": 0, "west": 1, "south": 2, "north": 3}
FACING_DIRECTION = {"down": 0, "up": 1, "north": 2, "south": 3, "west": 4, "east": 5}
TORCH_FACING = {"east": "west", "west": "east", "south": "north", "north": "south"}   # Bedrock names the side it hangs from


def bedrock_name(java, props=None):
    name = java.split(":", 1)[1] if ":" in java else java
    if java.startswith("cobblefurnies:"): return f"cobblefurnies:{name}" if name in FURNITURE else None
    if java.startswith("cobblemon:"):
        if name in PACK_BLOCKS: return f"cobblemon:{name}"   # a block the pack has: Cobblemon's own
        if name.endswith("_ore"): return "deepslate" if name.startswith("deepslate") else "stone"
        if name.endswith("_berry"): return f"cobblemon:{name}_bush"
        return COBBLEMON_BLOCKS.get(name)
    if name.startswith("potted_"): return "flower_pot"
    if name.endswith("_wall_sign"): return name[:-len("_wall_sign")] + "_wall_sign" if not name.startswith("oak") else "wall_sign"
    if name.endswith("_sign") and not name.endswith("hanging_sign") and name != "oak_sign": return name[:-len("_sign")] + "_standing_sign"
    if name.endswith("_wall_banner"): return "wall_banner"
    if name.endswith("_banner"): return "standing_banner"
    # each head is its own block in Bedrock now (the old "skull" with a type state is gone)
    if name.endswith("_wall_head") or name.endswith("_head") or name.endswith("_skull"): return name.replace("_wall_", "_")
    if name.endswith("_bed"): return "bed"
    if name == "light": return f"light_block_{props.get('level', '15') if props else '15'}"
    return BLOCK_NAMES.get(name, name)


def convert_states(java_name, name, props):
    """The Bedrock states for the few Java properties that matter to how a ruin looks."""
    states = {}
    if name.startswith("cobblemon:") and name.endswith("_berry_bush"): return {"cobblemon:stage": Tag(INT, 3)}
    # a block a structure placed is natural (CoinPouchBlock, PCBlock, HealingMachineBlock), which its drops depend on
    if name in ("cobblemon:relic_coin_pouch", "cobblemon:relic_coin_sack", "cobblemon:pc", "cobblemon:healing_machine") and props and props.get("natural") == "true":
        return {"cobblemon:natural": Tag(BYTE, 1)}
    if name.startswith("cobblemon:"): return {}   # the pack's blocks keep their default states
    if name.startswith("cobblefurnies:"):
        # a furniture piece keeps the shape it was saved in: its facing, its half and the rest of its properties
        for key, state in FURNITURE.get(name.split(":", 1)[1], {}).items():
            if key not in props: continue
            value = props[key]
            if state == "minecraft:multi_block_part": states[state] = Tag(INT, TWO_PART[value])
            elif value in ("true", "false"): states[state] = Tag(BYTE, 1 if value == "true" else 0)
            elif value.isdigit() and state != "minecraft:cardinal_direction": states[state] = Tag(INT, int(value))
            else: states[state] = Tag(STRING, value)
        return states
    if "axis" in props: states["pillar_axis"] = Tag(STRING, props["axis"])
    if name.endswith("_stairs"):
        states["weirdo_direction"] = Tag(INT, FACING_WEIRDO.get(props.get("facing", "east"), 0))
        states["upside_down_bit"] = Tag(BYTE, 1 if props.get("half") == "top" else 0)
    if name.endswith("_slab") and props.get("type") in ("top", "bottom"):
        states["minecraft:vertical_half"] = Tag(STRING, props["type"])
    if name.endswith("_leaves") or name == "leaves": states["persistent_bit"] = Tag(BYTE, 1)
    if name == "snow_layer" and "layers" in props: states["height"] = Tag(INT, int(props["layers"]) - 1)
    if name.endswith("candle") and "candles" in props:
        states["candles"] = Tag(INT, int(props["candles"]) - 1); states["lit"] = Tag(BYTE, 1 if props.get("lit") == "true" else 0)
    if name in ("lantern", "soul_lantern") and "hanging" in props: states["hanging"] = Tag(BYTE, 1 if props["hanging"] == "true" else 0)
    if name.endswith("_trapdoor"):
        states["upside_down_bit"] = Tag(BYTE, 1 if props.get("half") == "top" else 0)
        states["open_bit"] = Tag(BYTE, 1 if props.get("open") == "true" else 0)
    if name.endswith("torch") and java_name.endswith("wall_torch"):
        states["torch_facing_direction"] = Tag(STRING, TORCH_FACING.get(props.get("facing", "north"), "south"))
    if name in ("wheat", "carrots", "potatoes", "beetroot") and "age" in props: states["growth"] = Tag(INT, int(props["age"]))
    # a button points out of the block it is on, as the face it sits on; a wall sign hangs on the side it faces from
    if name.endswith("_button"):
        face = props.get("face", "wall")
        states["facing_direction"] = Tag(INT, 1 if face == "floor" else 0 if face == "ceiling" else FACING_DIRECTION.get(props.get("facing", "north"), 2))
    if name.endswith("wall_sign"): states["facing_direction"] = Tag(INT, FACING_DIRECTION.get(props.get("facing", "north"), 2))
    if name.endswith("standing_sign") and "rotation" in props: states["ground_sign_direction"] = Tag(INT, int(props["rotation"]))
    return states


def parse_processors(processors):
    """A Java processor list as rule lists: [[(block, properties or None, probability, (name, properties))]].
    Replacement rules and block rot are read; a capped processor changes at most its limit of blocks, and rules
    that look at the block already in the world (a location predicate other than always_true) are skipped,
    as are gravity, height range and rotation processors (scripts/main.js reads those from jigsaw.js)."""
    result = []
    for processor in processors or []:
        limit = None
        if "delegate" in processor:
            # a capped processor changes at most `limit` blocks of each placement
            limit = processor.get("limit") if isinstance(processor.get("limit"), int) else None
            processor = processor["delegate"]
        if processor.get("processor_type") == "minecraft:block_rot":
            # BlockRotProcessor: a block named in rottable_blocks (any block, when none are named) is left out, the
            # world's own block staying, when a roll beats the integrity (the deserted house, tower and fallen statue)
            result.append({"rules": [], "limit": None, "used": 0, "rot": float(processor.get("integrity", 1.0)),
                           "blocks": set(processor.get("rottable_blocks") or [])})
            continue
        if processor.get("processor_type") != "minecraft:rule": continue
        rules = []
        for rule in processor.get("rules", []):
            if rule.get("location_predicate", {}).get("predicate_type", "minecraft:always_true") != "minecraft:always_true": continue
            match = rule.get("input_predicate", {})
            kind = match.get("predicate_type")
            if kind in ("minecraft:random_block_match", "minecraft:block_match"): block, props = match.get("block"), None
            elif kind == "minecraft:random_blockstate_match": block, props = match["block_state"]["Name"], match["block_state"].get("Properties")
            else: continue
            output = rule.get("output_state", {})
            loot = (rule.get("block_entity_modifier") or {}).get("loot_table")
            rules.append((block, props, match.get("probability", 1.0), (output.get("Name", "minecraft:air"), output.get("Properties", {}), loot)))
        if rules: result.append({"rules": rules, "limit": limit, "used": 0})
    return result


def apply_processors(name, props, processors, rng):
    """Each processor replaces a block by its first rule that matches and wins its roll; returns the block and the
    loot table a rule gave it, if any."""
    loot = None
    for processor in processors:
        if "rot" in processor:
            if (not processor["blocks"] or name in processor["blocks"]) and rng.random() > processor["rot"]: return "minecraft:structure_void", {}, loot
            continue
        if processor["limit"] is not None and processor["used"] >= processor["limit"]: continue
        for block, want, probability, output in processor["rules"]:
            if block != name or (want and any(props.get(k) != v for k, v in want.items())): continue
            if probability >= 1 or rng.random() < probability:
                name, props, given = output
                loot = given or loot
                processor["used"] += 1
                break
    return name, props, loot


def load_invalid():
    path = os.path.join(HERE, "bedrock_blocks.json")
    if not os.path.exists(path): return set()
    with open(path, encoding="utf-8") as file: return set(json.load(file).get("invalid", []))


def brushable(block_name, loot_table):
    """Block entity data for a suspicious sand or gravel block that gives from a loot table when brushed."""
    return compound(block_entity_data=compound(
        id=Tag(STRING, "BrushableBlock"), isMovable=Tag(BYTE, 1),
        LootTable=Tag(STRING, loot_table), LootTableSeed=Tag(INT, 0), type=Tag(STRING, f"minecraft:{block_name}")))


# the pack's gilded and Gimmighoul chests are custom blocks, which hold no block entity, so a loot table given one is
# its number in CHEST_LOOT (filled by port.py), kept in two block states (a state holds at most 16 values) that
# scripts/main.js reads when the chest is first opened
CHEST_LOOT = []
def chest_loot_states(table):
    n = CHEST_LOOT.index(table) + 1 if table in CHEST_LOOT else 0
    return {"cobblemon:loot_set": Tag(INT, n // 16), "cobblemon:loot": Tag(INT, n % 16)}


# Java containers that can carry a loot table, and the block entity Bedrock gives each
CONTAINER_ENTITIES = {"chest": "Chest", "trapped_chest": "Chest", "barrel": "Barrel"}


def container(block_name, loot_table):
    """Block entity data for a chest or barrel that fills from a loot table when first opened."""
    return compound(block_entity_data=compound(
        id=Tag(STRING, CONTAINER_ENTITIES[block_name]), isMovable=Tag(BYTE, 1), Items=Tag(LIST, [], COMPOUND),
        LootTable=Tag(STRING, loot_table), LootTableSeed=Tag(INT, 0)))


# Java's dye colours for sign text, as the ARGB Bedrock signs keep
SIGN_COLOURS = {"black": 0xFF000000, "white": 0xFFF0F0F0, "light_gray": 0xFF9D9D97, "gray": 0xFF474F52, "red": 0xFFB02E26, "orange": 0xFFF9801D,
                "yellow": 0xFFFED83D, "lime": 0xFF80C71F, "green": 0xFF5E7C16, "cyan": 0xFF169C9C, "light_blue": 0xFF3AB3DA, "blue": 0xFF3C44AA,
                "purple": 0xFF8932B8, "magenta": 0xFFC74EBD, "pink": 0xFFF38BAA, "brown": 0xFF835432}


def sign(nbt):
    """Block entity data for a sign with its text, colour and glow on each side."""
    def side(text):
        lines = []
        for line in (text or {}).get("messages", []):
            try: value = json.loads(line)
            except (ValueError, TypeError): value = line
            lines.append(value if isinstance(value, str) else (value.get("text", "") if isinstance(value, dict) else ""))
        colour = SIGN_COLOURS.get((text or {}).get("color", "black"), 0xFF000000)
        return compound(Text=Tag(STRING, "\n".join(lines).rstrip("\n")), TextOwner=Tag(STRING, ""), SignTextColor=Tag(INT, colour - (1 << 32)),
                        IgnoreLighting=Tag(BYTE, 1 if (text or {}).get("has_glowing_text") else 0), HideGlowOutline=Tag(BYTE, 0), PersistFormatting=Tag(BYTE, 1))
    return compound(block_entity_data=compound(id=Tag(STRING, "Sign"), isMovable=Tag(BYTE, 1), IsWaxed=Tag(BYTE, 1),
                                               FrontText=side(nbt.get("front_text")), BackText=side(nbt.get("back_text"))))


# Bedrock's potion ids, the Damage a potion item carries, by Java's potion name (the Mossy Oubliette's dispensers)
POTIONS = {"water": 0, "mundane": 1, "long_mundane": 2, "thick": 3, "awkward": 4, "night_vision": 5, "long_night_vision": 6,
           "invisibility": 7, "long_invisibility": 8, "leaping": 9, "long_leaping": 10, "strong_leaping": 11, "fire_resistance": 12,
           "long_fire_resistance": 13, "swiftness": 14, "long_swiftness": 15, "strong_swiftness": 16, "slowness": 17, "long_slowness": 18,
           "water_breathing": 19, "long_water_breathing": 20, "healing": 21, "strong_healing": 22, "harming": 23, "strong_harming": 24,
           "poison": 25, "long_poison": 26, "strong_poison": 27, "regeneration": 28, "long_regeneration": 29, "strong_regeneration": 30,
           "strength": 31, "long_strength": 32, "strong_strength": 33, "weakness": 34, "long_weakness": 35, "wither": 36,
           "turtle_master": 37, "long_turtle_master": 38, "strong_turtle_master": 39, "slow_falling": 40, "long_slow_falling": 41,
           "strong_slowness": 42, "wind_charged": 43, "weaving": 44, "oozing": 45, "infested": 46}


def item_stack(name, count=1, damage=0, slot=None):
    """A Bedrock item stack as a container or a pot holds it."""
    stack = compound(Count=Tag(BYTE, max(1, min(64, int(count)))), Damage=Tag(SHORT, damage), Name=Tag(STRING, name), WasPickedUp=Tag(BYTE, 0))
    if slot is not None: stack.value["Slot"] = Tag(BYTE, slot)
    return stack


def java_item(item):
    """A Java saved item ({id, Count or count, tag or components}) as (Bedrock name, damage): a potion's kind is its Damage."""
    name = item.get("id", "")
    if not name.startswith("minecraft:"): return None
    potion = (item.get("tag") or {}).get("Potion") or ((item.get("components") or {}).get("minecraft:potion_contents") or {}).get("potion", "")
    return name, POTIONS.get(str(potion).split(":")[-1], 0)


def dispenser(block_name, items):
    """Block entity data for a dispenser or dropper with the items Java saved in it (the oubliette's poison and TNT traps)."""
    stacks = []
    for item in items or []:
        kind = java_item(item)
        if kind: stacks.append(item_stack(kind[0], item.get("Count", item.get("count", 1)), kind[1], int(item.get("Slot", len(stacks)))))
    return compound(block_entity_data=compound(id=Tag(STRING, "Dispenser" if block_name == "dispenser" else "Dropper"), isMovable=Tag(BYTE, 1),
                                               Items=Tag(LIST, stacks, COMPOUND)))


def mob_spawner(nbt):
    """Block entity data for a mob spawner with the mob Java's SpawnData names (the crypt's cave spiders, a tombstone's
    zombies) and Java's delays and counts, or None when it names none."""
    nbt = nbt or {}
    entity = ((nbt.get("SpawnData") or {}).get("entity") or {}).get("id")
    if not entity:
        entity = next((((p.get("data") or {}).get("entity") or {}).get("id") for p in nbt.get("SpawnPotentials", []) if ((p.get("data") or {}).get("entity") or {}).get("id")), None)
    if not entity: return None
    short = lambda key, default: Tag(SHORT, int(nbt.get(key, default)))
    return compound(block_entity_data=compound(
        id=Tag(STRING, "MobSpawner"), isMovable=Tag(BYTE, 1), EntityIdentifier=Tag(STRING, entity),
        Delay=short("Delay", 20), MinSpawnDelay=short("MinSpawnDelay", 200), MaxSpawnDelay=short("MaxSpawnDelay", 800),
        SpawnCount=short("SpawnCount", 4), MaxNearbyEntities=short("MaxNearbyEntities", 6), RequiredPlayerRange=short("RequiredPlayerRange", 16),
        SpawnRange=short("SpawnRange", 4), DisplayEntityWidth=Tag(FLOAT, 0.8), DisplayEntityHeight=Tag(FLOAT, 0.8), DisplayEntityScale=Tag(FLOAT, 1.0)))


def beehive():
    """Block entity data for a bee nest Java saved with bees in it: Bedrock spawns the nest's bees when it first loads."""
    return compound(block_entity_data=compound(id=Tag(STRING, "Beehive"), isMovable=Tag(BYTE, 1), Occupants=Tag(LIST, [], COMPOUND), ShouldSpawnBees=Tag(BYTE, 1)))


# a Java loot table name -> the converted Bedrock table's file, for the one stack a decorated pot holds; port.py sets it
POT_LOOT_PATH = None


def roll_loot(path, rng):
    """One stack from a converted Bedrock loot table, as a decorated pot holds one (Java fills the pot from its whole
    table when opened): the first pool's roll, an item entry by weight at its set_count, or None."""
    try:
        with open(path, encoding="utf-8") as file: table = json.load(file)
    except (OSError, ValueError): return None
    for pool in table.get("pools", []):
        entries = [e for e in pool.get("entries", []) if e.get("type") == "item" and e.get("name")]
        if not entries: continue
        pick = rng.random() * sum(e.get("weight", 1) for e in entries)
        for entry in entries:
            pick -= entry.get("weight", 1)
            if pick < 0: break
        count = 1
        for function in entry.get("functions", []):
            if function.get("function") == "set_count":
                c = function.get("count", 1)
                count = rng.randint(int(c.get("min", 1)), int(c.get("max", 1))) if isinstance(c, dict) else int(c)
        return entry["name"], count
    return None


def decorated_pot(nbt, loot, rng):
    """Block entity data for a decorated pot: Java's sherds (plain bricks where none), the item saved in it, or, for a pot
    a processor fills from a loot table (append_loot, the ruins' pots), one stack rolled from that table."""
    nbt = nbt or {}
    sherds = [s if isinstance(s, str) else "minecraft:brick" for s in (nbt.get("sherds") or [])]
    data = compound(id=Tag(STRING, "DecoratedPot"), isMovable=Tag(BYTE, 1),
                    sherds=Tag(LIST, [Tag(STRING, s) for s in (sherds + ["minecraft:brick"] * 4)[:4]], STRING))
    saved = nbt.get("item")
    if isinstance(saved, dict) and java_item(saved):
        name, damage = java_item(saved); data.value["item"] = item_stack(name, saved.get("count", saved.get("Count", 1)), damage)
    elif loot and POT_LOOT_PATH:
        rolled = roll_loot(POT_LOOT_PATH(loot), rng)
        if rolled: data.value["item"] = item_stack(rolled[0], rolled[1])
    return compound(block_entity_data=data)


def trial_spawner(nbt, loot_path):
    """Block entity data for a trial spawner as Java configured it (the shipwreck coves' drowned): its spawn potentials,
    mob counts, spawn delay and reward tables for the normal and ominous configs, Bedrock's own names for the same."""
    def config(c):
        potentials = [compound(TypeId=Tag(STRING, p["data"]["entity"]["id"]), Weight=Tag(INT, int(p.get("weight", 1))))
                      for p in c.get("spawn_potentials", []) if ((p.get("data") or {}).get("entity") or {}).get("id")]
        tables = [compound(data=Tag(STRING, loot_path(t["data"])), weight=Tag(INT, int(t.get("weight", 1)))) for t in c.get("loot_tables_to_eject", []) if t.get("data")]
        return compound(spawn_potentials=Tag(LIST, potentials, COMPOUND), loot_tables_to_eject=Tag(LIST, tables, COMPOUND),
                        simultaneous_mobs=Tag(FLOAT, float(c.get("simultaneous_mobs", 2.0))),
                        simultaneous_mobs_added_per_player=Tag(FLOAT, float(c.get("simultaneous_mobs_added_per_player", 1.0))),
                        total_mobs=Tag(FLOAT, float(c.get("total_mobs", 6.0))), total_mobs_added_per_player=Tag(FLOAT, float(c.get("total_mobs_added_per_player", 2.0))),
                        ticks_between_spawn=Tag(INT, int(c.get("ticks_between_spawn", 40))),
                        items_to_drop_when_ominous=Tag(STRING, loot_path(c["items_to_drop_when_ominous"]) if c.get("items_to_drop_when_ominous") else "loot_tables/spawners/trial_chamber/items_to_drop_when_ominous.json"))
    normal = nbt.get("normal_config") or {}
    ominous = nbt.get("ominous_config") or normal
    first = next((p for p in normal.get("spawn_potentials", []) if ((p.get("data") or {}).get("entity") or {}).get("id")), None)
    data = compound(id=Tag(STRING, "TrialSpawner"), isMovable=Tag(BYTE, 1),
                    required_player_range=Tag(INT, int(nbt.get("required_player_range", 14))),
                    target_cooldown_length=Tag(INT, int(nbt.get("target_cooldown_length", 36000))),
                    normal_config=config(normal), ominous_config=config(ominous))
    if first: data.value["spawn_data"] = compound(TypeId=Tag(STRING, first["data"]["entity"]["id"]), Weight=Tag(INT, int(first.get("weight", 1))))
    return compound(block_entity_data=data)


def entity(nbt, pos, rng):
    """A mob Java saved in a template (the Gimmighoul towers' breeze, witches and husks) as a Bedrock structure entity at
    the same spot in the template, kept from despawning, or None for one that is not a vanilla mob."""
    identifier = (nbt or {}).get("id", "")
    if not identifier.startswith("minecraft:"): return None
    rotation = (list(nbt.get("Rotation") or []) + [0.0, 0.0])[:2]
    return compound(identifier=Tag(STRING, identifier), Pos=Tag(LIST, [Tag(FLOAT, float(v)) for v in pos], FLOAT),
                    Rotation=Tag(LIST, [Tag(FLOAT, float(v)) for v in rotation], FLOAT), Persistent=Tag(BYTE, 1),
                    UniqueID=Tag(LONG, -(rng.getrandbits(62) + 1)), definitions=Tag(LIST, [Tag(STRING, f"+{identifier}")], STRING),
                    Tags=Tag(LIST, [], STRING))


def convert(src, dst, invalid=None, unmapped=None, processors=None, air_as_void=False, loot_path=None, loot_counts=None, overrides=None, region=None,
            foundation=0, brush_counts=None):
    """Write one .mcstructure; returns the set of Bedrock names it uses. Unmapped Java names are counted into
    `unmapped` (a dict) when given; `processors` (from parse_processors) run over every block first, with a
    random seed fixed by the file name so a rebuild gives the same result. air_as_void leaves the world's own
    blocks where the template has air (a buried formation must not carve a cave), and loot_path turns a Java loot
    table name into the Bedrock path a suspicious block's data names. overrides maps a position (x, y, z) to the
    (Bedrock name, {state: Tag}) to put there instead, whatever the template holds (the gyms' command blocks). region,
    (x0, z0, x1, z1), writes only that part of the template, for one wider than the 64 blocks a Bedrock structure can be,
    and a fifth number keeps only that many layers from the bottom. foundation adds that many layers under the
    template, each column of its floor carried down in the floor's own block (stone bricks where the floor is a slab,
    stairs, glass or the like), so a building placed that much lower stands on a plinth where the ground falls away
    rather than floating over a slope, as Java's terrain adaptation would have it. brush_counts, a dict, counts the
    suspicious blocks' loot tables alone."""
    invalid = load_invalid() if invalid is None else invalid
    with open(src, "rb") as file: java = read_nbt(gzip.decompress(file.read()))
    sx, sy, sz = java["size"]
    x0, z0, x1, z1 = (region or (0, 0, sx, sz))[:4]
    sx, sz = x1 - x0, z1 - z0
    if region and len(region) > 4: sy = min(sy, region[4])   # only the bottom layers
    rng = random.Random(os.path.basename(src))
    palette, names = [], set()

    def block_key(java_name, props):
        if java_name == "minecraft:structure_void": return -1
        name = bedrock_name(java_name, props)
        # a Java slab of type double is Bedrock's <slab>_double_slab block
        if name and name.endswith("_slab") and props.get("type") == "double" and name[:-5] + "_double_slab" not in invalid:
            name = name[:-5] + "_double_slab"
        if name is None or name in invalid:
            if unmapped is not None: unmapped[java_name] = unmapped.get(java_name, 0) + 1
            name = "air"
        names.add(name)
        return (name, json.dumps({k: (t.kind, t.value) for k, t in convert_states(java_name, name, props).items()}, sort_keys=True))

    source_palette = [(entry["Name"], entry.get("Properties", {})) for entry in java.get("palette", [])]
    for processor in processors or []: processor["used"] = 0
    # capped processors pick their blocks at random rather than the first ones met
    blocks = list(java.get("blocks", [])); rng.shuffle(blocks)
    keys = []
    position_data = {}
    def palette_index(key):
        if key not in keys:
            keys.append(key)
            name, states = key
            palette.append(compound(name=Tag(STRING, name if ":" in name else f"minecraft:{name}"),
                                    states=Tag(COMPOUND, {k: Tag(kind, value) for k, (kind, value) in json.loads(states).items()}),
                                    version=Tag(INT, 18168865)))
        return keys.index(key)
    air = palette_index(("air", "{}"))
    layer = [-1] * (sx * sy * sz)
    for block in blocks:
        x, y, z = block["pos"]
        if not (x0 <= x < x1 and z0 <= z < z1) or y >= sy: continue
        java_name, props = source_palette[block["state"]]
        if java_name == "minecraft:jigsaw":
            # a jigsaw block leaves its final state behind, usually air
            java_name, props = block.get("nbt", {}).get("final_state", "minecraft:air").split("[")[0], {}
        java_name, props, loot = apply_processors(java_name, props, processors or [], rng)
        loot = loot or (block.get("nbt") or {}).get("LootTable")   # a chest or barrel saved with its own table
        if air_as_void and java_name in ("minecraft:air", "minecraft:cave_air"): continue
        key = block_key(java_name, props)
        if overrides and (x, y, z) in overrides:
            name, states = overrides[(x, y, z)]; names.add(name)
            key = (name, json.dumps({k: (t.kind, t.value) for k, t in states.items()}, sort_keys=True))
        if key == -1: continue
        if loot and key[0].startswith("cobblemon:") and key[0].endswith(("gilded_chest", "gimmighoul_chest")) and loot in CHEST_LOOT:
            key = (key[0], json.dumps({k: (t.kind, t.value) for k, t in chest_loot_states(loot).items()}, sort_keys=True))
        index = ((x - x0) * sy + y) * sz + (z - z0)
        layer[index] = palette_index(key)
        if loot and loot_path and key[0] in CONTAINER_ENTITIES:
            position_data[str(index)] = container(key[0], loot_path(loot))
            if loot_counts is not None: loot_counts[loot_path(loot)] = loot_counts.get(loot_path(loot), 0) + 1
        if key[0].endswith("_sign") and (block.get("nbt") or {}).get("front_text"):
            position_data[str(index)] = sign(block["nbt"])
        if loot and loot_path and key[0] in ("suspicious_sand", "suspicious_gravel"):
            position_data[str(index)] = brushable(key[0], loot_path(loot))
            if loot_counts is not None: loot_counts[loot_path(loot)] = loot_counts.get(loot_path(loot), 0) + 1
            if brush_counts is not None: brush_counts[loot_path(loot)] = brush_counts.get(loot_path(loot), 0) + 1
        # the other block entities a template saves: a trial spawner's configs, a spawner's mob, a nest's bees, a
        # dispenser's items, a pot's sherds and loot
        nbt = block.get("nbt") or {}
        if key[0] == "trial_spawner" and loot_path and nbt.get("normal_config"): position_data[str(index)] = trial_spawner(nbt, loot_path)
        elif key[0] == "mob_spawner" and (spawner := mob_spawner(nbt)): position_data[str(index)] = spawner
        elif key[0] in ("bee_nest", "beehive") and nbt.get("Bees"): position_data[str(index)] = beehive()
        elif key[0] in ("dispenser", "dropper") and nbt.get("Items"): position_data[str(index)] = dispenser(key[0], nbt["Items"])
        elif key[0] == "decorated_pot" and (nbt.get("sherds") or nbt.get("item") or loot): position_data[str(index)] = decorated_pot(nbt, loot, rng)
    if foundation:
        thin = ("_slab", "_stairs", "glass", "_pane", "fence", "door", "carpet", "torch", "sign", "button", "plate", "lantern",
                "_wall", "bars", "chain", "ladder", "rail", "candle", "flower", "air",
                "gym_marker")   # a marker copied down stacked seven of each (a spot noted at seven heights by turns)
        bricks = palette_index(("stone_bricks", "{}"))
        tall = sy + foundation
        grown = [-1] * (sx * tall * sz)
        for x in range(sx):
            for z in range(sz):
                for y in range(sy): grown[(x * tall + y + foundation) * sz + z] = layer[(x * sy + y) * sz + z]
                floor = layer[(x * sy) * sz + z]
                if floor == -1 or floor == air: continue   # no floor here: an open side stays open
                block = bricks if any(t in keys[floor][0] for t in thin) else floor
                for y in range(foundation): grown[(x * tall + y) * sz + z] = block
        position_data = {str((int(i) // sz // sy * tall + int(i) // sz % sy + foundation) * sz + int(i) % sz): v for i, v in position_data.items()}
        layer, sy = grown, tall
    # the mobs saved in the template, at the same spot in it (a structure's entities stand off its origin, which is 0)
    entities = []
    for saved in java.get("entities", []):
        pos = saved.get("pos") or saved.get("blockPos") or [0, 0, 0]
        if not (x0 <= pos[0] < x1 and z0 <= pos[2] < z1): continue
        mob = entity(saved.get("nbt"), [pos[0] - x0, pos[1] + foundation, pos[2] - z0], rng)
        if mob: entities.append(mob)
    root = compound(
        format_version=Tag(INT, 1),
        size=int_list([sx, sy, sz]),
        structure=compound(
            block_indices=Tag(LIST, [int_list(layer), int_list([-1] * len(layer))], LIST),
            entities=Tag(LIST, entities, COMPOUND),
            palette=compound(default=compound(block_palette=Tag(LIST, palette, COMPOUND), block_position_data=Tag(COMPOUND, position_data)))),
        structure_world_origin=int_list([0, 0, 0]))
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with open(dst, "wb") as file: file.write(write_nbt(root))
    return names


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--names":
        found = {}
        for root_dir, _, files in os.walk(args[1]):
            for f in files:
                if not f.endswith(".nbt"): continue
                with open(os.path.join(root_dir, f), "rb") as file: java = read_nbt(gzip.decompress(file.read()))
                for entry in java.get("palette", []):
                    name = bedrock_name(entry["Name"])
                    if name: found[name] = found.get(name, 0) + 1
        print(json.dumps(sorted(found), indent=0))
    elif len(args) == 2:
        print(sorted(convert(args[0], args[1])))
    else:
        print(__doc__)
