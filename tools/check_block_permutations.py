"""Counts the behavior pack's block permutations and fails when they pass Bedrock's budget.

Every block state multiplies its block's permutations: a block with a 14-value state, a 16-value state and a facing
has 14 * 16 * 4 = 896, whatever its "permutations" list holds. Bedrock builds every one of them for every world the
pack is in, and warns past 65,536 ("World with over 65536 block permutations may degrade performance"). Release
1.0.556 went from 34,541 to 194,885 with a few new states (the monitor's disc and signal, the cake's tint, the
campfire pots' redstone): the server took five times as long to open a world and nearly twice the memory, and
players on phones could no longer load their worlds. This is the check that would have stopped it.

    python tools/check_block_permutations.py            # the total, the heaviest blocks, exit 1 over the budget
    python tools/check_block_permutations.py --top 40   # more of the heaviest

port.py runs it before bumping the pack version, and the release workflow before building the add-on.
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKS = os.path.join(ROOT, "development_behavior_packs", "cobblemon", "blocks")
BUDGET = 65536   # Bedrock's own threshold, from the server's warning

# the states a trait adds, by the value each enabled state takes
TRAIT_STATES = {
    "minecraft:cardinal_direction": 4, "minecraft:facing_direction": 6,          # placement_direction
    "minecraft:block_face": 6, "minecraft:vertical_half": 2,                       # placement_position
    "minecraft:connection_north": 2, "minecraft:connection_east": 2,              # connection
    "minecraft:connection_south": 2, "minecraft:connection_west": 2,
}


def permutations(description: dict) -> int:
    """The number of permutations a block's description gives: the product of every state's and trait state's values."""
    count = 1
    for values in (description.get("states") or {}).values():
        if isinstance(values, list): count *= len(values)
        elif isinstance(values, dict) and "values" in values: count *= values["values"]["max"] - values["values"]["min"] + 1
    for trait, config in (description.get("traits") or {}).items():
        if trait == "minecraft:multi_block": count *= config.get("parts", 2)
        for state in config.get("enabled_states", []): count *= TRAIT_STATES.get(state, 1)
    return count


def count(folder: str = BLOCKS) -> list:
    """[(permutations, identifier)] for every block JSON under folder, heaviest first."""
    rows = []
    for here, _, files in os.walk(folder):
        for name in files:
            if not name.endswith(".json"): continue
            with open(os.path.join(here, name), encoding="utf-8-sig") as file: data = json.load(file)
            description = data.get("minecraft:block", {}).get("description")
            if description: rows.append((permutations(description), description["identifier"]))
    return sorted(rows, reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--top", type=int, default=10, help="how many of the heaviest blocks to list")
    args = parser.parse_args()
    rows = count()
    total = sum(n for n, _ in rows)
    print(f"Block permutations: {total:,} in {len(rows)} blocks (budget {BUDGET:,})")
    for n, identifier in rows[:args.top]: print(f"  {n:8,}  {identifier}")
    if total > BUDGET:
        print(f"Over the budget by {total - BUDGET:,}: take a state off the heaviest blocks above, or keep the value in the script.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
