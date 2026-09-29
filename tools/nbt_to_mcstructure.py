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
    "tripwire": "trip_wire", "grass": "short_grass", "light": "light_block", "water": "water", "lava": "lava",
    "carved_pumpkin": "carved_pumpkin", "frosted_ice": "frosted_ice", "bubble_column": "water",
}
# Cobblemon blocks with a vanilla stand-in; the rest (berries, relic coins) become air until they are ported
COBBLEMON_BLOCKS = {"gilded_chest": "chest", "gimmighoul_chest": "chest", "apricorn_planks": "oak_planks", "habitat_block": "grass_block"}
PACK_BLOCKS = set()   # names of Cobblemon blocks the pack defines; port.py fills it before converting
FACING_WEIRDO = {"east": 0, "west": 1, "south": 2, "north": 3}
FACING_DIRECTION = {"down": 0, "up": 1, "north": 2, "south": 3, "west": 4, "east": 5}
TORCH_FACING = {"east": "west", "west": "east", "south": "north", "north": "south"}   # Bedrock names the side it hangs from


def bedrock_name(java):
    name = java.split(":", 1)[1] if ":" in java else java
    if java.startswith("cobblemon:"):
        if name in PACK_BLOCKS: return f"cobblemon:{name}"   # a block the pack has: Cobblemon's own
        if name.endswith("_ore"): return "deepslate" if name.startswith("deepslate") else "stone"
        if name.endswith("_berry"): return f"cobblemon:{name}_bush"
        return COBBLEMON_BLOCKS.get(name)
    if name.startswith("potted_"): return "flower_pot"
    if name.endswith("_wall_sign"): return name[:-len("_wall_sign")] + "_wall_sign" if not name.startswith("oak") else "wall_sign"
    if name.endswith("_wall_banner"): return "wall_banner"
    if name.endswith("_banner"): return "standing_banner"
    if name.endswith("_wall_head") or name.endswith("_head") or name.endswith("_skull"): return "skull"
    return BLOCK_NAMES.get(name, name)


def convert_states(java_name, name, props):
    """The Bedrock states for the few Java properties that matter to how a ruin looks."""
    states = {}
    if name.endswith("_berry_bush"): return {"cobblemon:stage": Tag(INT, 3)}
    if name.startswith("cobblemon:"): return {}   # the pack's blocks keep their default states
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
    return states


def parse_processors(processors):
    """A Java processor list as rule lists: [[(block, properties or None, probability, (name, properties))]].
    Only replacement rules are read; a capped processor counts as its delegate without the cap, and rules
    that look at the block already in the world (a location predicate other than always_true) are skipped,
    as are gravity, height range and rotation processors."""
    result = []
    for processor in processors or []:
        limit = None
        if "delegate" in processor:
            # a capped processor changes at most `limit` blocks of each placement
            limit = processor.get("limit") if isinstance(processor.get("limit"), int) else None
            processor = processor["delegate"]
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


def convert(src, dst, invalid=None, unmapped=None, processors=None, air_as_void=False, loot_path=None, loot_counts=None):
    """Write one .mcstructure; returns the set of Bedrock names it uses. Unmapped Java names are counted into
    `unmapped` (a dict) when given; `processors` (from parse_processors) run over every block first, with a
    random seed fixed by the file name so a rebuild gives the same result. air_as_void leaves the world's own
    blocks where the template has air (a buried formation must not carve a cave), and loot_path turns a Java loot
    table name into the Bedrock path a suspicious block's data names."""
    invalid = load_invalid() if invalid is None else invalid
    with open(src, "rb") as file: java = read_nbt(gzip.decompress(file.read()))
    sx, sy, sz = java["size"]
    rng = random.Random(os.path.basename(src))
    palette, names = [], set()

    def block_key(java_name, props):
        if java_name == "minecraft:structure_void": return -1
        name = bedrock_name(java_name)
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
        java_name, props = source_palette[block["state"]]
        if java_name == "minecraft:jigsaw":
            # a jigsaw block leaves its final state behind, usually air
            java_name, props = block.get("nbt", {}).get("final_state", "minecraft:air").split("[")[0], {}
        java_name, props, loot = apply_processors(java_name, props, processors or [], rng)
        if air_as_void and java_name in ("minecraft:air", "minecraft:cave_air"): continue
        key = block_key(java_name, props)
        if key == -1: continue
        index = (x * sy + y) * sz + z
        layer[index] = palette_index(key)
        if loot and loot_path and key[0] in ("suspicious_sand", "suspicious_gravel"):
            position_data[str(index)] = brushable(key[0], loot_path(loot))
            if loot_counts is not None: loot_counts[loot_path(loot)] = loot_counts.get(loot_path(loot), 0) + 1
    root = compound(
        format_version=Tag(INT, 1),
        size=int_list([sx, sy, sz]),
        structure=compound(
            block_indices=Tag(LIST, [int_list(layer), int_list([-1] * len(layer))], LIST),
            entities=Tag(LIST, [], COMPOUND),
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
