"""Build the Pokemon spawn hub, a 96 by 96 block town, in the Bedrock world through the bridge.

    python tools/build_hub.py --x 0 --y 64 --z 0 --dry-run              print every command, send nothing
    python tools/build_hub.py --x 0 --y 64 --z 0 --dry-run --zone mart  print one zone's commands
    python tools/build_hub.py --x 0 --y 64 --z 0                        build it on the running server
    python tools/build_hub.py --x 0 --y 64 --z 0 --zone gym             rebuild one zone in place

--x and --z are the hub's centre, --y its floor: the layer the paths and grass are made of, so players stand
on y + 1. +x is east and +z south. The hub spans x - 48 .. x + 47 and the same in z.

A full build first adds a ticking area over the hub (`tickingarea add ... hub true`, removed again at the
end) and waits for its chunks to load, then clears the whole area from y - 1 to y + 30 in 32 by 32 by 32 air
fills (/fill takes at most 32768 blocks), lays stone under a grass floor, and builds:

    base      clearing and the grass and stone floor
    roads     four 5 wide polished tumblestone boulevards with gate arches, and 3 wide grass paths at 15..17
    plaza     A. landing pad in a 9x9 fountain, Poke Ball mosaic, ring of 18 gem pillars
    center    B. Pokemon Center: counter with 3 healing machines, 4 PCs, lounge, upper floor
    mart      C. Poke Mart: shelves of every item-model block, till, TM machine
    gym       D. Gym and Battle Hall: 15x25 battle floor, bleachers, tatami dojo upstairs
    lab       E. Professor's Lab and Fossil Museum: working fossil machine, stones, ores, excavation
    garden    F. Berry garden: every berry bush ripe, mints, herbs, crops
    orchard   G. Apricorn orchard: the 7 grown apricorn trees round an apricorn wood gazebo
    ranch     H. Ranch: pastures in fenced paddocks, grain bales, feed tables
    camp      I. Camp circle: 7 coloured campfires with pots, tatami seats, gilded chests, saccharine grove
    lights    lights set flush into every outdoor walkway that is not lit yet (6 block grid)
    npcs      Nurse (Professor Sacchi), two gym trainers, the Poke Mart clerk (cobblemon:poke_mart_clerk, trading/poke_mart.json)
    spawn     setworldspawn at the centre, spawnradius 0, and the hub's area for scripts/main.js

--zone builds one of these alone (still inside the ticking area); every zone is still planned, so the light
pass knows what the others put down. Each zone overwrites only its own ground, so a zone can be rebuilt by
itself, but `base` clears everything and should be followed by the rest.

Commands go through tools/bridge.py (the minecraft-bedrock MCP bridge on this PC); the bridge and the server
must be running for a real build. Every block id and state is checked against the pack's blocks folder (or a
short list of vanilla ids) before anything is sent, so a typo stops the script, not the build. At the end the
script prints how many commands it sent, which commands the server refused, and which custom block ids the
hub uses and which it does not.
"""
import argparse
import json
import math
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(HERE, "..", "development_behavior_packs", "cobblemon")
BLOCKS_DIR = os.path.join(PACK, "blocks")
STRUCTURES_DIR = os.path.join(PACK, "structures", "cobblemon")
VANILLA_CHECKED = os.path.join(HERE, "bedrock_blocks.json")
MAX_FILL = 32768
HALF = 48                      # the hub spans -48 .. 47 around the centre
TOP = 30                       # cleared up to floor + 30
ARCH = 18                      # the gate arches stand 18 blocks out along each axis
ZONES = ["base", "roads", "plaza", "center", "mart", "gym", "lab", "garden", "orchard", "ranch", "camp", "lights", "npcs", "spawn"]

# ---------------------------------------------------------------------------------------------------------
# block ids and states

TRAIT_STATES = {
    "minecraft:cardinal_direction": ["north", "south", "east", "west"],
    "minecraft:facing_direction": ["down", "up", "north", "south", "east", "west"],
    "minecraft:block_face": ["down", "up", "north", "south", "east", "west"],
    "minecraft:vertical_half": ["bottom", "top"],
}
VANILLA_STAIRS = {"weirdo_direction": [0, 1, 2, 3], "upside_down_bit": [False, True]}
# the vanilla blocks the hub uses, with the states it sets on them
VANILLA = {
    "minecraft:air": {}, "minecraft:stone": {}, "minecraft:grass_block": {}, "minecraft:farmland": {"moisturized_amount": list(range(8))},
    "minecraft:grass_path": {}, "minecraft:water": {}, "minecraft:glowstone": {}, "minecraft:sea_lantern": {}, "minecraft:shroomlight": {},
    "minecraft:lantern": {"hanging": [False, True]}, "minecraft:white_concrete": {}, "minecraft:red_concrete": {},
    "minecraft:black_concrete": {}, "minecraft:blue_concrete": {}, "minecraft:light_blue_stained_glass": {}, "minecraft:glass_pane": {},
    "minecraft:smooth_quartz": {}, "minecraft:red_nether_brick_stairs": VANILLA_STAIRS, "minecraft:dark_prismarine_stairs": VANILLA_STAIRS,
    "minecraft:white_carpet": {}, "minecraft:red_carpet": {}, "minecraft:light_blue_carpet": {}, "minecraft:bookshelf": {},
}
# a vanilla stair's weirdo_direction for the side its tall back is on
WEIRDO = {"east": 0, "west": 1, "south": 2, "north": 3}
# short state names: dir, face, half and mb are the trait states, anything else is cobblemon:<name>
ALIASES = {"dir": "minecraft:cardinal_direction", "face": "minecraft:block_face", "half": "minecraft:vertical_half",
           "mb": "minecraft:multi_block_part"}
OPPOSITE = {"north": "south", "south": "north", "east": "west", "west": "east"}


def load_custom_blocks():
    blocks = {}
    for name in sorted(os.listdir(BLOCKS_DIR)):
        if not name.endswith(".json"): continue
        with open(os.path.join(BLOCKS_DIR, name), encoding="utf-8") as f:
            block = json.load(f)["minecraft:block"]
        desc, states = block["description"], {}
        for key, values in desc.get("states", {}).items():
            if isinstance(values, dict): values = list(range(values["values"]["min"], values["values"]["max"] + 1))
            states[key] = values
        for trait, spec in desc.get("traits", {}).items():
            for state in spec.get("enabled_states", []):
                states[state] = list(range(spec.get("parts", 2))) if state == "minecraft:multi_block_part" else TRAIT_STATES[state]
        blocks[desc["identifier"]] = {"states": states, "components": block.get("components", {}), "menu": desc.get("menu_category", {})}
    return blocks


CUSTOM = load_custom_blocks()


def ids(prefix="", suffix=""):
    return sorted(b for b in CUSTOM if b.startswith("cobblemon:" + prefix) and b.endswith(suffix))


GEM_TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug",
             "rock", "ghost", "dragon", "dark", "steel", "fairy"]
STONES = ["dawn", "dusk", "fire", "ice", "leaf", "moon", "shiny", "sun", "thunder", "water"]
COLOURS = ["red", "yellow", "green", "blue", "pink", "black", "white"]       # campfires, pots, apricorns
BERRIES = ids(suffix="_berry_bush")
MINTS = ids(suffix="_mint")
# item-model blocks: Cobblemon items shown as little models (potion_block and the rest), not the crops
ITEM_MODELS = sorted(b for b, d in CUSTOM.items() if d["menu"].get("category") == "items" and "group" not in d["menu"]
                     and "cobblemon:grows" not in d["components"])
MEDICINE = ["potion_block", "super_potion_block", "hyper_potion_block", "max_potion_block", "full_restore_block", "full_heal_block",
            "antidote_block", "paralyze_heal_block", "awakening_block", "burn_heal_block", "ice_heal_block", "ether_block",
            "elixir_block", "max_ether_block", "max_elixir_block"]
MINERALS = ids(suffix="_ore") + ["cobblemon:deepslate_crystal_core"] + [f"cobblemon:{s}_budding_{t}" for s in ("medium", "small")
                                                                         for t in ("tumblestone", "sky_tumblestone", "black_tumblestone")]


def resolve(block):
    if ":" in block: return block
    return f"cobblemon:{block}" if f"cobblemon:{block}" in CUSTOM else f"minecraft:{block}"


def block_spec(block, states):
    """'id ["state"=value,...]' for a command, after checking the id and every state against the pack or VANILLA."""
    block = resolve(block)
    known = CUSTOM[block]["states"] if block in CUSTOM else VANILLA.get(block)
    if known is None: raise ValueError(f"unknown block {block}")
    parts = []
    for key, value in states.items():
        if value is None: continue
        full = ALIASES.get(key, key if block not in CUSTOM else f"cobblemon:{key}")
        if full not in known and f"cobblemon:{key}" in known: full = f"cobblemon:{key}"   # hearty grains' own `half`
        if full not in known: raise ValueError(f"{block} has no state {full} (it has {sorted(known)})")
        if value not in known[full]: raise ValueError(f"{block} state {full} cannot be {value!r} (one of {known[full]})")
        text = ("true" if value else "false") if isinstance(value, bool) else str(value) if isinstance(value, int) else f'"{value}"'
        parts.append(f'"{full}"={text}')
    return block + (f" [{','.join(parts)}]" if parts else ""), block


# ---------------------------------------------------------------------------------------------------------
# structures: a little NBT reader for the .mcstructure files, for their size, palette and footprint

def _nbt(b, i, t):
    if t == 1: return b[i], i + 1
    if t == 2: return struct.unpack_from("<h", b, i)[0], i + 2
    if t == 3: return struct.unpack_from("<i", b, i)[0], i + 4
    if t == 4: return struct.unpack_from("<q", b, i)[0], i + 8
    if t == 5: return struct.unpack_from("<f", b, i)[0], i + 4
    if t == 6: return struct.unpack_from("<d", b, i)[0], i + 8
    if t == 7: n = struct.unpack_from("<i", b, i)[0]; return b[i + 4:i + 4 + n], i + 4 + n
    if t == 8: n = struct.unpack_from("<H", b, i)[0]; return b[i + 2:i + 2 + n].decode("utf-8", "replace"), i + 2 + n
    if t == 9:
        et, n = b[i], struct.unpack_from("<i", b, i + 1)[0]; i += 5; out = []
        for _ in range(n): v, i = _nbt(b, i, et); out.append(v)
        return out, i
    if t == 10:
        out = {}
        while True:
            tt = b[i]; i += 1
            if tt == 0: return out, i
            n = struct.unpack_from("<H", b, i)[0]; name = b[i + 2:i + 2 + n].decode(); i += 2 + n
            out[name], i = _nbt(b, i, tt)
    if t == 11: n = struct.unpack_from("<i", b, i)[0]; return list(struct.unpack_from(f"<{n}i", b, i + 4)), i + 4 + 4 * n
    if t == 12: n = struct.unpack_from("<i", b, i)[0]; return list(struct.unpack_from(f"<{n}q", b, i + 4)), i + 4 + 8 * n
    raise ValueError(f"NBT tag {t}")


def read_structure(name):
    """(size, {(x, y, z): block id}) of a structure in the pack; structure void is left out."""
    with open(os.path.join(STRUCTURES_DIR, name + ".mcstructure"), "rb") as f: b = f.read()
    root, _ = _nbt(b, 3 + struct.unpack_from("<H", b, 1)[0], b[0])
    sx, sy, sz = root["size"]
    palette = [p["name"] for p in root["structure"]["palette"]["default"]["block_palette"]]
    cells, indices = {}, root["structure"]["block_indices"][0]
    for x in range(sx):
        for y in range(sy):
            for z in range(sz):
                k = indices[(x * sy + y) * sz + z]
                if k >= 0: cells[(x, y, z)] = palette[k]
    return (sx, sy, sz), cells


# ---------------------------------------------------------------------------------------------------------
# the builder: relative coordinates in, absolute commands out

class Hub:
    def __init__(self, cx, y, cz, only=None):
        self.cx, self.y, self.cz, self.only = cx, y, cz, only
        self.zone = None
        self.commands = []            # (zone, command) of the zones being built
        self.used = set()             # custom block ids those commands (and structures) place
        self.planned = 0
        self.floor, self.above = {}, {}   # what the whole plan puts at floor level and the layer above it

    def begin(self, zone): self.zone = zone

    @property
    def building(self): return self.only is None or self.only == self.zone

    def abs(self, x, y, z): return self.cx + x, self.y + y, self.cz + z

    def emit(self, command, blocks=()):
        self.planned += 1
        if self.building:
            self.commands.append((self.zone, command))
            self.used.update(b for b in blocks if b in CUSTOM)

    def _track(self, x1, y1, z1, x2, y2, z2, block):
        for layer, cells in ((0, self.floor), (1, self.above)):
            if y1 <= layer <= y2:
                for x in range(x1, x2 + 1):
                    for z in range(z1, z2 + 1): cells[(x, z)] = block

    def set(self, x, y, z, block, **states):
        spec, full = block_spec(block, states)
        self._track(x, y, z, x, y, z, full)
        ax, ay, az = self.abs(x, y, z)
        self.emit(f"setblock {ax} {ay} {az} {spec}", [full])

    def fill(self, x1, y1, z1, x2, y2, z2, block, **states):
        x1, x2 = sorted((x1, x2)); y1, y2 = sorted((y1, y2)); z1, z2 = sorted((z1, z2))
        if (x1, y1, z1) == (x2, y2, z2): return self.set(x1, y1, z1, block, **states)
        size = (x2 - x1 + 1, y2 - y1 + 1, z2 - z1 + 1)
        if size[0] * size[1] * size[2] > MAX_FILL:      # halve the longest side until it fits
            axis = size.index(max(size)); lo, hi = [x1, y1, z1], [x2, y2, z2]
            mid = (lo[axis] + hi[axis]) // 2
            a_hi = list(hi); a_hi[axis] = mid; b_lo = list(lo); b_lo[axis] = mid + 1
            self.fill(*lo, *a_hi, block, **states); self.fill(*b_lo, *hi, block, **states)
            return
        spec, full = block_spec(block, states)
        self._track(x1, y1, z1, x2, y2, z2, full)
        a, b = self.abs(x1, y1, z1), self.abs(x2, y2, z2)
        self.emit(f"fill {a[0]} {a[1]} {a[2]} {b[0]} {b[1]} {b[2]} {spec}", [full])

    def paint(self, y, cells):
        """cells {(x, z): block} on one layer, as runs along x: a fill per run, a setblock per single block."""
        rows = {}
        for (x, z), block in cells.items(): rows.setdefault(z, {})[x] = block
        for z in sorted(rows):
            xs = sorted(rows[z]); start = xs[0]
            for i, x in enumerate(xs):
                nxt = xs[i + 1] if i + 1 < len(xs) else None
                if nxt != x + 1 or rows[z][nxt] != rows[z][x]:
                    self.fill(start, y, z, x, y, z, rows[z][x])
                    start = nxt

    def structure(self, name, x, y, z):
        size, cells = read_structure(name)
        self._track(x, max(y, 1), z, x + size[0] - 1, max(y, 1), z + size[2] - 1, "structure")   # keep the lights out
        for (sx, sy, sz), block in cells.items():
            if y + sy == 0: self._track(x + sx, 0, z + sz, x + sx, 0, z + sz, block)
        ax, ay, az = self.abs(x, y, z)
        self.emit(f"structure load cobblemon:{name} {ax} {ay} {az}", set(cells.values()))
        return size

    def stairs(self, x, y, z, block, back, top=False):
        """A stair whose tall back is on the `back` side (north/south/east/west)."""
        if resolve(block) in CUSTOM: self.set(x, y, z, block, dir=back, half="top" if top else "bottom")
        else: self.set(x, y, z, block, weirdo_direction=WEIRDO[back], upside_down_bit=top)

    def two_tall(self, x, y, z, block, **states):
        self.set(x, y, z, block, part="bottom", **states); self.set(x, y + 1, z, block, part="top", **states)

    def door(self, x, y, z, block, facing):
        self.set(x, y, z, block, dir=facing, mb=0); self.set(x, y + 1, z, block, dir=facing, mb=1)

    def lantern(self, x, y, z, hanging=False): self.set(x, y, z, "lantern", hanging=hanging)

    def connected(self, points, block, y, links=()):
        """Fences or walls along a set of (x, z), each joined to its neighbours in the set or in `links`."""
        joins = set(points) | set(links)
        for (x, z) in sorted(points):
            self.set(x, y, z, block, north=(x, z - 1) in joins, south=(x, z + 1) in joins, east=(x + 1, z) in joins, west=(x - 1, z) in joins)

    def lit_floor(self, x1, z1, x2, z2, y, floor, carpet, step=4):
        """A floor with glowstone set into it every `step` blocks, each under a carpet."""
        self.fill(x1, y, z1, x2, y, z2, floor)
        for x in range(x1 + 1, x2 + 1, step):
            for z in range(z1 + 1, z2 + 1, step):
                self.set(x, y, z, "glowstone"); self.set(x, y + 1, z, carpet)


def ring(x1, z1, x2, z2):
    return [(x, z) for x in range(x1, x2 + 1) for z in range(z1, z2 + 1) if x in (x1, x2) or z in (z1, z2)]


def amount(block, n=3):
    """A stack size for an item-model block, or None for a block without one."""
    values = CUSTOM[resolve(block)]["states"].get("cobblemon:amount")
    return min(n, max(values)) if values else None


def item_model(h, x, y, z, block, facing="south"):
    known = CUSTOM[resolve(block)]["states"]
    states = {"dir": facing if "minecraft:cardinal_direction" in known else None, "amount": amount(block)}
    if "minecraft:block_face" in known: states["face"] = "up"
    h.set(x, y, z, block, **states)


# ---------------------------------------------------------------------------------------------------------
# zones

def base(h):
    h.begin("base")
    for x in range(-HALF, HALF, 32):                 # 32 x 32 x 32 = 32768, the most one /fill takes
        for z in range(-HALF, HALF, 32):
            h.fill(x, -1, z, x + 31, TOP, z + 31, "air")
    h.fill(-HALF, -1, -HALF, HALF - 1, -1, HALF - 1, "stone")
    h.fill(-HALF, 0, -HALF, HALF - 1, 0, HALF - 1, "grass_block")


def boulevard_xz(axis, d, t):
    return {"N": (t, -d), "S": (t, d), "E": (d, t), "W": (-d, t)}[axis]


# axis: (last floor block before the building, plaque, which way the plaque's panel faces)
BOULEVARDS = {"N": (22, "red_plaque", "north"), "E": (20, "blue_plaque", "east"), "S": (28, "brown_plaque", "north"), "W": (19, "black_plaque", "east")}


def roads(h):
    h.begin("roads")
    for s in (-1, 1):                                  # grass paths round the plaza and between the districts
        h.fill(15 * s, 0, -HALF + 1, 17 * s, 0, HALF - 2, "grass_path")
        h.fill(-HALF + 1, 0, 15 * s, HALF - 2, 0, 17 * s, "grass_path")
    for axis, (end, plaque, panel) in BOULEVARDS.items():
        at = lambda d, t: boulevard_xz(axis, d, t)
        (x1, z1), (x2, z2) = at(13, -2), at(end, 2)
        h.fill(x1, 0, z1, x2, 0, z2, "polished_tumblestone")
        for d in range(13, end + 1):
            if d in (15, 16, 17, ARCH): continue      # gaps where the paths cross, and the arch
            for t in (-3, 3):
                x, z = at(d, t)
                if d in (14, end):                     # lamp posts at both ends
                    h.set(x, 0, z, "polished_tumblestone")
                    h.fill(x, 1, z, x, 2, z, "polished_tumblestone_wall")
                    h.lantern(x, 3, z)
                else:
                    h.set(x, 1, z, "smooth_sky_tumblestone_slab", half="bottom")
        # the gate arch: tumblestone brick pillars, lintel, keystone, coloured plaque hanging in the opening
        for t in (-4, -3, 3, 4):
            x, z = at(ARCH, t)
            h.set(x, 0, z, "polished_tumblestone")
            h.set(x, 1, z, "tumblestone_block")
            h.fill(x, 2, z, x, 5, z, "tumblestone_bricks")
        (lx1, lz1), (lx2, lz2) = at(ARCH, -4), at(ARCH, 4)
        h.fill(lx1, 6, lz1, lx2, 6, lz2, "tumblestone_bricks")
        x, z = at(ARCH, 0); h.set(x, 6, z, "chiseled_tumblestone_bricks")
        for t in range(-3, 4):
            if t: x, z = at(ARCH, t); h.set(x, 7, z, "tumblestone_brick_slab", half="bottom")
        for t in (-4, 4):
            x, z = at(ARCH, t); h.set(x, 7, z, "tumblestone_brick_wall")
        for t in (-2, 2):                              # upside-down stairs round the opening's top corners
            x, z = at(ARCH, t); bx, bz = at(ARCH, t + (1 if t > 0 else -1))
            back = "east" if bx > x else "west" if bx < x else "south" if bz > z else "north"
            h.stairs(x, 5, z, "tumblestone_brick_stairs", back, top=True)
        x, z = at(ARCH, 0); h.set(x, 5, z, plaque, face=panel, dir=panel)
        # the forecourt beyond the arch is boulevard as well; the Pokemon Center's front steps are its last block
    for x in range(-2, 3): h.stairs(x, 1, -22, "smooth_tumblestone_stairs", "north")


def plaza(h):
    h.begin("plaza")
    h.fill(-12, 0, -12, 12, 0, 12, "polished_tumblestone")
    # the Poke Ball mosaic: red top, white bottom, black band and rim, the fountain as its button
    cells = {}
    for x in range(-10, 11):
        for z in range(-10, 11):
            r = math.hypot(x, z)
            if r > 9.5 or max(abs(x), abs(z)) <= 4: continue
            if r >= 8.5 or z == 0 or max(abs(x), abs(z)) == 5: cells[(x, z)] = "black_concrete"
            else: cells[(x, z)] = "red_concrete" if z < 0 else "white_concrete"
    h.paint(0, cells)
    # the fountain, 9 by 9: rim, a basin of water crossed by four bridges, the landing pad in the middle
    for x in range(-4, 5):
        for z in range(-4, 5):
            m = max(abs(x), abs(z))
            if m == 4:
                h.set(x, 0, z, "polished_sky_tumblestone")
                if abs(x) == 4 and abs(z) == 4: h.lantern(x, 1, z)
                elif x and z: h.set(x, 1, z, "smooth_sky_tumblestone_slab", half="bottom")
            elif m >= 2 and (x == 0 or z == 0):
                h.set(x, 0, z, "chiseled_polished_sky_tumblestone")
            elif m >= 2:
                h.set(x, -1, z, "glowstone" if abs(x) == 2 and abs(z) == 2 else "sky_tumblestone_bricks")
                if abs(x) != 3 or abs(z) != 3: h.set(x, 0, z, "water")
    for (x, z), budding, cluster in (((3, -3), "large_budding_tumblestone", "tumblestone_cluster"),
                                     ((-3, -3), "large_budding_sky_tumblestone", "sky_tumblestone_cluster"),
                                     ((3, 3), "large_budding_black_tumblestone", "black_tumblestone_cluster"),
                                     ((-3, 3), "medium_budding_tumblestone", "tumblestone_cluster")):
        h.set(x, 0, z, budding); h.set(x, 1, z, cluster)
    h.fill(-1, 0, -1, 1, 0, 1, "white_concrete")      # the landing pad, the Poke Ball's button
    h.set(0, 0, 0, "chiseled_polished_sky_tumblestone")
    # 18 pillars, one per type: sea lantern, gem block, gem cluster
    for k, kind in enumerate(GEM_TYPES):
        a = math.radians(10 + 20 * k)
        x, z = round(10.5 * math.cos(a)), round(10.5 * math.sin(a))
        h.set(x, 0, z, "chiseled_polished_tumblestone")
        h.set(x, 1, z, "sea_lantern"); h.set(x, 2, z, f"{kind}_gem_block"); h.set(x, 3, z, f"{kind}_gem_cluster")
    # benches in the four corners
    for sx in (-1, 1):
        for sz in (-1, 1):
            h.stairs(11 * sx, 1, 12 * sz, "polished_tumblestone_stairs", "south" if sz > 0 else "north")
            h.stairs(12 * sx, 1, 11 * sz, "polished_tumblestone_stairs", "east" if sx > 0 else "west")
            h.set(12 * sx, 1, 12 * sz, "polished_tumblestone_slab", half="bottom")


def pokeball_disc(h, cx, cy, z):
    """A 7 wide Poke Ball in the x-y plane at z, centred on (cx, cy): black rim and band, red top, white bottom."""
    widths = {3: 1, 2: 2, 1: 3, 0: 3, -1: 3, -2: 2, -3: 1}
    for dy, w in widths.items():
        for dx in range(-w, w + 1):
            if abs(dx) == w or abs(dy) == 3: block = "black_concrete"
            elif dy == 0: block = "white_concrete" if dx == 0 else "black_concrete"
            else: block = "red_concrete" if dy > 0 else "white_concrete"
            h.set(cx + dx, cy + dy, z, block)


def center(h):
    h.begin("center")
    X1, X2, Z1, Z2 = -11, 11, -40, -24
    h.fill(-12, 1, -41, 12, 1, -23, "smooth_tumblestone")                     # the plinth
    h.fill(X1, 2, Z1, X2, 11, Z2, "white_concrete")
    h.fill(X1 + 1, 2, Z1 + 1, X2 - 1, 11, Z2 - 1, "air")
    h.lit_floor(-10, -39, 10, -25, 1, "white_concrete", "red_carpet")
    h.lit_floor(-10, -39, 10, -25, 7, "white_concrete", "red_carpet")
    for x, z in ring(X1, Z1, X2, Z2): h.set(x, 7, z, "smooth_quartz")         # the band between the storeys
    for y1, y2 in ((3, 5), (9, 10)):                                           # cyan-blue windows
        for z1, z2 in ((-38, -36), (-33, -31), (-28, -26)):
            for x in (X1, X2): h.fill(x, y1, z1, x, y2, z2, "light_blue_stained_glass")
        for x1, x2 in ((-8, -5), (5, 8)):
            h.fill(x1, y1, Z1, x2, y2, Z1, "light_blue_stained_glass")
            h.fill(x1, y1, Z2, x2, y2, Z2, "light_blue_stained_glass")
    h.fill(-2, 2, Z2, 2, 4, Z2, "air"); h.fill(-1, 5, Z2, 1, 5, Z2, "air")   # the open archway
    h.fill(X1, 12, Z1, X2, 12, Z2, "red_concrete"); h.fill(X1 + 2, 13, Z1 + 2, X2 - 2, 13, Z2 - 2, "red_concrete")
    pokeball_disc(h, 0, 9, Z2)                                                 # over the archway, rows 6 .. 12
    for x, z in ring(X1 - 1, Z1 - 1, X2 + 1, Z2 + 1):                          # red nether brick eaves
        if z == Z2 + 1 and abs(x) <= 4: continue
        back = "east" if x == X1 - 1 else "west" if x == X2 + 1 else "south" if z == Z1 - 1 else "north"
        h.stairs(x, 12, z, "red_nether_brick_stairs", back)
    # front counter with the three healing machines, the nurse's place behind it
    h.fill(-6, 2, -34, 6, 2, -34, "smooth_sky_tumblestone")
    h.fill(-6, 2, -39, -6, 2, -35, "smooth_sky_tumblestone"); h.fill(6, 2, -39, 6, 2, -35, "smooth_sky_tumblestone")
    for x in range(-6, 7):
        if x in (-4, 0, 4): h.set(x, 3, -34, "healing_machine", dir="south")
        else: h.set(x, 3, -34, "polished_sky_tumblestone_slab", half="bottom")
    h.fill(-3, 2, -40, 3, 4, -40, "white_concrete"); h.set(0, 4, -39, "pink_plaque", face="south", dir="south")
    # four PCs along the west wall
    for z in (-32, -30, -28, -26): h.two_tall(-10, 2, z, "pc", dir="east")
    # lounge: apricorn benches either side of a low table, medicine on the shelves
    for x in range(5, 9):
        h.stairs(x, 2, -31, "apricorn_stairs", "north"); h.stairs(x, 2, -27, "apricorn_stairs", "south")
        h.set(x, 2, -29, "sky_tumblestone_brick_slab", half="bottom")
    for i, z in enumerate(range(-32, -25)):
        h.set(10, 2, z, "bookshelf"); item_model(h, 10, 3, z, MEDICINE[i], "west")
    for x in (-10, 10):
        h.set(x, 2, -25, "sky_tumblestone_block"); h.set(x, 3, -25, "apricorn_leaves")
    # stairs up along the west wall, a railing round the opening
    for i, z in enumerate(range(-34, -39, -1)): h.stairs(-10, 2 + i, z, "polished_sky_tumblestone_stairs", "north"); h.stairs(-9, 2 + i, z, "polished_sky_tumblestone_stairs", "north")
    h.fill(-10, 7, -38, -9, 8, -33, "air")
    rail = [(-8, z) for z in range(-38, -31)] + [(-10, -32), (-9, -32)]
    h.connected(rail, "polished_sky_tumblestone_wall", 8)
    # upstairs: a reading lounge
    h.fill(-6, 8, -39, 6, 9, -39, "bookshelf")
    for x in range(-4, 0): h.stairs(x, 8, -28, "smooth_sky_tumblestone_stairs", "south"); h.stairs(x, 8, -32, "smooth_sky_tumblestone_stairs", "north")
    for x in range(1, 5): h.stairs(x, 8, -28, "sky_tumblestone_brick_stairs", "south"); h.stairs(x, 8, -32, "sky_tumblestone_brick_stairs", "north")
    h.fill(-4, 8, -30, 4, 8, -30, "sky_tumblestone_brick_slab", half="bottom")
    for i, x in enumerate(range(7, 11)): h.set(x, 8, -39, "smooth_sky_tumblestone"); item_model(h, x, 9, -39, MEDICINE[7 + i], "south")
    h.connected([(x, -25) for x in range(-4, 5)], "sky_tumblestone_brick_wall", 8)
    for x in (-5, 5): h.lantern(x, 11, -30, hanging=True); h.lantern(x, 6, -29, hanging=True)


def mart(h):
    h.begin("mart")
    X1, X2, Z1, Z2 = 21, 39, -10, 4
    h.fill(X1, 1, Z1, X2, 6, Z2, "white_concrete")
    h.fill(X1 + 1, 1, Z1 + 1, X2 - 1, 6, Z2 - 1, "air")
    h.lit_floor(22, -9, 38, 3, 0, "smooth_quartz", "light_blue_carpet")
    h.fill(X1, 1, -1, X1, 3, 1, "air")                                         # the doorway, on the boulevard
    h.fill(X1, 2, -8, X1, 4, -3, "light_blue_stained_glass"); h.fill(X1, 2, 3, X1, 4, 3, "light_blue_stained_glass")
    h.fill(X1, 5, -9, X1, 5, 3, "blue_concrete")
    for x1, x2 in ((24, 27), (31, 35)):
        for z in (Z1, Z2): h.fill(x1, 2, z, x2, 4, z, "light_blue_stained_glass")
    h.fill(X1, 7, Z1, X2, 7, Z2, "blue_concrete")
    for x, z in ring(X1 - 1, Z1 - 1, X2 + 1, Z2 + 1):
        back = "east" if x == X1 - 1 else "west" if x == X2 + 1 else "south" if z == Z1 - 1 else "north"
        h.stairs(x, 7, z, "dark_prismarine_stairs", back)
    # the till: counter round the clerk's corner, Gimmighoul's coins on it
    h.fill(22, 1, -7, 27, 1, -7, "smooth_quartz"); h.fill(27, 1, -9, 27, 1, -8, "smooth_quartz")
    h.set(23, 2, -7, "relic_coin_sack", dir="south"); h.set(25, 2, -7, "relic_coin_pouch", dir="south")
    h.set(27, 2, -8, "gimmighoul_chest")
    h.set(38, 1, -9, "tm_machine", dir="west")                                 # back corner
    # shelves: every item-model block once, then medicine again to fill the rest
    spots = [(x, -9, "disc_shelf", "south") for x in range(29, 38)]
    for za, zb in ((-7, -6), (-4, -3), (-1, 0)):
        spots += [(x, za, "display_case", "north") for x in range(29, 37)] + [(x, zb, "disc_shelf", "south") for x in range(29, 37)]
    spots += [(x, 3, "display_case", "north") for x in range(22, 38)] + [(38, z, "disc_shelf", "west") for z in range(-8, 4)]
    goods = ITEM_MODELS + [f"cobblemon:{m}" for m in MEDICINE] * 2
    for (x, z, shelf, facing), item in zip(spots, goods):
        h.set(x, 1, z, shelf, dir=facing); item_model(h, x, 2, z, item, facing)


def gym(h):
    h.begin("gym")
    X1, X2, Z1, Z2 = -44, -20, -14, 14
    h.fill(X1, 1, Z1, X2, 13, Z2, "black_tumblestone_bricks")
    h.fill(X1 + 1, 1, Z1 + 1, X2 - 1, 13, Z2 - 1, "air")
    for x, z in ring(X1, Z1, X2, Z2): h.set(x, 1, z, "black_tumblestone_block")
    for x in (X1, -38, -32, -26, X2):                                          # chiseled pillars
        for z in (Z1, Z2): h.fill(x, 1, z, x, 13, z, "chiseled_black_tumblestone_bricks")
    for z in (-8, -3, 3, 8):
        for x in (X1, X2): h.fill(x, 1, z, x, 13, z, "chiseled_black_tumblestone_bricks")
    h.fill(X2, 1, -2, X2, 4, 2, "air")                                         # the doors, on the boulevard
    for z in range(-2, 3): h.stairs(X2 + 1, 5, z, "black_tumblestone_brick_stairs", "west")
    h.fill(-43, 0, -13, -21, 0, 13, "polished_black_tumblestone")
    # the battle floor, 15 by 25, lined with sky tumblestone bricks, lit from below
    h.fill(-39, 0, -12, -25, 0, 12, "smooth_black_tumblestone")
    for x, z in ring(-40, -13, -24, 13): h.set(x, 0, z, "sky_tumblestone_bricks")
    h.fill(-39, 0, 0, -25, 0, 0, "chiseled_sky_tumblestone_bricks"); h.set(-32, 0, 0, "chiseled_polished_black_tumblestone")
    for x in (-37, -32, -27):
        for z in (-10, -5, 5, 10): h.set(x, 0, z, "glowstone")
    for z in (-13, 13): h.set(-32, 1, z, "gray_plaque", face="up", dir="north")   # the trainers' marks
    # bleachers on the west side
    for z in range(-12, 13):
        h.stairs(-41, 1, z, "smooth_tumblestone_stairs", "west")
        h.set(-42, 1, z, "polished_black_tumblestone"); h.stairs(-42, 2, z, "smooth_tumblestone_stairs", "west")
        h.fill(-43, 1, z, -43, 2, z, "polished_black_tumblestone"); h.stairs(-43, 3, z, "smooth_tumblestone_stairs", "west")
    # ceiling = the dojo's tatami floor, an opening over the stairs up
    h.fill(-43, 8, -13, -21, 8, 13, "tatami_block", dir="north")
    h.fill(-22, 8, 4, -21, 8, 13, "air")
    for i in range(8):
        for x in (-22, -21): h.stairs(x, 1 + i, 6 + i, "smooth_black_tumblestone_stairs", "south")
    h.connected([(-23, z) for z in range(4, 13)] + [(-22, 3), (-21, 3)], "black_tumblestone_brick_wall", 9)
    for x in (-40, -35, -30, -25):
        for z in (-10, -5, 0, 5, 10): h.lantern(x, 7, z, hanging=True)
    # the dojo: training mats, a dais, tea tables, windows
    for z in (-6, -2, 2, 6): h.fill(-41, 9, z, -27, 9, z, "tatami_mat", dir="east")
    h.fill(-36, 9, -13, -28, 9, -11, "polished_black_tumblestone_slab", half="bottom")
    for x in range(-36, -27): h.stairs(x, 9, -10, "polished_black_tumblestone_stairs", "north")
    for x in (-34, -30): h.set(x, 9, 10, "smooth_black_tumblestone_slab", half="bottom")
    for x1, x2 in ((-42, -40), (-36, -34), (-30, -28), (-24, -22)):
        for z in (Z1, Z2): h.fill(x1, 10, z, x2, 12, z, "glass_pane")
    for x in (-40, -35, -30, -25):
        for z in (-9, -1, 7): h.lantern(x, 13, z, hanging=True)
    h.fill(X1, 14, Z1, X2, 14, Z2, "polished_black_tumblestone")
    corners = [(X1, Z1), (X2, Z1), (X1, Z2), (X2, Z2)]
    h.connected([p for p in ring(X1, Z1, X2, Z2) if p not in corners], "polished_black_tumblestone_wall", 15, links=corners)
    for x, z in corners: h.set(x, 15, z, "black_tumblestone_brick_slab", half="bottom")


def lab(h):
    h.begin("lab")
    h.structure("ruins_lunatone_center1a", -11, 0, 21)                          # entrance pieces, 7 x 6 x 7
    h.structure("ruins_solrock_center1a", 5, 0, 21)
    X1, X2, Z1, Z2 = -12, 12, 29, 44
    h.fill(X1, 1, Z1, X2, 8, Z2, "saccharine_planks")
    h.fill(X1 + 1, 1, Z1 + 1, X2 - 1, 8, Z2 - 1, "air")
    for x, z in ((X1, Z1), (X2, Z1), (X1, Z2), (X2, Z2)): h.fill(x, 1, z, x, 8, z, "saccharine_wood")
    for x in (-8, -4, 4, 8): h.fill(x, 1, Z1, x, 8, Z1, "stripped_saccharine_log")
    h.lit_floor(-11, 30, 11, 43, 0, "saccharine_planks", "white_carpet")
    h.door(0, 1, Z1, "saccharine_door", "north")
    for x1, x2 in ((-7, -5), (5, 7)): h.fill(x1, 2, Z1, x2, 4, Z1, "glass_pane")
    for z1, z2 in ((32, 34), (38, 40)):
        for x in (X1, X2): h.fill(x, 2, z1, x, 4, z2, "glass_pane")
    h.fill(X1, 9, Z1, X2, 9, Z2, "saccharine_planks")
    for x, z in ring(X1 - 1, Z1 - 1, X2 + 1, Z2 + 1):
        back = "east" if x == X1 - 1 else "west" if x == X2 + 1 else "south" if z == Z1 - 1 else "north"
        h.stairs(x, 9, z, "saccharine_stairs", back)
    for x, z in ring(X1, Z1, X2, Z2): h.set(x, 10, z, "saccharine_slab", half="bottom")
    for z in (32, 36, 40): h.fill(0, 1, z, 0, 8, z, "stripped_saccharine_wood")
    h.set(-1, 2, 32, "saccharine_button", face="west")
    for x in (-6, 6):
        for z in (33, 39): h.lantern(x, 8, z, hanging=True)
    # the lab: a working fossil machine (analyzer beside the tank's lower block, monitor within two)
    h.set(-8, 1, 42, "fossil_analyzer", dir="south")
    h.two_tall(-7, 1, 42, "restoration_tank", dir="south")
    h.set(-6, 1, 42, "monitor", dir="south", screen="off")
    h.fill(-11, 1, 31, -11, 2, 33, "bookshelf")
    h.fill(-11, 1, 34, -11, 1, 40, "stripped_saccharine_wood")
    for z in range(34, 41): h.set(-11, 2, z, "saccharine_trapdoor", dir="east", half="bottom")
    for x in (-5, -3):
        h.set(x, 1, 36, "saccharine_fence"); h.set(x, 2, 36, "saccharine_pressure_plate")
        h.stairs(x, 1, 35, "saccharine_stairs", "north"); h.stairs(x, 1, 37, "saccharine_stairs", "south")
    h.set(-10, 0, 43, "grass_block"); h.set(-10, 1, 43, "saccharine_sapling")
    h.fill(-11, 1, 43, -11, 2, 43, "saccharine_leaves")
    # the museum: an excavation behind a fence, the ten stones on plinths, a wall of ores, display cases
    h.structure("ruins_stonjourner_center1a", 2, 0, 34)
    fence = [p for p in ring(1, 33, 9, 41) if p != (5, 33)]
    h.connected(fence, "saccharine_fence", 1, links=[(5, 33)])
    h.set(5, 1, 33, "saccharine_fence_gate", dir="north")
    h.set(5, 1, 32, "purple_plaque", face="up", dir="north")
    plinths = [(x, 30) for x in (2, 4, 6, 8, 10)] + [(11, z) for z in (32, 34, 36, 38, 40)]
    for (x, z), stone in zip(plinths, STONES):
        h.set(x, 1, z, "chiseled_polished_tumblestone"); h.set(x, 2, z, f"{stone}_stone_block")
    wall = [(x, y) for y in (2, 3, 4) for x in range(1, 12)]
    for (x, y), mineral in zip(wall, MINERALS + MINERALS): h.set(x, y, Z2, mineral)
    for x, item in zip((2, 4, 6, 8), ("chipped_pot_block", "cracked_pot_block", "masterpiece_teacup_block", "unremarkable_teacup_block")):
        h.set(x, 1, 43, "display_case", dir="north"); item_model(h, x, 2, 43, item, "north")
    h.set(10, 1, 43, "chiseled_polished_tumblestone"); h.set(10, 2, 43, "damaged_monitor", dir="north", screen="glitching")


PLAQUES = ["white_plaque", "orange_plaque", "magenta_plaque", "light_blue_plaque", "yellow_plaque", "lime_plaque", "pink_plaque"]


def garden(h):
    h.begin("garden")
    h.fill(21, 0, 19, 45, 0, 46, "grass_path")
    # seven rows of ten ripe bushes, each row labelled with its own colour of plaque
    for row, z in enumerate(range(20, 39, 3)):
        h.fill(24, 0, z, 44, 0, z, "grass_block")
        h.set(22, 1, z, PLAQUES[row], face="up", dir="west")
        for i, x in enumerate(range(25, 44, 2)):
            if row * 10 + i < len(BERRIES): h.set(x, 1, z, BERRIES[row * 10 + i], stage=3)
    # herbs: the mints grown, galarica, pep-up flower, bugwort, and a big root hanging from an arbour
    h.fill(24, 0, 41, 44, 0, 41, "grass_block")
    h.set(22, 1, 41, "cyan_plaque", face="up", dir="west")
    for x, plant in zip(range(25, 42, 2), MINTS + ["cobblemon:galarica_nut_bush", "cobblemon:pep_up_flower", "cobblemon:bugwort"]):
        if plant in MINTS: h.set(x, 1, 41, plant, age=7)
        else: h.set(x, 1, 41, plant)
    h.connected([(42, 41), (44, 41)], "apricorn_fence", 1); h.connected([(42, 41), (44, 41)], "apricorn_fence", 2)
    h.fill(42, 3, 41, 44, 3, 41, "apricorn_planks"); h.set(43, 2, 41, "big_root")
    # crops on watered farmland
    h.fill(24, 0, 44, 44, 0, 45, "farmland", moisturized_amount=7)
    h.set(22, 1, 44, "green_plaque", face="up", dir="west")
    for x in range(24, 45):
        if x in (28, 34, 40): h.fill(x, 0, 44, x, 0, 45, "water"); continue
        if x < 34:
            h.set(x, 1, 44, "hearty_grains_block", age=6, half="lower"); h.set(x, 2, 44, "hearty_grains_block", age=6, half="upper")
            h.set(x, 1, 45, "vivichoke_seeds_block", age=7)
        else:
            h.set(x, 1, 44, "medicinal_leek_block", age=3); h.set(x, 1, 45, "medicinal_leek_block", age=3)


def orchard(h):
    h.begin("orchard")
    cells = [(-46, -46), (-37, -46), (-28, -46), (-46, -37), (-28, -37), (-46, -28), (-37, -28)]
    for (x, z), colour in zip(cells, COLOURS):
        h.structure(f"apricorn_tree_{colour}_grown_0", x + 1, 1, z + 1)
    # the gazebo: apricorn plank deck, log posts, fence rails with a door, a gate and two open sides
    h.fill(-36, 0, -36, -30, 0, -30, "apricorn_planks")
    posts = [(-36, -36), (-30, -36), (-36, -30), (-30, -30)]
    for x, z in posts: h.fill(x, 1, z, x, 3, z, "stripped_apricorn_log", face="up")
    edge = [p for p in ring(-36, -36, -30, -30) if p not in posts and p not in ((-33, -36), (-36, -33), (-30, -33), (-33, -30))]
    h.connected(edge, "apricorn_fence", 1, links=posts + [(-30, -33), (-33, -30)])
    h.set(-30, 1, -33, "apricorn_fence_gate", dir="east")
    h.door(-33, 1, -30, "apricorn_door", "south")
    h.set(-33, 1, -36, "apricorn_pressure_plate"); h.set(-36, 1, -33, "apricorn_pressure_plate")
    h.set(-37, 2, -36, "apricorn_button", face="west")
    h.set(-33, 1, -33, "apricorn_fence"); h.set(-33, 2, -33, "apricorn_trapdoor", dir="north", half="bottom")
    for x, z, back in ((-34, -33, "west"), (-32, -33, "east"), (-33, -34, "north"), (-33, -32, "south")):
        h.stairs(x, 1, z, "apricorn_stairs", back)
    h.fill(-36, 4, -36, -30, 4, -30, "apricorn_planks"); h.fill(-35, 5, -35, -31, 5, -31, "apricorn_slab", half="bottom")
    h.set(-33, 5, -33, "apricorn_wood", face="up")
    for x, z in ring(-37, -37, -29, -29):
        back = "east" if x == -37 else "west" if x == -29 else "south" if z == -37 else "north"
        h.stairs(x, 4, z, "apricorn_stairs", back)
    h.lantern(-33, 3, -33, hanging=True)
    # saplings of all seven in a planter, a shed with an apricorn door
    for x, z in ring(-28, -28, -20, -26): h.set(x, 1, z, "stripped_apricorn_wood", face="up")
    for x, colour in zip(range(-27, -20), COLOURS): h.set(x, 1, -27, f"{colour}_apricorn_sapling")
    h.fill(-27, 1, -24, -23, 3, -21, "apricorn_planks"); h.fill(-26, 1, -23, -24, 3, -22, "air")
    for x, z in ((-27, -24), (-23, -24), (-27, -21), (-23, -21)): h.fill(x, 1, z, x, 3, z, "apricorn_log", face="up")
    h.door(-23, 1, -22, "apricorn_door", "east")
    h.set(-25, 2, -24, "apricorn_trapdoor", dir="north", half="bottom", open=True)
    h.fill(-27, 4, -24, -23, 4, -21, "apricorn_slab", half="bottom")
    h.fill(-26, 1, -23, -26, 2, -23, "hearty_grain_bale")


def ranch(h):
    h.begin("ranch")
    for (x1, x2), gate in (((22, 32), 27), ((34, 44), 39)):
        h.connected([p for p in ring(x1, -45, x2, -35) if p != (gate, -35)], "apricorn_fence", 1, links=[(gate, -35)])
        h.set(gate, 1, -35, "apricorn_fence_gate", dir="south")
        h.set(gate, 1, -34, "light_gray_plaque", face="up", dir="south")
        for x in (x1 + 3, x2 - 3): h.two_tall(x, 1, -41, "pasture", dir="south")
        h.fill(x1 + 4, 0, -43, x2 - 4, 0, -43, "water")                          # trough
        h.set(x1 + 3, 1, -43, "smooth_tumblestone_slab", half="bottom"); h.set(x2 - 3, 1, -43, "smooth_tumblestone_slab", half="bottom")
        h.fill(x1 + 1, 1, -44, x1 + 2, 2, -43, "hearty_grain_bale")
        h.fill(x2 - 2, 1, -38, x2 - 1, 1, -37, "hearty_grain_bale")
    # feed tables between benches
    h.fill(25, 1, -27, 31, 1, -27, "stripped_apricorn_wood", face="up")
    for x, treat in zip(range(25, 32), ("incense_sweet", "poke_cake", "poke_snack", "incense_sweet", "poke_cake", "poke_snack", "incense_sweet")):
        if treat == "incense_sweet": h.set(x, 2, -27, treat, lit=True)
        else: h.set(x, 2, -27, treat, dir="south", bites=0)
    for x in range(25, 32):
        h.stairs(x, 1, -29, "apricorn_stairs", "north"); h.stairs(x, 1, -25, "apricorn_stairs", "south")
    h.fill(38, 1, -28, 40, 2, -26, "hearty_grain_bale"); h.fill(39, 3, -28, 40, 3, -27, "hearty_grain_bale")


def camp(h):
    h.begin("camp")
    cx, cz = -33, 33
    cells = {(cx + x, cz + z): "grass_path" for x in range(-10, 11) for z in range(-10, 11) if math.hypot(x, z) <= 9.5}
    h.paint(0, cells)
    h.set(cx, 1, cz, "habitat_block", dir="south")
    # seven campfires with their pots, each pot block on a saccharine stump just outside
    for k, colour in enumerate(COLOURS):
        a = math.radians(-90 + k * 360 / 7)
        x, z = cx + round(6 * math.cos(a)), cz + round(6 * math.sin(a))
        facing = "east" if abs(math.cos(a)) > abs(math.sin(a)) and math.cos(a) < 0 else "west" if abs(math.cos(a)) > abs(math.sin(a)) else "south" if math.sin(a) < 0 else "north"
        h.set(x, 1, z, f"campfire_{colour}", dir=facing)
        sx, sz = cx + round(8.5 * math.cos(a)), cz + round(8.5 * math.sin(a))
        h.set(sx, 1, sz, "saccharine_log"); h.set(sx, 2, sz, f"campfire_pot_{colour}", dir=facing)
    seats = []
    for k in range(14):
        a = math.radians(k * 360 / 14)
        p = (cx + round(3.5 * math.cos(a)), cz + round(3.5 * math.sin(a)))
        if p not in seats: seats.append(p)
    for x, z in seats: h.set(x, 1, z, "tatami_mat", dir="north")
    # storage: every gilded chest in a row (a gilded chest turns into its chest entity the first time it is used)
    for x, chest in zip(range(-36, -29), ["gilded_chest"] + [f"{c}_gilded_chest" for c in ("black", "blue", "green", "pink", "white", "yellow")]):
        h.set(x, 1, 21, chest)
    # the saccharine grove: honey-slathered trunks under saccharine leaves
    honey = {(-44, 39): (0, 1), (-40, 44): (2, 3), (-45, 44): (4,), (-36, 45): (5,)}
    for (x, z), kinds in honey.items():
        for y in range(1, 5): h.set(x, y, z, "saccharine_log")
        for i, kind in enumerate(kinds): h.set(x, 2 + i, z, "saccharine_log_slathered", dir="south", honey_type=kind)
        for y in (4, 5):
            for dx in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    if (dx or dz) and abs(x + dx) <= HALF - 1 and abs(z + dz) <= HALF - 1: h.set(x + dx, y, z + dz, "saccharine_leaves")
        h.set(x, 5, z, "saccharine_leaves"); h.set(x, 6, z, "saccharine_leaves")
    h.set(-41, 1, 41, "saccharine_sapling")


def lights(h):
    """Light set flush into the outdoor ground on a 6 block grid wherever the ground is open."""
    h.begin("lights")
    swap = {"minecraft:grass_block": "shroomlight", "minecraft:grass_path": "shroomlight", "cobblemon:polished_tumblestone": "sea_lantern"}
    near = sorted({(dx, dz) for dx in range(-2, 3) for dz in range(-2, 3)}, key=lambda p: (abs(p[0]) + abs(p[1]), p))
    for gx in range(-45, HALF, 6):
        for gz in range(-45, HALF, 6):
            for dx, dz in near:
                x, z = gx + dx, gz + dz
                if abs(x) > HALF - 1 or abs(z) > HALF - 1: continue
                ground = h.floor.get((x, z)); over = h.above.get((x, z), "minecraft:air")
                if ground in swap and over == "minecraft:air":
                    h.set(x, 0, z, swap[ground]); break


NPC_SPOTS = {  # name: (entity, x, y, z)
    "Nurse": ("cobblemon:npc_sacchi", 0.5, 2, -36.5),
    "Gym Leader": ("cobblemon:npc_trainer", -31.5, 1, -10.5),
    "Ace Trainer": ("cobblemon:npc_trainer", -31.5, 1, 11.5),
    "Poke Mart Clerk": ("cobblemon:poke_mart_clerk", 24.5, 1, -8.5),
}


def npcs(h):
    h.begin("npcs")
    ox, oy, oz = h.abs(-HALF, -1, -HALF)
    volume = f"x={ox},y={oy},z={oz},dx={2 * HALF - 1},dy={TOP + 1},dz={2 * HALF - 1}"
    for name, (entity, *_rest) in NPC_SPOTS.items():
        h.emit(f'kill @e[type={entity},name="{name}",{volume}]')
    for name, (entity, x, y, z) in NPC_SPOTS.items():
        ax, ay, az = h.cx + x, h.y + y, h.cz + z
        h.emit(f'summon {entity} "{name}" {ax} {ay} {az}')
        near = f'name="{name}",x={ax},y={ay},z={az},r=2'
        h.emit(f"effect @e[type={entity},{near}] slowness 1000000 255 true")
        h.emit(f"tag @e[type={entity},{near}] add hub_npc")   # scripts/main.js keeps a trainer tagged so in the hub
        if entity == "cobblemon:poke_mart_clerk": h.emit(f"tag @e[type={entity},{near}] add poke_mart_clerk")


def spawn(h):
    h.begin("spawn")
    h.emit(f"setworldspawn {h.cx} {h.y + 1} {h.cz}")
    h.emit("gamerule spawnradius 0")
    # scripts/main.js keeps the hub's area: no wild Pokemon or hostile mobs spawn in it, and survival players are in
    # adventure mode there
    h.emit(f"scriptevent cobblemon:hub {h.cx} {h.y} {h.cz}")


BUILDERS = [base, roads, plaza, center, mart, gym, lab, garden, orchard, ranch, camp, lights, npcs, spawn]


# ---------------------------------------------------------------------------------------------------------

def failed(result):
    text = result.lower()
    return any(s in text for s in ("error", "unknown", "syntax", "cannot", "not loaded", "outside of the world", "too many", "success_count: 0", "no targets"))


def wait_loaded(bridge, corners, seconds=40):
    """Poll the hub's corners until the ticking area has loaded them, or give up."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        results = [bridge.command(f"testforblock {x} {y} {z} air") for x, y, z in corners]
        if not any(s in r.lower() for r in results for s in ("outside", "not loaded", "unloaded")): return True
        time.sleep(2)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--x", type=int, required=True); parser.add_argument("--y", type=int, required=True); parser.add_argument("--z", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true", help="print the commands instead of sending them")
    parser.add_argument("--zone", choices=ZONES, help="build only this zone")
    args = parser.parse_args()

    h = Hub(args.x, args.y, args.z, args.zone)
    for build in BUILDERS: build(h)
    a, b = h.abs(-HALF, -1, -HALF), h.abs(HALF - 1, TOP, HALF - 1)
    area = f"tickingarea add {a[0]} {a[1]} {a[2]} {b[0]} {b[1]} {b[2]} hub true"
    commands = [area] + [c for _, c in h.commands] + ["tickingarea remove hub"]

    refused = []
    if args.dry_run:
        for c in commands: print(c)
    else:
        sys.path.insert(0, HERE)
        from bridge import Bridge
        bridge = Bridge()
        print(area, "->", bridge.command(area))
        corners = [h.abs(x, 0, z) for x in (-HALF, HALF - 1) for z in (-HALF, HALF - 1)]
        if not wait_loaded(bridge, corners): sys.exit("the hub's chunks did not load; nothing built (the ticking area 'hub' is still there)")
        started, zone = time.time(), None
        for i, (z, c) in enumerate(h.commands, 1):
            if z != zone: zone = z; print(f"[{time.time() - started:6.0f}s] {zone}", flush=True)
            result = bridge.command(c)
            if failed(result): refused.append((c, result.strip().splitlines()[0] if result.strip() else ""))
            if i % 200 == 0: print(f"  {i}/{len(h.commands)} commands", flush=True)
        print("tickingarea remove hub ->", bridge.command("tickingarea remove hub"))

    out = sys.stderr if args.dry_run else sys.stdout
    print(f"\n{len(commands)} commands ({len(h.commands)} for {args.zone or 'all zones'}, {h.planned} planned in all)", file=out)
    if refused:
        print(f"{len(refused)} refused, the first 30:", file=out)
        for c, r in refused[:30]: print(f"  {c}\n    -> {r}", file=out)
    used = sorted(h.used); unused = sorted(set(CUSTOM) - h.used)
    print(f"\ncustom blocks used ({len(used)}): {' '.join(u.split(':')[1] for u in used)}", file=out)
    print(f"\ncustom blocks not used ({len(unused)}): {' '.join(u.split(':')[1] for u in unused)}", file=out)


if __name__ == "__main__":
    main()
