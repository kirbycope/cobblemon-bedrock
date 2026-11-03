// The held items added for the parity gaps (Showdown's data/items.js), each in the situation its code reacts to
import { M, mon, battle, move, check, flush } from "../harness.mjs";

{   // Custap Berry: eaten at a quarter of HP or less, it puts a normal-priority move first in its bracket
    const a = mon("Snorlax", { held: "custap_berry", hp: 0.2 }), d = mon("Pikachu");
    const b = battle(a, d);
    check("Custap Berry goes first at low HP", M.goesFirst(b, a, move("tackle")) === true && !a.held, b.log.join(" / "));
    const c = mon("Snorlax", { held: "custap_berry", hp: 0.9 });
    check("Custap Berry waits above a quarter", M.goesFirst(battle(c, d), c, move("tackle")) === false && c.held);
    const p = mon("Snorlax", { held: "custap_berry", hp: 0.2 });
    check("Custap Berry is not for a priority move", M.goesFirst(battle(p, d), p, move("quickattack")) === false && p.held);
}
{   // Micle Berry: eaten at the end of a turn at a quarter of HP or less; the next move is more accurate
    const a = mon("Snorlax", { held: "micle_berry", hp: 0.2 }), d = mon("Pikachu");
    const b = battle(a, d);
    M.endOfTurn(b); flush();
    check("Micle Berry is eaten at low HP", a.micle === true && !a.held, b.log.join(" / "));
}
{   // Berry Juice: 20 HP at half HP or less
    const a = mon("Snorlax", { held: "berry_juice", level: 50 });
    a.hp = Math.floor(a.stats.hp * 0.4);
    const before = a.hp, b = battle(a, mon("Pikachu"));
    M.heldBerry(b, a); flush();
    check("Berry Juice heals 20", a.hp === before + 20 && !a.held, `${before} -> ${a.hp}; ${b.log.join(" / ")}`);
}
{   // Float Stone halves the holder's weight: Low Kick on a 300 kg Golem is 120 power, on 150 kg 100
    const a = mon("Machamp"), d = mon("Golem"), b = battle(a, d);
    const plain = M.movePower(b, a, d, move("lowkick"));
    d.held = "cobblemon:float_stone";
    const floated = M.movePower(b, a, d, move("lowkick"));
    check("Float Stone lightens the target for Low Kick", plain === 120 && floated === 100, `${plain} -> ${floated}`);
    d.held = null; d.ability = "heavymetal";
    check("Heavy Metal doubles weight", M.movePower(b, a, d, move("lowkick")) === 120);
}
{   // Ring Target: a Ghost holding it is hit by a Normal move
    const a = mon("Snorlax", { moves: ["tackle"] }), d = mon("Gengar", { held: "ring_target" }), b = battle(a, d);
    const before = d.hp;
    M.useMove(b, a, d, move("tackle")); flush();
    check("Ring Target lets Normal hit a Ghost", d.hp < before, b.log.join(" / "));
    const g = mon("Gengar"), b2 = battle(mon("Snorlax"), g), hp = g.hp;
    M.useMove(b2, b2.ally, g, move("tackle")); flush();
    check("without it the Ghost is immune", g.hp === hp, b2.log.join(" / "));
}
{   // Room Service: Trick Room up, its holder's Speed falls a stage and the item is used
    const a = mon("Slowbro", { held: "room_service" }), d = mon("Pikachu"), b = battle(a, d);
    b.trickRoom = 5;
    M.roomService(b, a); flush();
    check("Room Service lowers Speed under Trick Room", a.stages.spe === -1 && !a.held, b.log.join(" / "));
}
{   // Eject Pack: a lowered stat sends the player's Pokemon back
    const a = mon("Snorlax", { held: "eject_pack" }), d = mon("Pikachu"), b = battle(a, d);
    M.boost(b, a, { atk: -1 }, d); flush();
    check("Eject Pack switches out after a drop", b.ejectAlly === true && !a.held, b.log.join(" / "));
}
