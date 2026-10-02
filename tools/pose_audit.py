"""Check every Pokemon's generated poses against Cobblemon's poser, species by species.

For each Pokemon it reads the poser (JSON or Kotlin) and the pack's controller and client entity, and checks that:
every pose an entity in the world can take has a controller state; each state plays exactly the pose's Bedrock clips;
every procedural animation (walk cycles, arm swing, wing flap, pitch tilt, bone waves) and transformed part became a
generated clip on bones the model has; the client entity maps every key a state plays. It prints a summary and
writes the per-species detail to captures/pose_audit.md.

    python tools/pose_audit.py            summary, detail to captures/pose_audit.md
    python tools/pose_audit.py mabosstiff  one species in full
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import poses  # noqa: E402

RP = f"{ROOT}/development_resource_packs/cobblemon"


def load(path):
    with open(path, encoding="utf-8") as file: return json.load(file)


_ids = None
_java_ids = None
JAVA_ANIMS = f"{ROOT}/java/common/src/main/resources/assets/cobblemon/bedrock/pokemon/animations"
JAVA_MODELS = f"{ROOT}/java/common/src/main/resources/assets/cobblemon/bedrock/pokemon/models"


def java_ids():
    """Every animation id in Cobblemon's own files."""
    global _java_ids
    if _java_ids is None:
        _java_ids = set()
        for path in glob.glob(f"{JAVA_ANIMS}/**/*.json", recursive=True):
            try: _java_ids |= set(load(path).get("animations", {}))
            except Exception: pass
    return _java_ids


def model_bones(pokemon):
    """The bones of Cobblemon's own model for the Pokemon (every geometry in its folder)."""
    out = set()
    for path in glob.glob(f"{JAVA_MODELS}/{pokemon}/*.json"):
        try: out |= {b["name"] for g in load(path).get("minecraft:geometry", []) for b in g.get("bones", [])}
        except Exception: pass
    return out


def all_ids():
    global _ids
    if _ids is None:
        _ids = set()
        for path in glob.glob(f"{RP}/animations/*.animation.json") + glob.glob(f"{RP}/animations/*/*.animation.json"):
            _ids |= set(load(path).get("animations", {}))
    return _ids


def audit(pokemon):
    name = pokemon.split("_", 1)[1]
    found = poses.poser(pokemon)
    problems, lines = [], []
    if not found: return ["no poser"], []
    ctrl_path = f"{RP}/animation_controllers/{pokemon}.animation_controllers.json"
    ent_path = f"{RP}/entity/{pokemon}.entity.json"
    if not os.path.exists(ctrl_path) or not os.path.exists(ent_path): return ["no controller or client entity"], []
    ctrl = load(ctrl_path)["animation_controllers"].get(f"controller.animation.{name}.pose", {})
    states = ctrl.get("states", {})
    desc = load(ent_path)["minecraft:client_entity"]["description"]
    keys = desc.get("animations", {})
    pre = desc.get("scripts", {}).get("pre_animation")
    if not pre: problems.append("client entity has no pose Molang")
    for expr in pre or []:
        if expr.count("(") != expr.count(")"): problems.append("pose Molang has unbalanced brackets")
        if re.search(r"(?<![\w.])[01](?:\.0)?\s*\?", expr): problems.append("pose Molang has a ternary on a literal, which Bedrock rejects")
        if len(re.findall(r"'[^']*'", expr)) * 2 != expr.count("'"): problems.append("pose Molang has a stray quote")
        if any(not q.startswith("cobblemon:") for q in re.findall(r"'([^']*)'", expr)): problems.append("pose Molang compares a string Bedrock has no query for")
    generated = {}
    gen_path = f"{RP}/animations/{pokemon}/poses.animation.json"
    if os.path.exists(gen_path): generated = load(gen_path).get("animations", {})
    ids = all_ids()
    used, gaps = set(), []
    model = model_bones(pokemon)
    lines.append(f"### {pokemon}  ({found['source']})")
    for index, pose in poses.world_poses(found):
        state = poses.state_name(pose["name"], used)
        st = states.get(state)
        types = ", ".join(sorted(pose["types"] & set(poses.WORLD_TYPES)))
        lines.append(f"- **{pose['name']}** [{types}] when `{pose['condition']}`")
        if st is None: problems.append(f"{pose['name']}: no controller state"); continue
        plays = [a if isinstance(a, str) else next(iter(a)) for a in st.get("animations", [])]
        for key in plays:
            if key not in keys: problems.append(f"{pose['name']}: plays unmapped key {key}")
            elif keys[key] not in ids and keys[key] not in generated: problems.append(f"{pose['name']}: {key} -> missing {keys[key]}")
        want_clips, want_proc = [], []
        gen = generated.get(keys.get(f"pose_{state}", ""), {})
        gbones = gen.get("bones", {})
        for anim, cond in pose["animations"]:
            if anim[0] in ("bedrock", "bedrock_choice"):
                for clip in ([anim[2]] if anim[0] == "bedrock" else [c for c, _ in anim[2]]):
                    want_clips.append(f"{anim[1]}.{clip}")
                    fixed = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in clip)
                    if keys.get(fixed if anim[1] == name else f"{anim[1]}__{fixed}"): continue
                    if f"animation.{anim[1]}.{clip}" not in java_ids(): gaps.append(f"{pose['name']}: Cobblemon has no clip {anim[1]}.{clip} either")
                    else: problems.append(f"{pose['name']}: clip {anim[1]}.{clip} not played")
            elif anim[0] == "look":
                bone = anim[1] if anim[1] in model else next((x for x in ("head_ai", "head") if x in model), None)
                if bone is None: gaps.append(f"{pose['name']}: the model has no {anim[1]} bone to look with, in Cobblemon too")
                elif "rotation" not in gbones.get(bone, {}): problems.append(f"{pose['name']}: look on {bone} not generated")
            elif anim[0] == "dropped_by_cobblemon":
                gaps.append(f"{pose['name']}: Cobblemon's loader drops {anim[1][:60]} from the animations list")
            elif anim[0] == "unknown":
                problems.append(f"{pose['name']}: not carried: {anim[1][:60]}")
            else:
                want_proc.append(anim[0])
                named = [x for x in anim[2:] if isinstance(x, str) and x not in ("x", "y", "z") and not x.startswith("(")]
                for bone in named:
                    if bone in model: continue
                    if bone == "root": continue
                    gaps.append(f"{pose['name']}: {anim[0]} names bone {bone}, which the model lacks in Cobblemon too")
        moving_parts = [t for t in pose["parts"] if t["hidden"] or any(t["position"]) or any(t["rotation"])]
        usable = [a for a, _ in pose["animations"] if a[0] not in ("bedrock", "bedrock_choice", "look", "unknown", "dropped_by_cobblemon")
                  and all(x in model or x == "root" for x in a[2:] if isinstance(x, str) and x not in ("x", "y", "z") and not x.startswith("("))]
        if (usable or [t for t in moving_parts if t["part"] in model]) and not gbones:
            problems.append(f"{pose['name']}: procedural parts {want_proc} made nothing")
        lines.append(f"  - Cobblemon: clips {want_clips or '-'}; code {want_proc or '-'}; parts {[t['part'] for t in pose['parts']] or '-'}")
        lines.append(f"  - pack: {plays}" + (f"; generated bones {sorted(gbones)}" if gbones else ""))
    lines += [f"  - Cobblemon's own gap: {g}" for g in gaps]
    return problems, lines


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    pokemons = sorted(os.path.basename(p).split(".")[0] for p in glob.glob(f"{RP}/entity/*.entity.json") if os.path.basename(p)[:4].isdigit())
    if only: pokemons = [p for p in pokemons if only in p]
    detail, bad, total = [], 0, 0
    for pokemon in pokemons:
        problems, lines = audit(pokemon)
        total += 1
        if problems: bad += 1
        detail += lines + [f"  - **problem**: {p}" for p in problems] + [""]
        if only: print("\n".join(lines + [f"PROBLEM: {p}" for p in problems]))
    os.makedirs(f"{ROOT}/captures", exist_ok=True)
    with open(f"{ROOT}/captures/pose_audit.md", "w", encoding="utf-8") as file:
        file.write(f"# Pose audit\n\n{total} Pokemon, {bad} with problems.\n\n" + "\n".join(detail))
    print(f"{total} Pokemon checked, {bad} with problems; detail in captures/pose_audit.md")


if __name__ == "__main__":
    main()
