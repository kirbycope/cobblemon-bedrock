"""Drive the Minecraft Bedrock client on this PC and capture what it shows.

The game window is found by its title, brought to the front, and driven with real input
(pydirectinput sends scancodes, which the game reads while it has the mouse captured).

    python tools/client_drive.py shot menu            captures/menu.png
    python tools/client_drive.py click 960 543        click a screen position
    python tools/client_drive.py key t                press a key
    python tools/client_drive.py interact             right-click whatever is in the crosshair
    python tools/client_drive.py chat "/summon cobblemon:p0004_charmander ~ ~ ~2"
    python tools/client_drive.py look 200 0           turn the view by a mouse delta
    python tools/client_drive.py join                 main menu -> Play -> Worlds -> LAN world (the server)
    python tools/client_drive.py leave                pause menu -> Save & Quit (lands on the Worlds list)
    python tools/client_drive.py dropped              after a join: back out of a "Terracotta" drop, so join can run again

Screen positions are for the 1920x1200 desktop with the game maximised.
"""
import ctypes
import os
import sys
import subprocess
import time

import pyautogui
import pydirectinput

pydirectinput.PAUSE = 0.05
# the game parks the cursor in a corner while it captures the mouse, which trips the corner fail-safe
pydirectinput.FAILSAFE = False
pyautogui.FAILSAFE = False
CAPTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures")


def focus() -> None:
    user32 = ctypes.windll.user32
    handle = user32.FindWindowW(None, "Minecraft")
    if not handle:
        sys.exit("no window titled 'Minecraft'; is the game running?")
    user32.ShowWindow(handle, 9)
    user32.SetForegroundWindow(handle)
    time.sleep(0.5)


def shot(name: str) -> str:
    os.makedirs(CAPTURES, exist_ok=True)
    path = os.path.join(CAPTURES, f"{name}.png")
    pyautogui.screenshot(path)
    print(path)
    return path


def click(x: int, y: int) -> None:
    """A press held briefly; a plain click is too quick for the game's UI to register."""
    pydirectinput.moveTo(x, y)
    time.sleep(0.3)
    pydirectinput.mouseDown(); time.sleep(0.12); pydirectinput.mouseUp()


def interact() -> None:
    """A held right press; the game ignores a click shorter than about a tenth of a second."""
    pydirectinput.mouseDown(button="right"); time.sleep(0.15); pydirectinput.mouseUp(button="right")


def key(name: str, hold: float = 0.0) -> None:
    if hold:
        pydirectinput.keyDown(name); time.sleep(hold); pydirectinput.keyUp(name)
    else:
        pydirectinput.press(name)


def chat(text: str) -> None:
    key("t")
    time.sleep(0.4)
    pyautogui.typewrite(text, interval=0.02)
    time.sleep(0.2)
    key("enter")
    time.sleep(0.5)


def look(dx: int, dy: int) -> None:
    pydirectinput.moveRel(dx, dy, relative=True)


SERVER_TILE_NAMES = ("dedicated server", "cobblemon")   # server-name and level-name in bedrock-server/server.properties


def find_text(names):
    """Where on screen a line of text containing one of names is, by Windows' OCR (tools/ocr.ps1), or None."""
    path = shot("ocr")
    out = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", os.path.join(os.path.dirname(__file__), "ocr.ps1"), "-Path", path],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL).stdout
    for line in (out or "").splitlines():
        box, _, text = line.partition("	")
        if any(n in text.lower() for n in names):
            x, y, w, h = map(int, box.split(","))
            return x + w // 2, y + h // 2, text
    return None


def join() -> None:
    """Main menu -> Play -> Worlds tab -> the LAN tile named after this server, and nothing else.

    Other LAN games on the network show up in the same list (a family member's world), so the tile is found
    by its name with OCR, never by its position, and after the join the bridge must see the player on the
    server; if it does not, the client leaves at once. The Servers tab's Local BDS entry (127.0.0.1) fails with
    a NetherNet error on this build, which is why the LAN route is used. Call this from the main menu only."""
    click(950, 535); time.sleep(4)      # Play
    click(340, 172); time.sleep(3)      # Worlds tab
    spot = None
    for _ in range(30):
        spot = find_text(SERVER_TILE_NAMES)
        if spot: break
        time.sleep(2)
    if not spot:
        click(36, 58)                   # back to the main menu, touching no world
        sys.exit("the server's LAN tile did not appear; is the server up?")
    click(spot[0], spot[1]); time.sleep(40)
    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from bridge import Bridge, PLAYER
        if PLAYER not in Bridge().tool("mc_player_list"):
            leave()
            sys.exit(f"joined something that is not the server (clicked '{spot[2]}'); left it")
    except SystemExit: raise
    except Exception as error: print("could not confirm the join through the bridge:", error)


def dropped() -> bool:
    """The first join after a deploy with a new pack version often drops a few seconds in with a "Terracotta"
    disconnect while the client takes in the packs; True when that dialog is up, after pressing its Back to menu
    (which lands on the main menu here), so join() can be called again."""
    if not find_text(["terracotta", "disconnected from server"]): return False
    click(395, 807); time.sleep(4)
    return True


def recover() -> None:
    """After a server restart the client shows a disconnect dialog whose Back to menu lands on the Play
    screen; back out to the main menu from there so join() starts where it expects."""
    click(396, 808); time.sleep(4)
    click(36, 58); time.sleep(3)


def leave() -> None:
    """Pause menu -> Save & Quit lands on the Worlds list, so back out once more to the main menu."""
    key("escape"); time.sleep(2)
    click(555, 775); time.sleep(12)
    click(36, 58); time.sleep(3)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    focus()
    if cmd == "shot": time.sleep(float(args[1]) if len(args) > 1 else 0); shot(args[0])
    elif cmd == "click": click(int(args[0]), int(args[1]))
    elif cmd == "key": key(args[0], float(args[1]) if len(args) > 1 else 0)
    elif cmd == "interact": interact()
    elif cmd == "chat": chat(args[0])
    elif cmd == "look": look(int(args[0]), int(args[1]))
    elif cmd == "join": join()
    elif cmd == "leave": leave()
    elif cmd == "recover": recover()
    elif cmd == "dropped": print(dropped())
    else: sys.exit(f"unknown command {cmd}")
