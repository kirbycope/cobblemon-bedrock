"""Run the Bedrock Dedicated Server with a console that other scripts can type into.

    python tools/bds_host.py

BDS takes its commands, `stop` among them, on standard input, and a server started detached has none,
so the only way to end it was taskkill, which skips the save: everything since the last autosave (an
entity's dynamic properties, a player's inventory) went back on every restart. This host starts the
server with its input on a pipe and passes on each line written to bds.cmd in the server folder, so
tools/deploy.py can send `stop` and wait for the world to be saved. It ends when the server does.
"""
import os
import subprocess
import time

BDS = os.environ.get("BDS", r"C:\GitHub\bedrock-server")
COMMANDS = os.path.join(BDS, "bds.cmd")

if __name__ == "__main__":
    if os.path.exists(COMMANDS): os.remove(COMMANDS)
    with open(os.path.join(BDS, "bds.out.log"), "w") as log:
        server = subprocess.Popen([os.path.join(BDS, "bedrock_server.exe")], cwd=BDS, stdin=subprocess.PIPE,
                                  stdout=log, stderr=subprocess.STDOUT, text=True)
        while server.poll() is None:
            time.sleep(0.5)
            if not os.path.exists(COMMANDS): continue
            try:
                with open(COMMANDS, encoding="utf-8") as file: lines = file.read().splitlines()
                os.remove(COMMANDS)
            except OSError:
                continue
            for line in lines:
                if line.strip(): server.stdin.write(line.strip() + "\n"); server.stdin.flush()
