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
        if name == "technical_machine":
            row("item", label, f"item.cobblemon.{name} ({cls})", "cobblemon:tm_<move>", "done", "one item a move here (items/tms), each a TechnicalMachineItem in scripts/tms.js and teachTm"); continue
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
        elif name.endswith("_sign"): row("block", label, f"block.cobblemon.{name}", "", "n/a", "a Bedrock custom block cannot hold text, so a sign of its own cannot be written on")
        else:
            near = [b for b in port_blocks if b.startswith(ident)]
            if near: row("block", label, f"block.cobblemon.{name}", ", ".join(sorted(near)[:3]), "done", "split into several blocks here")
            else: row("block", label, f"block.cobblemon.{name}", "", "missing")
    ENTITIES = {"pokemon": ("cobblemon:p<number>_<name>, one per species", "done", ""),
                "empty_pokeball": ("cobblemon:ball_<ball>, cobblemon:capture_ball", "done", ""),
                "poke_bobber": ("cobblemon:poke_bobber", "done", ""),
                "npc": ("cobblemon:npc_trainer, cobblemon:rct_trainer, cobblemon:nurse and others", "done", "one entity a kind of NPC"),
                "boat": ("cobblemon:apricorn_boat, cobblemon:saccharine_boat", "done", "on Bedrock's own boat (runtime_identifier)"),
                "chest_boat": ("cobblemon:apricorn_chest_boat, cobblemon:saccharine_chest_boat", "done", "on Bedrock's own chest boat")}
    for name, label in sorted(lang_ids("entity.cobblemon.").items()):
        port, status, comment = ENTITIES.get(name, ("", "missing", ""))
        row("entity", label, f"entity.cobblemon.{name}", port, status, comment)


# ---------------------------------------------------------------------------- sounds
PORTED = [d for d in os.listdir(f"{RP}/textures/entity") if re.match(r"\d{4}_", d)]


_plays = None
def cobblemon_plays():
    """The sound events Cobblemon actually plays: named in its data and assets (animations, effects, Molang scripts),
    not counting sounds.json and the lang files, or used through a CobblemonSounds constant in its Kotlin."""
    global _plays
    if _plays is not None: return _plays
    events = set(json.loads(read(f"{RES}/assets/cobblemon/sounds.json")))
    text = []
    for path in glob.glob(f"{RES}/**/*", recursive=True):
        if os.path.isdir(path) or "/lang/" in path.replace("\\", "/") or path.endswith("sounds.json") or not path.endswith((".json", ".js", ".molang", ".mcfunction")): continue
        text.append(read(path))
    kotlin = [read(p) for p in glob.glob(f"{KT}/**/*.kt", recursive=True) if not p.endswith("CobblemonSounds.kt")]
    constants = dict(re.findall(r'val (\w+) = this\.create\("([^"]+)"', read(f"{KT}/CobblemonSounds.kt")))
    blob, code = chr(10).join(text), chr(10).join(kotlin)
    _plays = {e for e in events if e in blob or e in code} | {e for c, e in constants.items() if re.search(r"\b" + c + r"\b", code)}
    return _plays


def sounds():
    events = json.loads(read(f"{RES}/assets/cobblemon/sounds.json"))
    defined = json.loads(read(f"{RP}/sounds/sound_definitions.json")).get("sound_definitions", {})
    used = battle_js + read(f"{SCRIPTS}/move_fx.js") + read(f"{RP}/sounds.json") + "".join(read(p) for p in glob.glob(f"{RP}/**/*.json", recursive=True)
                                                           if "sound_definitions" not in p and os.path.getsize(p) < 3_000_000)
    # a sound named by a template the script fills at run time (cobblemon.impact.$type)
    hole = lambda t: re.escape(re.sub(r"\$\{\w+\}|\$[a-z]+", "@@", t)).replace("@@", "[a-z0-9_]+")
    templates = [re.compile(hole(t)) for t in set(re.findall(r"cobblemon\.[a-z0-9_.]*\$(?:\{\w+\}|[a-z]+)[a-z0-9_.${}]*", used))]
    for event in sorted(events):
        if event.startswith("pokemon.") and event.endswith(".cry"): continue   # one row per species, under species
        ident = f"cobblemon.{event}"
        if ident not in defined and event.startswith("pokemon."): ident = f"cobblemon.{event[len('pokemon.'):]}"
        # a species the port does not carry (no model in Cobblemon) has no sounds to carry either
        species = event.split(".")[1] if event.startswith("pokemon.") else None
        if ident not in defined and species and not any(re.sub(r"[^a-z]", "", species) == re.sub(r"[^a-z]", "", f.split("_", 1)[1]) for f in PORTED):
            row("sound", event, "sounds.json", "", "n/a", "a species the port does not carry"); continue
        if ident not in defined: row("sound", event, "sounds.json", "", "missing"); continue
        if ident in used or event in used or any(t.fullmatch(ident) for t in templates): row("sound", event, "sounds.json", ident, "done")
        elif event not in cobblemon_plays(): row("sound", event, "sounds.json", ident, "n/a", "Cobblemon itself never plays it")
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
                     "desc", "shortDesc", "noPPBoosts", "multiaccuracy", "selfBoost", "willCrit", "thawsTarget", "selfdestruct",
                     "hasCrashDamage", "mindBlownRecoil", "overrideDefensiveStat", "overrideOffensiveStat", "overrideOffensivePokemon",
                     "ignoreDefensive", "ignoreEvasion", "ignoreAbility", "breaksProtect", "stealsBoosts"}


# moves whose own code only matters with allies on the field
DOUBLES_MOVES = {"afteryou", "allyswitch", "followme", "helpinghand", "quash", "ragepowder", "spotlight", "aromaticmist", "coaching",
                 "decorate", "holdhands", "instruct", "dragoncheer"}
# moves whose own code changes nothing in a single battle, so the move table's fields are the whole move here
SINGLES_WHOLE = {"dragondarts": "both hits land on the one target in a single battle", "snipeshot": "redirection only exists in doubles",
                 "firepledge": "its combination needs an ally's Pledge", "grasspledge": "its combination needs an ally's Pledge",
                 "waterpledge": "its combination needs an ally's Pledge",
                 "terablast": "it changes type only when Terastallized, and there is no Terastallization here",
                 "steelbeam": "its half-HP cost is the battle script's (mindBlownRecoil, cut its own HP)",
                 "flameburst": "its splash only reaches an ally", "pollenpuff": "it heals only an ally", "round": "doubling needs an ally using it too",
                 "orderup": "its raise needs a Commander Tatsugiri, a doubles pairing", "splash": "it does nothing, as it should (the battle script says so)",
                 "snore": "sleepUsable, failing while awake, in the battle script", "watershuriken": "its 20 power is Ash-Greninja's, a form Battle Bond no longer makes"}


def moves():
    data_js = read(f"{SCRIPTS}/data.js")
    in_table = set(re.findall(r'"(\w+)": \{"name": "[^"]*", "type": "\w+", "power"', data_js))
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
        carried = re.search(r'^    (terrain|weather|selfSwitch|forceSwitch|multihit|ohko|heal|hasCrashDamage):', body, re.M) or re.search(r'volatileStatus: "lockedmove"', body)             or 'addVolatile("trapped"' in body   # Mean Look, Block and the rest: the move table's trap
        extra = sorted(k for k in keys - MOVE_KEYS_HANDLED if not (carried and (k == "condition" or k.startswith("on"))))
        note = "" if move_id in learnable else "no species learns it; "
        if move_id in DOUBLES_MOVES: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "n/a", note + "acts on an ally or on targeting, which single battles do not have"); continue
        if move_id in SINGLES_WHOLE: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "done", note + SINGLES_WHOLE[move_id]); continue
        if move_id not in in_table:
            row("move", name, "showdown data/moves.js", "", "n/a", "no species the port carries learns it, so it is not in the move table"); continue
        if not extra: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "done", note + "standard fields only")
        elif quoted(move_id, battle_js): row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "done", note + "its own code, named in the battle script (heuristic): " + ", ".join(extra))
        else: row("move", name, "showdown data/moves.js", f"MOVES.{move_id}", "partial", note + "deals its damage or plain effect, but its own code is not carried (heuristic): " + ", ".join(extra))


# abilities that only act on an ally, so never in Cobblemon-on-Bedrock's single battles
DOUBLES_ONLY = {"battery", "powerspot", "steelyspirit", "flowerveil", "friendguard", "healer", "telepathy", "symbiosis",
                "powerofalchemy", "receiver", "costar", "commander", "aromaveil", "plus", "minus", "curiousmedicine",
                "hospitality", "propellertail", "stalwart"}

# a battle here is between real entities in the world, so one Pokemon cannot pass as another
NO_ILLUSION = {"illusion": "the Pokemon in battle are real entities in the world, so Zoroark cannot be shown as another"}
TERA_ONLY = {"embodyaspectcornerstone", "embodyaspecthearthflame", "embodyaspectteal", "embodyaspectwellspring", "terashift",
             "terashell", "teraformzero"}


def abilities():
    owned, battle_only = set(), set()   # battle_only: on a form Cobblemon only shows in battle (Mega, Primal), never reached here
    in_port = set(re.findall(r'"cobblemon:p\d{4}_(\w+)"', read(f"{SCRIPTS}/data.js")))
    absent = set()   # on species the port does not carry
    for path in glob.glob(f"{RES}/data/cobblemon/species/**/*.json", recursive=True):
        data = json.loads(read(path))
        if os.path.basename(path)[:-5] not in in_port:
            for form in [data] + data.get("forms", []): absent.update(a.split(":")[-1].lower() for a in form.get("abilities", []))
            continue
        for form in [data] + data.get("forms", []):
            for ability in form.get("abilities", []): (battle_only if form.get("battleOnly") else owned).add(ability.split(":")[-1].lower())
    for ability_id, body in sorted(showdown_entries("data/abilities.js").items()):
        name = (re.search(r'^    name: "([^"]+)"', body, re.M) or [None, ability_id])[1]
        note = "" if ability_id in owned else "no species has it; "
        hooks = sorted(set(re.findall(r"^    (on\w+|\w+Callback)[:(]", body, re.M)))
        if not hooks: row("ability", name, "showdown data/abilities.js", "", "n/a", note + "no battle effect")
        elif ability_id in DOUBLES_ONLY: row("ability", name, "showdown data/abilities.js", "", "n/a", note + "acts only on an ally; battles here are single")
        elif ability_id in NO_ILLUSION: row("ability", name, "showdown data/abilities.js", "", "n/a", NO_ILLUSION[ability_id])
        elif ability_id not in owned and ability_id in absent and not quoted(ability_id, battle_js): row("ability", name, "showdown data/abilities.js", "", "n/a", "only on species the port does not carry (see the species rows)")
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


# screen classes judged one by one: the parts of carried screens they do not draw, and screens Cobblemon itself leaves out
SCREEN_VERDICTS = {
    ("ModelWidget", "summary"): ("partial", "a still portrait stands in for the posed model"),
    ("ModelWidget", "trade"): ("partial", "the trade's portraits are the rendered icons, not models"),
    "StarterRoundabout": ("partial", "the starter screen shows a still portrait, not the rotating model"),
    "GrabbedStorageSlot": ("partial", "the PC moves a Pokemon by picking it and its new slot, not by dragging"),
    "DialogueTextInputWidget": ("n/a", "dialogues here are Bedrock's own NPC dialogues, which take no typed answer"),
    "DialogueTimerWidget": ("n/a", "dialogues here are Bedrock's own NPC dialogues, which have no timer"),
    "BattleGimmickButton": ("n/a", "for Mega Evolution, Z-Moves, Dynamax and Terastallization, none of which battles here have"),
    "BattleTargetSelection": ("n/a", "choosing a target is for double and triple battles"),
    "BattleShiftButton": ("n/a", "shifting is for triple battles"),
    "PokeNav": ("n/a", "Cobblemon leaves the PokeNav out of its menus"),
    "PokeNavFillerButton": ("n/a", "Cobblemon leaves the PokeNav out of its menus"),
    "PokeNavImageButton": ("n/a", "Cobblemon leaves the PokeNav out of its menus"),
    "PartyTutorialToasts": ("n/a", "tutorials for the party keys, which a Bedrock pack cannot add"),
    "SummaryTab": ("done", "the Summary's Info, Moves, Stats and Other tabs"),
    "TypeWidget": ("done", "the Summary's type icons"), "SingleTypeWidget": ("done", "the Summary's type icons"),
    "DualTypeWidget": ("done", "the Summary's type icons"), "MarkIcon": ("done", "the marks' icons in the Summary"),
    ("ArrowButton", "startselection"): ("done", "the starter screen's arrows"),
}


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
        elif (cls, folder.split("/")[0]) in SCREEN_VERDICTS or cls in SCREEN_VERDICTS:
            status, comment = SCREEN_VERDICTS.get((cls, folder.split("/")[0])) or SCREEN_VERDICTS[cls]
            row("screen", cls, f"client/gui/{folder}", "", status, comment)
        elif carried: row("screen", cls, f"client/gui/{folder}", "", "done", f"a part of the carried screen ({', '.join(carried[:3])}), drawn by it")
        else: row("screen", cls, f"client/gui/{folder}", "", "missing")


KEYBINDS = {"PartySendBinding": ("the Party item", "done"), "UpShiftPartyBinding": ("sneak and use the Party item", "done"),
            "DownShiftPartyBinding": ("sneak and use the Party item", "done"), "SummaryBinding": ("the Party item, sneaking and looking up", "done"),
            "HidePartyBinding": ("/cobblemon:hideparty", "done"), "PokeNavigatorBinding": ("", "n/a"), "RidingFreelookBinding": ("", "n/a"),
            "DebugKeybindings": ("", "n/a")}


def keybinds():
    for path in sorted(glob.glob(f"{KT}/client/keybind/keybinds/*.kt")):
        cls = os.path.basename(path)[:-3]
        port, status = KEYBINDS.get(cls, ("", "missing"))
        row("keybind", cls, "client/keybind/keybinds", port, status, "Bedrock add-ons cannot add keys" + {"PokeNavigatorBinding": "; PokeNavigator is not in Cobblemon's menus",
            "HidePartyBinding": "; a command toggles the overlay instead", "RidingFreelookBinding": "; the camera while riding is Bedrock's own"}.get(cls, ""))


# commands whose Cobblemon systems are not this port's
COMMAND_NA = {"AbandonMultiTeam": "multi battles (teams of players) are not carried",
              "ChangePCBoxesCommand": "the PC here has a fixed 40 boxes (CobblemonConfig.defaultBoxCount), not a count per player",
              "CheckSpawnsCommand": "wild spawning here is Bedrock's own spawn rules, which a script cannot list",
              "SpawnPokemonFromPool": "wild spawning here is Bedrock's own spawn rules, which a script cannot draw from",
              "CobblemonConfigCommand": "Cobblemon's config file is not carried (see the config rows)",
              "NPCEditCommand": "NPC classes and the NPC editor are not carried; the NPCs here are entities of their own",
              "NPCDeleteCommand": "NPC classes and the NPC editor are not carried; /kill removes an NPC entity",
              "SpawnNPCCommand": "NPC classes are not carried; /summon makes the NPC entities here",
              "OpenDialogueCommand": "dialogues here are Bedrock's own NPC dialogues, opened with /dialogue open"}


def commands():
    for path in sorted(glob.glob(f"{KT}/command/*.kt")):
        cls = os.path.basename(path)[:-3]
        if re.match(r"Test|Get|Run|Transform|Change(EyeHeight|ScaleAndSize|WalkSpeed)|BedrockParticle|BehaviourEdit|ApplyPlayerTexture|ReloadShowdown|ClickText", cls):
            row("command", cls, "command/", "", "n/a", "a development command"); continue
        if cls in COMMAND_NA: row("command", cls, "command/", "", "n/a", COMMAND_NA[cls]); continue
        literals = [n.lower() for n in re.findall(r'(?:literal\(|NAME = )"([A-Za-z_]+)"', read(path))]
        # registerCommands' add("name", ...), or add(["name", "alias"], ...) with Cobblemon's aliases (main.js and rules.js)
        names = [n for n in literals if re.search(rf'add\((?:"{n}"|\[[^\]]*"{n}"[^\]]*\])', battle_js)]
        if names: row("command", cls, "command/", ", ".join(f"/cobblemon:{n}" for n in names), "done", "a Bedrock custom command")
        else: row("command", cls, "command/", "", "missing", "")


# ---------------------------------------------------------------------------- data, config
# data folders the port answers without reading them: carried in the scripts, or for things a Bedrock add-on has not
DATA_VERDICTS = {
    "arts_and_crafts": ("", "n/a", "loads only with the Arts and Crafts mod"),
    "hourglass_dusts": ("", "n/a", "loads only with the Supplementaries mod"),
    "moonlight": ("", "n/a", "loads only with the Moonlight library mod"),
    "painting_variant": ("", "n/a", "a Bedrock add-on cannot add paintings"),
    "trim_pattern": ("", "n/a", "a Bedrock add-on cannot add armour trim patterns"),
    "dex_additions": ("", "n/a", "holds only a README, for other data packs"),
    "dex_entry_additions": ("", "n/a", "holds only a README, for other data packs"),
    "showdown.json": ("", "n/a", "the Showdown version Cobblemon bundles; the battle script stands in for Showdown"),
    "molang": ("", "n/a", "NPC and behaviour scripts for Cobblemon's behaviour system, which the entities here do in their own components"),
    "bag_items": ("scripts/main.js useBagItem", "done", "the medicine, X items, Dire Hit and Guard Spec act in battle by the script"),
    "held_items": ("scripts/main.js heldBerry", "done", "the Eggant Berry, Cobblemon's one held item script"),
    "callbacks": ("scripts/main.js", "done", "Burmy's cloak, alpha drops, marks, the partner mark, wallpaper unlocks and removed aspects; NPC battle-end scripts need Cobblemon's NPC classes, not carried"),
    "moveset_builders": ("scripts/main.js movesAt, alphaMoves", "done", "wild Pokemon their last level-up moves with one damaging, alphas their strongest damaging moves"),
    "move_weights.json": ("scripts/main.js alphaMoves", "done", "the alpha builder picks by power here, so Focus Blast's and Tera Blast's weights need no table"),
    "habitat_pools": ("port.py create_habitat_pools, scripts/habitats.js", "done", "the Habitat Block spawns from one, chosen and set in a form standing in for its editor"),
}


def data_folders():
    text = read(f"{REPO}/port.py")
    for path in sorted(glob.glob(f"{RES}/data/cobblemon/*")):
        name = os.path.basename(path)
        if name in ("species",): continue
        if name in DATA_VERDICTS: row("data", name, f"data/cobblemon/{name}", *DATA_VERDICTS[name]); continue
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
