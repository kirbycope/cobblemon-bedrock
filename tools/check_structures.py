"""Every block in every structure the behavior pack ships, checked against what Bedrock knows: a vanilla block by
Mojang's own list of blocks and their states (bedrock-samples, metadata/vanilladata_modules/mojang-blocks.json, fetched
into captures/), and a block of this pack by its file in blocks/. A name Bedrock does not know, or a state it does not
have (or a value outside it), loads as the "?" block (minecraft:unknown) when the structure is placed.

    python tools/check_structures.py           report, by structure; exit 1 if any entry would load as "?"
"""
import glob
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import nbt_to_mcstructure as N

MOJANG = "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/metadata/vanilladata_modules/mojang-blocks.json"
CACHE = os.path.join(REPO, "captures", "mojang-blocks.json")


def val(t): return t.value if hasattr(t, "value") else t


def known_blocks():
    """{name: {state: set(values)}} for vanilla and this pack's blocks."""
    if not os.path.exists(CACHE):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        urllib.request.urlretrieve(MOJANG, CACHE)
    data = json.load(open(CACHE, encoding="utf-8"))
    props = {p["name"]: {v["value"] for v in p["values"]} for p in data["block_properties"]}
    blocks = {}
    for b in data["data_items"]:
        blocks[b["name"]] = {p["name"]: props.get(p["name"], set()) for p in b.get("properties", [])}
    for path in glob.glob(f"{REPO}/development_behavior_packs/cobblemon/blocks/*.json"):
        desc = json.load(open(path, encoding="utf-8"))["minecraft:block"]["description"]
        states = {k: set(v) if isinstance(v, list) else set(range(v["values"]["min"], v["values"]["max"] + 1)) if isinstance(v, dict) and "values" in v else set()
                  for k, v in desc.get("states", {}).items()}
        traits = desc.get("traits", {})
        if "minecraft:placement_direction" in traits:
            for s in traits["minecraft:placement_direction"].get("enabled_states", []):
                states[s] = {"north", "south", "east", "west", "down", "up"} if s == "minecraft:cardinal_direction" else set(range(0, 360))
        if "minecraft:placement_position" in traits:
            for s in traits["minecraft:placement_position"].get("enabled_states", []):
                states[s] = {"top", "bottom", "north", "south", "east", "west", "down", "up"}
        if "minecraft:multi_block" in traits or "minecraft:connection" in traits:
            for s in (traits.get("minecraft:connection", {}).get("enabled_states", []) + ["minecraft:multi_block_part"]):
                states[s] = None
        blocks[desc["identifier"]] = states
    return blocks


def check():
    blocks = known_blocks()
    problems = {}
    for path in sorted(glob.glob(f"{REPO}/development_behavior_packs/cobblemon/structures/**/*.mcstructure", recursive=True)):
        root = val(N.read_nbt(open(path, "rb").read(), little=True))
        palette = val(val(val(val(root)["structure"])["palette"])["default"])["block_palette"]
        for entry in val(palette):
            e = val(entry); name = val(e["name"]); states = {k: val(v) for k, v in val(e.get("states", {})).items()}
            why = None
            if name not in blocks: why = "unknown block"
            else:
                for k, v in states.items():
                    allowed = blocks[name].get(k, "missing")
                    if allowed == "missing": why = f"no state {k}"; break
                    if allowed and v not in allowed and not (isinstance(v, int) and {0, 1} >= allowed - {True, False} and v in (0, 1)):
                        why = f"{k}={v!r} not in {sorted(map(str, allowed))[:8]}"; break
            if why: problems.setdefault(os.path.relpath(path, REPO).replace(os.sep, "/"), []).append(f"{name} {states}: {why}")
    return problems


if __name__ == "__main__":
    found = check()
    for path, entries in found.items():
        print(path)
        for e in sorted(set(entries)): print("   ", e[:220])
    print(f"{sum(len(set(v)) for v in found.values())} palette entries in {len(found)} structures would load as '?'")
    sys.exit(1 if found else 0)
