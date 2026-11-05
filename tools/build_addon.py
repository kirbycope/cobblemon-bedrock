"""Builds cobblemon-bedrock.mcaddon from the repository, so nothing is copied into a zip by hand.

The archive is what Minecraft imports when the file is double-clicked: the behavior pack and the resource pack,
each in a folder of its own at the root with its manifest.json directly inside. Only files git tracks go in, so
what the repository leaves out stays out of the add-on too: the battle music tools/fetch_battle_music.py
downloads (the games' own tracks), the hub's functions tools/build_hub.py writes for one location, and anything
else ignored; sound_definitions.json loses the sounds left out with them (present_sounds).

    python tools/build_addon.py            # writes cobblemon-bedrock.mcaddon
    python tools/build_addon.py --check    # exits 1 if the archive on disk differs from what a build would produce

What Minecraft requires of the zip (tools/build_template.py in one-block-bedrock found it out): forward slashes
in entry names, Deflate or Store, no zip64. PowerShell's Compress-Archive writes backslashes in entry names and
Minecraft refuses the result, which is why this is Python's zipfile. Images and sounds, already compressed, are
stored rather than deflated, which builds faster and comes out no bigger.

The archive is made smaller than the repository without changing what is in it: every JSON file is written without
its indentation (the packs unpack about 150 MB smaller), and every PNG is re-encoded by Pillow's optimizer, kept only
where it comes out smaller and decodes to exactly the same pixels. A texture no JSON, script or lang file names is
left out (a layer only ever composited into an icon, say); the UI's and the fonts' are kept whatever, since the
scripts build UI texture names at run time and the game finds a glyph sheet by its file name. The repository keeps
its readable files.
"""

import argparse
import io
import json
import os
import subprocess
import sys
import re
import zipfile

try:
    from PIL import Image
except ImportError:   # without Pillow the PNGs go in as they are
    Image = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = {   # folder in the archive -> pack in the repository
    "cobblemon_behavior_pack": "development_behavior_packs/cobblemon",
    "cobblemon_resource_pack": "development_resource_packs/cobblemon",
}
OUTPUT = os.path.join(ROOT, "cobblemon-bedrock.mcaddon")
STAMP = (2026, 1, 1, 0, 0, 0)   # a fixed timestamp keeps the archive byte-for-byte reproducible, so --check can compare it
STORED = {".png", ".jpg", ".jpeg", ".ogg", ".fsb"}
LIMIT = 100 * 1024 * 1024   # GitHub refuses a file over 100 MB


def tracked(pack: str) -> list[str]:
    """The files git tracks under a pack, as paths relative to it, sorted, those deleted from the working tree left out."""
    out = subprocess.run(["git", "-C", ROOT, "ls-files", "-z", "--", pack], check=True, capture_output=True).stdout.decode("utf-8")
    return sorted(p[len(pack) + 1:] for p in out.split("\0") if p and os.path.isfile(os.path.join(ROOT, p)))


def present_sounds(pack: str, files: list[str], data: bytes) -> bytes:
    """sound_definitions.json without the sounds whose files the archive leaves out, and without events left with
    none: the git-ignored battle music is defined on a machine that fetched it, and a definition naming a missing
    file is a content log error on every player's first join ("Invalid asset path sounds/battle/...")."""
    have = {os.path.splitext(f)[0] for f in files if f.startswith("sounds/")}
    definitions = json.loads(data)
    events = definitions.get("sound_definitions", definitions)
    dropped = False
    for name in list(events):
        sounds = events[name].get("sounds") if isinstance(events[name], dict) else None
        if not sounds: continue
        kept = [s for s in sounds if (s if isinstance(s, str) else s.get("name", "")) in have]
        if len(kept) == len(sounds): continue
        dropped = True
        if kept: events[name]["sounds"] = kept
        else: del events[name]
    return json.dumps(definitions, indent=2, ensure_ascii=False).encode("utf-8") if dropped else data


TEXTURE_NAME = re.compile(r"textures/[A-Za-z0-9_\-./]+")
ALWAYS_KEPT = ("textures/ui/", "textures/font/")


def named_textures(packs: dict[str, list[str]]) -> tuple[set[str], dict[str, list[str]]]:
    """Every "textures/..." string the packs' JSON, scripts and lang files hold, without .png: the names, and the same
    strings by the folder they name a start in, for names a script finishes at run time."""
    names: set[str] = set()
    for pack, files in packs.items():
        for relative in files:
            if not relative.endswith((".json", ".js", ".lang", ".material")): continue
            with open(os.path.join(ROOT, pack, relative), encoding="utf-8", errors="ignore") as handle:
                for found in TEXTURE_NAME.findall(handle.read()):
                    found = found.rstrip("./")
                    names.add(found[:-4] if found.endswith(".png") else found)
    starts: dict[str, list[str]] = {}
    for name in names: starts.setdefault(name.rsplit("/", 1)[0], []).append(name)
    return names, starts


def unused_texture(relative: str, names: set[str], starts: dict[str, list[str]]) -> bool:
    """A PNG under textures/ that nothing names, neither whole, nor by its folder, nor by a start of its name in it."""
    if not relative.startswith("textures/") or relative.startswith(ALWAYS_KEPT) or not relative.lower().endswith(".png"): return False
    path = relative[:-4]
    if path in names: return False
    folder = path.rsplit("/", 1)[0]
    return not (folder in names or any(path.startswith(p) for p in starts.get(folder, ())))


def compact_json(data: bytes) -> bytes:
    """The JSON without its whitespace, or as it was when it does not parse as plain JSON (a comment in it)."""
    try: value = json.loads(data.decode("utf-8-sig"))
    except ValueError: return data
    compact = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return compact if len(compact) < len(data) else data


def smaller_png(data: bytes) -> bytes:
    """The PNG re-encoded by Pillow's optimizer when that is smaller and decodes to the same pixels, else as it was."""
    if Image is None: return data
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            out = io.BytesIO()
            image.save(out, "PNG", optimize=True)
        if out.tell() >= len(data): return data
        with Image.open(io.BytesIO(data)) as a, Image.open(io.BytesIO(out.getvalue())) as b:
            same = a.size == b.size and a.convert("RGBA").tobytes() == b.convert("RGBA").tobytes()
        return out.getvalue() if same else data
    except Exception:
        return data


def build() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, allowZip64=False) as archive:
        seen: set[str] = set()

        def add_dir(path: str) -> None:
            parts = path.split("/")
            for depth in range(1, len(parts)):
                folder = "/".join(parts[:depth]) + "/"
                if folder in seen: continue
                seen.add(folder)
                info = zipfile.ZipInfo(folder, STAMP)
                info.external_attr = 0o40777 << 16
                archive.writestr(info, b"", zipfile.ZIP_STORED)

        listed = {pack: tracked(pack) for pack in PACKS.values()}
        names, starts = named_textures(listed)
        for folder, pack in PACKS.items():
            files = listed[pack]
            for relative in files:
                if unused_texture(relative, names, starts): continue
                path = f"{folder}/{relative}"
                add_dir(path)
                info = zipfile.ZipInfo(path, STAMP)
                info.external_attr = 0o666 << 16
                info.compress_type = zipfile.ZIP_STORED if os.path.splitext(relative)[1].lower() in STORED else zipfile.ZIP_DEFLATED
                with open(os.path.join(ROOT, pack, relative), "rb") as handle: data = handle.read()
                if relative == "sounds/sound_definitions.json": data = present_sounds(pack, files, data)
                if relative.endswith(".json"): data = compact_json(data)
                elif relative.lower().endswith(".png"): data = smaller_png(data)
                archive.writestr(info, data, compresslevel=9)
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="report whether the archive is up to date instead of writing it")
    parser.add_argument("--output", default=OUTPUT)
    args = parser.parse_args()

    data = build()
    current = os.path.exists(args.output) and open(args.output, "rb").read() == data
    if args.check:
        print("up to date" if current else f"out of date: {os.path.relpath(args.output, ROOT)}")
        return 0 if current else 1
    with open(args.output, "wb") as handle: handle.write(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = [i for i in archive.infolist() if not i.is_dir()]
        versions = {f: json.loads(archive.read(f"{f}/manifest.json"))["header"]["version"] for f in PACKS}
    print(f"wrote {os.path.relpath(args.output, ROOT)}: {len(files)} files, {len(data) / 1024 / 1024:.1f} MB, "
          + ", ".join(f"{f} {'.'.join(map(str, v))}" for f, v in versions.items()))
    if len(data) > LIMIT: print(f"warning: over GitHub's {LIMIT // 1024 // 1024} MB file limit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
