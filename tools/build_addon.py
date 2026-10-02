"""Builds cobblemon-bedrock.mcaddon from the repository, so nothing is copied into a zip by hand.

The archive is what Minecraft imports when the file is double-clicked: the behavior pack and the resource pack,
each in a folder of its own at the root with its manifest.json directly inside. Only files git tracks go in, so
what the repository leaves out stays out of the add-on too: the battle music tools/fetch_battle_music.py
downloads (the games' own tracks), the hub's functions tools/build_hub.py writes for one location, and anything
else ignored.

    python tools/build_addon.py            # writes cobblemon-bedrock.mcaddon
    python tools/build_addon.py --check    # exits 1 if the archive on disk differs from what a build would produce

What Minecraft requires of the zip (tools/build_template.py in one-block-bedrock found it out): forward slashes
in entry names, Deflate or Store, no zip64. PowerShell's Compress-Archive writes backslashes in entry names and
Minecraft refuses the result, which is why this is Python's zipfile. Images and sounds, already compressed, are
stored rather than deflated, which builds faster and comes out no bigger.
"""

import argparse
import io
import json
import os
import subprocess
import sys
import zipfile

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

        for folder, pack in PACKS.items():
            for relative in tracked(pack):
                path = f"{folder}/{relative}"
                add_dir(path)
                info = zipfile.ZipInfo(path, STAMP)
                info.external_attr = 0o666 << 16
                info.compress_type = zipfile.ZIP_STORED if os.path.splitext(relative)[1].lower() in STORED else zipfile.ZIP_DEFLATED
                with open(os.path.join(ROOT, pack, relative), "rb") as handle:
                    archive.writestr(info, handle.read(), compresslevel=9)
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
