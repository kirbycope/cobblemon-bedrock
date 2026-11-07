// The battle's rolls and the small rules beside them, against Showdown as Cobblemon bundles it: the sixteen-step damage
// roll, the Wild Alpha boost through getStat only, Metronome's pool, weather-dependent power, one-hit KO and Toxic
// accuracy, defrost moves, Shield Dust, Effect Spore, the added flinch of King's Rock, screens in doubles, Taunt's length,
// the onBeforeMove order and the two-turn sleep a napping wild Pokemon brings in
import { M, D, mon, battle, move, check, flush } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const use = (a, d, id, roll = 0.5, setup) => rolled(roll, () => { const b = battle(a, d); if (setup) setup(b, a, d); const before = d.hp; M.useMove(b, a, d, move(id)); flush(); return { b, dealt: before - d.hp, text: b.log.join(" / ") }; });
const lv = { level: 50, ability: "thickfat" };

// 1. the damage roll: one of sixteen, 85 to 100 percent (battle.randomizer), after the critical hit and before STAB
{
    const steps = new Set(); for (let i = 0; i < 16; i++) steps.add(rolled((i + 0.5) / 16, () => M.damageRoll(1000)));
    check("the damage roll has sixteen steps, 85 to 100 percent", steps.size === 16 && Math.min(...steps) === 850 && Math.max(...steps) === 1000, [...steps].join(" "));
    // a base damage where rolling before and after STAB disagree, Snorlax's Tackle at level 50 with roll 85 (random 0.97)
    const base = (atk) => Math.floor(Math.floor(Math.floor(22 * 40 * atk) / 100) / 50) + 2;
    const atk = [...Array(400).keys()].map((n) => n + 50).find((x) => Math.floor(Math.floor(base(x) * 85) / 100 * 1.5) !== Math.floor(Math.floor(Math.floor(base(x) * 1.5) * 85) / 100));
    const a = mon("Snorlax", lv), d = mon("Snorlax", lv);
    a.stats.atk = atk; d.stats.def = 100;
    const { dealt } = use(a, d, "tackle", 0.97);
    check("the roll comes before STAB (modifyDamage's order)", dealt === Math.floor(Math.floor(base(atk) * 85 / 100) * 1.5), `${dealt}, base ${base(atk)} at Attack ${atk}`);
    // the confusion self-hit (getConfusionDamage): 40 power typeless, the same roll
    const f = mon("Snorlax", lv); f.stats.atk = 120; f.stats.def = 90;
    const b = battle(f, mon("Snorlax", lv)), hp = f.hp;
    rolled(0.97, () => M.confusionHit(b, f));
    check("a confusion self-hit takes the same 85 to 100 roll", hp - f.hp === Math.floor((Math.floor(Math.floor(22 * 40 * 120 / 90) / 50) + 2) * 85 / 100), `${hp - f.hp}`);
}

// 2. the Wild Alpha boost stays in Pokemon.alphaBoosts: getStat (speed, Gyro Ball, Download, Beast Boost) reads it,
// calculateStat (the damage formula) does not
{
    const alpha = mon("Snorlax", { level: 40, ability: "thickfat" }), b = battle(mon("Pikachu"), alpha);
    alpha.entity.setDynamicProperty("cobblemon:alpha", true);
    const before = { ...alpha.stats };
    rolled(0.9, () => { M.enter(b, alpha, b.ally); flush(); });   // every step picks the last of the pool, Speed
    check("an alpha's stored stats are unchanged", JSON.stringify(before) === JSON.stringify(alpha.stats), JSON.stringify(alpha.stats));
    check("its level / 10 + 1 steps are kept as alphaBoosts", alpha.alphaBoosts?.spe === 5, JSON.stringify(alpha.alphaBoosts));
    check("Speed reads them (getStat, 3.5 times at five steps)", M.speedOf(alpha, b) === Math.floor(before.spe * 3.5), `${M.speedOf(alpha, b)} vs ${before.spe}`);
    alpha.alphaBoosts = { atk: 4, def: 0, spa: 0, spd: 0, spe: 0 };
    const plain = mon("Snorlax", lv), target = () => { const t = mon("Snorlax", lv); t.stats.def = 100; return t; };
    plain.stats.atk = alpha.stats.atk = 150; alpha.level = plain.level = 50;
    check("the damage formula does not", use(alpha, target(), "tackle").dealt === use(plain, target(), "tackle").dealt);
    const d = mon("Snorlax", lv), sb = battle(alpha, d); d.stats.def = 100; alpha.stats.def = 50;
    rolled(0.5, () => M.fieldMove(sb, alpha, d, move("guardsplit")));
    check("Guard Split averages the stored stats (storedStats)", alpha.stats.def === 75 && d.stats.def === 75, `${alpha.stats.def} ${d.stats.def}`);
}

// 3. Metronome calls any of Showdown's flags.metronome moves that are standard or Unobtainable, uniformly
{
    const pool = D.METRONOME_POOL;
    check("Metronome's pool is Showdown's 581 moves", pool.length === 581 && pool.every((id) => D.MOVES[id]) && pool.includes("fusionflare") && pool.includes("judgment"), `${pool.length}`);
    check("and leaves out the moves it cannot call", !["metronome", "struggle", "assist", "copycat", "sleeptalk", "transform", "protect", "hail"].some((id) => pool.includes(id)));
    const at = pool.indexOf("ember"), { text } = use(mon("Clefairy", lv), mon("Snorlax", lv), "metronome", (at + 0.5) / pool.length);
    check("it uses the move its roll lands on", text.includes("Waggling a finger let it use Ember"), text);
}

// 4 and 5. Weather Ball 100 in any weather; Solar Beam and Solar Blade half in rain, sand and snow
{
    const power = (id, kind) => { const a = mon("Snorlax", lv), d = mon("Snorlax", lv), b = battle(a, d); if (kind) b.weather = { kind, turns: 5 }; return M.movePower(b, a, d, move(id)); };
    check("Weather Ball is 100 in rain, sun, sand and snow, 50 without", ["rain", "sun", "sand", "snow"].every((w) => power("weatherball", w) === 100) && power("weatherball") === 50);
    check("Solar Beam is 60 in rain, sand and snow, 120 in sun or clear", ["rain", "sand", "snow"].every((w) => power("solarbeam", w) === 60) && power("solarbeam", "sun") === 120 && power("solarbeam") === 120);
    check("Solar Blade halves the same way", power("solarblade", "rain") === 62 && power("solarblade") === 125);
}

// 6. Sheer Cold: 30 percent from an Ice type, 20 from any other (ohko "Ice"); Ice types are immune
{
    check("Sheer Cold's data names Ice, Fissure's is plain", D.MOVES.sheercold.ohko === "Ice" && D.MOVES.fissure.ohko === true);
    const ice = use(mon("Lapras", lv), mon("Snorlax", lv), "sheercold", 0.25), other = use(mon("Snorlax", lv), mon("Snorlax", lv), "sheercold", 0.25);
    check("a roll of 25 hits from an Ice type and misses from another", ice.dealt > 0 && other.dealt === 0, `${ice.text} || ${other.text}`);
}

// 7. Toxic from a Poison type never misses, even at a target in the air
{
    const poison = use(mon("Ekans", lv), mon("Snorlax", lv), "toxic", 0.95), other = use(mon("Snorlax", lv), mon("Snorlax", lv), "toxic", 0.95);
    check("Toxic from a Poison type hits on a roll that misses another", poison.b.foe.status === "tox" && other.b.foe.status !== "tox", `${poison.text} || ${other.text}`);
    const flying = use(mon("Ekans", lv), mon("Snorlax", lv), "toxic", 0.95, (b, a, d) => { d.hiding = "air"; });
    check("and reaches a Pokemon in the air", flying.b.foe.status === "tox", flying.text);
}

// 8. a move with the defrost flag thaws its frozen user without the 20 percent roll
{
    check("the defrost flag is in the move data", ["flamewheel", "scald", "sacredfire", "flareblitz", "fusionflare"].every((id) => D.MOVES[id].flags.includes("defrost")) && !D.MOVES.ember.flags.includes("defrost"));
    const f = mon("Snorlax", { ...lv, status: "frz" }), g = mon("Snorlax", { ...lv, status: "frz" });
    const thawed = rolled(0.9, () => M.canAct(battle(f, mon("Snorlax")), f, move("flamewheel"))), stuck = rolled(0.9, () => M.canAct(battle(g, mon("Snorlax")), g, move("tackle")));
    check("Flame Wheel thaws its user, Tackle does not", thawed && f.status === null && !stuck && g.status === "frz");
}

// 9. Shield Dust stops the target's added effects but not the user's own (onModifySecondaries keeps effect.self)
{
    const { b } = use(mon("Snorlax", lv), mon("Snorlax", { ...lv, ability: "shielddust" }), "flamecharge", 0.5);
    check("Flame Charge still raises its user's Speed against Shield Dust", b.ally.stages.spe === 1, JSON.stringify(b.ally.stages));
    const burn = use(mon("Snorlax", lv), mon("Snorlax", { ...lv, ability: "shielddust" }), "ember", 0.05);
    check("Ember cannot burn through it", burn.b.foe.status !== "brn", burn.text);
}

// 10. Effect Spore: one roll of 100, under 11 sleep, under 21 paralysis, under 30 poison; nothing on a Grass type
{
    const spore = (roll, attacker = "Snorlax") => use(mon(attacker, lv), mon("Parasect", { ...lv, ability: "effectspore" }), "tackle", roll).b.ally.status;
    check("Effect Spore puts to sleep under 11, paralyses under 21, poisons under 30", spore(0.05) === "slp" && spore(0.15) === "par" && spore(0.25) === "psn" && !spore(0.35), `${spore(0.05)} ${spore(0.15)} ${spore(0.25)} ${spore(0.35)}`);
    check("and does nothing to a Grass type (powder immunity)", !spore(0.05, "Bulbasaur"));
}

// 11. King's Rock, Razor Fang and Stench add a 10 percent flinch: Serene Grace doubles it, Shield Dust and Covert Cloak stop it
{
    const flinch = (roll, opts = {}, foe = {}) => use(mon("Snorlax", { ...lv, held: "kings_rock", ...opts }), mon("Snorlax", { ...lv, ...foe }), "tackle", roll, (b, a) => { b.movedFirst = a; }).b.foe.flinched === true;
    check("King's Rock flinches on a roll under 10", flinch(0.05) && !flinch(0.15));
    check("Serene Grace makes it 20", flinch(0.15, { ability: "serenegrace" }) && !flinch(0.25, { ability: "serenegrace" }));
    check("Shield Dust and a Covert Cloak keep it off", !flinch(0.05, {}, { ability: "shielddust" }) && !flinch(0.05, {}, { held: "covert_cloak" }));
}

// 12. Reflect and Light Screen take a half in singles, 2732/4096 with two or more a side
{
    const hit = (doubles, screen) => rolled(0.5, () => {
        const a = mon("Snorlax", lv), d = mon("Snorlax", lv), b = battle(a, d, doubles ? { doubles: true } : {});
        a.stats.atk = 200; d.stats.def = 100;
        if (screen) M.sideOf(b, d).reflect = 5;
        const before = d.hp; M.useMove(b, a, d, move("tackle")); flush(); return before - d.hp;
    });
    const raw = hit(false, false);
    check("Reflect halves in singles", hit(false, true) === Math.floor(raw / 2), `${raw} ${hit(false, true)}`);
    check("and takes 2732/4096 in doubles", hit(true, true) === Math.floor((hit(true, false) * 2732 + 2047) / 4096), `${hit(true, false)} ${hit(true, true)}`);
}

// 13. Taunt lasts three turns, four when its target has already moved this turn (Taunt's onStart)
{
    const taunt = (first) => { const a = mon("Snorlax", lv), d = mon("Snorlax", lv), b = battle(a, d); b.movedFirst = first === "user" ? a : d; M.fieldMove(b, a, d, move("taunt")); return d.taunt; };
    check("Taunt is 3 turns before the target moves, 4 after", taunt("user") === 3 && taunt("target") === 4);
}

// 14. the onBeforeMove order: sleep, freeze and Truant before the flinch
{
    const f = mon("Snorlax", { ...lv, status: "slp" }), b = battle(f, mon("Snorlax"));
    f.sleep = 1; f.flinched = true;
    const acted = M.canAct(b, f, move("tackle"));
    check("a sleeping Pokemon that flinched counts its sleep down and does not say it flinched", !acted && f.sleep === 0 && !b.log.join(" ").includes("flinched"), b.log.join(" / "));
    const t = mon("Slakoth", { ...lv, ability: "truant" }), tb = battle(t, mon("Snorlax"));
    t.truant = true; t.flinched = true;
    M.canAct(tb, t, move("tackle"));
    check("a loafing Truant Pokemon loafs rather than flinches", tb.log.join(" ").includes("loafing") && !tb.log.join(" ").includes("flinched"), tb.log.join(" / "));
}

// 15. a napping wild Pokemon comes in asleep with Showdown's status duration 2 (BattleRegistry's packed team): asleep
// on its first turn, awake on its second
{
    const sleeper = mon("Snorlax", lv);
    sleeper.entity.setDynamicProperty("cobblemon:status", JSON.stringify({ s: "slp", left: 1000 }));
    const f = M.fighter(sleeper.entity), b = battle(mon("Snorlax"), f);
    const first = M.canAct(b, f, move("tackle")), second = M.canAct(b, f, move("tackle"));
    check("a napping Pokemon sleeps through its first turn and wakes on its second", f.status === null && !first && second, b.log.join(" / "));
}
