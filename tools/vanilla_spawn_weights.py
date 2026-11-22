"""Write tools/vanilla_spawn_weights.json: what vanilla Bedrock's own spawn rules weigh in every biome, on land and in
water, for port.py to size the Pokemon's share of each spot by (normalise_weights).

    python tools/vanilla_spawn_weights.py

Bedrock makes one weighted pick across every spawn rule that holds at a spot, vanilla's and an add-on's alike, and
only then checks the picked mob's population cap. So a Pokemon total far above vanilla's crowds vanilla out: at 50,000
a spot, the Nether kept only its zombified piglins (weight 100) and lost its ghasts (40), endermen (6 and 10) and
piglins (5 and 15), issue #79. The Dedicated Server ships no vanilla spawn rules, so they come from Mojang's
bedrock-samples, into the git-ignored java/bedrock-samples/vanilla/.

A condition counts on land when it spawns on the surface or underground, and in water when it spawns underwater; one
that spawns in lava (the strider) competes with neither. Each condition counts once in every biome it holds in.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.join(HERE, "..", "java", "bedrock-samples", "vanilla", "spawn_rules")
LISTING = "https://api.github.com/repos/Mojang/bedrock-samples/contents/behavior_pack/spawn_rules"


def passes(node, tags):
    """Whether a biome filter holds in a biome with these tags (port.py's _filter_passes)."""
    if isinstance(node, list): return all(passes(n, tags) for n in node)
    if "all_of" in node: return all(passes(n, tags) for n in node["all_of"])
    if "any_of" in node: return any(passes(n, tags) for n in node["any_of"])
    if "none_of" in node: return not any(passes(n, tags) for n in node["none_of"])
    if node.get("test") == "has_biome_tag": return (node.get("value") in tags) == (node.get("operator", "==") not in ("!=", "not"))
    return True


def fetch():
    """By curl, not urllib: the PC's Store Python fails GitHub's certificate chain (CERTIFICATE_VERIFY_FAILED)."""
    os.makedirs(FOLDER, exist_ok=True)
    listing = json.loads(subprocess.run(["curl", "-sfL", LISTING], capture_output=True, check=True).stdout)
    for entry in listing:
        local = os.path.join(FOLDER, entry["name"])
        if entry["name"].endswith(".json") and not os.path.exists(local): subprocess.run(["curl", "-sfL", "-o", local, entry["download_url"]], check=True)


def main():
    if "--offline" not in sys.argv: fetch()
    with open(os.path.join(HERE, "bedrock_biome_tags.json"), encoding="utf-8") as file: biomes = {b: set(t) for b, t in json.load(file).items()}
    out = {biome: {"land": 0, "water": 0} for biome in biomes}
    for name in sorted(os.listdir(FOLDER)):
        # Mojang's files carry // comments, at line ends too, and the odd trailing comma
        with open(os.path.join(FOLDER, name), encoding="utf-8") as file: text = re.sub(r"//[^\"\n]*$", "", file.read(), flags=re.M)
        rules = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))
        for condition in rules["minecraft:spawn_rules"].get("conditions", []):
            weight = condition.get("minecraft:weight", {}).get("default", 0)
            kind = "water" if "minecraft:spawns_underwater" in condition else \
                   "land" if {"minecraft:spawns_on_surface", "minecraft:spawns_underground"} & condition.keys() and "minecraft:spawns_lava" not in condition else None
            if not kind or not weight: continue
            for biome, tags in biomes.items():
                if passes(condition.get("minecraft:biome_filter", {}), tags): out[biome][kind] += weight
    path = os.path.join(HERE, "vanilla_spawn_weights.json")
    with open(path, "w", encoding="utf-8", newline="\n") as file: file.write(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print(f"wrote {path}: {len(out)} biomes from {len(os.listdir(FOLDER))} vanilla spawn rules")


if __name__ == "__main__":
    main()
