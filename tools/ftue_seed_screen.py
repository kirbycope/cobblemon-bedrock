"""Find a world seed with a Pewter Gym near spawn, for the FTUE's first-gym steps (tools/ftue_playbook.py).

Pewter Gyms are rare (one chunk in 1,024, in meadows, stony peaks and windswept hills), so a run on a random seed
usually explores for nothing. This screens seeds on the local Bedrock Dedicated Server alone, without the client:
each try makes a world from the add-on's packs with a new seed, loads the ground within --reach blocks of the middle
with ticking areas, a batch at a time, with random ticks sped up so every gym's spot marker is noticed
(cobblemon:gym_sites, the same record the Trainer Card reads), then asks the add-on's test hook for the record. The
first seed with Brock's gym in reach is printed and written to captures/ftue/seed.json; the FTUE then plays it in a
fresh world from that seed (FTUE_SEED), where nothing has been noticed yet.

    python tools/ftue_seed_screen.py --addon captures/ftue/local.mcaddon [--tries 8] [--reach 1200]
"""
import argparse
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".claude", "skills", "ftue"))
import ftue

BROCK = "leader_brock_019e"   # scripts/rct_trainers.js


def gym_sites(server):
    """The add-on's record of noticed gym spots, from what cobblemon:gym_sites prints to the server log. The add-on's
    test hooks want an entity to run them, which the bridge's commands lack, so a marker armour stand at the world's
    middle (kept loaded by its own ticking area) runs it."""
    log = os.path.join(server.ROOT, "bds.out.log")
    mark = os.path.getsize(log)
    ftue.Bridge().command("execute as @e[type=armor_stand,name=ftue_probe] run scriptevent cobblemon:gym_sites")
    time.sleep(2)
    with open(log, encoding="utf-8", errors="replace") as file:
        file.seek(mark)
        found = re.findall(r"gym sites: (\{.*\})", file.read())
    return json.loads(found[-1]) if found else {}


def screen(run, addon, reach, batch=8):
    server = run.server
    name = "ftue-screen-" + time.strftime("%Y%m%d-%H%M%S")
    server.prepare_world(name, addon, fresh_version=True)
    server.start()
    bridge = ftue.Bridge()
    bridge.command("gamerule randomtickspeed 300")   # every block a random tick within a second or so, without swamping the server
    bridge.command("tickingarea add circle 0 0 0 1 probe")
    time.sleep(3)
    bridge.command("summon armor_stand ftue_probe 0 320 0")
    # a control first: a Pewter Gym loaded beyond the search must be noticed, or every "not within reach" means nothing
    cx = cz = reach + 400
    bridge.command(f"tickingarea add circle {cx} 0 {cz} 2 control", timeout=60)
    time.sleep(8)
    bridge.command(f"structure load cobblemon:rgs_pewter_gym {cx} 100 {cz}", timeout=120)
    time.sleep(20)
    control = [s for s in gym_sites(server).get(BROCK, []) if math.hypot(s[1] - cx, s[3] - cz) < 64]
    bridge.command("tickingarea remove control")
    if not control: raise RuntimeError("a Pewter Gym loaded as a control was not noticed; the screen would be blind")
    centers = sorted(((x, z) for x in range(-reach, reach + 1, 128) for z in range(-reach, reach + 1, 128)), key=lambda p: math.hypot(*p))
    for n in range(0, len(centers), batch):
        group = centers[n:n + batch]
        for i, (x, z) in enumerate(group): bridge.command(f"tickingarea add circle {x} 0 {z} 4 screen{i}")   # 9 areas at most beside the probe's
        time.sleep(25)   # long enough to generate the chunks and give every block a few random ticks at this speed
        for i in range(len(group)): bridge.command(f"tickingarea remove screen{i}")
        brock = [s for s in gym_sites(server).get(BROCK, []) if s[0] == "minecraft:overworld" and math.hypot(s[1], s[3]) <= reach * 1.5]
        if brock: return server.seed, name, brock
    return server.seed, name, []


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--addon", required=True)
    parser.add_argument("--tries", type=int, default=8)
    parser.add_argument("--reach", type=int, default=1200)   # 640 found no Pewter Gym in 8 seeds
    args = parser.parse_args()
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures", "ftue")
    run = ftue.Run("seed screen", os.path.join(out, "screen"))
    original = run.server.set_level("cobblemon")   # the world the server had, put back at the end
    run.server.set_level(original)
    try:
        for attempt in range(args.tries):
            seed, world, brock = screen(run, args.addon, args.reach)
            print(f"try {attempt + 1}: seed {seed} ({world}): Brock's gym {brock or 'not within reach'}", flush=True)
            if not brock:   # nothing to keep: the world goes, so failed tries do not pile up gigabytes
                run.server.stop()
                import shutil
                shutil.rmtree(os.path.join(run.server.ROOT, "worlds", world), ignore_errors=True)
            if brock:
                with open(os.path.join(out, "seed.json"), "w", encoding="utf-8") as file:
                    json.dump({"seed": seed, "brock": brock, "screened_in": world}, file, indent=1)
                return 0
        return 1
    finally:
        run.server.restore(original)


if __name__ == "__main__":
    sys.exit(main())
