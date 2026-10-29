"""Cobblemon's First Time User Experience, for the ftue skill (C:\\GitHub\\.claude\\skills\\ftue\\ftue.py):

    python ../.claude/skills/ftue/ftue.py tools/ftue_playbook.py

A new player's first session, as the add-on's README, its in-game Getting Started book, the Cobblemon wiki and
First Play videos have it: download the release's .mcaddon, import it, make a new world with the behavior pack on,
pick a starter, send it out, and so on. The install is clean: any copy of the packs already in the game (the
development junctions to this repository) is moved aside first and put back by cleanup().
"""
import json
import math
import os
import re
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
    # straight after an import the menu is drawn but takes no input for a minute or two (the game is still taking the
    # packs in): Play is tried again until it opens
    began = time.time()
    while True:
        try:
            c.select("play", then=("create new", "import world"))
            break
        except Exception as error:   # by name: the runner's StepFailed is ftue.py run as __main__, not this import's
            if type(error).__name__ != "StepFailed" or time.time() - began > 240: raise
            time.sleep(15)
    if time.time() - began > 30:
        t.finding(f"After the import the main menu ignored the controller and the mouse for {time.time() - began:.0f} s.")
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
    # past the Loading screen first: read loosely, its tips passed for the starter screen ("Use phantom membranes to
    # repair your elytra" was taken for one of "starter", "choose", "kanto")
    while time.time() - began < 900 and c.find("loading", timeout=0):
        time.sleep(3)
    found = c.wait("starter selection", "i choose you", "kanto", "content log", timeout=max(60, 900 - (time.time() - began)), why="the starter screen on first join")
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
    # The first press after the screen opens can be lost, which leaves the focus a row short (Cyndaquil, in Johto):
    # pressing a starter only shows it, so the moves are made again until the screen shows Charmander
    for attempt in range(3):
        pad.press(*["up"] * (3 + attempt), "right"); time.sleep(0.4)
        c.shot("charmander_focused")
        pad.press("a"); time.sleep(1.5)
        if c.find("you chose", timeout=1):
            t.finding("The starter screen's D-pad did not reach Charmander: A chose the starter already shown.")
            return c.find("you chose")[2]
        if c.find("charmander", timeout=4): break
        t.note(f"the moves to Charmander showed another starter (try {attempt + 1}); made again")
    else:
        check(False, "up, up, up, right and A did not bring up Charmander on the starter screen")
    c.shot("charmander")
    pad.press("a")   # the focus is back on "I choose you!"
    found = c.find("you chose", timeout=10)
    if found: return found[2]
    # the chat line is light text that OCR can lose over a bright world (bamboo); the party panel naming the starter,
    # with the starter screen gone, says the same
    check(c.find("charmander", timeout=3) and not c.find("starter selection", "i choose you", timeout=0),
          "neither the chat line after choosing nor Charmander in the party panel")
    t.note("no 'You chose' chat line read; Charmander shows in the party panel")
    return "Charmander in the party panel"


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
    # steered by the world's name, the line over "Dedicated Server's world": the tile's focus outline stops the OCR
    # reading that subtitle, and the walk lost the tile the moment it reached it (a LAN tile first in the list)
    over = [(abs(spot[1] - (ly + lh // 2)), (lx + lw // 2, ly + lh // 2, t)) for lx, ly, lw, lh, t in c.ocr()
            if 10 < spot[1] - (ly + lh // 2) < 70 and abs(lx - (spot[0] - 210)) < 260 and not matches("dedicated server", t)]
    if over: spot = min(over)[1]
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
        t.say(f"Walking up to a wild {pokemon_name(candidate)} to battle it")
        left = approach(t, candidate["id"], within=2.5, timeout=45)   # followed as it wanders
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
            t.say(f"Using the Party item on the {pokemon_name(candidate)}")
            pad.press("lt:0.3"); time.sleep(3)
            if battle_menu(c, timeout=10): target = candidate; break
            pad.stick("left", 0, 1, 0.3); pad.press("a", hold=0.1, gap=0.0); pad.walk(0.4)
        if target: break
        t.note(f"no battle menu after using the Party item on {candidate.get('type_id')}")
    check(target, "no battle started with any of the nearest wild Pokemon")
    return play_battle(t, target)


def pokemon_name(entity):
    """ "Raticate" from "cobblemon:p0020_raticate" """
    return entity.get("type_id", "Pokemon").split(":")[-1].split("_", 1)[-1].replace("_", " ").title()


def approach(t, entity_id, within=2.5, timeout=45):
    """Walk up to an entity with the navigator, planning again toward where it has got to after each short leg, as a
    player closes on a Pokemon that wanders. Returns the distance left, or None once it is gone."""
    steer, nv = t.steer(t.data.get("player")), navigator(t)
    end, left = time.time() + timeout, None
    while time.time() < end:
        at, me = steer.entity_at(entity_id), nv.where()
        if not at or not me: return None
        left = math.hypot(at[0] - me[0], at[2] - me[2])
        if left <= within: return left
        nv.go(at, within=within, timeout=min(15, end - time.time()))
    return left


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
        if start != "fight":
            # Fight is the top left tile; looked for again first, since the D-pad outside the menu changes the camera
            # (up) and opens the emote wheel (left), which then swallowed the next step's hotbar presses
            if not battle_menu(c, timeout=0.5): break
            pad.press("up", "left")
        pad.press("a")
        if not moves_shown(c):   # the moves show their PP ("35/35"); Back is an icon with no text
            if not battle_menu(c, timeout=2): break   # the battle is over
            t.finding("A on the battle menu's Fight did not open the moves."); break
        c.shot("moves")
        pad.press("a"); time.sleep(6)   # the moves open on the first
    c.shot("after_battle")
    check(not battle_menu(c, timeout=3), "still in battle after 30 turns")
    text = t.client.read()
    in_world(t)
    outcome = "lost: the starter fainted" if "fainted" in text or "no more" in text else "won" if "gained" in text or "exp" in text else "ended"
    if outcome.startswith("lost"):
        t.finding(f"The first wild battle was lost: {target.get('type_id')} against the level 10 starter.")
    return f"battled {target.get('type_id')}, {outcome}"


# ------------------------------------------------------------------------------- the first gym, by the Trainer Card

PEWTER_BIOMES = ("meadow", "stony_peaks", "extreme_hills")   # its feature rule's biomes, by their Bedrock ids (extreme_hills is windswept hills)


def card_arrow(c, path=None):
    """The Trainer Card's reading over the hotbar: the arrow's direction in degrees clockwise from straight ahead,
    "none" for its "No gym found yet" line, or None when neither shows. The arrow is one red Unicode glyph (main.js
    ARROWS), about 8 pixels tall, alone on the action bar's dark backing in the middle of the screen; its heavier end is
    the head, so the direction runs from the middle of its box to its centre of mass. Only the bar's own red (#FF5555)
    on that backing counts: read anywhere red, a red block or Pokemon in view came back as an arrow, and the run
    stopped exploring with no gym found (the arrow it "saw" was a Charmander)."""
    import numpy
    from PIL import Image
    path = path or c.shot("card")
    image = numpy.asarray(Image.open(path).convert("RGB")).astype(int)
    h, w = image.shape[:2]
    win = image[int(h * 0.73):int(h * 0.79), int(w * 0.475):int(w * 0.525)]
    red = (abs(win[:, :, 0] - 254) < 24) & (abs(win[:, :, 1] - 84) < 28) & (abs(win[:, :, 2] - 84) < 28)
    ys, xs = numpy.nonzero(red)
    if len(xs) >= 6 and xs.max() - xs.min() < 30 and ys.max() - ys.min() < 30:
        around = win[max(0, ys.min() - 6):ys.max() + 7, max(0, xs.min() - 6):xs.max() + 7]
        backing = around[~red[max(0, ys.min() - 6):ys.max() + 7, max(0, xs.min() - 6):xs.max() + 7]]
        if len(backing) and backing.mean() < 70:
            cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
            return round(math.degrees(math.atan2(xs.mean() - cx, -(ys.mean() - cy))) / 45) * 45 % 360
    bar = c.action_bar(path)
    if matches("no gym found", bar) or matches("gym found yet", bar) or matches("association will find", bar): return "none"
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
    if name is None and held_item(t) is not None:
        # an empty hand, asked of the server: a blank name strip read as empty with a book in hand, and "use" on the
        # crafting table opened the book
        for _ in range(tries):
            if held_item(t) == "nothing": return True
            pad.press("rb", gap=0.15)
        return held_item(t) == "nothing"
    for _ in range(tries):
        pad.press("rb", gap=0.15)
        shown = c.action_bar(band=(0.80, 0.90), cols=(0.3, 0.7)).strip()
        if (name is None and not shown) or (name and matches(name, shown)): return True
    return False


def series_card(t, series="Radical Red"):
    """Whether the player's Trainer Card is named for a series (the Association renames it when one starts), from
    the inventory through the bridge."""
    bridge = t.connect_bridge()
    inventory = bridge.data("mc_player_get_inventory", player=t.data.get("player") or bridge.player()["name"]) or {}
    items = (inventory.get("inventory", {}) or {}).get("items", []) if isinstance(inventory, dict) else []
    return any(i.get("type_id") == "rctmod:trainer_card" and series.lower() in str(i.get("name_tag") or "").lower() for i in items)


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


def held_item(t):
    """What the player holds, from the add-on's cobblemon:held test hook in the server log, or None where the build
    has no such hook (reading the item's name off the screen missed the Trainer Card in some worlds)."""
    bridge = t.connect_bridge()
    who = t.data.get("player") or bridge.player()["name"]
    log = os.path.join(t.server.ROOT, "bds.out.log")
    mark = os.path.getsize(log)
    bridge.command(f"execute as {who} run scriptevent cobblemon:held")
    time.sleep(0.7)
    with open(log, encoding="utf-8", errors="replace") as file:
        file.seek(mark)
        found = re.findall(r"held: (\S+) slot", file.read())
    return found[-1] if found else None


def hold_card(t):
    """The Trainer Card in hand, from wherever it sits in the hotbar."""
    if hotbar_slot(t, "rctmod:trainer_card") is None: return False
    pad = t.connect_pad()
    for _ in range(10):
        held = held_item(t)
        if held is None: return hold(t, "trainer card")   # a build without the hook
        if held == "rctmod:trainer_card": return True
        pad.press("rb", gap=0.15)
    return held_item(t) == "rctmod:trainer_card"


def in_world(t):
    """Back to plain play: chat closed (B only: Escape opens the pause menu, where a later A lands on Save & Quit), a
    pause menu left, the emote wheel closed, and a death's Respawn pressed. True if it had died."""
    c, pad = t.client, t.connect_pad()
    pad.press("b"); time.sleep(0.8)
    if c.find("resume game", timeout=0.5): pad.press("b"); time.sleep(0.8)
    # the emote wheel, which a D-pad press meant for a battle menu that had just closed opens: B picks an emote there,
    # and the wheel swallows RB, so the hotbar cannot be stepped until the same D-pad button closes it
    if c.find("change emotes", timeout=0.5): pad.press("left"); time.sleep(0.8)
    # B in the world is crouch: if there was nothing to close, it crouched the player, so stand back up
    if getattr(t, "_nav", None) is not None: t._nav.stand_up()
    if c.find("respawn", "you died", timeout=0.5):
        # the button takes a moment to answer after the screen comes up, so A is pressed until the screen goes
        for _ in range(5):
            pad.press("a"); time.sleep(4)
            if not c.find("respawn", "you died", timeout=0.5): break
        return True
    return False


def stuck(at, memory={}):
    """Whether the player has moved less than half a block since the last call (a step or a wall in the way)."""
    last = memory.get("at")
    memory["at"] = at
    return bool(last) and math.hypot(at["x"] - last["x"], at["z"] - last["z"]) < 0.5


def recipe_tooltip(t, text):
    """Whether the tooltip of the recipe under the focus reads text. Read from the crafting window alone: over the
    whole screen RapidOCR found no line in the tooltip (white on dark purple, across the Inventory label) and two
    runs walked past the Trainer Card, while the same frame cropped to the window reads "Trainer Card"."""
    from PIL import Image
    image = Image.open(t.client.shot("recipes"))
    w, h = image.size
    path = os.path.join(t.dir, "_recipes.png")
    image.crop((int(w * 0.156), int(h * 0.14), int(w * 0.844), int(h * 0.817))).save(path)
    return any(matches(text, line[4]) for line in t.client.ocr(path))


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
    at, yaw = me["location"], me["rotation"]["y"]
    # an open place 1.5 to 3.5 blocks off, at the feet's level or a block up or down, with ground under it and room
    # over it, the nearest to straight ahead first, read from the navigator's terrain: put blindly two blocks ahead,
    # on a hillside it went into the slope, and on the edge of a step no place straight out in eight ways was open
    terrain, fy = navigator(t).terrain, math.floor(at["y"] + 0.5)
    px, pz = math.floor(at["x"]), math.floor(at["z"])
    places = []
    for x in range(px - 3, px + 4):
        for z in range(pz - 3, pz + 4):
            d = math.hypot(x + 0.5 - at["x"], z + 0.5 - at["z"])
            if not 1.5 <= d <= 3.5: continue
            off = abs((math.degrees(math.atan2(-(x + 0.5 - at["x"]), z + 0.5 - at["z"])) - yaw + 180) % 360 - 180)
            for y in (fy, fy - 1, fy + 1):
                places.append((off + 20 * abs(y - fy), d, (x, y, z)))
    import nav
    clear = lambda x, y, z: terrain.has(x, y, z, nav.WALK_THROUGH) and not terrain.has(x, y, z, nav.LIQUID)
    spot = next((p for *_, p in sorted(places)
                 if clear(*p) and clear(p[0], p[1] + 1, p[2]) and terrain.has(p[0], p[1] - 1, p[2], nav.WALK_ON)), None)
    check(spot, "no open ground round the player for a crafting table")
    x, y, z = spot
    t.say("Putting down a crafting table to make a Trainer Card")
    bridge.command(f"setblock {x} {y} {z} crafting_table")
    placed = bridge.command(f"testforblock {x} {y} {z} crafting_table")
    # "Successfully found the block", or a count of successes over nought ("successCount: 0" is a miss)
    placed = str(placed).lower()
    check("successfully found" in placed or re.search(r"success_?count\W+[1-9]", placed), f"the crafting table was not placed: {placed}")
    # an empty slot in hand (a book or the Party item would take the use), then the table, looking a little lower each
    # try. The slot is found by its contents through the bridge: the item name over the hotbar fades after a moment,
    # so reading the screen cannot tell an empty slot from a held book
    in_world(t)   # any screen a stray press opened
    check(hold(t, None), "no empty hotbar slot to free the hand")
    # right up beside it, then the top face from above: from two blocks off at its side, the Raticate just battled
    # wandered in between and took the use ("Press Use to battle")
    navigator(t).go((x + 0.5, y, z + 0.5), within=1.8, timeout=20)
    for attempt in range(6):
        # aimed afresh each try, the empty hand checked again: the aim drifted off the table and a slot change put
        # an ingredient in hand, and the table never opened (two runs in a row)
        if attempt: hold(t, None)
        # on the table by the probe's word where it runs, else by the angles
        if not navigator(t).look_at((x + 0.5 + 0.15 * (attempt % 2), y + 0.97, z + 0.5 - 0.15 * (attempt % 3 == 2)),
                                    block=(x, y, z) if navigator(t).probe else None, timeout=6):
            t.note(f"the crosshair never settled on the table (try {attempt + 1})")
        pad.press("lt:0.2"); time.sleep(2)
        if c.find("all recipes", "construction", "equipment", "items", "nature", timeout=2): break
    else:
        c.shot("crafting_table_not_open")
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
            if recipe_tooltip(t, "trainer card"): found = True; break
            if col < 6: pad.press("left" if row % 2 else "right")
        if found: break
        pad.press("down")
    check(found, "no Trainer Card among the Items recipes")
    t.say("Found the Trainer Card recipe: crafting it")
    c.shot("card_recipe")
    pad.press("a"); time.sleep(1.5)   # A on a recipe the player has the ingredients for crafts it
    pad.press("b"); time.sleep(1)
    check(hold_card(t), "no Trainer Card in the hotbar after crafting")
    return "crafted the Trainer Card"


@step("Trainer Card: what it says at spawn", blocking=False)
def card_at_spawn(t):
    """A new player's card, in no series, points at the nearest Trainer Association; one is sent to a card holder
    every 400 ticks (main.js spawnAssociation), so the card is watched for a minute."""
    check(hold_card(t), "no Trainer Card in the hotbar")
    t.say("Holding the Trainer Card to see where it points")
    started, reading, said_none = time.time(), None, False
    while time.time() - started < 60:
        reading = card_arrow(t.client)
        if isinstance(reading, int): break
        said_none = said_none or reading == "none"
        time.sleep(2)
    t.client.shot("card_at_spawn")
    if said_none:
        t.note(f"before the Association came the card said: {t.client.action_bar().strip()!r}")
    if not isinstance(reading, int):
        t.finding("A new player's Trainer Card still had nothing to point at after a minute: no Trainer Association came.")
        return f"card reads {reading}"
    return f"the card pointed at a Trainer Association {time.time() - started:.0f} s after it was first held"


TA = "cobblemon:trainer_association"


@step("Meet the Trainer Association and start Radical Red")
def start_series(t):
    """The Association sent to the player walks to them while they head the way the card points; used, it shows its
    offers, and Radical Red, paid with the Trainer Card, starts the series (main.js showAssociation, showSeriesOffer)."""
    c, pad, bridge = t.client, t.connect_pad(), t.connect_bridge()
    t.data.setdefault("player", bridge.player()["name"])
    who, nv = t.data["player"], navigator(t)
    started, ta, gap = time.time(), None, None
    while time.time() - started < 180:
        at = bridge.player(who)["location"]
        near = bridge.entities(type=TA, location=at, max_distance=96)
        check(near or time.time() - started < 60, "no Trainer Association within 96 blocks")
        if not near: time.sleep(3); continue
        ta = min(near, key=lambda e: math.dist((e["location"]["x"], e["location"]["z"]), (at["x"], at["z"])))
        gap = math.dist((ta["location"]["x"], ta["location"]["z"]), (at["x"], at["z"]))
        if gap < 3.5: break
        # toward it, as the card's arrow shows; it comes the other way, so a short leg and look again
        t.say(f"Heading for the Trainer Association, {gap:.0f} blocks off")
        loc = ta["location"]
        nv.go((loc["x"], loc["y"], loc["z"]), within=2.5, timeout=20)
    # out of time still far off is a miss too: a run stuck 44 blocks away talked to it from there and blamed the use
    check(ta and gap is not None and gap < 3.5, f"the Trainer Association never came within reach ({gap:.0f} blocks off)" if gap else "the Trainer Association never came within reach")
    t.note(f"met the Association {time.time() - started:.0f} s after setting off")
    c.shot("association_near")
    # an empty hand (the card in hand would take the use as the card's own screen), the eyes on it, LT to use it
    steer = t.steer(who)
    opened = False
    t.say("Talking to the Trainer Association")
    def body():
        pos = steer.entity_at(ta["id"])
        return pos and (pos[0], pos[1] + 1.0, pos[2])
    for attempt in range(4):
        hold(t, None)
        # the crosshair on it by the probe's word (the name tag over its head and the run's own chat line both read
        # "Trainer Association", and the camera once stopped on the sky beside it)
        if not nv.look_at(body, entity=ta["id"], timeout=6):
            t.note(f"the crosshair never settled on the Association (try {attempt + 1})")
            nv.go(body() or (ta["location"]["x"], ta["location"]["y"], ta["location"]["z"]), within=2, timeout=10)
            continue
        pad.press("lt:0.2"); time.sleep(1.5)
        # its own form: the series button, or the card offer priced in emeralds
        if c.find("radical red", "emerald", timeout=4): opened = True; break
        # the probe saw it under the crosshair, but a block was nearer: one stood in a pit below the player, the
        # crosshair on the grass at its edge, and four uses from there opened nothing. Go right up to it first
        t.note(f"using it opened nothing (try {attempt + 1}); walking up to it")
        nv.go(body() or (ta["location"]["x"], ta["location"]["y"], ta["location"]["z"]), within=1.5, timeout=10)
    c.shot("association_screen")
    check(opened, "using the Trainer Association opened nothing")
    t.say("Choosing the Radical Red series")
    c.select("radical red", then=("start", "not now", "costs one"))
    c.shot("series_offer")
    try:
        c.select("start", then=("new journey", "radical red"))
    except Exception as error:   # by name: the runner's StepFailed is ftue.py run as __main__, not this import's
        if type(error).__name__ != "StepFailed": raise
        # the form closes and its line scrolls off before the screen is read sometimes (run 7): the card the
        # Association gives back is named for the series, which the server can say for sure
        time.sleep(2)
        if not series_card(t): raise
        t.note("the series' confirmation was not read on screen; the card named Radical Red says it started")
    c.shot("series_started")
    time.sleep(3)
    check(hold_card(t), "no Trainer Card after starting the series: the card should come back named Radical Red")
    reading = card_arrow(c)
    return f"started Radical Red; the card now reads {reading}"


def navigator(t):
    """The run's navigator: baritone-bedrock (nav.py finds it), planning Baritone's way over the terrain its probe
    pack streams and driving the run's controller. One per run, so the probe's bands and the previous path's
    favoring are kept. It drives the pad itself: press nothing while a go() is running."""
    if getattr(t, "_nav", None) is None:
        import nav
        name = t.data.get("player") or t.connect_bridge().player()["name"]
        t.data["player"] = name
        probe = nav.Probe()
        check(probe.connected(timeout=15), "the baritone-probe pack is not reporting from this world (prepare_world puts it in)")
        # one line per executor tick in the run's folder (feet, sticks, movement, status), for reading a walk that
        # went wrong afterwards; the course's ticks.jsonl has the same shape
        ticks = open(os.path.join(t.dir, "nav_ticks.jsonl"), "a", encoding="utf-8")
        t._nav = nav.Navigator(t.connect_pad(), probe, name, log=lambda m: print(m, flush=True), say=t.say,
                               on_tick=lambda row: (ticks.write(json.dumps(row) + "\n"), ticks.flush()))
    return t._nav


def seed_gyms(t, dimensions=False):
    """The gyms of the run's seed, from tools/ftue_seed_screen.py's seed.json: [(trainer, x, y, z)], or [] when the
    run's world is not that seed. Overworld ones only, unless dimensions, when each is (trainer, dimension, x, y, z)."""
    path = os.environ.get("FTUE_SEED_FILE") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "captures", "ftue", "seed.json")
    if not os.path.exists(path): return []
    with open(path, encoding="utf-8") as file: known = json.load(file)
    if str(known.get("seed")) != str(getattr(t.server, "seed", None) or os.environ.get("FTUE_SEED")): return []
    if dimensions:
        return [(trainer, dim.split(":")[-1], x, y, z) for trainer, sites in known.get("gyms", {}).items() for dim, x, y, z in sites]
    return [(trainer, x, y, z) for trainer, sites in known.get("gyms", {}).items() for dim, x, y, z in sites if dim == "minecraft:overworld"]


def walk_legs(t, goal, leg=45, within=8, until=None, budget=60 * 20):
    """Walk to goal with the navigator in legs of some seconds, calling until() between legs (the card read, say,
    which presses the pad the navigator must not be driving) and stopping when it returns something. The navigator
    is given the real goal every leg, so it plans Baritone's way toward it and keeps its last path's favoring.
    Returns (what until returned or None, distance left)."""
    bridge, nv = t.connect_bridge(), navigator(t)
    started, left, trail, check_alive = time.time(), None, [], True
    while time.time() - started < budget:
        # a death shows as the navigator losing the player (go returns None): only then is the screen read for the
        # Respawn button; read every leg, the check cost 8 s a leg and its B press crouched the player (run 7)
        if check_alive:
            if in_world(t): t.note("died on the way; respawned at the world spawn")
            check_alive = False
        if until:
            seen = until()
            if seen: return seen, left
        me = nv.where()
        if not me: check_alive = True; time.sleep(2); continue
        x, y, z = me[:3]
        left = math.hypot(goal[0] - x, goal[2] - z)
        if left <= within: return None, left
        rest = nv.go(goal, within=within, timeout=min(leg, max(10, budget - (time.time() - started))))
        if rest is None: check_alive = True; continue   # the player is gone from the probe's reports: dead
        if nv.arrived: return None, rest
        # three legs that between them got nowhere count as no way on, like a cliff face or an ocean
        trail = (trail + [(x, z)])[-3:]
        if len(trail) == 3 and math.hypot(trail[-1][0] - trail[0][0], trail[-1][1] - trail[0][1]) < 3:
            # the run moves on toward the goal and says so, so the report shows how much of the way was walked
            k = min(1.0, 32 / max(left, 1))
            px, pz = x + (goal[0] - x) * k, z + (goal[2] - z) * k
            t.note(f"no way on foot from {round(x)}, {round(y)}, {round(z)} toward {round(px)}, {round(pz)}; moved on")
            bridge.command(f"spreadplayers {px:.1f} {pz:.1f} 0 1 {t.data['player']}")
            time.sleep(4); trail = []
    return None, left


@step("Head for the seed's Pewter Gym until the card picks it up")
def seek_gym(t):
    """A player with a seed guide (a seed showcase video, a wiki's seed list) walks toward the Pewter Gym it shows,
    the card in hand; the step ends when the card shows an arrow, and reports how far from the gym that was."""
    c, bridge = t.client, t.connect_bridge()
    t.data.setdefault("player", bridge.player()["name"])
    hold_card(t)
    if isinstance(card_arrow(c), int): return "the card already points at a gym"
    gyms = sorted(seed_gyms(t), key=lambda g: math.hypot(g[1], g[3]))
    brock = [g for g in gyms if g[0] == "leader_brock_019e"]
    check(brock, f"no Pewter Gym known for seed {t.server.seed}: screen it first (tools/ftue_seed_screen.py --seed)")
    _, gx, gy, gz = brock[0]
    t.data["gym"] = (gx, gy, gz)
    t.say(f"Heading for Pewter Gym at {gx}, {gz}, watching the card")
    started = time.time()
    def card():
        hold_card(t)
        reading = card_arrow(c)
        if isinstance(reading, int):
            at = bridge.player(t.data["player"])["location"]
            return math.hypot(gx - at["x"], gz - at["z"])
    seen, left = walk_legs(t, (gx, gy, gz), leg=45, within=6, until=card)
    if seen:
        return f"the card picked up the gym {seen:.0f} blocks from it, after {(time.time() - started) / 60:.1f} minutes"
    # at the gym with no arrow yet: the gym is noticed only when its marker gets a random tick (about once a minute
    # at the default tick speed), so a player standing there with the card sees it come up a while later
    arrived = time.time()
    while time.time() - arrived < 180:
        seen = card()
        if seen:
            waited = time.time() - arrived
            if waited > 30:
                t.finding(f"At the Pewter Gym the Trainer Card showed no arrow for {waited:.0f} s: the gym is noticed only on a random tick of its marker, so a player who arrives first sees the card say nothing.")
            return f"the card picked up the gym {waited:.0f} s after arriving at it"
        time.sleep(5)
    t.finding(f"At the Pewter Gym ({gx}, {gz}) the Trainer Card still showed no arrow after 3 minutes.")
    check(False, "the card never showed an arrow on the way to the seed's Pewter Gym")


def gym_block_near(bridge, at, reach=20, dimension="overworld"):
    """Whether a gym's marker block is within reach blocks of at, asked of the bridge: the run's own check that the
    player stands at a gym, not a step the player takes."""
    hit = bridge.data("mc_block_contains", dimension=dimension, timeout=30,
                      **{"from": {"x": int(at["x"]) - reach, "y": int(at["y"]) - 24, "z": int(at["z"]) - reach},
                         "to": {"x": int(at["x"]) + reach, "y": int(at["y"]) + 24, "z": int(at["z"]) + reach},
                         "filter": {"include": ["cobblemon:gym_marker"]}})
    return isinstance(hit, dict) and bool(hit.get("contains"))


@step("Follow the card's arrow to the gym")
def follow_arrow(t):
    c, pad, bridge = t.client, t.connect_pad(), t.connect_bridge()
    t.data.setdefault("player", bridge.player()["name"])   # a run started at this step has not joined in this process
    steer = t.steer(t.data["player"])
    hold_card(t)
    started, behind, legs = time.time(), 0, 0
    while time.time() - started < 60 * 15:
        if in_world(t): t.note("died on the way; respawned at the world spawn")
        if not hold_card(t) and hotbar_slot(t, "rctmod:trainer_card") is None:
            t.finding("The player died following the card and dropped it with everything else; only the Party item comes back on respawn.")
            check(False, "the Trainer Card was lost on the way to the gym")
        reading = card_arrow(c)
        if not isinstance(reading, int):
            t.note(f"card read {reading}"); pad.walk(0.5); continue
        t.say(f"Following the card's arrow ({reading} degrees)")
        p = bridge.player(t.data["player"])
        at, yaw = p["location"], p["rotation"]["y"]
        turn = (reading + 180) % 360 - 180
        # the arrow swinging round behind, again and again, is where it points: checked against the gym's own blocks,
        # since a camera turn that overshot once read the same way 150 blocks short
        behind = behind + 1 if abs(turn) >= 135 else 0
        if behind >= 2 and gym_block_near(bridge, at): break
        # the way the arrow points, 24 blocks on: the player's yaw (from the bridge) turned by the arrow's reading
        heading = math.radians(yaw + turn)
        gx, gz = at["x"] - 16 * math.sin(heading), at["z"] + 16 * math.cos(heading)
        top = bridge.data("mc_block_get_top", dimension="overworld", x=int(gx), z=int(gz))
        gy = top["location"]["y"] + 1 if isinstance(top, dict) and "location" in top else at["y"]
        left = navigator(t).go((gx, gy, gz), within=3, timeout=60)
        legs += 1
        if left is not None and left > 12:
            t.note(f"no way on foot from {round(at['x'])}, {round(at['y'])}, {round(at['z'])} following the arrow; moved on to {round(gx)}, {round(gz)}")
            bridge.command(f"spreadplayers {gx:.1f} {gz:.1f} 0 1 {t.data['player']}")
            time.sleep(4)
    c.shot("at_gym")
    at = bridge.player(t.data["player"])["location"]
    check(gym_block_near(bridge, at), "the card never led to a gym in 15 minutes")
    # where the player stands: at the door (the plate over the entrance marker), or somewhere else at the building
    door = bridge.data("mc_block_contains", dimension="overworld", timeout=30,
                       **{"from": {"x": int(at["x"]) - 8, "y": int(at["y"]) - 3, "z": int(at["z"]) - 8},
                          "to": {"x": int(at["x"]) + 8, "y": int(at["y"]) + 3, "z": int(at["z"]) + 8},
                          "filter": {"include": ["minecraft:bamboo_pressure_plate"]}})
    if not (isinstance(door, dict) and door.get("contains")):
        t.finding("Following the card's arrow brings the player to the gym building but not to its door: the arrow points at the trainer's spot inside, so the last stretch is finding the way in.")
    trainers = bridge.entities(type="cobblemon:rct_trainer", location=at, max_distance=48)
    return f"arrived at the gym in {(time.time() - started) / 60:.1f} minutes ({legs} legs){', a gym trainer is out' if trainers else ''}"


# the eight gyms in the order the series meets them, with the town each building is (scripts/gyms.js GYM_BADGES,
# feature_rules/rgs_*_gym_rule.json); Cinnabar's is in the Nether and Blackthorn's on the End islands
GYM_TOWNS = {"leader_brock_019e": "Pewter", "leader_misty_019f": "Cerulean", "leader_lt_surge_01a0": "Vermilion",
             "leader_erika_01a1": "Celadon", "leader_sabrina_01a4": "Saffron", "leader_koga_01a2": "Fuchsia",
             "leader_blaine_01a3": "Cinnabar", "leader_clair_004a": "Blackthorn"}


def find_blocks(bridge, dimension, lo, hi, block, most=16):
    """Where the blocks of the type are in the box lo..hi (corners, inclusive), as [(x, y, z)], up to most: the box is
    split in two along its longest side again and again, keeping the halves that hold one, with the bridge's contains
    test (it has no search). The ground has to be loaded, or nothing is found."""
    def holds(a, b):
        hit = bridge.data("mc_block_contains", dimension=dimension, timeout=30,
                          **{"from": dict(zip("xyz", a)), "to": dict(zip("xyz", b)), "filter": {"include": [block]}})
        return isinstance(hit, dict) and bool(hit.get("contains"))
    found, boxes = [], [(list(lo), list(hi))]
    while boxes and len(found) < most:
        a, b = boxes.pop()
        if not holds(a, b): continue
        if a == b: found.append(tuple(a)); continue
        axis = max(range(3), key=lambda k: b[k] - a[k])
        mid = (a[axis] + b[axis]) // 2
        b1, a2 = b[:], a[:]
        b1[axis], a2[axis] = mid, mid + 1
        boxes += [(a2, b), (a, b1)]
    return found


def door_plate(bridge, dimension, x, y, z):
    """The pressure plate over a gym's entrance marker near x, y, z, as (x, y, z), or None (scripts/main.js: a plate
    two or three blocks over a cobblemon:gym_marker whose role is entrance)."""
    for m in find_blocks(bridge, dimension, (x - 24, y - 12, z - 24), (x + 24, y + 12, z + 24), "cobblemon:gym_marker"):
        got = bridge.data("mc_block_get", dimension=dimension, location=dict(zip("xyz", m)))
        if "entrance" not in json.dumps(got): continue
        for dy in (2, 3):
            above = bridge.data("mc_block_get", dimension=dimension, location={"x": m[0], "y": m[1] + dy, "z": m[2]})
            if "pressure_plate" in json.dumps(above): return (m[0], m[1] + dy, m[2])
    return None


@step("Tour one of every gym the seed has", blocking=False)
def every_gym(t):
    """One of each of the eight gyms, in the series' order, the way a player follows a seed guide round them: the
    runner teleports to 200 blocks short of each (the seed's gyms are thousands of blocks apart) and the player walks
    the rest, through the door onto its pressure plate, where the gym's trainer should appear. Cinnabar's gym is in
    the Nether and Blackthorn's on the End islands, which this does not walk: the player is put on the plate. The card
    is not checked here; it points at the next leader only, and Brock is not beaten."""
    bridge = t.connect_bridge()
    name = t.data.setdefault("player", bridge.player()["name"])
    sites = seed_gyms(t, dimensions=True)
    check(sites, f"no gyms known for seed {getattr(t.server, 'seed', None)}: screen it first (tools/ftue_seed_screen.py --seed N --every)")
    found = []
    only = {w.strip().lower() for w in os.environ.get("FTUE_TOWNS", "").split(",") if w.strip()}   # "saffron,fuchsia": just those
    for trainer, town in GYM_TOWNS.items():
        if only and town.lower() not in only: continue
        here = [s for s in sites if s[0] == trainer]
        if not here:
            found.append(f"{town} none in the screen")
            continue
        # alive and back in play first: a teleport sent at the death screen goes nowhere
        if in_world(t): t.note("died between gyms; respawned at the world spawn")
        # a teleport can land in the air over ground not yet generated ("fell from a high place" lost the run its
        # hotbar) or in the sea (it drowned short of Cerulean), and the Nether has lava: the runner's own safety, not
        # the player's play
        for effect in ("slow_falling", "resistance", "fire_resistance", "water_breathing"):
            bridge.command(f"effect {name} {effect} 600 4 true")   # the whole walk: 30 s ran out in the sea short of Fuchsia
        p = bridge.player(name)
        at, dim = p["location"], p.get("dimension", "overworld").split(":")[-1]
        _, gdim, gx, gy, gz = min(here, key=lambda s: (s[1] != dim, math.hypot(s[2] - at["x"], s[4] - at["z"])))
        t.say(f"Touring {town} Gym at {gx}, {gz}{ {'nether': ' in the Nether', 'the_end': ' in the End'}.get(gdim, '')}")
        plate = None
        if gdim == "overworld":
            ax, az = (at["x"], at["z"]) if dim == "overworld" else (0, 0)
            d = math.hypot(gx - ax, gz - az)
            k = max(0.0, (d - 200) / d) if d else 0.0
            sx, sz = ax + (gx - ax) * k, az + (gz - az) * k
            if dim != "overworld": bridge.command(f"execute in overworld run tp {name} {sx:.1f} 200 {sz:.1f}")
            bridge.command(f"spreadplayers {sx:.1f} {sz:.1f} 0 1 {name}")
            time.sleep(6)
            # toward the building until its ground is loaded, then to its door, as a player heads for the way in:
            # the trainer's spot inside is no goal to walk at (Saffron's lies across a river from its door)
            _, left = walk_legs(t, (gx, gy, gz), leg=90, within=40, budget=60 * 6)
            plate = door_plate(bridge, gdim, gx, gy, gz) if left is not None and left <= 40 else None
            if plate: _, left = walk_legs(t, (plate[0] + 0.5, plate[1], plate[2] + 0.5), leg=90, within=4, budget=60 * 6)
            else:
                _, left = walk_legs(t, (gx, gy, gz), leg=90, within=10, budget=60 * 4)
                # the first walk ended over 40 blocks off, so the plate was never looked for, and the walk dug into
                # Cerulean's and Celadon's halls past the doors their plates stood in: look now, and go to it
                plate = door_plate(bridge, gdim, gx, gy, gz)
                if plate: _, left = walk_legs(t, (plate[0] + 0.5, plate[1], plate[2] + 0.5), leg=90, within=4, budget=60 * 3)
            if plate and left is not None and left <= 4:
                # onto the plate itself (go counts half a block over within as there); and if no trainer comes, the
                # runner puts the player square on it, so the report tells a missed step from a gym that does nothing
                left = navigator(t).go((plate[0] + 0.5, plate[1], plate[2] + 0.5), within=0.3, timeout=60)
                # the plate goes once it has fired (scripts/main.js), which says the step landed better than a trainer
                # looked for at once
                fired = False
                for _ in range(8):
                    got = bridge.data("mc_block_get", dimension=gdim, location=dict(zip("xyz", plate)))
                    if "pressure_plate" not in json.dumps(got): fired = True; break
                    time.sleep(1)
                if fired: t.note(f"{town}: walked onto the door plate")
                else:
                    t.note(f"{town}: the door plate had not fired after walking to it ({left if left is None else round(left, 1)} blocks off); put on it")
                    bridge.command(f"tp {name} {plate[0] + 0.5} {plate[1]} {plate[2] + 0.5}")
                time.sleep(2)
            elif plate:
                # the door found but no way walked to it: the gym itself is still checked from its plate
                t.finding(f"{town} Gym at {gx}, {gz}: the player could not walk to its door ({left if left is None else round(left)} blocks short); put on the plate.")
                bridge.command(f"tp {name} {plate[0] + 0.5} {plate[1]} {plate[2] + 0.5}")
                time.sleep(2)
        else:
            # into the building first, so its ground is loaded to look for the plate, then onto the plate
            bridge.command(f"execute in {gdim} run tp {name} {gx + 0.5} {gy + 1} {gz + 0.5}")
            time.sleep(5)
            plate = door_plate(bridge, gdim, gx, gy, gz)
            if plate: bridge.command(f"execute in {gdim} run tp {name} {plate[0] + 0.5} {plate[1]} {plate[2] + 0.5}")
        time.sleep(4)
        p = bridge.player(name)
        at = p["location"]
        reached = p.get("dimension", "").endswith(gdim) and gym_block_near(bridge, at, dimension=gdim)
        # the trainer is called to its spot, so give it a while: Sabrina was out at Saffron's after the run had looked
        for _ in range(5):
            trainers = bridge.entities(type="cobblemon:rct_trainer", dimension=gdim, location={"x": gx, "y": gy, "z": gz}, max_distance=32)
            if trainers or not reached: break
            time.sleep(3)
        t.client.shot(f"gym_{town.lower()}")
        if not reached:
            found.append(f"{town} not reached ({math.hypot(gx - at['x'], gz - at['z']):.0f} blocks short)")
            continue
        # a plate goes once it has fired, so a gym whose trainer is already out (the arrow walk fired Pewter's) has none
        missing = [what for what, ok in (("no door plate", plate or trainers), ("no trainer after the door plate", trainers)) if not ok]
        if missing and p.get("water") is True:
            missing.append("the doorway is under water")   # run 7: Cerulean's gym generated in the sea
        if missing: t.finding(f"{town} Gym at {gx}, {gy}, {gz} ({gdim}): {', '.join(missing)}.")
        found.append(f"{town} {'trainer out' if trainers else 'reached'}{' (' + ', '.join(missing) + ')' if missing else ''}")
    return "; ".join(found)


STEPS = [download, install, create_world, starter_screen, pick_starter, no_tm_message,
         server_world, join_server, server_starter, send_out, first_battle,
         card_craft, card_at_spawn, start_series, seek_gym, follow_arrow, every_gym]


def cleanup(t):
    """Put the development junctions back, remove the imported packs, and point the server back at its world. The
    worlds stay for a look afterwards."""
    if t.data.get("packs"):
        t.store.restore({p[0] for p in t.data["packs"]})
    if t.data.get("server_world"):
        t.server.restore()
