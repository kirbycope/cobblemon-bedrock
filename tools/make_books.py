"""The two books signed by Kirbycope that a player's first join puts in the hotbar (scripts/main.js, giveBooks):
README, every control, and Getting Started, a first-steps guide. Writes loot_tables/readme_book.json and
getting_started_book.json. The headings' icons are the characters U+E700 to U+E709 from font/glyph_E7.png
(port.py, create_book_glyphs). A page holds about 13 lines of 23 characters; a page that would not fit is reported.

    python tools/make_books.py
"""
import json, os, re, textwrap
BALL, DEX, ROD, POTION, APRICORN, CANDY, BATTLE, TRADE, RIDE, HELD = (chr(0xE700 + n) for n in range(10))
H = lambda icon, text: f"{icon} §4§l{text}§r"
def rainbow(text):
    cols = "c6eab9d"; out, i = "", 0
    for ch in text:
        if ch == " ": out += ch; continue
        out += f"§{cols[i % len(cols)]}{ch}"; i += 1
    return out
README = [
    f"§l{rainbow('Cobblemon')}§r\n§lBedrock Edition§r\n\n{BALL} §1Controls§r {BALL}\n\nEvery control in one place. New here? Read the Getting Started book next to this one first.",
    H(BALL, "Party") + "\n\nThe Party item (hotbar slot 3) holds your Poke Balls.\n\nUse it to send out the selected Pokemon, and again to call it back.\n\nSneak and use it to select the next one.",
    H(BATTLE, "Battling") + "\n\nUse the Party item on a wild Pokemon, or use one with an empty hand, to battle it.\n\nPick Fight, Switch, Catch or Run.\n\nClosing the battle screen minimises it. Sneak to bring it back.",
    H(BALL, "Catching") + "\n\nChoose Catch, then throw a Poke Ball at the wild Pokemon.\n\nWeaken it and put it to sleep or paralyse it first for a better chance.\n\nA ball in hand is always thrown.",
    H(POTION, "Medicine") + "\n\nUse a Potion, Revive or status cure on your own Pokemon to heal it.\n\nIn battle, minimise the battle screen, then use the medicine on the Pokemon fighting. It takes your turn.",
    H(HELD, "Your Pokemon") + "\n\nSneak and use one of your Pokemon for its wheel: Summary, held item, cosmetic item, Ride, Shoulder, Stay and Follow.\n\nSneak twice to reopen the last Summary.",
    H(CANDY, "Items on Pokemon") + "\n\nUse these on your own Pokemon:\nHeld items and berries to give them.\nEvolution stones to evolve.\nTMs to teach a move.\nCandies to gain levels.",
    H(RIDE, "Riding") + "\n\nUse a rideable Pokemon to get on. Sneak to get off.\n\nOn land, W walks, double-tap W sprints and holding jump jumps.\n\nThe bar over your hotbar is stamina.",
    H(RIDE, "Flying") + "\n\nA flying Pokemon goes where you look.\n\nHold jump to climb. Look down while moving forward to dive and land.\n\nWhen its stamina runs out it falls until it lands.",
    H(TRADE, "Other Players") + "\n\nSneak and use another player for their wheel.\n\nBattle (top) sends a challenge.\nTrade (top right) sends a trade request.\n\nThey answer from their own wheel on you.",
    H(DEX, "Pokedex") + "\n\nTap use to open your Pokedex.\n\nHold use to open the scanner. Keep a Pokemon in its sights to scan it.\n\nWhile scanning, jump zooms in and sneak zooms out.",
    H(ROD, "Fishing") + "\n\nUse a Poke Rod to cast into water.\n\nWhen the bobber splashes, use it again quickly to reel in a Pokemon or an item.\n\nMake rods at a smithing table.",
    H(DEX, "PC and Pasture") + "\n\nUse a PC to see your boxes. Choose a Pokemon, then the slot to move it to.\n\nUse a Pasture, choose a boxed Pokemon, then a row to let it roam there.",
    H(POTION, "Machines") + "\n\nHealing Machine: use it to heal your party.\n\nTM Machine: pick a TM, then Start. It takes a Blank TM and the recipe items.",
    H(CANDY, "Cooking") + "\n\nUse a Campfire Pot on a lit campfire, then use the campfire to open it.\n\nFill the grid with a recipe, add seasonings, and press the lid button to cook.",
    H(APRICORN, "Berries, Apricorns") + "\n\nPlant a berry on grass or dirt. Use a ripe bush to pick its berries.\n\nUse a ripe apricorn to pick it. Plant an Apricorn Sprout to grow a tree. Bone meal helps.",
    H(HELD, "Fossils") + "\n\nUse a fossil on a Fossil Analyzer beside a Restoration Tank.\n\nFeed the tank berries, wheat or bread. When it is done, use a Poke Ball on it to take your Pokemon.",
]
GUIDE = [
    f"§l{rainbow('Getting Started')}§r\n\n{BALL} {BALL} {BALL}\n\nYour first steps as a Trainer, one page at a time.\n\nThe README book next to this one has every control.",
    H(BALL, "1. Your Starter") + "\n\nThe Starter screen opens when you first join. Pick a region, then your partner.\n\nIf you close it, sneak twice to open it again.",
    H(HELD, "2. Your Party") + "\n\nUp to six Pokemon travel with you in their balls, shown down the left of your screen.\n\nUse the Party item to send out the selected one. Sneak and use it to pick another.",
    H(BATTLE, "3. First Battle") + "\n\nLook at a wild Pokemon and use the Party item.\n\nWinning earns experience. Pokemon level up, learn new moves and can evolve.",
    H(APRICORN, "4. Poke Balls") + f"\n\nCraft 4 {BALL} Poke Balls from 4 Red Apricorns around a Copper Ingot.\n\nApricorns grow on apricorn trees in the wild.",
    H(BALL, "5. Catching") + "\n\nWeaken a wild Pokemon, choose Catch, and throw a ball at it.\n\nThe ball shakes up to three times. If it stays shut, the Pokemon is yours.",
    H(POTION, "6. Healing") + "\n\nA fainted Pokemon wakes after 5 minutes with a little health. A bed heals half.\n\nA Healing Machine heals fully. Craft one from copper, iron, redstone and a Max Revive.",
    H(DEX, "7. Storage") + "\n\nOnly six travel with you. A PC keeps the rest. Craft one from iron, glass, copper and smooth stone.\n\nA Pasture lets them roam at home.",
    H(DEX, "8. Pokedex") + "\n\nCraft a Pokedex from an apricorn, copper, iron and glowstone or redstone.\n\nScan Pokemon to learn about them and fill your register.",
    f"§l{rainbow('Good luck!')}§r\n\n{BALL} {BALL} {BALL}\n\nGo catch them all.\n\n§o- Kirbycope§r",
]
def lines(page):
    n = 0
    for para in re.sub("§.", "", page).split("\n"):
        n += max(1, len(textwrap.wrap(para, 23)))
    return n
for name, pages in (("README", README), ("GUIDE", GUIDE)):
    for i, p in enumerate(pages):
        if lines(p) > 13: print(name, i + 1, lines(p), "TOO LONG")
# a book's title is cut at 16 characters, colour codes included, so it stays plain and the rainbow goes in the item's name
def book(title, pages):
    return {"pools": [{"rolls": 1, "entries": [{"type": "item", "name": "minecraft:written_book", "functions": [
        {"function": "set_book_contents", "author": "Kirbycope", "title": title, "pages": pages},
        {"function": "set_name", "name": "§l" + rainbow(title) + "§r"}]}]}]}
L = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "development_behavior_packs", "cobblemon", "loot_tables")
open(f"{L}/readme_book.json", "w", encoding="utf-8", newline="\n").write(json.dumps(book("README", README), indent=4) + "\n")
open(f"{L}/getting_started_book.json", "w", encoding="utf-8", newline="\n").write(json.dumps(book("Getting Started", GUIDE), indent=4) + "\n")
print(len(README), len(GUIDE))
