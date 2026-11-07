// A Pokemon's brain out of battle: its melee damage (attackToDamageCurve), defending its trainer, panicking and staying
// angry while its attacker lives, the sleeping hours IntRangesAdapter reads, and the numbers port.py writes into the
// behaviour entities for walking, hovering, looking around and following (those pass once port.py has run)
import { M, check } from "../harness.mjs";
import { readFileSync } from "node:fs";

// PokemonServerDelegate.attackToDamageCurve: ceil(sqrt((Attack - 10) ^ 0.875)), at least 1
check("an Attack under 10 hits for 1, as does 11", M.attackDamage(5) === 1 && M.attackDamage(11) === 1);
check("Rattata at level 5 (Attack 12) hits for 2, Machamp at 30 (92) for 7, Snorlax at 50 (130) for 9",
      M.attackDamage(M.statAt(56, 5)) === 2 && M.attackDamage(M.statAt(130, 30)) === 7 && M.attackDamage(M.statAt(110, 50)) === 9,
      JSON.stringify([M.statAt(56, 5), M.statAt(130, 30), M.statAt(110, 50)]));
{
    const store = new Map([["cobblemon:level", 50], ["cobblemon:ivs", JSON.stringify({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 })],
                           ["cobblemon:evs", JSON.stringify({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })], ["cobblemon:nature", "hardy"]]);
    const snorlax = { typeId: "cobblemon:p0143_snorlax", getDynamicProperty: (k) => store.get(k), setDynamicProperty: (k, v) => store.set(k, v), getComponent: () => undefined };
    check("a level 50 Snorlax's melee hit is 9 from its own Attack, not its base Attack over ten (11)", M.meleeDamage(snorlax) === 9, String(M.meleeDamage(snorlax)));
}

// DefendOwnerSensor: the mob that hurt the trainer, while it lives, within FOLLOW_RANGE 32 and in the same dimension
{
    const dim = { id: "minecraft:overworld" }, other = { id: "minecraft:nether" };
    const pokemon = { location: { x: 0, y: 64, z: 0 }, dimension: dim };
    const zombie = (x, d = dim, hp = 20) => ({ isValid: true, location: { x, y: 64, z: 0 }, dimension: d, getComponent: () => ({ currentValue: hp }) });
    check("a Pokemon defends its trainer against a mob 30 blocks off, not one 33 off", M.defendsAgainst(pokemon, zombie(30)) && !M.defendsAgainst(pokemon, zombie(33)));
    check("nor against a dead one or one in another dimension", !M.defendsAgainst(pokemon, zombie(5, dim, 0)) && !M.defendsAgainst(pokemon, zombie(5, other)));
}

// HurtBySensor's HURT_BY_ENTITY holds until the attacker dies or leaves: the panic (and the anger) lasts that long
{
    const dim = { id: "minecraft:overworld" }, events = [];
    const pokemon = { id: "p1", dimension: dim, triggerEvent: (n) => events.push(n) };
    const player = { isValid: true, dimension: dim, getComponent: () => ({ currentValue: 20 }) };
    check("a Pokemon stays fleeing while its attacker lives", M.calmIfAttackerGone(pokemon, player) === true && !events.includes("cobblemon:calm"));
    check("and calms once the attacker is gone", M.calmIfAttackerGone(pokemon, { isValid: false }) === false && events.includes("cobblemon:calm"));
}

// IntRangesAdapter: comma lists of names and min-max ticks, trimmed
check("\"night, noon\" is night and noon", JSON.stringify(M.timeRanges("night, noon")) === JSON.stringify([...M.timeRanges("night"), ...M.timeRanges("noon")]), JSON.stringify(M.timeRanges("night, noon")));
check("\"167-11833,13702-22299\" is those two ranges", JSON.stringify(M.timeRanges("167-11833,13702-22299")) === "[[167,11833],[13702,22299]]");
check("a single name is its own ranges", JSON.stringify(M.timeRanges("dusk")) === "[[11834,13701]]");

// port.py's rules for these (read from its source, as the entity files are written by a port run)
{
    const port = readFileSync(new URL("../../../port.py", import.meta.url), "utf-8");
    check("port.py walks a Pokemon at 0.6125 of its walkSpeed (0.7 x 0.35 x 2.5), walkSpeed 0.35 unless said", /WANDER_PACE = 0\.7 \* WANDER_SPEED \* 2\.5/.test(port) && /"walkSpeed", 0\.35\)/.test(port));
    check("port.py hovers within 10 across, 5 up or down, 0 to 6 off the ground, about every 220 ticks",
          /random_hover": \{"priority": 8, "xz_dist": 10, "y_dist": 5, "y_offset": -1, "interval": LAND_WANDER_INTERVAL, "hover_height": \[0, 6\]\}/.test(port) && /LAND_WANDER_INTERVAL = 220/.test(port));
    check("port.py's amphibious swim wanders one tick in 60, 7 up or down", /random_swim": \{"priority": 7, "interval": 60, "xz_dist": 10, "y_dist": 7/.test(port));
    check("port.py looks at any mob or player within 15 blocks", /"look_distance": 15, "probability": 1\.0/.test(port) && /def look_around/.test(port));
    check("port.py follows the owner, teleporting past 32 and stopping 3 off", /"max_distance": round\(32 \+ width \/ 2, 2\)/.test(port) && /max\(4, math\.ceil\(width \/ 2\)\) - 1/.test(port));
    check("port.py's nap has no thunderstorm test", !/"is_weather", "subject": "self", "operator": "!=", "value": "thunderstorm"/.test(port));
}
