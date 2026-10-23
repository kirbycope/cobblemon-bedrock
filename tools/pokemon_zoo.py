"""Photograph every Pokemon in the pack, to look them over for broken models, missing textures, T-poses and bad eyes.

    python tools/pokemon_zoo.py                 every species
    python tools/pokemon_zoo.py 0006 0658       only those (dex numbers or names, any part of the id)
    python tools/pokemon_zoo.py from:0400 sheet:49   carry on from a species, numbering sheets from 49

Each species is summoned on a stone platform high in the sky (PLATFORM), held still, and photographed from in front at
a distance that fits its size, three times: standing (frozen, its idle pose), in its battle pose (cobblemon:battle_pose)
and asleep (cobblemon:bedtime). The three photographs, labelled, make one row of a contact sheet in captures/pokezoo/,
SHEET_ROWS species to a sheet. It is noon for the first two and midnight for the third, with night vision on the
player, so it sleeps when told to and is lit the same. Needs the client on the server (client_drive) and the bridge.
"""
import glob
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bridge import Bridge, PLAYER, protect
import client_drive

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLATFORM = (4000, 240, 4000)
SHEET_ROWS = 8
OUT = f"{REPO}/captures/pokezoo"


def species(filters):
    found = []
    for path in sorted(glob.glob(f"{REPO}/development_behavior_packs/cobblemon/entities/[0-9]*.behavior.json")):
        stem = os.path.basename(path)[:-len(".behavior.json")]
        if filters and not any(f in stem for f in filters): continue
        e = json.load(open(path, encoding="utf-8"))["minecraft:entity"]
        c = e["components"]
        box = c.get("minecraft:collision_box", {"width": 1, "height": 1})
        scale = (c.get("minecraft:scale") or {}).get("value", 1)
        found.append((e["description"]["identifier"], stem, max(box["width"], box["height"]) * scale, box["height"] * scale))
    return found


def shoot(bridge, ident, size, height, name):
    x, y, z = PLATFORM
    # back far enough to fit it, a little above it, looking at its middle
    d = round(max(1.6, size * (1.3 if size < 4 else 2.2) + 0.8), 1)
    eye = round(y + 1 + max(height * 0.6, d * 0.25))
    look = round(math.degrees(math.atan2(eye + 1.62 - (y + 1 + height / 2), d)), 1)
    bridge.command(f"setblock {x} {eye - 1} {math.floor(z + 0.5 - d)} barrier")   # stood on, past the platform's edge too
    bridge.command(f"tp {PLAYER} {x + 0.5} {eye} {z + 0.5 - d} 0 {look}")
    bridge.command("time set noon")   # awake: at night a wild one dozes off while it is photographed standing
    bridge.command(f"summon {ident} {x + 0.5} {y + 1} {z + 0.5} 180 0")
    sel = f"@e[type={ident},x={x},y={y},z={z},r=3]"
    bridge.command(f"event entity {sel} cobblemon:battle_start")
    bridge.command(f"tp {sel} {x + 0.5} {y + 1} {z + 0.5} 180 0")
    time.sleep(3.5)   # a Pokemon just summoned has its eyes shut for about two seconds
    shots = [client_drive.shot(f"pokezoo/_{name}_rest")]
    bridge.command(f"execute as {sel} run scriptevent cobblemon:battle_pose")
    bridge.command(f"tp {sel} {x + 0.5} {y + 1} {z + 0.5} 180 0")
    time.sleep(2.0)
    shots.append(client_drive.shot(f"pokezoo/_{name}_battle"))
    bridge.command(f"execute as {sel} run scriptevent cobblemon:battle_pose off")
    bridge.command(f"event entity {sel} cobblemon:battle_start")
    bridge.command("time set midnight")
    bridge.command(f"event entity {sel} cobblemon:bedtime")
    time.sleep(3.0)
    shots.append(client_drive.shot(f"pokezoo/_{name}_sleep"))
    bridge.command(f"tp {sel} {x} -100 {z}")   # into the void: a kill drops its loot on the platform
    bridge.command(f"setblock {x} {eye - 1} {math.floor(z + 0.5 - d)} air")
    return shots


def sheet(rows, n):
    from PIL import Image, ImageDraw
    tile_w, tile_h = 400, 300
    page = Image.new("RGB", (tile_w * 3 + 160, tile_h * len(rows)), (30, 30, 30))
    draw = ImageDraw.Draw(page)
    for r, (label, shots) in enumerate(rows):
        draw.text((6, r * tile_h + 6), label, fill=(255, 255, 255))
        for k, path in enumerate(shots):
            tile = Image.open(path).crop((510, 262, 1410, 937)).resize((tile_w, tile_h))
            page.paste(tile, (160 + k * tile_w, r * tile_h))
            os.remove(path)
    page.save(f"{OUT}/sheet_{n:03d}.png")


if __name__ == "__main__":
    bridge = Bridge()
    os.makedirs(OUT, exist_ok=True)
    x, y, z = PLATFORM
    protect(bridge)
    for c in ("tickingarea remove pokezoo", f"tickingarea add {x - 16} {y} {z - 16} {x + 16} {y} {z + 16} pokezoo",
              f"tp {PLAYER} {x} {y + 3} {z - 6}"):
        bridge.command(c)
    time.sleep(4)
    for c in (f"fill {x - 12} {y} {z - 12} {x + 12} {y} {z + 12} smooth_stone", f"fill {x - 12} {y + 1} {z - 12} {x + 12} {y + 12} {z + 12} air",
              "time set midnight", "gamerule doDaylightCycle false", "gamerule sendcommandfeedback false", "weather clear", f"effect {PLAYER} night_vision 99999 0 true",
              f"execute as {PLAYER} run scriptevent cobblemon:clear_wild {x} {y} {z} 32"):
        bridge.command(c)
    client_drive.focus()
    rows = []
    start = next((a[5:] for a in sys.argv[1:] if a.startswith("from:")), None)
    names = [a for a in sys.argv[1:] if not a.startswith("from:")]
    n = int(next((a[6:] for a in sys.argv[1:] if a.startswith("sheet:")), 0))
    names = [a for a in names if not a.startswith("sheet:")]
    for ident, stem, size, height in species(names):
        if start and stem < start: continue
        client_drive.key("1")   # the client counts it idle after a few minutes and covers the screen with "You've been away"
        try: shots = shoot(bridge, ident, size, height, stem)
        except Exception as e: print(f"{stem}: {e}"); continue
        rows.append((stem, shots))
        print(stem, flush=True)
        if len(rows) == SHEET_ROWS: sheet(rows, n); rows, n = [], n + 1
    if rows: sheet(rows, n)
    bridge.command("tickingarea remove pokezoo")
    bridge.command("gamerule sendcommandfeedback true")
