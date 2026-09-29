"""Cobblemon's posers, read as data: each Pokemon's poses in the order Cobblemon tries them, with the pose types and
conditions that pick each one, the animations it plays and the parts it moves or hides. The JSON posers
(assets/cobblemon/bedrock/pokemon/posers) and the Kotlin models (client/render/models/blockbench/pokemon) are both
read, since Cobblemon keeps a species in one or the other.

A pose's animations are normalised to tuples:
  ("bedrock", group, name)                      a Bedrock animation clip
  ("look", bone, pitch, yaw, max_p, min_p, max_y, min_y)
  ("quadruped", period, amplitude, front_left, front_right, back_left, back_right)
  ("biped", period, amplitude, left, right)
  ("bimanual", period, amplitude, left, right)
  ("wing_flap", kind, amplitude, period, shift, axis, left, right)
  ("pitch_tilt", bone, min_pitch, max_pitch)
  ("unknown", source text)
and to_bedrock() turns a pose list into what the pack needs: Molang for the pose index, one controller state per pose
and a generated animation per pose for the procedural parts, which Cobblemon runs in code.
"""
import glob
import json
import math
import os
import re

JAVA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "java", "common", "src", "main")
POSERS = f"{JAVA}/resources/assets/cobblemon/bedrock/pokemon/posers"
MODELS_KT = f"{JAVA}/kotlin/com/cobblemon/mod/common/client/render/models/blockbench/pokemon"

# PoseType.kt, and the sets it names
POSE_SETS = {
    "ALL_POSES": {"STAND", "WALK", "SLEEP", "HOVER", "FLY", "FLOAT", "SWIM", "GLIDE", "SHOULDER_LEFT", "SHOULDER_RIGHT", "PROFILE", "PORTRAIT", "OPEN", "NONE"},
    "FLYING_POSES": {"FLY", "HOVER"}, "SWIMMING_POSES": {"SWIM", "FLOAT"}, "STANDING_POSES": {"STAND", "WALK"},
    "SHOULDER_POSES": {"SHOULDER_LEFT", "SHOULDER_RIGHT"}, "UI_POSES": {"PROFILE", "PORTRAIT"},
    "MOVING_POSES": {"WALK", "SWIM", "FLY"}, "STATIONARY_POSES": {"STAND", "FLOAT", "HOVER"}, "NO_GRAV_POSES": {"FLY", "HOVER", "SWIM"},
}
# the pose types an entity in the world can be in, as PokemonServerDelegate.updatePoseType picks them; the index is v.pose_type
WORLD_TYPES = ["STAND", "WALK", "SLEEP", "HOVER", "FLY", "FLOAT", "SWIM"]
DEG = 180 / math.pi

# Molang the pack can evaluate for each state Cobblemon's conditions read
BATTLE = "q.property('cobblemon:battle')"
SUBMERGED = "q.property('cobblemon:submerged')"
IN_WATER = "q.is_in_water"
HOLDING = "q.property('cobblemon:holding')"
# the queries the translated Molang may use; anything else Cobblemon asks is unknown to Bedrock and reads as false
BEDROCK_QUERIES = {"q.property", "q.is_on_ground", "q.has_rider", "q.is_in_water", "q.is_in_water_or_rain", "q.time_of_day",
                   "q.ground_speed", "q.vertical_speed", "q.is_tamed", "q.is_riding", "q.is_sleeping"}
UNKNOWN_QUERIES = set()


# ---------------------------------------------------------------------------
# small parsers
# ---------------------------------------------------------------------------

def split_args(text):
    """Top-level comma split, respecting brackets, braces and quotes."""
    out, depth, cur, quote = [], 0, "", None
    for ch in text:
        if quote:
            cur += ch
            if ch == quote: quote = None
            continue
        if ch in "'\"": quote = ch; cur += ch; continue
        if ch in "([{": depth += 1
        elif ch in ")]}": depth -= 1
        if ch == "," and depth == 0: out.append(cur.strip()); cur = ""
        else: cur += ch
    if cur.strip(): out.append(cur.strip())
    return out


def call(text):
    """'name(args)' as (name, [args]), or (None, None)."""
    m = re.match(r"\s*([A-Za-z_][\w.]*)\s*\(", text)
    if not m: return None, None
    depth = 0
    for i in range(m.end() - 1, len(text)):
        if text[i] == "(": depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0: return m.group(1), split_args(text[m.end():i])
    return None, None


def number(text, default=None):
    """A Kotlin or Molang number: 1.4F, -10F.toRadians(), (-2).toRadians(), 0.6662f."""
    if text is None: return default
    t = str(text).strip()
    radians = t.endswith(".toRadians()")
    if radians: t = t[:-len(".toRadians()")]
    t = t.strip().strip("()").strip()
    t = re.sub(r"(?<=\d)[fFdD]$", "", t.strip())
    try: value = float(t)
    except ValueError: return default
    return value / DEG if radians else value


def string(text):
    if text is None: return None
    t = text.strip()
    return t[1:-1] if len(t) >= 2 and t[0] in "'\"" and t[-1] == t[0] else None


def named(args):
    """Kotlin arguments as (positional list, named dict)."""
    pos, kw = [], {}
    for a in args:
        m = re.match(r"^([a-zA-Z_]\w*)\s*=(?!=)\s*(.*)$", a, re.S)
        if m: kw[m.group(1)] = m.group(2).strip()
        else: pos.append(a)
    return pos, kw


TIME = "q.life_time"


def wave(fname, args, t=TIME):
    """One of WaveFunction.kt's functions as Molang of the pose's time, in the function's own units (radians for a
    rotation, pixels for a translation)."""
    pos, kw = named(args or [])
    def g(key, i, d):
        v = number(kw[key], None) if key in kw else (number(pos[i], None) if i < len(pos) else d)
        if v is None: raise ValueError(f"cannot read {key} in {fname}({', '.join(args)})")
        return v
    if fname in ("sineFunction", "cosineFunction"):
        amp, period, phase, shift = g("amplitude", 0, 1), g("period", 1, 1), g("phaseShift", 2, 0), g("verticalShift", 3, 0)
        return f"(math.{'sin' if fname == 'sineFunction' else 'cos'}(({t} - {phase:g}) * {360 / period:.4f}) * {amp:.5f} + {shift:.5f})"
    if fname == "triangleFunction":
        amp, period, phase, shift = g("amplitude", 0, 1), g("period", 1, 1), g("phaseShift", 2, 0), g("verticalShift", 3, 0)
        return f"({4 * amp / period:.5f} * math.abs(math.mod({t} + {0.75 * period - phase:.5f}, {period:.5f}) - {period / 2:.5f}) - {amp:.5f} + {shift:.5f})"
    if fname == "parabolaFunction":
        if "peak" in kw or ("tightness" not in kw and len(pos) == 2):
            peak, period = g("peak", 0, 1), g("period", 1, 1)
            a, phase, shift = -4 * peak / period ** 2, period / 2, peak
        else:
            a, phase, shift = g("tightness", 0, -1), g("phaseShift", 1, 0), g("verticalShift", 2, 1)
        # the parabola repeats between its roots
        half = math.sqrt(max(0.0, -shift / a)) if a else 0
        lo, span = phase - half, 2 * half or 1
        wrapped = f"({lo:.5f} + math.mod({t} - {lo:.5f}, {span:.5f}))"
        return f"({a:.5f} * math.pow({wrapped} - {phase:.5f}, 2) + {shift:.5f})"
    if fname == "linearFunction":
        return f"({g('gradient', 0, 1):.5f} * {t} + {g('yIntercept', 1, 0):.5f})"
    return None


# ---------------------------------------------------------------------------
# JSON posers
# ---------------------------------------------------------------------------

JSON_FUNCTIONS = {"bedrock", "bedrock_primary", "bedrock_stateful", "look", "quadruped_walk", "biped_walk", "bimanual_swing", "sine_wing_flap", "pitch_tilt"}


def json_animation(text):
    if text == "look": return ("look", "head", 1, 1, 70, -45, 45, -45)
    name, args = call(text)
    if name is None: return ("unknown", text)
    name = name.split(".")[-1]
    s = lambda i, d=None: string(args[i]) if i < len(args) and string(args[i]) is not None else d
    n = lambda i, d: number(args[i], d) if i < len(args) else d
    if name in ("bedrock", "bedrock_primary", "bedrock_stateful"):
        if len(args) > 1 and string(args[1]) is None:
            # Cobblemon resolves a random name once, when it loads the poser; here each Pokemon rolls once
            choices = random_clips(args[1])
            return ("bedrock_choice", s(0), choices) if choices else ("unknown", text)
        return ("bedrock", s(0), s(1))
    if name == "look": return ("look", s(0, "head"), n(1, 1), n(2, 1), n(3, 70), n(4, -45), n(5, 45), n(6, -45))
    if name == "quadruped_walk": return ("quadruped", n(0, 0.6662), n(1, 1.4), s(2, "leg_front_left"), s(3, "leg_front_right"), s(4, "leg_back_left"), s(5, "leg_back_right"))
    if name == "biped_walk": return ("biped", n(0, 0.6662), n(1, 1.4), s(2, "leg_left"), s(3, "leg_right"))
    if name == "bimanual_swing": return ("bimanual", n(0, 0.6662), n(1, 1), s(2, "arm_left"), s(3, "arm_right"))
    if name == "sine_wing_flap":
        return ("wing_flap", wave("sineFunction", [f"amplitude={n(0, 0.9)}", f"period={n(1, 0.9)}", f"verticalShift={n(2, 0)}"]), s(3, "y"), s(4, "wing_left"), s(5, "wing_right"))
    if name == "pitch_tilt": return ("pitch_tilt", s(0, "root"), n(2, -45), n(3, 45))
    if name in ("bedrock_quirk", "bedrock_primary_quirk"):
        # a quirk in the animations list is not a pose animation, and Cobblemon's loader drops it
        return ("dropped_by_cobblemon", text)
    return ("unknown", text)


def top_level(text, ch):
    """Index of the first ch outside brackets and quotes, or -1."""
    depth, quote = 0, None
    for i, c in enumerate(text):
        if quote:
            if c == quote: quote = None
        elif c in "'\"": quote = c
        elif c in "([": depth += 1
        elif c in ")]": depth -= 1
        elif c == ch and depth == 0: return i
    return -1


def random_clips(text, weight=1.0):
    """A clip name chosen by math.random, 'math.random(0, 1) < 0.4 ? 'a' : (...)', as [(name, probability)]."""
    t = text.strip()
    while t.startswith("(") and t.endswith(")") and top_level(t[1:-1], ")") == -1: t = t[1:-1].strip()
    if string(t) is not None: return [(string(t), weight)]
    q = top_level(t, "?")
    m = re.match(r"math\.random\(\s*0\s*,\s*1\s*\)\s*<\s*([\d.]+)\s*$", t[:q]) if q > 0 else None
    if not m: return None
    rest, depth, quote = t[q + 1:], 0, None
    for i, c in enumerate(rest):   # the ':' that closes this '?', past any nested ternaries
        if quote:
            if c == quote: quote = None
            continue
        if c in "'\"": quote = c
        elif c in "([": depth += 1
        elif c in ")]": depth -= 1
        elif c == "?" and depth == 0: depth += 100
        elif c == ":" and depth >= 100: depth -= 100
        elif c == ":" and depth == 0:
            p = float(m.group(1))
            a, b = random_clips(rest[:i], weight * p), random_clips(rest[i + 1:], weight * (1 - p))
            return a + b if a is not None and b is not None else None
    return None


def json_condition(pose):
    """The Molang for a JSON pose's flags and conditions, or '1'."""
    parts = []
    if "isBattle" in pose: parts.append(BATTLE if pose["isBattle"] else f"!{BATTLE}")
    if "isTouchingWater" in pose: parts.append(IN_WATER if pose["isTouchingWater"] else f"!{IN_WATER}")
    if "isUnderWater" in pose: parts.append(SUBMERGED if pose["isUnderWater"] else f"!{SUBMERGED}")
    if "isWild" in pose: parts.append("!q.is_tamed" if pose["isWild"] else "q.is_tamed")
    conds = pose.get("condition", pose.get("conditions"))
    for c in ([conds] if isinstance(conds, str) else conds or []):
        parts.append(f"({molang_condition(c)})")
    return " && ".join(parts) or "1"


# Cobblemon's Molang queries a pose condition uses, as Bedrock can ask them
MOLANG_QUERIES = [
    (r"q\.in_air\b", "!q.is_on_ground"), (r"q\.is_flying\b", "!q.is_on_ground"), (r"q\.is_ridden\b", "q.has_rider"),
    (r"q\.has_entity\b", "1"), (r"q\.is_sprinting\b", "(q.has_rider && q.ground_speed > 7)"), (r"q\.is_gliding\b", "0"),
    (r"q\.is_battling\b", BATTLE), (r"q\.is_in_water\b", IN_WATER), (r"q\.is_underwater\b", SUBMERGED), (r"q\.is_touching_water\b", IN_WATER),
    (r"q\.in_battle\b", BATTLE), (r"q\.is_holding_item\b", HOLDING), (r"q\.is_wearing_hat\b", "0"),
    (r"q\.riding_style\s*==\s*'AIR'", "!q.is_on_ground"), (r"q\.riding_style\s*==\s*'LAND'", "q.is_on_ground"),
    (r"q\.riding_style\s*==\s*'LIQUID'", "q.is_in_water"), (r"q\.riding_style\s*!=\s*'AIR'", "q.is_on_ground"),
    (r"q\.riding_style\s*!=\s*'LAND'", "!q.is_on_ground"), (r"q\.riding_style\s*!=\s*'LIQUID'", "!q.is_in_water"), (r"q\.is_air\b", "!q.is_on_ground"),
    (r"q\.horizontal_velocity\b", "(q.ground_speed / 20)"),   # Cobblemon's is blocks a tick
    (r"q\.has_aspect\([^)]*\)", "0"), (r"!\s*q\.is_standing_on_blocks\([^)]*\)", "1"), (r"q\.is_standing_on_blocks\([^)]*\)", "0"),
]


def tidy(text):
    """Cobblemon's own condition typos (Orthworm's "!q.in_air' && q.is_ridden)"): a quote that opens no string,
    a bracket that closes nothing."""
    text = re.sub(r":\s*[\d.]+\s*\?\s*[\d.]+\s*$", "", text)   # Metagross: "... != 'AIR': 1.0 ? 0.0"
    out, depth, i = "", 0, 0
    while i < len(text):
        c = text[i]
        if c == "'":
            j = text.find("'", i + 1)
            if j > i + 1 and re.fullmatch(r"[\w:. -]+", text[i + 1:j]): out += text[i:j + 1]; i = j + 1; continue
            i += 1; continue
        if c == "(": depth += 1
        elif c == ")":
            if depth == 0: i += 1; continue
            depth -= 1
        out += c; i += 1
    return out + ")" * depth


def fold(text):
    """Bedrock will not take a ternary on a literal, 1 ? a : b; keep the branch it would pick."""
    while True:
        m = re.search(r"(?<![\w.])([01](?:\.0)?)\s*\?", text)
        if not m: return text
        rest, depth, colon = text[m.end():], 0, None
        for i, c in enumerate(rest):
            if c in "([": depth += 1
            elif c in ")]":
                if depth == 0: end = i; break
                depth -= 1
            elif c == "?" and depth == 0: depth += 100
            elif c == ":" and depth >= 100: depth -= 100
            elif c == ":" and depth == 0 and colon is None: colon = i
        else:
            end = len(rest)
        if colon is None:   # the binary form, a ? b: b when a holds, else 0
            keep = rest[:end] if float(m.group(1)) else "0"
        else:
            keep = rest[:colon] if float(m.group(1)) else rest[colon + 1:end]
        text = text[:m.start()] + f"({keep.strip()})" + rest[end:]


def molang_condition(text):
    out = tidy(text)
    for pattern, replacement in MOLANG_QUERIES: out = re.sub(pattern, replacement, out)
    def unknown(m):
        if m.group(1) in BEDROCK_QUERIES: return m.group(0)
        UNKNOWN_QUERIES.add(m.group(1))
        return "0"
    out = re.sub(r"(q\.\w+)(\([^)]*\))?", unknown, out)
    return fold(out.replace("!!", ""))


def json_parts(parts):
    out = []
    for t in parts or []:
        visible = t.get("isVisible", t.get("visible"))
        hidden = str(visible).strip().lower() in ("false", "0", "0.0") if visible is not None else False
        out.append({"part": t["part"], "position": t.get("position", [0, 0, 0]), "rotation": t.get("rotation", [0, 0, 0]),
                    "scale": t.get("scale"), "hidden": hidden})
    return out


def json_poses(folder, preferred):
    files = sorted(glob.glob(f"{folder}/*.json"))
    if not files: return None
    path = next((f for f in files if os.path.basename(f) == f"{preferred}.json"), None) or min(files, key=lambda f: len(os.path.basename(f)))
    with open(path, encoding="utf-8") as file: data = json.load(file)
    poses = []
    for key, pose in data.get("poses", {}).items():
        types = set(t.upper() for t in pose.get("poseTypes", []))
        if pose.get("allPoseTypes"): types |= POSE_SETS["ALL_POSES"]
        anims = []
        for a in pose.get("animations", []):
            text, cond = (a.get("animation"), a.get("condition")) if isinstance(a, dict) else (a, None)
            if text: anims.append((json_animation(text), molang_condition(cond) if cond else None))
        pname = pose.get("poseName", key)
        if isinstance(pname, list): pname = pname[0] if pname else key   # Lapras and Carracosta list theirs
        poses.append({"name": pname, "types": types, "condition": json_condition(pose), "animations": anims,
                      "parts": json_parts(pose.get("transformedParts")), "blend": pose.get("transformTicks", 10) / 20})
    return {"source": os.path.relpath(path, JAVA).replace("\\", "/"), "poses": poses, "parts": json_parts(data.get("transformedParts")),
            "root": data.get("rootBone")}


# ---------------------------------------------------------------------------
# Kotlin models
# ---------------------------------------------------------------------------

FRAME_PARTS = {"foreLeftLeg", "foreRightLeg", "hindLeftLeg", "hindRightLeg", "leftLeg", "rightLeg", "leftArm", "rightArm", "leftWing", "rightWing", "head"}


def kotlin_types(expr):
    """PoseType.X, the named sets, setOf(...), and + and - between them."""
    result, sign = set(), 1
    for token in re.findall(r"[+-]|setOf\([^)]*\)|arrayOf\([^)]*\)|(?:PoseType\.)?[A-Z_]+\b", expr):
        if token in "+-": sign = 1 if token == "+" else -1; continue
        members = set()
        for name in re.findall(r"(?:PoseType\.)?([A-Z_]+)\b", token):
            if name in POSE_SETS or name in POSE_SETS["ALL_POSES"]: members |= POSE_SETS.get(name, {name})
        result = result | members if sign > 0 else result - members
    return result


KOTLIN_CONDITIONS = [(r"\bisBattling\b", BATTLE), (r"\bisInWater\b", IN_WATER), (r"\bisUnderWater\b", SUBMERGED), (r"\bisTouchingWater\b", IN_WATER),
                     (r"\bisInWaterOrRain\b", "q.is_in_water_or_rain"), (r"\bisWild\b", "!q.is_tamed"), (r"\bisPosedIn\([^)]*\)", "1")]


# Cobblemon's entity checks: dusk is day time 12000 to 13000; Bedrock Molang cannot see the block underfoot, so a
# pose for standing on sand never applies and its plain counterpart always does
DUSK = "(q.time_of_day >= 0.5 && q.time_of_day <= 0.5417)"
FALLING = "(!q.is_on_ground && q.vertical_speed < -0.5)"
ENTITY = r"\(?it\.getEntity\(\)(?:\s+as\?\s+PokemonEntity\))?\)?\?\."
KOTLIN_ENTITY = [
    (ENTITY + r"isDusk\(\)\s*==\s*true", DUSK), (ENTITY + r"isDusk\(\)\s*!=\s*true", "!" + DUSK),
    (ENTITY + r"isFalling\(\)\s*==\s*true", FALLING), (ENTITY + r"isFalling\(\)\s*!=\s*true", "!" + FALLING),
    (ENTITY + r"isStandingOn\(setOf\([^)]*\)\)\s*==\s*true", "0"), (ENTITY + r"isStandingOn\(setOf\([^)]*\)\)\s*!=\s*true", "1"),
]


def kotlin_condition(body):
    text = body.strip().strip("{}").strip()
    for pattern, replacement in KOTLIN_ENTITY: text = re.sub(pattern, replacement, text)
    text = re.sub(r"\bit\.", "", text)
    for pattern, replacement in KOTLIN_CONDITIONS: text = re.sub(pattern, replacement, text)
    # anything still Kotlin (aspects, blocks underfoot, time of day) cannot be read on Bedrock
    if re.search(r"[A-Za-z_]\w*\(|\?\.|==|DataKeys|getEntity", re.sub(r"q\.(property|is_\w+)\([^)]*\)|q\.\w+", "", text)): return None
    return text or "1"


def kotlin_animation(text, bones):
    name, args = call(text)
    if name is None: return ("unknown", text)
    pos, kw = named(args or [])
    bone = lambda key, default: bones.get(key, default)
    if name in ("bedrock", "bedrockStateful", "bedrockPrimary"):
        return ("bedrock", string(pos[0]) if pos else None, string(pos[1]) if len(pos) > 1 else None)
    if name == "singleBoneLook":
        return ("look", bones.get("head", "head"), number(kw.get("pitchMultiplier"), 1), number(kw.get("yawMultiplier"), 1),
                number(kw.get("maxPitch"), 70), number(kw.get("minPitch"), -45), number(kw.get("maxYaw"), 45), number(kw.get("minYaw"), -45))
    if name == "SingleBoneLookAnimation":
        return ("look", bones.get(kw.get("bone", "head"), "head"), 1, 1, 70, -45, 45, -45)
    p = number(kw.get("periodMultiplier", kw.get("swingPeriodMultiplier")), None)
    a = number(kw.get("amplitudeMultiplier"), None)
    rest = [x for x in pos if x != "this"]
    if p is None and rest: p = number(rest[0], None)
    if a is None and len(rest) > 1: a = number(rest[1], None)
    if name == "QuadrupedWalkAnimation":
        return ("quadruped", p or 0.6662, a or 1.4, bone("foreLeftLeg", "leg_front_left"), bone("foreRightLeg", "leg_front_right"), bone("hindLeftLeg", "leg_back_left"), bone("hindRightLeg", "leg_back_right"))
    if name == "BipedWalkAnimation":
        return ("biped", p or 0.6662, a or 1.4, bone("leftLeg", "leg_left"), bone("rightLeg", "leg_right"))
    if name == "BimanualSwingAnimation":
        return ("bimanual", p or 0.6662, a or 1, bone("leftArm", "arm_left"), bone("rightArm", "arm_right"))
    axis = {"X_AXIS": "x", "Y_AXIS": "y", "Z_AXIS": "z"}.get((kw.get("axis") or "Y_AXIS").split(".")[-1], "y")
    if name.endswith("WingFlapIdleAnimation") or name.endswith("wingFlap"):
        # the model's own wings, or a named wing frame's (wingFrame1 = object : BiWingedFrame { leftWing = ... })
        frame = name.rsplit(".", 1)[0] if "." in name else None
        left = bones.get(f"{frame}.leftWing") if frame else bone("leftWing", "wing_left")
        right = bones.get(f"{frame}.rightWing") if frame else bone("rightWing", "wing_right")
        fname, fargs = call(kw.get("flapFunction", kw.get("function", "")))
        w = wave(fname, fargs)
        return ("wing_flap", w, axis, left, right) if w else ("unknown", text)
    if name == "WaveAnimation":
        # a wave running down a chain of segments (Ekans, Qwilfish, Huntail, Overqwil)
        fname, fargs = call(kw.get("waveFunction", ""))
        segs = []
        for ref in call(kw.get("segments", "arrayOf()"))[1] or []:
            seg = bones.get(f"segment:{ref.strip()}")
            if seg: segs.append(seg)
        axis_of = lambda key, d: {"X_AXIS": 0, "Y_AXIS": 1, "Z_AXIS": 2}.get((kw.get(key) or d).split(".")[-1], 1)
        return ("wave", fname, fargs, number(kw.get("oscillationsScalar"), 1), bones.get(kw.get("head", "head"), "head"),
                number(kw.get("headLength"), 0), kw.get("moveHead", "false").strip() == "true", axis_of("rotationAxis", "Y_AXIS"),
                axis_of("motionAxis", "X_AXIS"), kw.get("basedOnLimbSwing", "false").strip() == "true", segs)
    if name.endswith(".rotation") or name.endswith(".translation"):
        part = bones.get(name.rsplit(".", 1)[0])
        fname, fargs = call(kw.get("function", ""))
        w = wave(fname, fargs)
        if part and w: return ("bone_wave", "rotation" if name.endswith(".rotation") else "position", part, axis, w)
    return ("unknown", text)


def kotlin_parts(expr, bones):
    out = []
    for m in re.finditer(r"(\w+)\.createTransformation\(\)((?:\s*\.\s*\w+\([^()]*(?:\([^()]*\)[^()]*)*\))*)", expr):
        part = bones.get(m.group(1))
        if not part: continue
        t = {"part": part, "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": None, "hidden": False}
        for c in re.finditer(r"\.\s*(\w+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)", m.group(2)):
            fn, args = c.group(1), split_args(c.group(2))
            pos, kw = named(args)
            axis = lambda s: {"X_AXIS": 0, "Y_AXIS": 1, "Z_AXIS": 2}.get(s.split(".")[-1], 0)
            if fn == "withVisibility": t["hidden"] = (kw.get("visibility", pos[0] if pos else "true").strip() == "false")
            elif fn in ("addPosition", "withPosition") and len(pos) == 2: t["position"][axis(pos[0])] += number(pos[1], 0)
            elif fn in ("addPosition", "withPosition") and len(pos) == 3: t["position"] = [number(v, 0) for v in pos]
            elif fn in ("addRotationDegrees", "withRotationDegrees") and len(pos) == 2: t["rotation"][axis(pos[0])] += number(pos[1], 0)
            elif fn in ("addRotation", "withRotation") and len(pos) == 2: t["rotation"][axis(pos[0])] += number(pos[1], 0) * DEG
            elif fn in ("addRotationDegrees", "withRotationDegrees") and len(pos) == 3: t["rotation"] = [number(v, 0) for v in pos]
        out.append(t)
    return out


def kotlin_model(name):
    """The Kotlin model file for a Pokemon name (mr_mime -> MrMimeModel.kt)."""
    key = re.sub(r"[^a-z0-9]", "", name.lower())
    for path in glob.glob(f"{MODELS_KT}/**/*Model.kt", recursive=True):
        if os.path.basename(path)[:-len("Model.kt")].lower() == key: return path
    return None


def kotlin_poses(path):
    with open(path, encoding="utf-8") as file: src = file.read()
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//.*", "", src)
    bones = {}
    for m in re.finditer(r"(?:override\s+)?va[lr]\s+(\w+)\s*(?::\s*\w+\??)?\s*=\s*(?:getPart|root\.registerChildWithAllChildren|registerChildWithAllChildren)\(\s*\"([^\"]+)\"", src):
        bones[m.group(1)] = m.group(2)
    for m in re.finditer(r"(?:override\s+)?va[lr]\s+(\w+)\s*(?::\s*\w+\??)?\s*=\s*(\w+)\s*$", src, re.M):
        if m.group(2) in bones: bones.setdefault(m.group(1), bones[m.group(2)])
    if "rootPart" in bones: bones.setdefault("root", bones["rootPart"])
    for m in re.finditer(r"va[lr]\s+(\w+)\s*=\s*WaveSegment\(\s*(?:modelPart\s*=\s*)?(\w+)\s*,\s*(?:length\s*=\s*)?([^)]+)\)", src):
        if m.group(2) in bones: bones[f"segment:{m.group(1)}"] = (bones[m.group(2)], number(m.group(3), 0))
    for m in re.finditer(r"va[lr]\s+(\w+)\s*=\s*object\s*:\s*BiWingedFrame\s*\{(.*?)\n\s*\}", src, re.S):
        for w in re.finditer(r"(leftWing|rightWing)\s*=\s*(?:getPart\(\s*\"([^\"]+)\"\)|(\w+))", m.group(2)):
            bones[f"{m.group(1)}.{w.group(1)}"] = w.group(2) or bones.get(w.group(3))
    poses = []
    for m in re.finditer(r"(?:(\w+)\s*=\s*)?registerPose\(", src):
        _, args = call(src[m.end() - len("registerPose("):])
        if args is None: continue
        pos, kw = named(args)
        types = kotlin_types(kw["poseTypes"]) if "poseTypes" in kw else kotlin_types(kw.get("poseType", ""))
        cond = kotlin_condition(kw["condition"]) if "condition" in kw else "1"
        anims = []
        aname, aargs = call(kw.get("animations", "arrayOf()"))
        for a in aargs or []: anims.append((kotlin_animation(a, bones), None))
        poses.append({"name": string(kw.get("poseName")) or m.group(1) or f"pose{len(poses)}", "types": types,
                      "condition": cond if cond is not None else "0", "unreadable_condition": cond is None,
                      "animations": anims, "parts": kotlin_parts(kw.get("transformedParts", ""), bones),
                      "blend": (number(kw.get("transformTicks"), 10) or 10) / 20})
    return {"source": os.path.relpath(path, JAVA).replace("\\", "/"), "poses": poses, "parts": [], "root": bones.get("rootPart")} if poses else None


def poser(pokemon):
    """A Pokemon's poses from its JSON poser or its Kotlin model, or None. pokemon is the folder name, 0004_charmander."""
    name = pokemon.split("_", 1)[1]
    folder = f"{POSERS}/{pokemon}"
    if os.path.isdir(folder):
        found = json_poses(folder, name)
        if found: return found
    path = kotlin_model(name)
    return kotlin_poses(path) if path else None


# ---------------------------------------------------------------------------
# To Bedrock
# ---------------------------------------------------------------------------

LIMB_SWING = "q.modified_distance_moved"
LIMB_AMOUNT = "q.modified_move_speed"


def add(bones, bone, channel, axis, expr):
    c = bones.setdefault(bone, {}).setdefault(channel, ["0", "0", "0"])
    c[axis] = expr if c[axis] == "0" else f"{c[axis]} + {expr}"


def procedural(anim, bones):
    """Cobblemon's code animations as Molang on Bedrock bones. Cobblemon adds these in radians to Java parts, whose
    rotations match a Bedrock clip's degrees one for one, so each becomes degrees on the same axis."""
    kind = anim[0]
    if kind in ("quadruped", "biped"):
        period, amp = anim[1] * DEG, anim[2] * DEG
        swing = lambda phase: f"math.cos({LIMB_SWING} * {period:.4f}{' + 180' if phase else ''}) * {LIMB_AMOUNT} * {amp:.4f}"
        legs = [(anim[3], False), (anim[4], True), (anim[5], True), (anim[6], False)] if kind == "quadruped" else [(anim[4], True), (anim[3], False)]
        for bone, phase in legs:
            if bone: add(bones, bone, "rotation", 0, swing(phase))
    elif kind == "bimanual":
        period, amp = anim[1] * DEG, anim[2] * DEG
        swing = f"math.cos({LIMB_SWING} * {period:.4f}) * {LIMB_AMOUNT} * {amp:.4f}"
        age = "(q.life_time * 20)"
        sway_z = f"(math.cos({age} * {0.09 * DEG:.4f}) * {0.05 * DEG:.4f} + {0.05 * DEG:.4f})"
        sway_y = f"math.sin({age} * {0.067 * DEG:.4f}) * {0.05 * DEG:.4f}"
        left, right = anim[3], anim[4]
        if right: add(bones, right, "rotation", 1, f"{swing} + {sway_y}"); add(bones, right, "rotation", 2, sway_z)
        if left: add(bones, left, "rotation", 1, f"{swing} - {sway_y}"); add(bones, left, "rotation", 2, f"-{sway_z}")
    elif kind == "wing_flap":
        _, w, axis, left, right = anim
        i = {"x": 0, "y": 1, "z": 2}.get(axis, 1)   # Cobblemon reads any other axis as y
        if left: add(bones, left, "rotation", i, f"{w} * {DEG:.4f}")
        if right: add(bones, right, "rotation", i, f"-{w} * {DEG:.4f}")
    elif kind == "wave":
        # WaveAnimation.kt: each segment turns by the change in the wave's slope between its ends
        _, fname, fargs, osc, head, head_len, move_head, rot_axis, motion_axis, limb, segs = anim
        t = LIMB_SWING if limb else TIME
        w = lambda offset: wave(fname, fargs, f"({t} + {offset:.5f})")
        total = (head_len + sum(length for _, length in segs)) / osc
        if move_head: add(bones, head, "position", motion_axis, f"{'' if motion_axis == 1 else '-'}{w(total - head_len / osc)} * 16")
        total -= head_len / osc
        previous_len, previous = head_len, None
        for bone, length in segs:
            t2 = total + previous_len / 2 / osc
            t1 = total - length / 2 / osc
            theta = f"math.atan(({w(t1)} - {w(t2)}) / {t2 - t1:.5f})"   # Molang's atan is in degrees already
            add(bones, bone, "rotation", rot_axis, theta if previous is None else f"({theta} - {previous})")
            previous, previous_len = theta, length
            total = max(0.0, total - length / osc)
    elif kind == "bone_wave":
        _, channel, bone, axis, w = anim
        i = {"x": 0, "y": 1, "z": 2}.get(axis, 1)   # Cobblemon reads any other axis as y
        # a rotation is radians on the Java part; a translation is pixels, with Java's y running down
        add(bones, bone, channel, i, f"{w} * {DEG:.4f}" if channel == "rotation" else (f"-{w}" if i == 1 else w))
    elif kind == "pitch_tilt":
        _, bone, lo, hi = anim
        add(bones, bone, "rotation", 0, f"(q.has_rider ? 0 : -math.clamp(math.atan2(q.vertical_speed, q.ground_speed), {lo:g}, {hi:g}))")
    else:
        return False
    return True


def static_parts(parts, bones):
    """A pose's transformed parts: offsets from the rest pose (Java position y runs down, Bedrock's up) and hidden parts."""
    for t in parts:
        x, y, z = t["position"]
        if x or y or z: add(bones, t["part"], "position", 0, f"{x:g}"); add(bones, t["part"], "position", 1, f"{-y:g}"); add(bones, t["part"], "position", 2, f"{z:g}")
        for i, v in enumerate(t["rotation"]):
            if v: add(bones, t["part"], "rotation", i, f"{v:g}")
        if t["hidden"]: bones.setdefault(t["part"], {})["scale"] = [0, 0, 0]
        elif t.get("scale") and t["scale"] != [1, 1, 1]: bones.setdefault(t["part"], {})["scale"] = t["scale"]


def pose_type_molang(flier):
    """v.pose_type as PokemonServerDelegate.updatePoseType sets it: a passenger stands, then sleep, underwater
    swimming or floating, flying or hovering, walking, standing."""
    moving = "(q.ground_speed > 0.5 || math.abs(q.vertical_speed) > 0.5)"
    ground = "(v.moving ? 1 : 0)"
    air = f"((!q.is_on_ground && !q.is_in_water) ? (v.moving ? 4 : 3) : {ground})" if flier else ground
    return (f"v.moving = {moving}; "
            f"v.pose_type = q.is_riding ? 0 : (q.is_sleeping ? 2 : ({SUBMERGED} ? (v.moving ? 6 : 5) : {air}));")


def world_poses(found):
    """The poses an entity in the world can take, with their original indexes kept for naming."""
    return [(i, p) for i, p in enumerate(found["poses"]) if p["types"] & set(WORLD_TYPES)]


def state_name(name, used):
    base = re.sub(r"[^a-z0-9_]", "_", name.lower()) or "pose"
    out, n = base, 2
    while out in used: out = f"{base}_{n}"; n += 1
    used.add(out)
    return out


def to_bedrock(pokemon, found, animation_ids, model_bones, flier, has_look, ambient=None):
    """What the pack needs for one Pokemon's poses:
      pre_animation   Molang setting v.pose_type and v.pose, the index of the first suitable pose
      states          the pose controller's states, one per pose an entity in the world can take
      keys            short animation keys the client entity must map, {key: animation id}
      animations      generated animations for the procedural parts, {id: animation}
      report          what could not be carried, for the audit
    """
    name = pokemon.split("_", 1)[1]
    poses_ = world_poses(found)
    keys, generated, report, states, used = {}, {}, [], {}, set()
    names = [state_name(p["name"], used) for _, p in poses_]
    for (index, pose), state in zip(poses_, names):
        clips, bones = [], {}
        def clip_key(group, clip):
            clip = re.sub(r"[^A-Za-z0-9_]", "_", clip)   # as the port names the clips (Dunsparce's "unused flying")
            full = f"animation.{group}.{clip}"
            if full not in animation_ids and f"animation.{name}.{clip}" in animation_ids: full = f"animation.{name}.{clip}"
            if full not in animation_ids: report.append(f"{pose['name']}: no animation {group}.{clip}"); return None
            key = clip if group == name else f"{group}__{clip}"
            keys[key] = full
            return key
        for anim, cond in pose["animations"]:
            kind = anim[0]
            if kind == "bedrock":
                key = clip_key(anim[1], anim[2])
                if key: clips.append({key: cond} if cond else key)
            elif kind == "bedrock_choice":
                # one roll per Pokemon (v.clip_roll), split in Cobblemon's odds
                low = 0.0
                for clip, p in anim[2]:
                    key = clip_key(anim[1], clip)
                    test = f"v.clip_roll >= {low:.4f} && v.clip_roll < {low + p:.4f}"
                    if key: clips.append({key: f"({cond}) && {test}" if cond else test})
                    low += p
            elif kind == "look":
                # Cobblemon's SingleBoneLookAnimation: the bone turns by its multipliers times the head's pitch and
                # yaw, clamped; "look" alone means head_ai, or head
                bone = anim[1] if anim[1] in model_bones else next((b for b in ("head_ai", "head") if b in model_bones), None)
                if not bone: report.append(f"{pose['name']}: no bone to look with"); continue
                _, _, pm, ym, max_p, min_p, max_y, min_y = anim
                if pm: add(bones, bone, "rotation", 0, f"{pm:g} * math.clamp(q.target_x_rotation, {min_p:g}, {max_p:g})")
                if ym: add(bones, bone, "rotation", 1, f"{ym:g} * math.clamp(q.target_y_rotation, {min_y:g}, {max_y:g})")
            elif kind == "unknown":
                report.append(f"{pose['name']}: not carried: {anim[1][:80]}")
            elif kind == "dropped_by_cobblemon":
                report.append(f"{pose['name']}: Cobblemon drops it too: {anim[1][:80]}")
            else:
                if cond: report.append(f"{pose['name']}: {kind} plays always, its condition is dropped: {cond}")
                procedural(anim, bones)
        static_parts(found.get("parts", []) + pose["parts"], bones)
        # "root" is the model's root part: the poser's rootBone
        if "root" in bones and "root" not in model_bones and found.get("root") in model_bones:
            bones[found["root"]] = bones.pop("root")
        missing = [b for b in bones if b not in model_bones]
        for b in missing:
            report.append(f"{pose['name']}: no bone {b}"); del bones[b]
        if bones:
            gid = f"animation.{pokemon}.pose_{state}"
            generated[gid] = {"loop": True, "bones": bones}
            keys[f"pose_{state}"] = gid
            clips.append(f"pose_{state}")
        others = [{other: f"v.pose == {j}"} for j, other in enumerate(names) if other != state]
        # a pose whose clips Cobblemon lacks plays nothing; Bedrock wants no animations key rather than an empty one
        states[state] = {**({"animations": clips} if clips else {}), "transitions": others, "blend_transition": round(min(pose.get("blend", 0.5), 1.0), 2)}
        effects = [e for c in clips for e in (ambient or {}).get(c if isinstance(c, str) else next(iter(c)), [])]
        if effects: states[state]["particle_effects"] = effects
    # Bedrock does not run the initial state's entry effects, so a throwaway first state hands over
    states["spawn"] = {"transitions": [{s: f"v.pose == {j}"} for j, s in enumerate(names)]}
    choice = "0"
    for j in reversed(range(len(poses_))):
        pose = poses_[j][1]
        types = " || ".join(f"v.pose_type == {WORLD_TYPES.index(t)}" for t in WORLD_TYPES if t in pose["types"])
        cond = pose["condition"]
        test = f"({types})" + ("" if cond in ("1", "") else f" && ({cond})")
        choice = f"({test}) ? {j} : ({choice})"
    pre = [pose_type_molang(flier), f"v.pose = {choice};"]
    # each Pokemon rolls once for the clips Cobblemon picks at random
    return {"initialize": ["v.clip_roll = math.random(0, 1);"], "pre_animation": pre, "states": states, "keys": keys, "animations": generated, "report": report, "names": names}
