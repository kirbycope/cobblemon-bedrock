"""Cobblemon's First Time User Experience, for the ftue skill (C:\\GitHub\\.claude\\skills\\ftue\\ftue.py):

    python ../.claude/skills/ftue/ftue.py tools/ftue_playbook.py

A new player's first session, as the add-on's README, its in-game Getting Started book, the Cobblemon wiki and
First Play videos have it: download the release's .mcaddon, import it, make a new world with the behavior pack on,
pick a starter, send it out, and so on. The install is clean: any copy of the packs already in the game (the
development junctions to this repository) is moved aside first and put back by cleanup().
"""
import math
import os
import shutil
import time
import urllib.request

import pyautogui

from ftue import check, matches, step

RELEASE = "https://github.com/kirbycope/cobblemon-bedrock/releases/latest/download/cobblemon-bedrock.mcaddon"
WORLD = "FTUE Cobblemon"


@step("Download the add-on from the latest release")
def download(t):
    """The release's .mcaddon, or with FTUE_ADDON set, that local build (python tools/build_addon.py --output ...) to
    try a change the way a new player meets it before it is released."""
    path = os.path.join(t.dir, "cobblemon-bedrock.mcaddon")
    if os.environ.get("FTUE_ADDON"):
        shutil.copyfile(os.environ["FTUE_ADDON"], path)
        t.note(f"local build {os.environ['FTUE_ADDON']}, not the release")
    else:
        urllib.request.urlretrieve(RELEASE, path)
    t.data["addon"] = path
    t.data["packs"] = t.store.manifests_in_addon(path)
    check(len(t.data["packs"]) == 2, f"expected a behavior and a resource pack in the .mcaddon, found {t.data['packs']}")
    return f"{os.path.getsize(path) // 1024 // 1024} MB, packs {[(p[3], p[1]) for p in t.data['packs']]}"


@step("Clean install: import the .mcaddon as a double-click does")
def install(t):
    uuids = {p[0] for p in t.data["packs"]}
    moved = t.store.stash_existing(uuids)
    if moved: t.note(f"moved aside for the run: {[m[0] for m in moved]}")
    t.connect_pad()   # plugged in before the game starts, as a controller player's is
    if t.client.running(): t.client.quit()
    if t.store.first_person(): t.note("camera set back to first person, as a new player has it")
    installed = t.store.import_addon(t.data["addon"], uuids, t.client)
    t.client.launch()
    t.client.wait("play", "settings", timeout=180, why="the main menu after the import")
    t.client.shot("imported")
    return f"installed to {sorted(os.path.relpath(p, t.store.ROOT) for p in installed)}"


@step("Create a new world with the Cobblemon behavior pack")
def create_world(t):
    c = t.client
    t.connect_pad()   # already in from install; plugged in here when the run resumes at this step
    c.focus(); c.park_mouse()
    c.wait("play", "settings", timeout=120, why="the main menu")
    c.select("play", then=("create new", "import world"))
    c.select("create new world", then=("create new world", "templates", "game mode", "world name"))
    if not c.find("behavior packs", "world name", timeout=3):   # the "Create from..." screen: a new world or a template
        c.select("create new world", then=("behavior packs", "world name", "game mode"))
    c.shot("create_world")
    c.select("behavior packs", then=("available", "activate", "my packs"))
    check(c.find("cobblemon", timeout=10), "Cobblemon is not in the world's behavior pack list after the import")
    c.shot("behavior_packs")
    c.beside("cobblemon", "activate", then=("cobblemon activated", "deactivate"))
    c.shot("activated")
    # the behavior pack names its resource pack as a dependency, so the game should have turned that on too
    c.select("resource packs", then=("active", "available"))
    if not c.find("active", timeout=2) or not c.find("cobblemon", timeout=4):
        t.pad.press("lb")   # the Active tab
        if not c.find("cobblemon", timeout=4): t.finding("Activating the behavior pack did not add the Cobblemon resource pack.")
    c.shot("resource_packs")
    c.select("create", then=("create anyway", "creating", "loading", "generating", "building terrain"))
    if c.find("create anyway", timeout=2):   # activating a behavior pack turns achievements off, and the game asks
        c.select("create anyway", then=("creating", "loading", "generating", "building terrain"))
    c.shot("creating")
    return "world created"


@step("Join: the starter screen opens")
def starter_screen(t):
    c = t.client
    t.connect_pad()
    began = time.time()
    found = c.wait("starter", "choose", "kanto", "content log", timeout=900, why="the starter screen on first join")
    if time.time() - began > 120:
        t.finding(f"The first load of the new world took {(time.time() - began) / 60:.1f} minutes on the Loading screen.")
    if "content log" in found[2].lower():
        t.finding("A clean install's first join opens the Content Log over the world (the pack has content errors).")
        c.shot("content_log")
        found = c.wait("starter", "choose", "kanto", timeout=60, why="the starter screen behind the content log")
    c.shot("starter_screen")
    return found[2]


@step("Pick a starter with the controller: Charmander, then I choose you!")
def pick_starter(t):
    c, pad = t.client, t.connect_pad()
    c.park_mouse()
    if not c.find("i choose you", "starter selection", timeout=5):
        t.finding("The starter screen was not open after the first join; sneaking twice (B, B) to open it as the Getting Started book says.")
        pad.press("b", "b", hold=0.1, gap=0.15)
        c.wait("i choose you", "starter selection", timeout=10, why="the starter screen after sneaking twice")
    c.shot("starter_open")
    # the screen opens on "I choose you!"; up three times reaches Bulbasaur at the top left, right Charmander. Pressing
    # a starter opens the screen again showing it, with the focus back on "I choose you!"
    pad.press("up", "up", "up", "right"); time.sleep(0.4)
    c.shot("charmander_focused")
    pad.press("a"); time.sleep(1.5)
    if c.find("you chose", timeout=1):
        t.finding("The starter screen's D-pad did not reach Charmander: A chose the starter already shown.")
        return c.find("you chose")[2]
    check(c.find("charmander", timeout=4), "up, up, up, right and A did not bring up Charmander on the starter screen")
    c.shot("charmander")
    pad.press("a")   # the focus is back on "I choose you!"
    found = c.wait("you chose", timeout=10, why="the chat line after choosing")
    return found[2]


@step("First join: no TM unlock message before any Pokemon", blocking=False)
def no_tm_message(t):
    t.client.key("t"); time.sleep(1.5)   # the chat history, to read every line sent since joining
    text = t.client.read()
    t.client.shot("chat")
    t.client.key("escape"); time.sleep(0.8)
    check("new tms learned" not in text and "unlocked the" not in text, "chat shows a TM unlock message at first join")
    return "no TM message"


# The in-world steps play on the local Bedrock Dedicated Server, in a world made for the run from the same .mcaddon,
# so the bridge can say where the player and the Pokemon are; the player still moves by the controller alone.

@step("Server world: the add-on's packs on the local Bedrock server")
def server_world(t):
    if "addon" not in t.data: download(t)   # a run started here (--from server_world)
    name = "ftue-" + time.strftime("%Y%m%d-%H%M%S")
    # FTUE_SEED (from tools/ftue_seed_screen.py) plays a seed known to have a Pewter Gym within reach of spawn
    t.server.prepare_world(name, t.data["addon"], fresh_version=bool(os.environ.get("FTUE_ADDON")), seed=os.environ.get("FTUE_SEED"))
    t.note(f"seed {t.server.seed}")
    # the game is closed while the server starts: both bind UDP 7551, the LAN discovery port, on one machine, and a
    # server that starts second never shows on the Play screen
    t.client.quit()
    t.store.first_person()
    t.server.start()
    spawn = t.server.safe_spawn()
    t.data["server_world"] = name
    t.connect_pad()
    t.client.launch()
    t.client.wait("marketplace", "realms", timeout=180, why="the main menu after relaunching")
    return f"worlds/{name}, server and bridge up, spawn on open ground at {spawn}"


@step("Join the server from the Play screen's LAN tile")
def join_server(t):
    c, pad = t.client, t.connect_pad()
    c.focus(); c.park_mouse()
    # where the client is: a disconnect screen (the server it was on went away, focus on Back to menu), the Play screen
    # (maybe scrolled down its list), the main menu, or a world; read until one shows, since a stopped server's
    # disconnect screen comes and goes on its way to the menus
    on_play = menu = False
    for _ in range(4):
        if c.find("back to menu", timeout=1):
            pad.press("a"); time.sleep(3); continue
        on_play = c.find("create new world", "import world", "dedicated server", timeout=2)
        menu = on_play or c.find("marketplace", timeout=1)
        if menu: break
    if not menu:   # in a world: pause and quit to the main menu
        if not c.find("resume game", timeout=1): pad.press("start"); time.sleep(1.5)
        c.select("save & quit", "save and quit", then=("marketplace",))
    if not on_play: c.select("play", then=("create new world", "import world"))
    # the server's LAN tile comes after the worlds, once the game has found it on the network (up to a minute)
    spot, end = None, time.time() + 120
    while not spot and time.time() < end:
        spot = c.find("dedicated server", timeout=5)
        if not spot: c.nav("down")
    check(spot, "the server's LAN tile never showed on the Play screen")
    c.select_at(*spot, then=("download", "joining", "loading", "locating server", "resource packs"))
    if c.find("download resource packs", "would you like to download", timeout=8):   # packs this client has not cached
        c.select("download everything", then=("joining", "loading", "downloading", "locating", "building terrain"))
    bridge, end = t.connect_bridge(), time.time() + 300
    while time.time() < end and not bridge.player():
        time.sleep(3)
    check(bridge.player(), "the bridge never saw the player join")
    t.data["player"] = bridge.player().get("name")
    return f"joined as {t.data['player']}"


@step("Server first join: the starter screen, Charmander chosen")
def server_starter(t):
    found = t.client.find("i choose you", "starter selection", "content log", timeout=120)
    if found and "content log" in found[2].lower():
        t.finding("The Content Log opened on first joining the server.")
        t.connect_pad().press("b"); time.sleep(1.5)
    return pick_starter(t)


@step("Party item: call the starter back and send it out again")
def send_out(t):
    c, pad, bridge = t.client, t.connect_pad(), t.connect_bridge()
    me = bridge.player(t.data.get("player"))
    def mine(): return [e for e in bridge.entities(families=["owned"], location=me["location"], max_distance=24)]
    check(mine(), "no Pokemon of the player's is out after choosing the starter")
    for _ in range(8):   # the hotbar to the Party item (slot 3), read off its name over the hotbar
        if c.find("party", timeout=1): break
        pad.press("rb"); time.sleep(0.6)
    pad.press("lt:0.3"); time.sleep(3)
    check(not mine(), "the starter is still out after using the Party item")
    pad.press("lt:0.3"); time.sleep(4)
    check(mine(), "nothing came out on using the Party item again")
    c.shot("sent_out")
    return "recalled and sent out"


def battle_menu(c, timeout=0.0):
    """Whether the battle menu is up: one of its tiles' short labels on screen. The pixel font reads as "Suitch",
    "Cateh" or "Fiun", and "fight" alone also matches "no Pokemon that can fight", so only short lines count."""
    end = time.time() + timeout
    while True:
        if any(len(text) <= 9 and any(matches(label, text) for label in ("fight", "switch", "suitch", "catch", "cateh", "forfeit"))
               for *_, text in c.ocr()):
            return True
        if time.time() >= end: return False
        time.sleep(1)


def moves_shown(c, timeout=5):
    """Whether the battle's move list is up: its tiles show each move's PP as "left/max"."""
    import re
    end = time.time() + timeout
    while time.time() < end:
        path = c.shot("moves_check")
        from PIL import Image
        width, height = Image.open(path).size
        # in the bottom left quarter, where the moves sit; the HP over the top left reads "30/30" as well
        if any(re.search(r"\d+\s*/\s*\d+", text) and x < width / 2 and y > height * 0.6 for x, y, w, h, text in c.ocr(path)): return True
        time.sleep(1)
    return False


def focused_label(c, labels):
    """Which of the labelled buttons on screen has the controller's focus, by colour: the add-on's battle tiles are
    grey until focused, then red, green, yellow or blue. None when none of them stands out."""
    import numpy
    from PIL import Image
    path = c.shot("focus_tile")
    image = numpy.asarray(Image.open(path).convert("HSV")).astype(int)
    scores = {}
    for x, y, w, h, text in c.ocr(path):
        name = next((l for l in labels if matches(l, text)), None)
        if not name: continue
        patch = image[max(0, y - 6):y + h + 6, max(0, x - 20):x + w + 20]
        scores[name] = float(patch[:, :, 1].mean())   # saturation
    if not scores: return None
    best = max(scores, key=scores.get)
    return best if scores[best] > 2 * min(scores.values()) + 20 else None


@step("First battle: look at a wild Pokemon and use the Party item")
def first_battle(t):
    import math
    c, pad, bridge, steer = t.client, t.connect_pad(), t.connect_bridge(), t.steer(t.data.get("player"))
    if battle_menu(c, timeout=1):   # a run resumed here mid-battle
        return play_battle(t, {"type_id": "the wild Pokemon already in battle"})
    me = bridge.player(t.data.get("player"))
    owned = {e["id"] for e in bridge.entities(families=["owned"], location=me["location"], max_distance=64)}
    if owned:   # called back first, looking at the sky: the starter at the player's side would take the Party item's aim
        pad.look(0, 1, 0.5); pad.press("lt:0.3"); time.sleep(2); pad.look(0, -1, 0.5)
    wild = [e for e in bridge.entities(families=["pokemon"], location=me["location"], max_distance=48, closest=12)
            if e["id"] not in owned and abs(e["location"]["y"] - me["location"]["y"]) <= 6]
    wild = [e for e in wild if steer.on_surface(e["location"])]   # out in the open, not in a cave under the hill or in water
    wild.sort(key=lambda e: (abs(e["location"]["y"] - me["location"]["y"]) > 2, math.dist((e["location"]["x"], e["location"]["z"]), (me["location"]["x"], me["location"]["z"]))))
    check(wild, "no wild Pokemon out in the open within 48 blocks of the player")
    target = None
    for candidate in wild[:5]:   # the nearest that can be walked to; a step up or a pit can stop the walk
        left = steer.walk_to(candidate["id"], within=2.5, timeout=45)   # followed as it wanders
        if left is None or left > 6: t.note(f"could not reach {candidate.get('type_id')} ({left if left is None else round(left, 1)} blocks left)"); continue
        for attempt in range(2):   # a second time from on top of the step in the way
            at = steer.entity_at(candidate["id"])
            if not at: break
            aim = (at[0], at[1] + 0.6, at[2])
            for side in (1, -1, 1, -1):   # step sideways round a trunk or a ledge in the way
                if steer.clear(aim): break
                pad.stick("left", side, 0, 0.5)
                at = steer.entity_at(candidate["id"]) or at
                aim = (at[0], at[1] + 0.6, at[2])
            else:
                t.note(f"a block stands between the player and {candidate.get('type_id')}")
            # aimed until the Pokemon's name tag ("Press Use to battle.") shows under the crosshair, as a player waits for it
            steer.face(aim, tolerance=3)
            if not steer.nudge(lambda: bool(c.find("press use to battle", timeout=0.3))):
                t.note(f"no name tag under the crosshair while aiming at {candidate.get('type_id')}")
            c.shot("facing_wild")
            pad.press("lt:0.3"); time.sleep(3)
            if battle_menu(c, timeout=10): target = candidate; break
            pad.stick("left", 0, 1, 0.3); pad.press("a", hold=0.1, gap=0.0); pad.walk(0.4)
        if target: break
        t.note(f"no battle menu after using the Party item on {candidate.get('type_id')}")
    check(target, "no battle started with any of the nearest wild Pokemon")
    return play_battle(t, target)


def play_battle(t, target):
    """Fight to the end with the first move, from the battle menu."""
    c, pad = t.client, t.connect_pad()
    c.shot("battle_menu")
    for turn in range(30):   # Fight, then the first move, until the battle menu stops coming back
        if not battle_menu(c, timeout=20): break
        if turn == 0:
            start = focused_label(c, ("fight", "switch", "catch", "run", "forfeit"))
            t.note(f"the battle menu opened with the focus on {start}")
            if start is None: t.finding("The battle menu opens with no tile showing the controller's focus.")
            elif start != "fight": t.finding(f"The battle menu opens with the controller's focus on {start.title()}, not Fight: a new player pressing A gets {start.title()}.")
        if start != "fight": pad.press("up", "left")   # Fight is the top left tile
        pad.press("a")
        if not moves_shown(c):   # the moves show their PP ("35/35"); Back is an icon with no text
            if not battle_menu(c, timeout=2): break   # the battle is over
            t.finding("A on the battle menu's Fight did not open the moves."); break
        c.shot("moves")
        pad.press("a"); time.sleep(6)   # the moves open on the first
    c.shot("after_battle")
    check(not battle_menu(c, timeout=3), "still in battle after 30 turns")
    text = t.client.read()
    outcome = "lost: the starter fainted" if "fainted" in text or "no more" in text else "won" if "gained" in text or "exp" in text else "ended"
    if outcome.startswith("lost"):
        t.finding(f"The first wild battle was lost: {target.get('type_id')} against the level 10 starter.")
    return f"battled {target.get('type_id')}, {outcome}"


# ------------------------------------------------------------------------------- the first gym, by the Trainer Card

PEWTER_BIOMES = ("meadow", "stony_peaks", "extreme_hills")   # its feature rule's biomes, by their Bedrock ids (extreme_hills is windswept hills)


def card_arrow(c):
    """The Trainer Card's reading over the hotbar: the arrow's direction in degrees clockwise from straight ahead,
    "none" for its "No gym found yet" line, or None when neither shows. The arrow is a red Unicode arrow (main.js
    ARROWS); its heavier end is the head, so the direction runs from the middle of its box to its centre of mass."""
    import numpy
    from PIL import Image
    path = c.shot("card")
    image = numpy.asarray(Image.open(path).convert("RGB")).astype(int)
    h, w = image.shape[:2]
    box = image[int(h * 0.70):int(h * 0.83), int(w * 0.38):int(w * 0.62)]   # where the action bar sits, above the hearts
    red = (box[:, :, 0] > 150) & (box[:, :, 1] < 90) & (box[:, :, 2] < 90)
    ys, xs = numpy.nonzero(red)
    if len(xs) >= 15:
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        return round(math.degrees(math.atan2(xs.mean() - cx, -(ys.mean() - cy))) / 45) * 45 % 360
    if matches("no gym found", c.action_bar(path)) or matches("gym found yet", c.action_bar(path)): return "none"
    return None


DIGIT_LOOKS = {"0": "0oOQD@ag", "1": "1iIl|!", "2": "2zZa", "3": "3", "4": "4", "5": "5sS", "6": "6b", "7": "7", "8": "8B", "9": "9gq"}


def parse_locate(text, here):
    """(x, z) from "The nearest ... is at block X, Y, Z (D blocks away)" as OCR reads Minecraft's font, its digits
    often mistaken for letters ("-14g, 12@, -140 c226"). Every reading of the ambiguous characters is tried and the
    one whose distance from here matches the line's own distance is kept."""
    import itertools
    import re
    m = re.search(r"bl\S*k\s+(\S+?)[,.]\s*(\S+?)[,.]\s*(\S+?)\s*\(?c?(\S+?)\s*bl", text, re.I)   # "block" reads as "blook" too
    if not m: return None
    def readings(token):
        token = token.strip("()c, ")
        options = []
        for ch in token:
            if ch == "-": options.append("-"); continue
            digits = [d for d, looks in DIGIT_LOOKS.items() if ch in looks]
            if not digits: return []
            options.append(digits)
        return ["".join(p) for p in itertools.product(*[o if isinstance(o, list) else [o] for o in options])]
    xs, zs, ds = readings(m.group(1)), readings(m.group(3)), readings(m.group(4))
    best = None
    for x, z, d in itertools.product(xs, zs, ds):
        try: x, z, d = int(x), int(z), int(d)
        except ValueError: continue
        error = abs(math.dist((x, z), here) - d)
        if best is None or error < best[0]: best = (error, x, z)
    return (best[1], best[2]) if best and best[0] <= 3 else None


def hold(t, name=None, tries=10):
    """Step the hotbar with RB until the item named name is in hand, or with name None until the hand is empty. The
    game shows the held item's name over the hotbar for a moment after each change, and nothing for an empty slot,
    so each step is read at once (Client.action_bar, the name's strip)."""
    c, pad = t.client, t.connect_pad()
    for _ in range(tries):
        pad.press("rb", gap=0.15)
        shown = c.action_bar(band=(0.80, 0.90), cols=(0.3, 0.7)).strip()
        if (name is None and not shown) or (name and matches(name, shown)): return True
    return False


def hotbar_slot(t, item):
    """The hotbar slot (0 to 8) holding item, from the player's inventory through the bridge, or None."""
    bridge = t.connect_bridge()
    inventory = bridge.data("mc_player_get_inventory", player=t.data.get("player") or bridge.player()["name"]) or {}
    items = (inventory.get("inventory", {}) or {}).get("items", []) if isinstance(inventory, dict) else []
    return next((i["slot"] for i in items if i.get("type_id") == item and i.get("slot", 9) < 9), None)


def eat(t):
    """Bread from the hotbar, held to eat it, as a player tops up hunger on a long walk."""
    if hotbar_slot(t, "minecraft:bread") is None or not hold(t, "bread"): return False
    t.connect_pad().press("lt:2.0"); time.sleep(0.5)
    return True


def hold_card(t):
    """The Trainer Card in hand, from wherever it sits in the hotbar."""
    return hotbar_slot(t, "rctmod:trainer_card") is not None and hold(t, "trainer card")


def stuck(at, memory={}):
    """Whether the player has moved less than half a block since the last call (a step or a wall in the way)."""
    last = memory.get("at")
    memory["at"] = at
    return bool(last) and math.hypot(at["x"] - last["x"], at["z"] - last["z"]) < 0.5


@step("Trainer Card: craft it at a crafting table")
def card_craft(t):
    c, pad, bridge, steer = t.client, t.connect_pad(), t.connect_bridge(), t.steer(t.data.get("player"))
    who = t.data.get("player") or bridge.player()["name"]
    # gathered off camera: paper (sugar cane), a glass pane (smelted sand), redstone (mined) and a name tag (a chest,
    # fishing or a librarian); a crafting table is put down in front of the player
    for item, n in (("paper", 6), ("glass_pane", 1), ("redstone", 1), ("name_tag", 1)):
        bridge.command(f"give {who} {item} {n}")
    t.note("given the card's ingredients and a crafting table rather than gathering them")
    me = bridge.player(who)
    at, yaw = me["location"], math.radians(me["rotation"]["y"])
    x, z, y = math.floor(at["x"] - math.sin(yaw) * 2), math.floor(at["z"] + math.cos(yaw) * 2), math.floor(at["y"])
    bridge.command(f"setblock {x} {y} {z} crafting_table")
    # an empty slot in hand (a book or the Party item would take the use), then the table, looking a little lower each
    # try. The slot is found by its contents through the bridge: the item name over the hotbar fades after a moment,
    # so reading the screen cannot tell an empty slot from a held book
    pad.press("b"); time.sleep(0.6)   # any screen a stray press opened
    check(hold(t, None), "no empty hotbar slot to free the hand")
    steer.face((x + 0.5, y + 0.6, z + 0.5), tolerance=3)
    for attempt in range(5):
        pad.press("lt:0.2"); time.sleep(2)
        if c.find("all recipes", "construction", "equipment", "items", "nature", timeout=2): break
        pad.look(0, -0.7, 0.15); time.sleep(0.4)
    else:
        check(False, "the crafting table did not open")
    c.shot("crafting")
    # the recipe book's tabs go round with LB and RB; the card is in Items, where the focus starts on its first recipe
    for _ in range(6):
        if c.find("items", timeout=0.6) and not c.find("all recipes", timeout=0.2): break
        pad.press("rb"); time.sleep(0.6)
    check(c.find("items", timeout=1), "the recipe book's Items tab never came up")
    # along the recipes, row by row, until the tooltip under the focus reads Trainer Card; the tooltip shows a moment
    # after the focus lands, and right from a row's last recipe leaves the list for the crafting grid, so each row is
    # walked one way and the next the other (7 recipes to a row)
    found = False
    for row in range(4):
        for col in range(7):
            time.sleep(0.9)
            if c.find("trainer card", timeout=0.2): found = True; break
            if col < 6: pad.press("left" if row % 2 else "right")
        if found: break
        pad.press("down")
    check(found, "no Trainer Card among the Items recipes")
    c.shot("card_recipe")
    pad.press("a"); time.sleep(1.5)   # A on a recipe the player has the ingredients for crafts it
    pad.press("b"); time.sleep(1)
    check(hold_card(t), "no Trainer Card in the hotbar after crafting")
    return "crafted the Trainer Card"


@step("Trainer Card: what it says at spawn", blocking=False)
def card_at_spawn(t):
    check(hold_card(t), "no Trainer Card in the hotbar")
    time.sleep(1)
    reading = card_arrow(t.client)
    t.client.shot("card_at_spawn")
    if reading == "none":
        t.finding("A new player's Trainer Card says 'No gym found yet': it cannot point at a gym nobody has been near, so the first gym is found by exploring.")
        t.finding("The card's 'No gym found yet. Explore: ...' line is too long for the action bar: with a controller its end runs under the RT hint and off the screen.")
    return f"card reads {reading}"


@step("Explore toward a Pewter Gym's biomes until the card shows an arrow")
def explore_for_gym(t):
    c, pad, bridge = t.client, t.connect_pad(), t.connect_bridge()
    t.data.setdefault("player", bridge.player()["name"])   # a run started at this step has not joined in this process
    steer = t.steer(t.data["player"])
    here = bridge.player(t.data["player"])["location"]
    found = []
    # where its biomes are, asked with /locate in chat: a stand-in for a player who reads the README's table and a map
    t.note("used /locate biome in chat to find a Pewter Gym's biomes")
    for biome in PEWTER_BIOMES:
        c.key("t"); time.sleep(1.2)
        # a click into the field first: after controller input it is not focused, and typing goes nowhere
        w, h = pyautogui.size()
        c.click(w // 2, int(h * 0.955)); time.sleep(0.5)
        c.type(f"/locate biome minecraft:{biome}"); time.sleep(0.3); c.key("enter"); time.sleep(4)
        c.key("t"); time.sleep(1.2)
        # the newest answer is the lowest in the chat history; older ones from earlier asks sit above it
        lines = sorted((y, text) for x, y, w, h, text in c.ocr() if "nearest" in text.lower())
        line = lines[-1][1] if lines else ""
        in_world(t)
        spot = parse_locate(line, (here["x"], here["z"]))
        if spot: found.append((math.dist(spot, (here["x"], here["z"])), biome) + spot)
    t.note(f"nearest: {sorted(found)[:3]}")
    check(found, "locate found none of a Pewter Gym's biomes")
    distance, biome, bx, bz = min(found)
    t.data["gym_biome"] = (biome, bx, bz)
    started, budget = time.time(), 60 * 25
    # to the biome, then round it in widening squares, looking at the card every leg
    legs = [(bx, bz)] + [(bx + dx * r, bz + dz * r) for r in range(48, 400, 48)
                         for dx, dz in ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))]
    for n, (gx, gz) in enumerate(legs):
        if time.time() - started > budget: break
        if in_world(t): t.note(f"died on the way; respawned at the world spawn")
        if n % 4 == 3: eat(t)
        hold_card(t)
        reading = card_arrow(c)
        if isinstance(reading, int):
            return f"the card showed an arrow after {(time.time() - started) / 60:.1f} minutes, heading for a {biome} {distance:.0f} blocks off"
        top = bridge.data("mc_block_get_top", dimension="overworld", x=int(gx), z=int(gz))
        gy = top["location"]["y"] + 1 if isinstance(top, dict) and "location" in top else 80
        at = bridge.player(t.data.get("player"))["location"]
        left = steer.walk_to((gx, gy, gz), within=6, timeout=max(30, math.dist((gx, gz), (at["x"], at["z"])) / 3))
        if left is not None and left > 20:
            # terrain the controller could not cross (a pit, a cliff, a lake): the run moves on to the leg's end and
            # says where, so the report shows how far it got on foot
            at = bridge.player(t.data.get("player"))["location"]
            t.note(f"stuck at {round(at['x'])}, {round(at['y'])}, {round(at['z'])} with {left:.0f} blocks to go; moved on to {gx}, {gz}")
            # spreadplayers puts the player on the surface, where a teleport to a guessed height into a chunk not
            # yet loaded can land inside a hill ("suffocated in a wall")
            bridge.command(f"spreadplayers {gx} {gz} 0 1 {t.data['player']}")
            time.sleep(4)
    t.finding(f"After {budget // 60} minutes walking to and around the nearest {biome}, the Trainer Card still had no gym to point at.")
    check(False, "the card never showed an arrow")


@step("Follow the card's arrow to the gym")
def follow_arrow(t):
    c, pad, bridge, steer = t.client, t.connect_pad(), t.connect_bridge(), t.steer(t.data.get("player"))
    hold_card(t)
    started, flips = time.time(), 0
    while time.time() - started < 60 * 15:
        reading = card_arrow(c)
        if not isinstance(reading, int):
            t.note(f"card read {reading}"); pad.walk(0.5); continue
        turn = (reading + 180) % 360 - 180
        if abs(turn) > 22:   # turn the camera toward the arrow, then look again
            if abs(turn) >= 135: flips += 1
            if flips >= 3: break   # the arrow keeps swinging round behind: the player stands where it points
            pad.look(0.6 if turn > 0 else -0.6, 0, abs(turn) / 360)
            time.sleep(0.3)
            continue
        flips = 0
        at = bridge.player(t.data.get("player"))["location"]
        pad.walk(1.5, hold=("a",) if stuck(at) or steer.in_water(at) else ())
    c.shot("at_gym")
    check(flips >= 3, "the arrow never settled on a place in 15 minutes")
    trainers = bridge.entities(type="cobblemon:rct_trainer", location=bridge.player(t.data.get("player"))["location"], max_distance=48)
    return f"arrived where the card points{', a gym trainer is out' if trainers else ''}"


STEPS = [download, install, create_world, starter_screen, pick_starter, no_tm_message,
         server_world, join_server, server_starter, send_out, first_battle,
         card_craft, card_at_spawn, explore_for_gym, follow_arrow]


def cleanup(t):
    """Put the development junctions back, remove the imported packs, and point the server back at its world. The
    worlds stay for a look afterwards."""
    if t.data.get("packs"):
        t.store.restore({p[0] for p in t.data["packs"]})
    if t.data.get("server_world"):
        t.server.restore()
