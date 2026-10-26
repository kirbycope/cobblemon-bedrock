"""Check that the add-on's new worldgen comes up in a fresh world on the local Bedrock Dedicated Server.

Makes a world from the current packs with a new seed (ftue.BedrockServer.prepare_world), loads the ground within
--reach blocks of the middle with ticking areas, then searches it through the bridge (mc_block_contains, a 16 by 16
column at a time) for the blocks in --blocks, and prints how many columns held each. Nothing in the world is placed
by hand: what it finds, worldgen put there.

    python tools/worldgen_check.py --blocks berry_bush revival_herb [--reach 192] [--y 40 160]
"""
import argparse
import glob
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(ROOT), ".claude", "skills", "ftue"))
import ftue


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--addon", default=os.path.join(ROOT, "captures", "ftue", "local.mcaddon"))
    parser.add_argument("--blocks", nargs="+", required=True, help="substrings of block ids to count (berry_bush, revival_herb)")
    parser.add_argument("--also", nargs="*", default=[], help="vanilla block ids to count too, as landmarks (minecraft:spore_blossom marks a lush cave)")
    parser.add_argument("--reach", type=int, default=192)
    parser.add_argument("--y", type=int, nargs=2, default=(-56, 200))
    args = parser.parse_args()
    ids = sorted({json.load(open(f, encoding="utf-8"))["minecraft:block"]["description"]["identifier"]
                  for f in glob.glob(os.path.join(ROOT, "development_behavior_packs", "cobblemon", "blocks", "*.json"))
                  if any(b in os.path.basename(f) for b in args.blocks)})
    ids += args.also
    print(f"looking for {len(ids)} block types", flush=True)
    run = ftue.Run("worldgen check", os.path.join(ROOT, "captures", "worldgen"))
    original = run.server.set_level("cobblemon"); run.server.set_level(original)
    name = "worldgen-" + time.strftime("%Y%m%d-%H%M%S")
    try:
        run.server.prepare_world(name, args.addon, fresh_version=True)
        run.server.start()
        bridge = ftue.Bridge()
        found = {}
        centers = [(x, z) for x in range(-args.reach, args.reach + 1, 128) for z in range(-args.reach, args.reach + 1, 128)]
        for n, (cx, cz) in enumerate(centers):
            bridge.command(f"tickingarea add circle {cx} 0 {cz} 4 check", timeout=60)
            time.sleep(12)
            for x in range(cx - 64, cx + 64, 16):
                for z in range(cz - 64, cz + 64, 16):
                    for group in (ids[i:i + 40] for i in range(0, len(ids), 40)):   # one search a column, whichever type it meets first
                        hit = bridge.data("mc_block_contains", dimension="overworld", timeout=30,
                                          **{"from": {"x": x, "y": args.y[0], "z": z}, "to": {"x": x + 15, "y": args.y[1], "z": z + 15},
                                             "filter": {"include": group}})
                        if isinstance(hit, dict) and hit.get("contains"):
                            match = hit.get("match", {})
                            found.setdefault(match.get("type_id", "?"), []).append((match.get("location", {}).get("x", x), match.get("location", {}).get("y"), match.get("location", {}).get("z", z), json.dumps(match.get("states"))))
            bridge.command("tickingarea remove check")
            print(f"area {n + 1}/{len(centers)}: " + ", ".join(f"{b.split(':')[1]} {len(c)}" for b, c in sorted(found.items())), flush=True)
        print("columns holding each:", json.dumps({b: len(c) for b, c in found.items()}), flush=True)
        print("first places:", json.dumps({b: c[:3] for b, c in found.items()}), flush=True)
    finally:
        run.server.restore(original)
        import shutil
        shutil.rmtree(os.path.join(run.server.ROOT, "worlds", name), ignore_errors=True)


if __name__ == "__main__":
    main()
