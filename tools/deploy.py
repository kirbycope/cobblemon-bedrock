"""Point the local Bedrock Dedicated Server's world at the current packs and restart it.

    python tools/deploy.py                 sync the world's pack lists to the manifests, restart BDS
    python tools/deploy.py --no-restart    only sync the pack lists

The packs reach the world through junctions (see README), so their files are already there; what
changes is the version in each manifest, which port.py bumps on every run. The world's
world_behavior_packs.json and world_resource_packs.json must name that version, and the client
caches the pack the server sent it by version, so a stale entry means the client keeps rendering
last time's pack.
"""
import json
import os
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BDS = os.environ.get("BDS", r"C:\GitHub\bedrock-server")
WORLD = os.path.join(BDS, "worlds", os.environ.get("BDS_WORLD", "cobblemon"))
BRIDGE_PACK = "fa013817-66f2-4a5f-a724-1347f912bd40"


def manifest(kind):
    with open(os.path.join(REPO, f"development_{kind}_packs", "cobblemon", "manifest.json"), encoding="utf-8") as file:
        header = json.load(file)["header"]
    return {"pack_id": header["uuid"], "version": header["version"]}


def sync():
    behavior = [manifest("behavior")]
    world_bp = os.path.join(WORLD, "world_behavior_packs.json")
    if os.path.exists(world_bp):
        with open(world_bp, encoding="utf-8") as file:
            behavior += [p for p in json.load(file) if p["pack_id"] == BRIDGE_PACK]
    with open(world_bp, "w", encoding="utf-8") as file: file.write(json.dumps(behavior, indent=2))
    with open(os.path.join(WORLD, "world_resource_packs.json"), "w", encoding="utf-8") as file: file.write(json.dumps([manifest("resource")], indent=2))
    print("world packs:", behavior, [manifest("resource")])


def restart():
    subprocess.run(["taskkill", "/IM", "bedrock_server.exe", "/F"], capture_output=True)
    time.sleep(3)
    log = open(os.path.join(BDS, "bds.out.log"), "w")
    # its own console, so the server outlives this script and the shell that ran it
    subprocess.Popen([os.path.join(BDS, "bedrock_server.exe")], cwd=BDS, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NEW_CONSOLE)
    for _ in range(60):
        time.sleep(2)
        with open(os.path.join(BDS, "bds.out.log"), encoding="utf-8", errors="replace") as file: text = file.read()
        if "Server started" in text: break
    errors = [line for line in text.splitlines() if "[error]" in line or "ERROR" in line]
    print("server started" if "Server started" in text else "server did not report start", f"({len(errors)} error lines)")
    for line in errors[:10]: print("  ", line[:200])


if __name__ == "__main__":
    sync()
    if "--no-restart" not in sys.argv: restart()
