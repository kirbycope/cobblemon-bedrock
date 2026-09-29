"""Find which block names Bedrock knows, and record the answer in tools/bedrock_blocks.json.

    python tools/validate_blocks.py write <names.json>    write a test structure holding every name
    python tools/validate_blocks.py read <names.json>     place it, read the blocks back, record the result

One /setblock per name through the bridge takes about two seconds, so instead every name goes into one
structure, a grid 23 blocks wide with one name each, written into this behavior pack. `write` writes it
(restart the server after); `read` places it above the test platform and reads the volume back: a
name Bedrock does not know loads as air (or `unknown`), and lands in "invalid", which the structure
converter turns into air. Run both with the player on the server, near the platform.
"""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bridge as B
from nbt_to_mcstructure import Tag, compound, int_list, write_nbt, STRING, INT, LIST, COMPOUND

SPOT = (40, 95, 40)
WIDTH = 23
OUT = os.path.join(HERE, "bedrock_blocks.json")
NAME = "cobblemon:block_test"
PACK_FILE = os.path.join(HERE, "..", "development_behavior_packs", "cobblemon", "structures", "cobblemon", "block_test.mcstructure")


def grid(names):
    # liquids stay out: a water or lava block in the grid pours over everything below the test spot
    names = [n for n in names if n not in ("air", "water", "lava", "flowing_water", "flowing_lava", "bubble_column")]
    depth = (len(names) + WIDTH - 1) // WIDTH
    sx, sy, sz = WIDTH, 1, depth
    palette = [compound(name=Tag(STRING, "minecraft:air"), states=Tag(COMPOUND, {}), version=Tag(INT, 18168865))]
    layer = [0] * (sx * sy * sz)
    for i, name in enumerate(names):
        palette.append(compound(name=Tag(STRING, f"minecraft:{name}"), states=Tag(COMPOUND, {}), version=Tag(INT, 18168865)))
        x, z = i % WIDTH, i // WIDTH
        layer[(x * sy + 0) * sz + z] = i + 1
    root = compound(format_version=Tag(INT, 1), size=int_list([sx, sy, sz]),
                    structure=compound(block_indices=Tag(LIST, [int_list(layer), int_list([-1] * len(layer))], LIST),
                                       entities=Tag(LIST, [], COMPOUND),
                                       palette=compound(default=compound(block_palette=Tag(LIST, palette, COMPOUND), block_position_data=Tag(COMPOUND, {})))),
                    structure_world_origin=int_list([0, 0, 0]))
    return names, depth, write_nbt(root)


def main():
    mode, names = sys.argv[1], json.load(open(sys.argv[2], encoding="utf-8"))
    names, depth, data = grid(names)
    b = B.Bridge()
    if mode == "write":
        # the bridge writes structure files into its own world, so the file goes into this pack instead,
        # which the server reads at start: run tools/deploy.py before `read`
        os.makedirs(os.path.dirname(PACK_FILE), exist_ok=True)
        with open(PACK_FILE, "wb") as file: file.write(data)
        print("wrote", PACK_FILE, len(data), "bytes; restart the server before read")
        return
    x, y, z = SPOT
    print(b.command(f"fill {x} {y} {z} {x + WIDTH - 1} {y} {z + depth - 1} air"))
    print(b.command(f"structure load {NAME} {x} {y} {z}"))
    found, cursor = {}, None
    while True:
        args = {"dimension": "overworld", "from": {"x": x, "y": y, "z": z}, "to": {"x": x + WIDTH - 1, "y": y, "z": z + depth - 1}}
        if cursor: args["cursor"] = cursor
        page = b.tool("mc_block_get_volume", **args)
        text = page if isinstance(page, str) else json.dumps(page)
        found[len(found)] = text
        cursor = None
        for marker in ("cursor: ", '"cursor": "'):
            if marker in text:
                cursor = text.split(marker, 1)[1].split('"')[0].split("\n")[0].strip() or None
        if not cursor or len(found) > 40: break
    raw = "\n".join(found.values())
    with open(os.path.join(HERE, "..", "captures", "block_volume.txt"), "w", encoding="utf-8") as file: file.write(raw)
    print(raw[:1500])


if __name__ == "__main__":
    main()
