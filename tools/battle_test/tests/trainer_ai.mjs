// RCTBattleAI's own numbers: ResponseBuilder's pick, evalMove's kinds and MoveType's evaluators, PokeMath.damage's
// roll and accuracy factor, evalItem's potion score, the trainer's biases, and the forced switch after a faint
import { M, mod, mon, battle, move, check } from "../harness.mjs";

const { RCT_TRAINERS } = await mod("rct_trainers.js");
// Math.random answering from a list (then 0.5), for the draws a check pins
function seeded(values, fn) {
    const random = Math.random, list = [...values];
    Math.random = () => (list.length ? list.shift() : 0.5);
    try { return fn(); } finally { Math.random = random; }
}
function gymBattle(foeName, allyName, extra = {}, bench = []) {
    const foe = mon(foeName, { level: 30 }), b = battle(mon(allyName, { level: 30 }), foe);
    b.gym = { npc: foe.entity, at: 0, turns: 1, itemsLeft: 0, bag: [], margin: 0.25, name: "Test", ...extra,
              party: [{ spec: { t: foe.entity.typeId, lv: 30, moves: ["tackle"] }, down: false },
                      ...bench.map((n) => ({ spec: { t: mon(n).entity.typeId, lv: 30, moves: ["tackle"], ivs: {}, evs: {} }, down: false }))] };
    return b;
}

// ResponseBuilder.getRandom: the k-th option within the margin takes the pick with a chance of 1 in k + floor(16 w)
{
    const two = [{ id: "a", e: 0.75 }, { id: "b", e: 0.5 }];
    // margin 0.5 * 1 = 0.5, w = 0.25 / 0.5 = 0.5: 1 in 2 + 8, so a draw under 0.1 takes the second
    check("the second option within the margin is taken on a draw under 1 / (2 + floor(16 w))", seeded([0.5, 0.09], () => M.rctPick(two, 1)).id === "b");
    check("and not on a draw over it", seeded([0.5, 0.11], () => M.rctPick(two, 1)).id === "a");
    check("an option behind by more than the margin is never taken", seeded([0.2, 0], () => M.rctPick(two, 1)).id === "a");
    let tie = 0, flat = 0;
    for (let n = 0; n < 6000; n++) {
        if (M.rctPick([{ id: "a", e: 0.5 }, { id: "b", e: 0.5 }], 0.25).id === "b") tie++;
        if (M.rctPick([{ id: "a", e: 0.5 }, { id: "b", e: 0.5 }], 0).id === "b") flat++;
    }
    check("two tied options split about evenly under a margin (1 in 2)", tie > 2700 && tie < 3300, String(tie));
    check("with a margin of 0, w counts 1: the second of a tie 1 in 18", flat > 220 && flat < 450, String(flat));
}
// MoveType.MOVE_TYPES and evalMove's kinds
{
    check("Swords Dance is a buff, Growl a malus, Recover a heal, Heal Bell a cure, Toxic a status move, Tackle damage",
        ["swordsdance", "growl", "recover", "healbell", "toxic", "tackle"].map((id) => M.rctMoveKind(move(id))).join() === "BUFF,MALUS,HEAL,CURE,STATUS,DAMAGE");
    const b = gymBattle("Bulbasaur", "Squirtle");
    check("a heal aimed at the player's Pokemon (Heal Pulse) is worth -1", M.gymMoveValue(b, b.foe, b.ally, move("healpulse"), b.gym) === -1);
    let recover = 0;
    for (let n = 0; n < 500; n++) recover = Math.max(recover, M.gymMoveValue(b, b.foe, b.ally, move("recover"), b.gym));
    check("Recover at full health is worth no more than its random floor (0.25 times 0.85)", recover > 0 && recover <= 0.2125 + 1e-9, String(recover));
    b.foe.hp = Math.floor(b.foe.stats.hp / 4);
    const missing = 1 - b.foe.hp / b.foe.stats.hp;
    check("Recover at a quarter health is worth the missing share times statusMoveBias 0.85", Math.abs(M.gymMoveValue(b, b.foe, b.ally, move("recover"), b.gym) - missing * 0.85) < 1e-9);
    b.gym.statusMoveBias = 1;
    check("a statusMoveBias of 1 (the friendly coaches') carries through", Math.abs(M.gymMoveValue(b, b.foe, b.ally, move("recover"), b.gym) - missing) < 1e-9);
}
// MoveType.MOVE_EVALUATORS and MOVE_TYPE_EVALUATORS
{
    const ground = gymBattle("Pikachu", "Diglett");
    check("Thunder Wave into a Ground type is worth nothing", M.gymMoveValue(ground, ground.foe, ground.ally, move("thunderwave"), ground.gym) === 0);
    const clear = gymBattle("Bulbasaur", "Tentacool");
    clear.ally.ability = "clearbody";
    check("a malus into Clear Body is worth nothing", M.gymMoveValue(clear, clear.foe, clear.ally, move("growl"), clear.gym) === 0);
    const fake = gymBattle("Meowth", "Squirtle");
    const first = M.gymMoveValue(fake, fake.foe, fake.ally, move("fakeout"), fake.gym);
    fake.gym.turns = 2;
    check("Fake Out is worth 1.75 times more on the first turn out and nothing after", first > 0 && M.gymMoveValue(fake, fake.foe, fake.ally, move("fakeout"), fake.gym) === 0);
    const sleep = gymBattle("Bulbasaur", "Squirtle");
    sleep.ally.status = "slp";
    check("Sleep Powder into a sleeping Pokemon is worth nothing", M.gymMoveValue(sleep, sleep.foe, sleep.ally, move("sleeppowder"), sleep.gym) === 0);
    const faced = gymBattle("Bulbasaur", "Charmander");
    faced.foe.rctFaced = new Map([["c", faced.ally]]);
    check("a status move is divided by the worst matchup faced (Fire into Grass/Poison: 2)", M.rctKindValue(faced, faced.foe, faced.ally, "STATUS") === 0.5);
    check("a buff is not", M.rctKindValue(faced, faced.foe, faced.ally, "BUFF") === 1);
}
// PokeMath.damage: the stats without stages, the 0.85 to 1 roll and the accuracy factor
{
    const b = gymBattle("Charmander", "Bulbasaur");
    const a = b.foe, d = b.ally, tackle = move("tackle");
    const base = Math.trunc((((2 * a.level) / 5 + 2) * tackle.power * a.stats.atk / d.stats.def) / 50) + 2;
    check("Tackle's lowest roll is the 0.85 one, rounded up", seeded([0, 0], () => M.rctDamage(b, a, d, tackle)) === Math.ceil(Math.max(1, base * 0.85)));
    a.stages.atk = 6;
    check("stat stages do not count", seeded([0, 0], () => M.rctDamage(b, a, d, tackle)) === Math.ceil(Math.max(1, base * 0.85)));
    const ember = move("ember"), fire = Math.trunc(Math.trunc(Math.trunc((((2 * a.level) / 5 + 2) * ember.power * a.stats.spa / d.stats.spd) / 50) + 2) * 1.5) * 2;
    check("STAB and the type are truncated in turn, then the roll", seeded([0.999999, 0.5], () => M.rctDamage(b, a, d, ember)) === Math.ceil(fire * (0.999999 * 0.15 + 0.85)));
    const rock = { ...move("rockslide") };
    check("a 90% move's damage is scaled by 0.9 at the lowest accuracy draw", seeded([0, 0], () => M.rctDamage(b, a, d, rock)) === Math.ceil(0.9 * Math.max(1, (Math.trunc((((2 * a.level) / 5 + 2) * rock.power * a.stats.atk / d.stats.def) / 50) + 2) * 0.85)));
    check("a move that cannot miss counts Cobblemon's accuracy of -1: nothing at the lowest draw", seeded([0, 0], () => M.rctDamage(b, a, d, move("swift"))) === 0);
}
// the speed penalty: a slower Pokemon's move is scaled by rngRange(health, 1, true)
{
    const b = gymBattle("Slowpoke", "Jolteon");
    b.foe.hp = Math.max(1, Math.floor(b.foe.stats.hp / 10));
    const share = b.foe.hp / b.foe.stats.hp, full = seeded([0.3, 0.3, 0.3], () => { const f = b.foe.stats.spe; b.foe.stats.spe = 999; const v = M.gymMoveValue(b, b.foe, b.ally, move("tackle"), b.gym); b.foe.stats.spe = f; return v; });
    const slow = seeded([0.3, 0.3, 0.3, 0], () => M.gymMoveValue(b, b.foe, b.ally, move("tackle"), b.gym));
    check("the slower one's move at a tenth of its health is scaled down to its health share at the lowest draw", Math.abs(slow - full * share) < 1e-9, `${slow} against ${full * share}`);
}
// RCTBattleAI.evalItem: a Max Potion at half health scores about 0.21
{
    const b = gymBattle("Bulbasaur", "Squirtle", { turns: 9 });
    b.foe.hp = b.foe.stats.hp / 2;
    const score = seeded([0, 0], () => M.gymItemValue(b.gym, b.foe, "cobblemon:max_potion"));
    check("a Max Potion at half health after three turns out scores 1 x 0.5 x 0.5 x 0.85", Math.abs(score - 0.2125) < 1e-9, String(score));
    const potion = seeded([0, 0], () => M.gymItemValue(b.gym, b.foe, "cobblemon:potion")), amount = Math.min(20, b.foe.stats.hp);
    check("a Potion scores its share of the health times the share missing", Math.abs(potion - (amount / b.foe.stats.hp) * 0.5 * 0.85) < 1e-9, String(potion));
    b.gym.itemBias = 0;
    check("an itemBias of 0 (the friendly coaches') never scores an item", seeded([0, 0], () => M.gymItemValue(b.gym, b.foe, "cobblemon:max_potion")) === 0);
}
// RCTBattleAIConfig carried from the trainer files
{
    const coach = RCT_TRAINERS.friendly_coach_0009, ace = RCT_TRAINERS.ace_trainer_abel_04a5;
    check("a friendly coach carries itemBias 0, moveBias 1 and statusMoveBias 1", coach.itemBias === 0 && coach.moveBias === 1 && coach.statusMoveBias === 1 && coach.switchBias === 0);
    check("another trainer has RCT's defaults, 0.85, 1 and 0.85", ace.itemBias === 0.85 && ace.moveBias === 1 && ace.statusMoveBias === 0.85 && ace.margin === 0.15);
}
// the forced switch after a faint is rated by evalSwitch and picked by ResponseBuilder, not the best matchup outright
{
    let bulbasaur = 0;
    for (let n = 0; n < 300; n++) {
        const b = gymBattle("Charmander", "Squirtle", { turns: 3 }, ["Bulbasaur", "Vulpix"]);
        b.foe.hp = 0;
        if (M.gymForcedSwitch(b, [[b.gym.party[1], 1], [b.gym.party[2], 2]])[1] === 1) bulbasaur++;
    }
    check("the bench Pokemon evalSwitch rates better is the one sent in", bulbasaur > 200, String(bulbasaur));
}
