# Radical Cobblemon Trainers: the gym trainers

The 14 trainers the Radical Gyms & Structures buildings summon, from [Radical Cobblemon Trainers](https://gitlab.com/srcmc/rct/mod)
(RCT) by HDainester, version 0.19.2-beta (`1.21.1` branch, commit `80260c6`), under the Mod Community License (MCOML)
in `LICENSE.txt`. Under that licence these files, and the add-on's `scripts/rct_trainers.js` that `port.py` writes from
them, stay under the MCOML; the rest of the add-on is MIT.

`trainers/` holds RCT's `data/rctmod/trainers/<id>.json` for the eight gym leaders (Brock, Misty, Lt. Surge, Erika, Koga,
Sabrina, Blaine and Clair), the Elite Four (Lorelei, Bruno, Agatha and Lance) and Champion Terry, unchanged, and `skins/`
their skins from RCT's `assets/rctmod/textures/trainers/single/`, unchanged. Agatha is there twice because the League
summons `elite_four_agatha_0053` and its rematch button `elite_four_agatha_0054`, two teams RCT counts as one member.

`progression.json` is RCT's `requiredDefeats` (`data/rctmod/mobs/trainers/single/`, with Radical Gyms' own versions of the
leaders' files) cut down to these 14: each trainer's groups of trainers, one of each group to be beaten first. Where RCT
names a trainer not ported (a rival, Brendan, Giovanni), that trainer's own requirements stand in for it, so the order is
Brock, Misty, Lt. Surge, Erika, Sabrina, Koga, Blaine, Clair, the Elite Four in any order, then Terry.

Changes made in the port (MCOML 2.2): the teams are read as RCT defines them; RCT's progression is cut down to these
14 trainers, so a trainer's required defeats that name a trainer not ported (a rival, Giovanni) are replaced by the
ported trainers those require in turn; and RCT's battle AI, level cap and rewards are re-implemented in the add-on's
script rather than carried over.
