"""Find a world seed with a Pewter Gym near spawn, for the FTUE's first-gym steps (tools/ftue_playbook.py).

Pewter Gyms are rare (one chunk in 1,024, in meadows, stony peaks and windswept hills), so a run on a random seed
usually explores for nothing. This screens seeds on the local Bedrock Dedicated Server alone, without the client:
each try makes a world from the add-on's packs with a new seed, loads the ground within --reach blocks of the middle
with ticking areas, a batch at a time, with random ticks sped up so every gym's spot marker is noticed
(cobblemon:gym_sites, the same record the Trainer Card reads), then asks the add-on's test hook for the record. The
first seed with Brock's gym in reach is printed and written to captures/ftue/seed.json; the FTUE then plays it in a
fresh world from that seed (FTUE_SEED), where nothing has been noticed yet.

    python tools/ftue_seed_screen.py --addon captures/ftue/local.mcaddon [--tries 8] [--reach 1200] [--near 240]
    python tools/ftue_seed_screen.py --addon captures/ftue/local.mcaddon --seed N --every --reach 3000 --nether 600
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
# the gyms that are not in the overworld: Cinnabar's in the Nether, Blackthorn's on the End islands (port.py, Gyms)
ELSEWHERE = {"leader_blaine_01a3": "nether", "leader_clair_004a": "the_end"}
# the eight gym leaders in the order the series meets them (scripts/gyms.js GYM_BADGES)
LEADERS = ["leader_brock_019e", "leader_misty_019f", "leader_lt_surge_01a0", "leader_erika_01a1",
           "leader_sabrina_01a4", "leader_koga_01a2", "leader_blaine_01a3", "leader_clair_004a"]


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


def sweep(server, bridge, dimension, reach, wanted=None, batch=8, inner=0):
    """Load the ground within reach of the dimension's middle, nearest first, a batch at a time; with wanted, stop as
    soon as every one of those trainers has a site in the dimension (the control gym, far out in the overworld, aside).
    inner skips the ground a sweep before has already loaded."""
    run_in = "" if dimension == "overworld" else f"execute in {dimension} run "
    centers = sorted(((x, z) for x in range(-reach, reach + 1, 128) for z in range(-reach, reach + 1, 128)
                      if inner <= math.hypot(x, z) <= reach), key=lambda p: math.hypot(*p))
    for n in range(0, len(centers), batch):
        group = centers[n:n + batch]
        for i, (x, z) in enumerate(group): bridge.command(f"{run_in}tickingarea add circle {x} 0 {z} 4 screen{i}")   # 9 areas at most beside the probe's
        # until every area's far corners can be read (generated and ticking), then long enough for a few random ticks
        # on every block: a fixed 25 s missed a Misty gym the first screen of 42069 had found
        end = time.time() + 120
        for x, z in group:
            for dx, dz in ((-56, -56), (56, 56), (-56, 56), (56, -56)):
                while time.time() < end:
                    got = bridge.data("mc_block_get", dimension=dimension, location={"x": x + dx, "y": 64, "z": z + dz})
                    if isinstance(got, dict) and got.get("type_id"): break
                    time.sleep(2)
        time.sleep(12)
        for i in range(len(group)): bridge.command(f"{run_in}tickingarea remove screen{i}")
        if wanted:
            found = {t for t, v in gym_sites(server).items() if any(s[0] == "minecraft:" + dimension and math.hypot(s[1], s[3]) <= reach * 1.5 for s in v)}
            print(f"  {dimension} {math.hypot(*group[-1]):.0f} blocks out: {len(found & wanted)} of {len(wanted)} gyms", flush=True)
            if wanted <= found: return


def screen(run, addon, reach, batch=8, near=None, seed=None, every=False, nether=0, end=0):
    server = run.server
    name = "ftue-screen-" + time.strftime("%Y%m%d-%H%M%S")
    server.prepare_world(name, addon, fresh_version=True, seed=seed)
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
    sweep(server, bridge, "overworld", reach, set(LEADERS) - set(ELSEWHERE) if every else None, batch)
    for dimension, far in (("nether", nether), ("the_end", end)):
        if far: sweep(server, bridge, dimension, far, {t for t, d in ELSEWHERE.items() if d == dimension} if every else None, batch)
    # every gym found, the control gym (loaded at reach + 400 on both axes) left out
    screen.sites = {t: [s for s in v if s[0] != "minecraft:overworld" or (math.hypot(s[1], s[3]) <= reach * 1.5
                                                                         and math.hypot(s[1] - cx, s[3] - cz) > 64)]
                    for t, v in gym_sites(server).items()}
    brock = [s for s in screen.sites.get(BROCK, []) if math.hypot(s[1], s[3]) <= (near or reach * 1.5)]
    return server.seed, name, brock


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--addon", required=True)
    parser.add_argument("--tries", type=int, default=8)
    parser.add_argument("--reach", type=int, default=1200)   # 640 found no Pewter Gym in 8 seeds
    # only a gym this close to the middle counts: one 313 blocks out took longer than the FTUE's 45 minutes of walking
    parser.add_argument("--near", type=int, default=None)
    # a seed to screen rather than random ones: every gym within reach is written to seed.json
    parser.add_argument("--seed", type=int, default=None)
    # with --seed: keep going out until one of every gym is found (or --reach runs out), and search the Nether out to
    # --nether blocks for Cinnabar's and the End out to --end for Blackthorn's, for the FTUE's tour of every gym
    parser.add_argument("--every", action="store_true")
    parser.add_argument("--nether", type=int, default=0)
    parser.add_argument("--end", type=int, default=0)
    args = parser.parse_args()
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures", "ftue")
    run = ftue.Run("seed screen", os.path.join(out, "screen"))
    original = run.server.set_level("cobblemon")   # the world the server had, put back at the end
    run.server.set_level(original)
    try:
        for attempt in range(args.tries):
            seed, world, brock = screen(run, args.addon, args.reach, near=args.near, seed=args.seed, every=args.every, nether=args.nether, end=args.end)
            print(f"try {attempt + 1}: seed {seed} ({world}): Brock's gym {brock or 'not within reach'}", flush=True)
            print("gyms:", json.dumps(screen.sites), flush=True)
            run.server.stop()
            import shutil
            shutil.rmtree(os.path.join(run.server.ROOT, "worlds", world), ignore_errors=True)   # a fresh world is played
            if brock or args.seed:
                with open(os.path.join(out, "seed.json"), "w", encoding="utf-8") as file:
                    json.dump({"seed": seed, "brock": brock, "gyms": screen.sites, "reach": args.reach}, file, indent=1)
                return 0
        return 1
    finally:
        run.server.restore(original)


if __name__ == "__main__":
    sys.exit(main())
