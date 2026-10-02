"""Download the battle music Cobblemon leaves empty.

Cobblemon declares battle.pvw.default (against a wild Pokemon), battle.pvn.default (against an NPC trainer) and
battle.pvp.default (against another player) with no sounds, for a resource pack to fill. This fetches Pokemon
Showdown's battle themes (https://play.pokemonshowdown.com/audio/) into the resource pack's sounds/battle/ folder,
which is git-ignored: the tracks are the games' own music and stay out of the repository, as the Cobblemon source
does. port.py (create_sounds) registers whatever is there under the three events, and scripts/main.js plays one at
random for the length of a battle.

    python tools/fetch_battle_music.py
"""
import os
import urllib.request

SOURCE = "https://play.pokemonshowdown.com/audio"
# the battle each track plays for; Showdown has no wild battle themes, so a wild battle uses the trainer themes
TRACKS = {
    "pvn": ["bw-trainer", "bw-subway-trainer", "dpp-trainer", "hgss-johto-trainer", "hgss-kanto-trainer", "oras-trainer",
            "sm-trainer", "xy-trainer"],
    "pvp": ["bw-rival", "bw2-rival", "dpp-rival", "oras-rival", "sm-rival", "xy-rival", "bw2-kanto-gym-leader",
            "bw2-homika-dogars", "colosseum-miror-b", "xd-miror-b", "spl-elite4"],
}
TRACKS["pvw"] = TRACKS["pvn"]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "development_resource_packs", "cobblemon", "sounds", "battle")


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in sorted({t for tracks in TRACKS.values() for t in tracks}):
        path = os.path.join(OUT, f"{name}.ogg")
        if os.path.exists(path):
            continue
        print("fetching", name)
        # the server refuses Python's own user agent
        request = urllib.request.Request(f"{SOURCE}/{name}.ogg", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request) as response, open(path, "wb") as file:
            file.write(response.read())
    print(f"{len(os.listdir(OUT))} tracks in {OUT}")


if __name__ == "__main__":
    main()
