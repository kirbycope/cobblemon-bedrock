"""Every block geometry's vertical span, tilted cubes measured by their turned corners, against Bedrock's limit: the
client rejects a block geometry spanning more than 29 pixels up (port.py's BLOCK_SPAN_Y) and draws nothing for it.
Prints each one over the limit and exits non-zero when there is any.

    python tools/block_spans.py
"""
import glob, json, math, os, sys

LIMIT = 29.0
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "development_resource_packs", "cobblemon", "models", "blocks")


def corner_ys(cube):
    o, s = cube["origin"], cube["size"]
    rx, ry, rz = [math.radians(a) for a in cube.get("rotation", [0, 0, 0])]
    pv = cube.get("pivot", [0, 0, 0])
    out = []
    for dx in (0, s[0]):
        for dy in (0, s[1]):
            for dz in (0, s[2]):
                x, y, z = o[0] + dx - pv[0], o[1] + dy - pv[1], o[2] + dz - pv[2]
                for sign in (1, -1):   # Java and Bedrock turn x opposite ways; either way round
                    a, b, c = sign * rx, sign * ry, sign * rz
                    y1, z1 = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
                    x1 = x * math.cos(b) + z1 * math.sin(b)
                    y2 = x1 * math.sin(c) + y1 * math.cos(c)
                    out.append(y2 + pv[1])
    return out


def main():
    over = []
    for path in sorted(glob.glob(os.path.join(ROOT, "*.geo.json"))):
        with open(path, encoding="utf-8") as file: data = json.load(file)
        for geo in data.get("minecraft:geometry", []):
            ys = [y for bone in geo.get("bones", []) for cube in bone.get("cubes", []) for y in corner_ys(cube)]
            if ys and max(ys) - min(ys) > LIMIT + 1e-3:
                over.append((round(max(ys) - min(ys), 2), geo["description"]["identifier"]))
    for span, name in sorted(over, reverse=True): print(f"{span:6.2f}  {name}")
    print(f"{len(over)} block geometries span more than {LIMIT} pixels up")
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
