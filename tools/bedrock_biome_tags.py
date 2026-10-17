"""Write tools/bedrock_biome_tags.json: every vanilla Bedrock biome and its tags, as the Bedrock Dedicated Server ships
them, for port.py to build spawn biome filters from rather than guessing tags.

    python tools/bedrock_biome_tags.py [C:\\GitHub\\bedrock-server]

The server keeps the biomes in behavior_packs/vanilla*/biomes, each later pack overriding the one before (1.16 adds
the Nether biomes, 1.18.0 the peaks and slopes), so the packs are read oldest first and the last word wins.
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def version(folder):
    numbers = re.findall(r"\d+", os.path.basename(folder))
    return [int(n) for n in numbers] or [0]


def main():
    server = sys.argv[1] if len(sys.argv) > 1 else r"C:\GitHub\bedrock-server"
    packs = sorted(glob.glob(os.path.join(server, "behavior_packs", "vanilla*")), key=version)
    tags = {}
    for pack in packs:
        for path in glob.glob(os.path.join(pack, "biomes", "*.json")):
            biome = json.load(open(path, encoding="utf-8"))["minecraft:biome"]
            name = biome["description"]["identifier"].split(":")[-1]
            tags[name] = sorted(biome.get("components", {}).get("minecraft:tags", {}).get("tags", []))
    out = os.path.join(HERE, "bedrock_biome_tags.json")
    with open(out, "w", encoding="utf-8") as file: file.write(json.dumps(dict(sorted(tags.items())), indent=1) + "\n")
    print(f"wrote {out}: {len(tags)} biomes from {len(packs)} packs")


if __name__ == "__main__":
    main()
