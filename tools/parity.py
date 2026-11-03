"""PARITY.csv: everything Cobblemon has, where it comes from, whether the port carries it, and why not.

    python tools/parity.py            # writes PARITY.csv at the repository root and prints the counts

Each row is one thing Cobblemon has, enumerated from Cobblemon's own source rather than from memory or the wiki, so a
gap cannot hide by never having been thought of:

  item, block, entity      lang en_us.json's item.cobblemon.*, block.cobblemon.*, entity.cobblemon.* keys
  sound                    assets/cobblemon/sounds.json's events
  species                  data/cobblemon/species
  move, ability, held item Showdown's data/moves.js, abilities.js and items.js inside data/cobblemon/showdown.zip
  screen                   the Kotlin classes under client/gui
  command                  the Kotlin classes under command/
  keybind                  client/keybind/keybinds
  data                     the folders under data/cobblemon, and the mechanics files
  config                   CobblemonConfig's fields
  README                   each "Not carried" note in the README's port table

The status column is done, partial, missing or n/a. How each is decided is in that section's function; where a check
is a heuristic (a Showdown move whose effect lives in code counts as done when the battle script names it), the
comment says so. Rows are sorted by area, then status (missing first), then name.
"""
import csv, glob, json, os, re, sys, zipfile
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAVA = f"{REPO}/java/common/src/main"
RES = f"{JAVA}/resources"
KT = f"{JAVA}/kotlin/com/cobblemon/mod/common"
BP = f"{REPO}/development_behavior_packs/cobblemon"
RP = f"{REPO}/development_resource_packs/cobblemon"
SCRIPTS = f"{BP}/scripts"
rows = []


def row(area, feature, source, port, status, comment=""):
    rows.append({"area": area, "feature": feature, "cobblemon_source": source, "port": port, "status": status, "comment": comment})


def read(path):
    with open(path, encoding="utf-8", errors="replace") as file: return file.read()


def identifiers(folder, key):
    """Every identifier the pack defines under a folder (items, blocks, entities)."""
    found = set()
    for path in glob.glob(f"{folder}/**/*.json", recursive=True):
        try: data = json.loads(read(path))
        except ValueError: continue
        body = data.get(key) or {}
        ident = (body.get("description") or {}).get("identifier")
        if ident: found.add(ident)
    return found


lang = json.loads(read(f"{RES}/assets/cobblemon/lang/en_us.json"))
port_items = identifiers(f"{BP}/items", "minecraft:item")
port_blocks = identifiers(f"{BP}/blocks", "minecraft:block")
port_entities = identifiers(f"{BP}/entities", "minecraft:entity")
# the port's own words: its generator, its scripts (the generated data tables left out) and its README, searched for
# Cobblemon's class and file names, which the port names wherever it carries one
DATA_SCRIPTS = {"data.js", "fishing.js", "herds.js", "dex.js", "tms.js", "pot.js", "move_fx.js", "variants.js", "dex_evolution.js",
                "chest_loot.js", "fossil_loot.js", "rct_trainers.js", "npc_dialogue.js", "items.js", "cosmetics.js", "features.js"}
battle_js = "\n".join(read(p) for p in glob.glob(f"{SCRIPTS}/*.js") if os.path.basename(p) not in DATA_SCRIPTS)
# the lists of abilities other abilities cannot take or stop name abilities without making them act
battle_js = re.sub(r"^const (CANT_SUPPRESS|NO_SWAP|NO_TRACE) = new Set\(\[[^\]]*\]\);", "", battle_js, flags=re.M)
corpus = read(f"{REPO}/port.py") + battle_js + read(f"{REPO}/README.md") + "".join(read(p) for p in glob.glob(f"{REPO}/tools/*.py"))
readme = read(f"{REPO}/README.md")


def named(word):
    """Where the port names a Cobblemon class or file: port.py, the scripts, the README."""
    places = [name for name, text in (("port.py", read(f"{REPO}/port.py")), ("scripts", battle_js), ("README", readme)) if re.search(rf"\b{re.escape(word)}\b", text)]
    return places


# ---------------------------------------------------------------------------- items, blocks, entities
def lang_ids(prefix):
    out = {}
    for key, value in lang.items():
        if not key.startswith(prefix): continue
        rest = key[len(prefix):]
        if "." in rest: continue   # .desc, .tooltip and the like
        out[rest] = value
    return out


# Cobblemon's item classes that do nothing but sit in the inventory (materials, held items, whose effect is in battle)
INERT_CLASSES = {"CobblemonItem", "noSettingsItem", "itemWithRarity", "heldItem", "Item", "object", "SmithingTemplateItem"}
BASIC_COMPONENTS = {"minecraft:icon", "minecraft:display_name", "minecraft:max_stack_size", "minecraft:tags", "minecraft:hand_equipped", "minecraft:rarity"}
all_scripts = "\n".join(read(p) for p in glob.glob(f"{SCRIPTS}/*.js"))


def item_classes():
    """Each item Cobblemon registers by name, and the class or helper it is made with (CobblemonItems.kt)."""
    text = read(f"{KT}/CobblemonItems.kt")
    found = {}
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)   # what Cobblemon has commented out is not registered
    for name, cls in re.findall(r'create\(\s*"(\w+)",\s*(\w+)', text): found[name] = cls
    for cls, name in re.findall(r'(blockItem|itemNameBlockItem|noSettingsItem|itemWithRarity|mulchItem|candyItem|wearableItem|wearableBlockItem|heldItem|berryItem|aprijuiceItem|pokepuffItem|regionalFoodItem|foodItem)\(\s*"(\w+)"', text):
        found.setdefault(name, cls)
    return found


def port_item_components():
    out = {}
    for path in glob.glob(f"{BP}/items/**/*.json", recursive=True):
        try: data = json.loads(read(path))["minecraft:item"]
        except (ValueError, KeyError): continue
        out[data["description"]["identifier"]] = set(data.get("components", {}))
    return out


def items_blocks_entities():
    items, blocks = lang_ids("item.cobblemon."), lang_ids("block.cobblemon.")
    # every block Cobblemon has a blockstate for, named or not (the potted berries borrow their berry's name)
    lang_blocks, blocks_kt = set(blocks), read(f"{KT}/CobblemonBlocks.kt")
    for path in glob.glob(f"{RES}/assets/cobblemon/blockstates/*.json"):
        name = os.path.basename(path)[:-5]
        blocks.setdefault(name, name.replace("_", " ").title())
    classes, components = item_classes(), port_item_components()
    kotlin = read(f"{KT}/CobblemonItems.kt") + "".join(read(p) for p in glob.glob(f"{KT}/item/**/*.kt", recursive=True))
    for name, label in sorted(items.items()):
        ident = f"cobblemon:{name}"
        cls = classes.get(name, "")
        if re.search(rf"^\s*//.*{name}", read(f"{KT}/CobblemonItems.kt"), re.M) and name not in classes:
            row("item", label, f"item.cobblemon.{name}", ident if ident in port_items else "", "n/a", "commented out of CobblemonItems; not in Cobblemon 1.8"); continue
        if f'"item.cobblemon.{name}"' in kotlin and name not in classes and ident not in port_items:
            row("item", label, f"item.cobblemon.{name}", "", "n/a", "a name Cobblemon gives another item, not an item of its own (see its comment in the port)"); continue
        if ident in port_items:
            # the hand-written scripts, not the generated tables, which name every item
            acts = (components.get(ident, set()) - BASIC_COMPONENTS) or re.search(rf"[\"'`]{re.escape(ident)}[\"'`]|\b{name}\b", battle_js)
            if cls and cls not in INERT_CLASSES and not acts:
                row("item", label, f"item.cobblemon.{name} ({cls})", ident, "partial", f"Cobblemon makes it a {cls}; here it is only an icon and a name, and no script names it")
            else: row("item", label, f"item.cobblemon.{name}" + (f" ({cls})" if cls else ""), ident, "done")
        elif ident in port_blocks: row("item", label, f"item.cobblemon.{name}", ident, "done", "a block item here")
        elif re.search(rf"\b{name}\b", corpus): row("item", label, f"item.cobblemon.{name}", "", "partial", "named in the port but no item of that id")
        else: row("item", label, f"item.cobblemon.{name}", "", "missing")
    for name, label in sorted(blocks.items()):
        ident = f"cobblemon:{name}"
        if name not in lang_blocks and f'"{name}"' not in blocks_kt and ident not in port_blocks:
            row("block", label, f"blockstates/{name}.json", "", "n/a", "a blockstate CobblemonBlocks does not register"); continue
        # the port names some blocks apart from their items: a placed medicine is <item>_block, a berry's plant
        # <berry>_bush, a mint's leaf litter the mint itself
        alias = next((a for a in (f"{ident}_block", f"{ident}_bush", ident.replace("_leaf_litter", "")) if a in port_blocks), None)
        if ident in port_blocks: row("block", label, f"block.cobblemon.{name}", ident, "done")
        elif alias: row("block", label, f"block.cobblemon.{name}", alias, "done", "under another identifier here")
        elif ident in port_items: row("block", label, f"block.cobblemon.{name}", ident, "partial", "an item here, not a placeable block")
        else:
            near = [b for b in port_blocks if b.startswith(ident)]
            if near: row("block", label, f"block.cobblemon.{name}", ", ".join(sorted(near)[:3]), "done", "split into several blocks here")
            else: row("block", label, f"block.cobblemon.{name}", "", "missing")
    ENTITIES = {"pokemon": ("cobblemon:p<number>_<name>, one per species", "done", ""),
                "empty_pokeball": ("cobblemon:ball_<ball>, cobblemon:capture_ball", "done", ""),
                "poke_bobber": ("cobblemon:poke_bobber", "done", ""),
                "npc": ("cobblemon:npc_trainer, cobblemon:rct_trainer, cobblemon:nurse and others", "done", "one entity a kind of NPC"),
                "boat": ("", "missing", "the Apricorn Boat item places nothing"),
                "chest_boat": ("", "missing", "the Apricorn Chest Boat item places nothing")}
    for name, label in sorted(lang_ids("entity.cobblemon.").items()):
        port, status, comment = ENTITIES.get(name, ("", "missing", ""))
        row("entity", label, f"entity.cobblemon.{name}", port, status, comment)


# ---------------------------------------------------------------------------- sounds
def sounds():
    events = json.loads(read(f"{RES}/assets/cobblemon/sounds.json"))
    defined = json.loads(read(f"{RP}/sounds/sound_definitions.json")).get("sound_definitions", {})
    used = battle_js + read(f"{RP}/sounds.json") + "".join(read(p) for p in glob.glob(f"{RP}/**/*.json", recursive=True)
                                                           if "sound_definitions" not in p and os.path.getsize(p) < 3_000_000)
    for event in sorted(events):
        if event.startswith("pokemon.") and event.endswith(".cry"): continue   # one row per species, under species
        ident = f"cobblemon.{event}"
        if ident not in defined and event.startswith("pokemon."): ident = f"cobblemon.{event[len('pokemon.'):]}"
        if ident not in defined: row("sound", event, "sounds.json", "", "missing"); continue
        if ident in used or event in used: row("sound", event, "sounds.json", ident, "done")
        else: row("sound", event, "sounds.json", ident, "partial", "defined but nothing plays it")


# ---------------------------------------------------------------------------- species
RESOLVERS = {int(n.split("_")[0]) for n in os.listdir(f"{RES}/assets/cobblemon/bedrock/pokemon/resolvers") if n[:4].isdigit()}
modelled = lambda number: number in RESOLVERS


def species():
    for path in sorted(glob.glob(f"{RES}/data/cobblemon/species/**/*.json", recursive=True)):
        data = json.loads(read(path))
        number, name = data.get("nationalPokedexNumber", 0), data.get("name", "")
        key = re.sub(r"[^a-z0-9]", "", name.lower().replace("♀", "f").replace("♂", "m"))
        match = next((e for e in port_entities if re.match(rf"cobblemon:p{number:04d}_", e)), "")
        src = os.path.relpath(path, RES).replace("\\", "/")
        if match: row("species", f"#{number} {name}", src, match, "done")
        elif not data.get("implemented", True) or not modelled(number): row("species", f"#{number} {name}", src, "", "n/a", "Cobblemon ships no model for it")
        else: row("species", f"#{number} {name}", src, "", "missing")


# ---------------------------------------------------------------------------- moves, abilities, held items
def showdown_entries(file):
    with zipfile.ZipFile(f"{RES}/data/cobblemon/showdown.zip") as archive: text = archive.read(file).decode("utf-8")
    return {m.group(1): m.group(2) for m in re.finditer(r"^  (\w+): \{(.*?)^  \},?", text, re.S | re.M)}


def quoted(word, text):
    return re.search(rf"[\"']{word}[\"']|[{{,]\s*{word}\s*:", text) is not None


# the keys port.py's showdown_moves reads into the move table, which the battle script acts on wherever a move has them
MOVE_KEYS_HANDLED = {"num", "accuracy", "basePower", "category", "name", "pp", "priority", "flags", "target", "type", "contestType",
                     "secondary", "secondaries", "self", "boosts", "status", "drain", "recoil", "ohko", "multihit", "selfSwitch",
                     "forceSwitch", "heal", "sleepUsable", "weather", "terrain", "critRatio", "isNonstandard", "zMove", "maxMove",
                     "desc", "shortDesc", "noPPBoosts", "multiaccuracy"}


def moves():
    learnable = set()
    for path in glob.glob(f"{RES}/data/cobblemon/species/**/*.json", recursive=True):
        data = json.loads(read(path))
        for form in [data] + data.get("forms", []):
            for move in form.get("moves", []): learnable.add(move.split(":")[-1])
    for move_id, body in sorted(showdown_entries("data/moves.js").items()):
        name = (re.search(r'^    name: "([^"]+)"', body, re.M) or [None, move_id])[1]
        if re.search(r"^    isZ:|^    isMax:", body, re.M): row("move", name, "showdown data/moves.js", "", "n/a", "Z-Move or Max Move"); continue
        if re.search(r'^    isNonstandard: "(CAP|LGPE|Custom)"', body, re.M): row("move", name, "showdown data/moves.js", "", "n/a", "nonstandard"); continue
        keys = set(re.findall(r"^    (\w+)[:(]", body, re.M))
        volatile = re.search(r'^    volatileStatus: "(\w+)"', body, re.M)
        if volatile and volatile.group(1) in ("confusion", "partiallytrapped"): keys.discard("volatileStatus")
        # the code behind a field the move table carries is the battle script's (terrain and weather moves' conditions,
        # Outrage's lock-in, a switching move's), so only the rest counts against the move
        carried = re.search(r'^    (terrain|weather|selfSwitch|forceSwitch|multihit|ohko|heal):', body, re.M) or re.search(r'volatileStatus: "lockedmove"', body)
        extra = sorted(k for k in keys - MOVE_KEYS_HANDLED if not (carried and (k == "condition" or k.startswith("on"))))
        note = "" if move_id in learnable else "no species learns it; "
        if not extra: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "done", note + "standard fields only")
        elif quoted(move_id, battle_js): row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "done", note + "its own code, named in the battle script (heuristic): " + ", ".join(extra))
        else: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "partial", note + "deals its damage or plain effect, but its own code is not carried (heuristic): " + ", ".join(extra))


# abilities that only act on an ally, so never in Cobblemon-on-Bedrock's single battles
DOUBLES_ONLY = {"battery", "powerspot", "steelyspirit", "flowerveil", "friendguard", "healer", "telepathy", "symbiosis",
                "powerofalchemy", "receiver", "costar", "commander", "aromaveil", "plus", "minus", "curiousmedicine",
                "hospitality", "propellertail", "stalwart"}

TERA_ONLY = {"embodyaspectcornerstone", "embodyaspecthearthflame", "embodyaspectteal", "embodyaspectwellspring", "terashift",
             "terashell", "teraformzero"}


def abilities():
    owned, battle_only = set(), set()   # battle_only: on a form Cobblemon only shows in battle (Mega, Primal), never reached here
    for path in glob.glob(f"{RES}/data/cobblemon/species/**/*.json", recursive=True):
        data = json.loads(read(path))
        for form in [data] + data.get("forms", []):
            for ability in form.get("abilities", []): (battle_only if form.get("battleOnly") else owned).add(ability.split(":")[-1].lower())
    for ability_id, body in sorted(showdown_entries("data/abilities.js").items()):
        name = (re.search(r'^    name: "([^"]+)"', body, re.M) or [None, ability_id])[1]
        note = "" if ability_id in owned else "no species has it; "
        hooks = sorted(set(re.findall(r"^    (on\w+|\w+Callback)[:(]", body, re.M)))
        if not hooks: row("ability", name, "showdown data/abilities.js", "", "n/a", note + "no battle effect")
        elif ability_id in DOUBLES_ONLY: row("ability", name, "showdown data/abilities.js", "", "n/a", note + "acts only on an ally; battles here are single")
        elif ability_id in TERA_ONLY: row("ability", name, "showdown data/abilities.js", "", "n/a", note + "acts only on a Terastallized Pokemon; there is no Terastallization here")
        elif ability_id not in owned and ability_id in battle_only and not quoted(ability_id, battle_js): row("ability", name, "showdown data/abilities.js", "", "n/a", "only on a battle-only form (Mega, Primal) there is no way to reach")
        elif ability_id not in owned and not quoted(ability_id, battle_js): row("ability", name, "showdown data/abilities.js", "", "n/a", "no species has it")
        elif quoted(ability_id, battle_js): row("ability", name, "showdown data/abilities.js", "battle script", "done", note + "named in the battle script (heuristic)")
        else: row("ability", name, "showdown data/abilities.js", "", "missing", note + "hooks: " + ", ".join(hooks[:6]))


def held_items():
    by_showdown = {k.replace("_", ""): k for k in lang_ids("item.cobblemon.")}
    cobblemon_items = set(by_showdown)
    for item_id, body in sorted(showdown_entries("data/items.js").items()):
        if item_id not in cobblemon_items: continue   # only what Cobblemon has as an item
        name = (re.search(r'^    name: "([^"]+)"', body, re.M) or [None, item_id])[1]
        hooks = sorted(set(re.findall(r"^    (on\w+)[:(]", body, re.M)))
        if not hooks: continue   # no battle effect beyond being held
        cob = by_showdown[item_id]
        # an onEat that does nothing (Pomeg, Razz, Nanab: berries Cobblemon uses outside battle) is no battle effect
        if hooks == ["onEat"] and re.search(r"^    onEat(\(\) \{\s*\}|: false)", body, re.M):
            row("held item", name, "showdown data/items.js", "", "n/a", "no battle effect in Showdown (its onEat does nothing)"); continue
        # the battle script names some held items by a template: a type gem as `${type}_gem`, a terrain seed as
        # `${terrain}_seed`, and some berries by their stem (PORTION_BERRIES' "figy")
        templated = (cob.endswith("_gem") and "_gem`" in battle_js) or (cob.endswith("_seed") and "_seed`" in battle_js)             or (cob.endswith("_berry") and quoted(cob[:-len("_berry")], battle_js))
        if quoted(item_id, battle_js) or quoted(cob, all_scripts) or templated: row("held item", name, "showdown data/items.js", "battle script", "done", "named in the scripts (heuristic)")
        else: row("held item", name, "showdown data/items.js", "", "missing", "hooks: " + ", ".join(hooks[:6]))


# ---------------------------------------------------------------------------- screens, commands, keybinds
HELPER = re.compile(r"(Utils?|Constants|Renderable|Widget|Button|Slot|Entry|Data|State|Style|Icon|List|Scroll\w*|Bar|Tooltip|Handler|Sprite|Animation|Panel|Element)$")


def screens():
    for path in sorted(glob.glob(f"{KT}/client/gui/**/*.kt", recursive=True)):
        cls = os.path.basename(path)[:-3]
        folder = os.path.relpath(os.path.dirname(path), f"{KT}/client/gui").replace("\\", "/")
        if folder.startswith("debug") or "Debug" in cls: row("screen", cls, f"client/gui/{folder}", "", "n/a", "debug only"); continue
        if re.search(r"Editor|EditGUI|Config|Snapshot", cls) or folder.startswith(("behaviour", "config", "habitat", "npc", "snapshots")):
            row("screen", cls, f"client/gui/{folder}", "", "n/a", "a development or settings screen"); continue
        places = named(cls)
        siblings = [os.path.basename(p)[:-3] for p in glob.glob(f"{KT}/client/gui/{folder}/*.kt")]
        carried = [c for c in siblings if c != cls and named(c)]
        if places: row("screen", cls, f"client/gui/{folder}", ", ".join(places), "done", "")
        elif carried: row("screen", cls, f"client/gui/{folder}", "", "partial", f"its screen is carried ({', '.join(carried[:3])} named), this class is not; check what it draws")
        else: row("screen", cls, f"client/gui/{folder}", "", "missing")


KEYBINDS = {"PartySendBinding": ("the Party item", "done"), "UpShiftPartyBinding": ("sneak and use the Party item", "done"),
            "DownShiftPartyBinding": ("sneak and use the Party item", "done"), "SummaryBinding": ("the Party item, sneaking and looking up", "done"),
            "HidePartyBinding": ("", "missing"), "PokeNavigatorBinding": ("", "n/a"), "RidingFreelookBinding": ("", "missing"),
            "DebugKeybindings": ("", "n/a")}


def keybinds():
    for path in sorted(glob.glob(f"{KT}/client/keybind/keybinds/*.kt")):
        cls = os.path.basename(path)[:-3]
        port, status = KEYBINDS.get(cls, ("", "missing"))
        row("keybind", cls, "client/keybind/keybinds", port, status, "Bedrock add-ons cannot add keys" + ("; PokeNavigator is not in Cobblemon's menus" if cls == "PokeNavigatorBinding" else ""))


def commands():
    for path in sorted(glob.glob(f"{KT}/command/*.kt")):
        cls = os.path.basename(path)[:-3]
        if re.match(r"Test|Get|Run|Transform|Change(EyeHeight|ScaleAndSize|WalkSpeed)|BedrockParticle|BehaviourEdit|ApplyPlayerTexture|ReloadShowdown|ClickText|PokemonRestart", cls):
            row("command", cls, "command/", "", "n/a", "a development command"); continue
        row("command", cls, "command/", "", "missing", "the port has test scriptevents, not Cobblemon's commands (custom slash commands are possible in @minecraft/server 2)")


# ---------------------------------------------------------------------------- data, config
def data_folders():
    text = read(f"{REPO}/port.py")
    for path in sorted(glob.glob(f"{RES}/data/cobblemon/*")):
        name = os.path.basename(path)
        if name in ("species",): continue
        used = re.search(rf"[/\"']{re.escape(name)}[/\"']", text) or re.search(rf"\b{re.escape(name)}\b", text)
        row("data", name, f"data/cobblemon/{name}", "port.py" if used else "", "done" if used else "missing")
    for path in sorted(glob.glob(f"{RES}/data/cobblemon/mechanics/*.json")):
        name = os.path.basename(path)[:-5]
        used = re.search(rf"\b{re.escape(name)}\b", corpus)
        row("mechanic", name, f"data/cobblemon/mechanics/{name}.json", "named in the port" if used else "", "done" if used else "missing")


def config():
    text = read(f"{KT}/config/CobblemonConfig.kt")
    for name in sorted(set(re.findall(r"^\s+var (\w+)\s*[:=]", text, re.M))):
        row("config", name, "config/CobblemonConfig.kt", "named in the port" if re.search(rf"\b{name}\b", corpus) else "", "n/a",
            "no config screen; the port runs Cobblemon's default" + ("" if re.search(rf"\b{name}\b", corpus) else " where it carries the feature at all"))


# ---------------------------------------------------------------------------- the README's own notes
def readme_notes():
    for line in readme.splitlines():
        if not line.startswith("| ") or "Not carried" not in line: continue
        cells = [c.strip() for c in line.strip("|").split(" | ")]
        system = re.split(r"[,:`]", cells[0])[0].strip() or cells[0][:40]
        source = cells[-1][:120] if len(cells) > 1 else ""
        for note in re.findall(r"Not carried: ([^|]*?)(?:\.(?:\s|$)|\|)", line):
            row("README note", system, source, "README", "partial", "not carried: " + note.strip())


def main():
    items_blocks_entities(); sounds(); species(); moves(); abilities(); held_items()
    screens(); keybinds(); commands(); data_folders(); config(); readme_notes()
    order = {"missing": 0, "partial": 1, "done": 2, "n/a": 3}
    rows.sort(key=lambda r: (r["area"], order[r["status"]], r["feature"].lower()))
    with open(f"{REPO}/PARITY.csv", "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=["area", "feature", "cobblemon_source", "port", "status", "comment"])
        writer.writeheader(); writer.writerows(rows)
    counts = Counter((r["area"], r["status"]) for r in rows)
    for area in sorted({r["area"] for r in rows}):
        print(f"{area:12} " + "  ".join(f"{s} {counts[(area, s)]}" for s in ("done", "partial", "missing", "n/a") if counts[(area, s)]))
    print(f"{len(rows)} rows in PARITY.csv")


if __name__ == "__main__":
    main()
