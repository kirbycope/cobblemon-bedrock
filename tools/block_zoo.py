"""Build a block zoo in the sky: a field of white concrete with every block the behavior pack defines standing on it,
one per spot, spaced out, so each can be looked at in the client for a missing texture or a "?" (an unknown block).

    python tools/block_zoo.py              build the zoo at ZOO (x, y, z) and stand the player at its corner
    python tools/block_zoo.py closeups     also photograph every block from a little above and to one side, and put the
                                           photographs, each labelled with its block, on contact sheets in captures/zoo/

The blocks go in name order, ROW of them to a row, GAP blocks apart. captures/zoo.json maps each block to its spot,
and lists the ones the server refused to place (an identifier the game does not know, or a broken block file).
"""
import glob
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bridge import Bridge, PLAYER, protect

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZOO = (2000, 250, 2000)   # the field's corner, high above anything the world generates
GAP = 3
ROW = 22


SKIP = {"cobblemon:league_anchor"}   # its first random tick builds the whole Kanto League over it


def block_ids():
    ids = []
    for path in sorted(glob.glob(f"{REPO}/development_behavior_packs/cobblemon/blocks/*.json")):
        with open(path, encoding="utf-8") as file: ids.append(json.load(file)["minecraft:block"]["description"]["identifier"])
    return sorted(i for i in ids if i not in SKIP)


def build(bridge):
    ids = block_ids()
    x0, y, z0 = ZOO
    rows = math.ceil(len(ids) / ROW)
    x1, z1 = x0 + ROW * GAP, z0 + rows * GAP
    protect(bridge)
    for c in (f"tickingarea remove block_zoo", f"tickingarea add {x0 - 2} {y} {z0 - 2} {x1 + 2} {y} {z1 + 2} block_zoo",
              f"tp {PLAYER} {x0 - 1} {y + 3} {z0 - 1}"):
        bridge.command(c)
    time.sleep(4)   # the ticking area loads
    for c in (f"fill {x0 - 2} {y} {z0 - 2} {x1 + 2} {y} {z1 + 2} white_concrete",
              f"fill {x0 - 2} {y + 1} {z0 - 2} {x1 + 2} {y + 6} {z1 + 2} air", "time set noon", "gamerule doDaylightCycle false",
              "gamerule doWeatherCycle false", "weather clear"):
        print(c, "->", bridge.command(c))
    spots, refused = {}, {}
    for n, block in enumerate(ids):
        x, z = x0 + (n % ROW) * GAP, z0 + (n // ROW) * GAP
        result = bridge.command(f"setblock {x} {y + 1} {z} {block}")
        spots[block] = [x, y + 1, z]
        if "success_count: 1" not in result: refused[block] = result.strip()[:200]
    with open(f"{REPO}/captures/zoo.json", "w", encoding="utf-8") as file:
        json.dump({"corner": ZOO, "gap": GAP, "row": ROW, "spots": spots, "refused": refused}, file, indent=1)
    print(f"{len(ids)} blocks, {len(refused)} refused: {sorted(refused)}")
    return ids


def closeups(bridge, ids, per_sheet=48):
    """Each block from two blocks off its north-east corner, standing on a barrier, looking down at it; the middle of
    each photograph, labelled, goes on contact sheets of per_sheet, captures/zoo/sheet_<n>.png."""
    import client_drive
    from PIL import Image, ImageDraw
    out = f"{REPO}/captures/zoo"
    os.makedirs(out, exist_ok=True)
    x0, y, z0 = ZOO
    tiles = []
    for n, block in enumerate(ids):
        x, z = x0 + (n % ROW) * GAP, z0 + (n // ROW) * GAP
        bridge.command(f"setblock {x + 2} {y + 1} {z - 2} barrier")
        bridge.command(f"tp {PLAYER} {x + 2.5} {y + 2} {z - 1.5} 45 37")
        time.sleep(1.2)
        path = client_drive.shot(f"zoo/block_{n:03d}")
        tile = Image.open(path).crop((610, 250, 1310, 950)).resize((240, 240))
        ImageDraw.Draw(tile).rectangle((0, 0, 240, 14), fill=(0, 0, 0))
        ImageDraw.Draw(tile).text((3, 1), f"{n} {block.split(':')[1]}"[:38], fill=(255, 255, 255))
        tiles.append(tile)
        os.remove(path)
    cols = 8
    for s in range(0, len(tiles), per_sheet):
        page = tiles[s:s + per_sheet]
        sheet = Image.new("RGB", (cols * 240, math.ceil(len(page) / cols) * 240), (40, 40, 40))
        for k, tile in enumerate(page): sheet.paste(tile, ((k % cols) * 240, (k // cols) * 240))
        sheet.save(f"{out}/sheet_{s // per_sheet:02d}.png")
    print(f"{len(tiles)} photographs on {math.ceil(len(tiles) / per_sheet)} sheets in {out}")


if __name__ == "__main__":
    bridge = Bridge()
    ids = build(bridge)
    if "closeups" in sys.argv[1:]: closeups(bridge, ids)
