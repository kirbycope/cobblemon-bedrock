"""Offline portrait renderer for the cobblemon-bedrock resource pack.

Renders a species' Bedrock geometry (.geo.json, format 1.12) with its texture
layers into a transparent PNG, posed at the first frame of the animations its
Cobblemon poser plays for the PROFILE pose, and turned the way Cobblemon's
drawProfilePokemon turns it (Euler XYZ 13, 35, 0 degrees).

Conventions (verified against Cobblemon's TexturedModel.createWithUvOverride):
  * Work in Blockbench space: bb = (-x, y, z) of the Bedrock file, rotations
    (-rx, -ry, rz), Euler order ZYX (X applied first). The model faces -Z.
  * Cobblemon's Java model space is diag(-1, -1, 1) * bb (Y down), which is the
    space drawProfilePokemon rotates in; the GUI then looks along +Z, X right,
    Y down. Feet sit at the model origin (the root bone has no 24 px offset).

Usage:
  python render_portraits.py 0004_charmander 0025_pikachu ...   (folder names)
  python render_portraits.py --all
Options: --size 128 --ss 4 --variant 0 --frame fit|cobblemon --rest --out DIR
"""
import argparse
import fnmatch
import glob
import json
import math
import os
import re
import sys
import time

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(REPO, "development_resource_packs", "cobblemon")
POSERS = os.path.join(REPO, "java", "common", "src", "main", "resources", "assets",
                      "cobblemon", "bedrock", "pokemon", "posers")
HERE = os.path.dirname(os.path.abspath(__file__))


def load_json(path):
    with open(path, encoding="utf-8") as f:
        txt = f.read()
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        # strip // comments and trailing commas that some files carry
        txt = re.sub(r"//[^\n]*", "", txt)
        txt = re.sub(r",(\s*[}\]])", r"\1", txt)
        return json.loads(txt)


# ---------------------------------------------------------------- molang (t = 0)

_MATH = {
    "sin": lambda d: math.sin(math.radians(d)),
    "cos": lambda d: math.cos(math.radians(d)),
    "abs": abs, "sqrt": lambda x: math.sqrt(max(x, 0)), "floor": math.floor,
    "ceil": math.ceil, "round": round, "trunc": math.trunc, "exp": math.exp,
    "ln": lambda x: math.log(x) if x > 0 else 0.0, "pow": lambda a, b: a ** b,
    "min": min, "max": max, "mod": lambda a, b: math.fmod(a, b) if b else 0.0,
    "clamp": lambda x, a, b: max(a, min(b, x)),
    "lerp": lambda a, b, t: a + (b - a) * t,
    "atan": lambda x: math.degrees(math.atan(x)),
    "atan2": lambda y, x: math.degrees(math.atan2(y, x)),
    "asin": lambda x: math.degrees(math.asin(max(-1, min(1, x)))),
    "acos": lambda x: math.degrees(math.acos(max(-1, min(1, x)))),
    "random": lambda a, b: (a + b) / 2, "random_integer": lambda a, b: (a + b) // 2,
    "die_roll": lambda n, a, b: n * (a + b) / 2, "hermite_blend": lambda t: 3 * t * t - 2 * t ** 3,
    "pi": math.pi,
}


def molang(expr, t=0.0):
    if isinstance(expr, (int, float)):
        return float(expr)
    if not isinstance(expr, str):
        return 0.0
    s = expr.strip().rstrip(";").lower()
    if not s:
        return 0.0
    if "?" in s or ";" in s:
        return 0.0
    s = re.sub(r"\b(q|query)\.(anim_time|life_time)\b", "__t", s)
    s = re.sub(r"\bmath\.pi\b", "__m_pi", s)
    s = re.sub(r"\bmath\.(\w+)", r"__m_\1", s)
    s = re.sub(r"\b(q|query|v|variable|t|temp|c|context)\.[\w.]+(\([^()]*\))?", "0", s)
    s = s.replace("&&", " and ").replace("||", " or ")
    s = re.sub(r"!(?!=)", " not ", s)
    env = {"__t": t, "__m_pi": math.pi, "__builtins__": {}}
    for k, v in _MATH.items():
        env["__m_" + k] = v
    try:
        return float(eval(s, env))
    except Exception:
        return 0.0


def channel_at_zero(ch):
    """Value of an animation channel ([x,y,z], scalar or keyframe dict) at t=0."""
    if isinstance(ch, dict):
        if not ch:
            return None
        keys = sorted(ch.keys(), key=lambda k: float(k))
        v = ch[keys[0]]
        if isinstance(v, dict):
            v = v.get("post", v.get("pre", [0, 0, 0]))
        ch = v
    if isinstance(ch, list):
        vals = [molang(c) for c in ch]
        while len(vals) < 3:
            vals.append(vals[-1] if vals else 0.0)
        return vals[:3]
    x = molang(ch)
    return [x, x, x]


# ------------------------------------------------------------------ math helpers

def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def bedrock_rot(r):
    """Bedrock rotation (deg) -> 3x3 matrix in Blockbench space."""
    rx, ry, rz = (math.radians(v) for v in r)
    return rot_z(rz) @ rot_y(-ry) @ rot_x(-rx)


def affine(R=None, t=None):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    if t is not None:
        M[:3, 3] = t
    return M


def about(pivot_bb, R, S=None):
    """T(p) R S T(-p)."""
    A = R if S is None else R @ np.diag(S)
    p = np.asarray(pivot_bb, float)
    return affine(A, p - A @ p)


def bbp(p):
    return np.array([-p[0], p[1], p[2]], float)


# ------------------------------------------------------------------ pack lookup

_GEO_INDEX = None


def geo_index():
    global _GEO_INDEX
    if _GEO_INDEX is None:
        _GEO_INDEX = {}
        for f in glob.glob(os.path.join(PACK, "models", "entity", "*", "*.geo.json")):
            try:
                d = load_json(f)
            except Exception:
                continue
            for g in d.get("minecraft:geometry", []):
                _GEO_INDEX[g["description"]["identifier"]] = g
    return _GEO_INDEX


def load_rc_defs():
    defs = {}
    for f in glob.glob(os.path.join(PACK, "render_controllers", "*.json")):
        try:
            defs.update(load_json(f)["render_controllers"])
        except Exception:
            pass
    return defs


_RC = None


def rc_defs():
    global _RC
    if _RC is None:
        _RC = load_rc_defs()
    return _RC


def pick(expr, arrays, variant):
    """Resolve 'Array.x[query.variant]' / 'Texture.y' to a leaf name."""
    m = re.match(r"\s*(Array\.\w+)\s*\[(.*)\]\s*$", expr)
    if m:
        arr = arrays.get(m.group(1), [])
        if not arr:
            return None
        idx = re.sub(r"\b(query|q)\.variant\b", str(variant), m.group(2))
        i = int(molang(idx))
        return arr[max(0, min(i, len(arr) - 1))]
    return expr.strip()


def find_animations(folder, species):
    """First-frame bone channels of the PROFILE pose's bedrock clips."""
    anims = {}
    for f in glob.glob(os.path.join(PACK, "animations", folder, "*.animation.json")):
        try:
            anims.update(load_json(f).get("animations", {}))
        except Exception:
            pass
    posers = sorted(glob.glob(os.path.join(POSERS, folder, "*.json")))
    poser = None
    for p in posers:  # prefer the file named after the base species
        if os.path.splitext(os.path.basename(p))[0] == species:
            poser = p
    if poser is None and posers:
        poser = posers[0]
    info = {"poser": poser, "clips": [], "portraitScale": None, "profileScale": 1.0,
            "profileTranslation": [0, 0, 0]}
    if not poser:
        return kotlin_poser(species, anims, info)
    pj = load_json(poser)
    info["profileScale"] = pj.get("profileScale", 1.0)
    info["profileTranslation"] = pj.get("profileTranslation", [0, 0, 0])
    info["portraitScale"] = pj.get("portraitScale")
    poses = pj.get("poses", {})
    chosen = None
    for want in ("PROFILE", "PORTRAIT", "STAND", "NONE"):
        for name, pose in poses.items():
            if want in pose.get("poseTypes", []) and not pose.get("isBattle", False):
                chosen = pose
                break
        if chosen:
            break
    if chosen is None and poses:
        chosen = next(iter(poses.values()))
    for a in (chosen or {}).get("animations", []):
        if not isinstance(a, str):
            continue  # conditional entries (hold_item and the like)
        m = re.match(r"\s*q\.bedrock\(\s*'([^']+)'\s*,\s*'([^']+)'", a)
        if m:
            key = "animation.%s.%s" % (m.group(1), m.group(2))
            if key in anims:
                info["clips"].append((key, anims[key]))
    return info


KOTLIN = os.path.join(REPO, "java", "common", "src", "main", "kotlin", "com", "cobblemon", "mod",
                      "common", "client", "render", "models", "blockbench", "pokemon")
_KT = None


def kotlin_poser(species, anims, info):
    """Older species keep their poser as a Kotlin class (gen1/ParasModel.kt)."""
    global _KT
    if _KT is None:
        _KT = {os.path.basename(f)[:-len("Model.kt")].lower(): f
               for f in glob.glob(os.path.join(KOTLIN, "*", "*Model.kt"))}
    f = _KT.get(species.replace("_", "").lower())
    chosen = []
    if f:
        info["poser"] = f
        src = open(f, encoding="utf-8").read()
        m = re.search(r"profileScale\s*=\s*([-\d.]+)F?", src)
        if m:
            info["profileScale"] = float(m.group(1))
        m = re.search(r"profileTranslation\s*=\s*Vec3\(([^)]*)\)", src)
        if m:
            info["profileTranslation"] = [float(x.strip().rstrip("F")) for x in m.group(1).split(",")]
        chunks = src.split("registerPose(")[1:]
        for want in ("UI_POSES", "PROFILE", "PORTRAIT", "STATIONARY_POSES", "STAND"):
            for c in chunks:
                if want in c.split("animations")[0] and "isBattle = true" not in c:
                    chosen = re.findall(r'bedrock\(\s*"([^"]+)"\s*,\s*"([^"]+)"', c)
                    break
            if chosen:
                break
    if not chosen:  # no poser at all: fall back to the pack's own idle clip
        for key in anims:
            if key.endswith(".ground_idle"):
                chosen = [tuple(key.split(".")[1:3])]
                break
    for a, b in chosen:
        key = "animation.%s.%s" % (a, b)
        if key in anims:
            info["clips"].append((key, anims[key]))
    return info


def species_setup(folder, variant=0):
    ent_path = os.path.join(PACK, "entity", folder + ".entity.json")
    desc = load_json(ent_path)["minecraft:client_entity"]["description"]
    geos = desc.get("geometry", {})
    texs = desc.get("textures", {})
    mats = desc.get("materials", {})
    layers = []
    for rc in desc.get("render_controllers", []):
        if isinstance(rc, dict):
            continue  # conditional (held item) controllers are skipped
        d = rc_defs().get(rc)
        if not d:
            continue
        arrays = {}
        for kind in ("textures", "geometries", "materials"):
            arrays.update(d.get("arrays", {}).get(kind, {}))
        gname = pick(d.get("geometry", ""), arrays, variant)
        if not gname:
            continue
        gid = geos.get(gname.split(".", 1)[-1])
        tname = pick(d.get("textures", [""])[0], arrays, variant)
        tpath = texs.get(tname.split(".", 1)[-1]) if tname else None
        mat_rules = []
        for m in d.get("materials", []):
            for bone_pat, mexpr in m.items():
                mname = mexpr.split(".", 1)[-1]
                mat_rules.append((bone_pat, mats.get(mname, mname)))
        vis = []
        for m in d.get("part_visibility", []):
            for bone_pat, v in m.items():
                vis.append((bone_pat, bool(v) if isinstance(v, bool) else bool(molang(v))))
        layers.append({"controller": rc, "geometry": gid, "texture": tpath,
                       "materials": mat_rules, "visibility": vis})
    return desc, layers


# ------------------------------------------------------------------ geometry

FACES = ("north", "south", "east", "west", "up", "down")


def cube_quads(cube, tex_w, tex_h):
    """Yield (face, corners[4] bb-space, uv[4], normal) for one Bedrock cube.

    Corners are ordered TL, TR, BR, BL as seen from outside the face, so the
    texture's top-left lands on corner 0.
    """
    o = np.array(cube.get("origin", [0, 0, 0]), float)
    s = np.array(cube.get("size", [0, 0, 0]), float)
    inf = float(cube.get("inflate", 0.0))
    lo = np.array([-(o[0] + s[0]), o[1], o[2]])  # bb min
    hi = lo + s
    lo_i, hi_i = lo - inf, hi + inf
    x0, y0, z0 = lo_i
    x1, y1, z1 = hi_i
    P = {  # corners TL, TR, BR, BL viewed from outside
        "north": [(x1, y1, z0), (x0, y1, z0), (x0, y0, z0), (x1, y0, z0)],
        "south": [(x0, y1, z1), (x1, y1, z1), (x1, y0, z1), (x0, y0, z1)],
        "east":  [(x1, y1, z1), (x1, y1, z0), (x1, y0, z0), (x1, y0, z1)],
        "west":  [(x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (x0, y0, z0)],
        # up: u along -X (from maxX), v along -Z (from maxZ)
        "up":    [(x1, y1, z1), (x0, y1, z1), (x0, y1, z0), (x1, y1, z0)],
        # down: same horizontal orientation, v from maxZ as well
        "down":  [(x1, y0, z1), (x0, y0, z1), (x0, y0, z0), (x1, y0, z0)],
    }
    N = {"north": (0, 0, -1), "south": (0, 0, 1), "east": (1, 0, 0), "west": (-1, 0, 0),
         "up": (0, 1, 0), "down": (0, -1, 0)}
    uv = cube.get("uv", [0, 0])
    mirror = bool(cube.get("mirror", False))
    sx, sy, sz = s
    rects = {}
    if isinstance(uv, list):
        u, v = uv[0], uv[1]
        rects = {
            "east": (u, v + sz, sz, sy),
            "north": (u + sz, v + sz, sx, sy),
            "west": (u + sz + sx, v + sz, sz, sy),
            "south": (u + 2 * sz + sx, v + sz, sx, sy),
            "up": (u + sz, v, sx, sz),
            "down": (u + sz + sx, v, sx, sz),
        }
        if mirror:
            rects["east"], rects["west"] = rects["west"], rects["east"]
    else:
        for f in FACES:
            fd = uv.get(f)
            if not fd:
                continue
            fu, fv = fd.get("uv", [0, 0])
            fw, fh = fd.get("uv_size", [0, 0])
            rects[f] = (fu, fv, fw, fh)
    for f in FACES:
        if f not in rects:
            continue
        ru, rv, rw, rh = rects[f]
        if mirror and isinstance(uv, list):
            ru, rw = ru + rw, -rw  # mirrored box: every face flips horizontally
        c = [np.array(p, float) for p in P[f]]
        area = np.linalg.norm(np.cross(c[1] - c[0], c[3] - c[0]))
        if area < 1e-9:
            continue
        uvs = [(ru, rv), (ru + rw, rv), (ru + rw, rv + rh), (ru, rv + rh)]
        uvs = [(a / tex_w, b / tex_h) for a, b in uvs]
        yield f, c, uvs, np.array(N[f], float)


def bone_matrices(bones, anim):
    """World matrix (bb space) per bone, rest pose plus animation channels."""
    by_name = {b["name"]: b for b in bones}
    cache = {}

    def world(name):
        if name in cache:
            return cache[name]
        b = by_name[name]
        rot = list(b.get("rotation", [0, 0, 0]))
        pos = [0.0, 0.0, 0.0]
        scl = [1.0, 1.0, 1.0]
        a = anim.get(name.lower())
        if a:
            if "rotation" in a:
                rot = [rot[i] + a["rotation"][i] for i in range(3)]
            if "position" in a:
                pos = [-a["position"][0], a["position"][1], a["position"][2]]
            if "scale" in a:
                scl = a["scale"]
        local = affine(t=pos) @ about(bbp(b.get("pivot", [0, 0, 0])), bedrock_rot(rot), scl)
        parent = b.get("parent")
        M = world(parent) @ local if parent in by_name else local
        cache[name] = M
        return M

    for n in by_name:
        world(n)
    return cache


def collect_anim(info):
    out = {}
    for _, clip in info["clips"]:
        for bone, chans in clip.get("bones", {}).items():
            e = out.setdefault(bone.lower(), {})
            for k in ("rotation", "position", "scale"):
                if k in chans:
                    v = channel_at_zero(chans[k])
                    if v is None:
                        continue
                    if k == "scale":
                        e[k] = [a * b for a, b in zip(e.get(k, [1, 1, 1]), v)]
                    else:
                        e[k] = [a + b for a, b in zip(e.get(k, [0, 0, 0]), v)]
    return out


# ------------------------------------------------------------------ raster

def load_texture(rel):
    if not rel:
        return None
    for ext in (".png", ".tga"):
        p = os.path.join(PACK, rel.replace("/", os.sep) + ext)
        if os.path.exists(p):
            return np.asarray(Image.open(p).convert("RGBA"), dtype=np.float32) / 255.0
    return None


def view_matrix():
    """bb space -> GUI space (x right, y down, z away from viewer)."""
    to_java = np.diag([-1.0, -1.0, 1.0])
    q = rot_x(math.radians(13)) @ rot_y(math.radians(35)) @ rot_z(0)
    return q @ to_java


L0 = np.array([-1.0, -1.0, -1.0])
L0 /= np.linalg.norm(L0)
L1 = np.array([1.3, 1.0, -1.0])
L1 /= np.linalg.norm(L1)


def shade(n_gui):
    """Minecraft entity lighting: 0.4 ambient + 0.6 * two diffuse lights."""
    d = max(0.0, float(-n_gui @ -L0)) + max(0.0, float(-n_gui @ -L1))
    return min(1.0, 0.4 + 0.6 * d)


def build_tris(geo, anim, layer):
    bones = geo.get("bones", [])
    desc = geo["description"]
    tw, th = desc.get("texture_width", 64), desc.get("texture_height", 64)
    mats = bone_matrices(bones, anim)
    V = view_matrix()
    hidden = set()
    for b in bones:
        vis = True
        for pat, v in layer["visibility"]:
            if fnmatch.fnmatch(b["name"], pat):
                vis = v
        if not vis:
            hidden.add(b["name"])
    tris = []
    for b in bones:
        if b["name"] in hidden or not b.get("cubes"):
            continue
        mat = "entity_alphatest"
        for pat, m in layer["materials"]:
            if fnmatch.fnmatch(b["name"], pat):
                mat = m
        M = mats[b["name"]]
        for cube in b["cubes"]:
            C = M
            if "rotation" in cube:
                C = M @ about(bbp(cube.get("pivot", b.get("pivot", [0, 0, 0]))),
                              bedrock_rot(cube["rotation"]))
            R = V @ C[:3, :3]
            for f, corners, uvs, n in cube_quads(cube, tw, th):
                pts = [V @ (C[:3, :3] @ p + C[:3, 3]) for p in corners]
                ng = R @ n
                nl = np.linalg.norm(ng)
                if nl < 1e-9:
                    continue
                ng /= nl
                if ng[2] >= -1e-6:  # facing away (viewer looks along +z)
                    continue
                s = shade(ng)
                tris.append((pts[0], pts[1], pts[2], uvs[0], uvs[1], uvs[2], s, mat))
                tris.append((pts[0], pts[2], pts[3], uvs[0], uvs[2], uvs[3], s, mat))
    return tris


def raster(tris, tex, W, H, xf, color, alpha, zbuf, blend, emissive):
    th, tw = tex.shape[:2]
    for (p0, p1, p2, t0, t1, t2, s, mat) in tris:
        P = np.array([xf(p0), xf(p1), xf(p2)])
        xmin = max(int(math.floor(P[:, 0].min())), 0)
        xmax = min(int(math.ceil(P[:, 0].max())), W - 1)
        ymin = max(int(math.floor(P[:, 1].min())), 0)
        ymax = min(int(math.ceil(P[:, 1].max())), H - 1)
        if xmin > xmax or ymin > ymax:
            continue
        (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = P
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12:
            continue
        xs = np.arange(xmin, xmax + 1) + 0.5
        ys = np.arange(ymin, ymax + 1) + 0.5
        X, Y = np.meshgrid(xs, ys)
        w0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
        w1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
        w2 = 1 - w0 - w1
        inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not inside.any():
            continue
        z = w0 * z0 + w1 * z1 + w2 * z2
        u = w0 * t0[0] + w1 * t1[0] + w2 * t2[0]
        v = w0 * t0[1] + w1 * t1[1] + w2 * t2[1]
        # keep samples inside the face's own texel rectangle
        umin, umax = min(t0[0], t1[0], t2[0]), max(t0[0], t1[0], t2[0])
        vmin, vmax = min(t0[1], t1[1], t2[1]), max(t0[1], t1[1], t2[1])
        eu, ev = 0.01 / tw, 0.01 / th
        u = np.clip(u, umin + eu, max(umin + eu, umax - eu))
        v = np.clip(v, vmin + ev, max(vmin + ev, vmax - ev))
        tx = np.clip((u * tw).astype(int), 0, tw - 1)
        ty = np.clip((v * th).astype(int), 0, th - 1)
        texel = tex[ty, tx]
        sl = (slice(ymin, ymax + 1), slice(xmin, xmax + 1))
        zb = zbuf[sl]
        if blend:
            ok = inside & (z <= zb + 1e-3) & (texel[..., 3] > 0.004)
        else:
            ok = inside & (z < zb) & (texel[..., 3] >= 0.1)
        if not ok.any():
            continue
        lit = 1.0 if emissive else s
        rgb = texel[..., :3] * lit
        if blend:
            a = texel[..., 3:4]
            cs = color[sl]
            asl = alpha[sl]
            nc = rgb * a + cs * (1 - a)
            na = a[..., 0] + asl * (1 - a[..., 0])
            cs[ok] = nc[ok]
            asl[ok] = na[ok]
        else:
            color[sl][ok] = rgb[ok]
            alpha[sl][ok] = 1.0
            zb[ok] = z[ok]


def render_species(folder, size=128, ss=4, variant=0, frame="fit", rest=False, margin=0.06):
    species = folder.split("_", 1)[1] if "_" in folder else folder
    desc, layers = species_setup(folder, variant)
    info = find_animations(folder, species)
    anim = {} if rest else collect_anim(info)
    gi = geo_index()
    passes = []
    for L in layers:
        geo = gi.get(L["geometry"])
        tex = load_texture(L["texture"])
        if geo is None or tex is None:
            continue
        if L["texture"].endswith("/blank"):
            continue
        tris = build_tris(geo, anim, L)
        blend = any("blend" in m for _, m in L["materials"])
        emissive = "emissive" in L["controller"] or any("emissive" in m for _, m in L["materials"])
        passes.append((tris, tex, blend, emissive))
    if not passes:
        raise RuntimeError("no renderable layer")
    W = H = size * ss
    allpts = np.array([p for tris, _, b, _ in passes if not b for t in tris for p in t[:3]]
                      or [p for tris, _, _, _ in passes for t in tris for p in t[:3]])
    if frame == "fit":
        mn, mx = allpts[:, :2].min(0), allpts[:, :2].max(0)
        ext = max(mx[0] - mn[0], mx[1] - mn[1], 1e-6)
        k = W * (1 - 2 * margin) / ext
        c = (mn + mx) / 2
        off = np.array([W / 2 - c[0] * k, H / 2 - c[1] * k])
    else:
        # Cobblemon PC slot: 25x25 GUI px, origin at (12.5, 1), 2.5 * 4.5 GUI px per block
        ps = info["profileScale"]
        tr = info["profileTranslation"]
        gui = W / 25.0
        k = gui * 11.25 * ps / 16.0
        off = np.array([gui * (12.5 + 11.25 * tr[0]),
                        gui * (1.0 + 11.25 * (tr[1] + 1.5 * ps))])

    def xf(p):
        return (p[0] * k + off[0], p[1] * k + off[1], p[2])

    color = np.zeros((H, W, 3), np.float32)
    alpha = np.zeros((H, W), np.float32)
    zbuf = np.full((H, W), np.inf, np.float32)
    for tris, tex, blend, emis in sorted(passes, key=lambda x: x[2]):
        raster(tris, tex, W, H, xf, color, alpha, zbuf, blend, emis)
    img = np.dstack([color * alpha[..., None], alpha])  # premultiplied
    img = img.reshape(size, ss, size, ss, 4).mean(axis=(1, 3))
    a = img[..., 3:4]
    rgb = np.where(a > 0, img[..., :3] / np.maximum(a, 1e-6), 0)
    out = np.dstack([rgb, a[..., 0]])
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA"), info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("species", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--size", type=int, default=128)
    ap.add_argument("--ss", type=int, default=4)
    ap.add_argument("--variant", type=int, default=0)
    ap.add_argument("--frame", choices=("fit", "cobblemon"), default="fit")
    ap.add_argument("--rest", action="store_true", help="skip the idle pose")
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    names = args.species
    if args.all:
        names = sorted(os.path.basename(p)[:-len(".entity.json")]
                       for p in glob.glob(os.path.join(PACK, "entity", "*.entity.json")))
        names = [n for n in names if re.match(r"^\d{4}_", n)]
        if args.limit:
            names = names[:args.limit]
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    fails = []
    for n in names:
        t = time.time()
        try:
            img, info = render_species(n, args.size, args.ss, args.variant, args.frame, args.rest)
            suffix = "" if args.frame == "fit" else "_" + args.frame
            img.save(os.path.join(args.out, n + suffix + ".png"), optimize=True)
            print("%-28s %.2fs clips=%s" % (n, time.time() - t, [c for c, _ in info["clips"]]))
        except Exception as e:
            fails.append((n, repr(e)))
            print("%-28s FAILED %r" % (n, e))
    print("total %.1fs for %d, %d failed" % (time.time() - t0, len(names), len(fails)))


def _render_to(job):
    name, path, size, variant = job
    try:
        img, _ = render_species(name, size, 4, variant, "fit", False)
        img.save(path, optimize=True)
        return None
    except Exception as e:
        return (name, repr(e))


def render_all(out_dir, naming, size=128, processes=None, variants=None):
    """Render every numbered species' portrait into out_dir, named by naming(species folder, variant); variants maps a
    folder to its number of variants (one when absent). Returns the failures."""
    from multiprocessing import Pool
    names = sorted(os.path.basename(p)[:-len(".entity.json")] for p in glob.glob(os.path.join(PACK, "entity", "*.entity.json")))
    jobs = [(n, os.path.join(out_dir, naming(n, v)), size, v) for n in names if re.match(r"^\d{4}_", n)
            for v in range((variants or {}).get(n, 1))]
    os.makedirs(out_dir, exist_ok=True)
    with Pool(processes) as pool: results = pool.map(_render_to, jobs, chunksize=8)
    return [r for r in results if r]


if __name__ == "__main__":
    main()
