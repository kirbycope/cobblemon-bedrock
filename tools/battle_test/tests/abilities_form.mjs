// Abilities that change their holder's form, and Transform (batch G)
import { M, mon, battle, move, check, flush, damage } from "../harness.mjs";

function rolled(roll, fn) { const random = Math.random; Math.random = () => roll; try { return fn(); } finally { Math.random = random; } }
const hitWith = (a, d, id, b = battle(a, d)) => rolled(0.5, () => { const before = d.hp; M.useMove(b, a, d, move(id)); flush(); return before - d.hp; });

{
    const f = mon("Darmanitan", { level: 50, ability: "zenmode" }), b = battle(f, mon("Snorlax"));
    const spa = f.stats.spa;
    f.hp = Math.floor(f.stats.hp * 0.4);
    M.battleForms(b); flush();
    check("Zen Mode turns Darmanitan Zen at half HP, with Zen's types and stats", f.form === "zen-mode" && f.info.types.join() === "fire,psychic" && f.stats.spa > spa * 2, b.log.join(" / "));
    check("and keeps the variant it came in as for afterwards", f.entity.getDynamicProperty("cobblemon:battle_form") === 0);
    f.hp = f.stats.hp; M.battleForms(b); flush();
    check("and back above half", f.form === null && f.stats.spa === spa);
    f.hp = 10; M.battleForms(b);
    M.freeze(f.entity, false);
    check("leaving the battle puts the variant back", f.entity.getDynamicProperty("cobblemon:battle_form") === undefined);
}
{
    const f = mon("Wishiwashi", { level: 30, ability: "schooling" }), b = battle(f, mon("Snorlax"));
    M.enter(b, f, b.foe); flush();
    const schooled = f.form === "school-form" && f.stats.atk > 50;
    f.hp = Math.floor(f.stats.hp * 0.2); M.endOfTurn(b); flush();
    check("Schooling forms a school from level 20 above a quarter HP, and breaks it below", schooled && f.form === null, b.log.join(" / "));
}
{
    const f = mon("Minior", { ability: "shieldsdown" }), b = battle(f, mon("Snorlax"));
    M.enter(b, f, b.foe); flush();
    const meteor = f.form === "meteor-form";
    M.inflict(b, f, "par", true, b.foe); flush();
    const kept = !f.status;
    f.hp = Math.floor(f.stats.hp * 0.4); M.endOfTurn(b); flush();
    check("Shields Down is Meteor Form above half HP, kept from status, and its core below", meteor && kept && f.form === null, b.log.join(" / "));
}
{
    const f = mon("Eiscue", { ability: "iceface" }), a = mon("Snorlax"), b = battle(a, f);
    const first = hitWith(a, f, "tackle", b), second = hitWith(a, f, "tackle", b);
    check("Ice Face takes a physical hit, then the face is gone", first === 0 && second > 0 && f.form === "noice_face", b.log.join(" / "));
    M.setWeather(b, "snow", a); flush();
    check("and snow grows it back", f.form === null, b.log.join(" / "));
}
{
    const f = mon("Mimikyu", { ability: "disguise" }), a = mon("Snorlax"), b = battle(a, f);
    const first = hitWith(a, f, "crunch", b);
    check("Disguise takes the first hit for an eighth of HP", first === Math.floor(f.stats.hp / 8) && f.busted, b.log.join(" / "));
    check("then the hits land", hitWith(a, f, "crunch", b) > first);
}
{
    const f = mon("Morpeko", { ability: "hungerswitch" }), b = battle(f, mon("Snorlax"));
    M.endOfTurn(b); flush();
    check("Hunger Switch changes mode at the end of a turn, and Aura Wheel turns Dark", f.form === "hangry-mode" && M.abilityMove(f, move("aurawheel")).type === "dark");
    M.endOfTurn(b); flush();
    check("and back again", f.form === null);
}
{
    const f = mon("Palafin", { ability: "zerotohero" }), b = battle(f, mon("Snorlax"));
    const atk = f.stats.atk;
    b.heroes = new Set([f.entity.id]);
    M.enter(b, f, b.foe); flush();
    check("Zero to Hero comes back in as the Hero", f.form === "hero-form" && f.stats.atk > atk * 2, b.log.join(" / "));
}
{
    const f = mon("Cherrim", { ability: "flowergift" }), b = battle(f, mon("Snorlax"));
    M.setWeather(b, "sun", b.foe); flush();
    check("Flower Gift turns Cherrim Sunshine in sun", f.form === "sunshine-form", b.log.join(" / "));
    const sun = damage({ species: "Cherrim", level: 50, ability: "flowergift" }, { species: "Snorlax", level: 50 }, "tackle", (b) => { b.weather = { kind: "sun", turns: 5 }; });
    const none = damage({ species: "Cherrim", level: 50, ability: "flowergift" }, { species: "Snorlax", level: 50 }, "tackle");
    check("and raises its Attack by half there", sun.dealt > none.dealt * 1.3, `${none.dealt} -> ${sun.dealt}`);
}
{
    const f = mon("Aegislash", { ability: "stancechange" }), b = battle(f, mon("Snorlax"));
    const shield = { ...f.stats };
    rolled(0.5, () => { M.useMove(b, f, b.foe, move("tackle")); flush(); });
    const blade = f.blade && f.stats.atk > shield.atk * 2 && f.stats.def < shield.def / 2;
    b.turn++;
    rolled(0.9, () => { b.movedFirst = f; M.useMove(b, f, b.foe, move("kingsshield")); flush(); });
    check("Stance Change turns Blade Forme to attack and Shield Forme for King's Shield", blade && !f.blade && f.stats.atk === shield.atk, b.log.join(" / "));
}
{
    const f = mon("Cramorant", { ability: "gulpmissile" }), a = mon("Snorlax", { ability: "thickfat" }), b = battle(a, f);
    rolled(0.5, () => { M.useMove(b, f, a, move("surf")); flush(); });
    const caught = f.gulp === "gulping", before = a.hp;
    hitWith(a, f, "tackle", b);
    check("Gulp Missile spits its catch at the next Pokemon to hit it", caught && before - a.hp === Math.floor(a.stats.hp / 4) && a.stages.def === -1 && !f.gulp, b.log.join(" / "));
}
{
    const f = mon("Greninja", { level: 100, ability: "battlebond" }), b = battle(f, mon("Snorlax", { level: 2 }));
    hitWith(f, b.foe, "tackle", b);
    check("Battle Bond raises Attack, Sp. Atk and Speed on a knockout", f.stages.atk === 1 && f.stages.spa === 1 && f.stages.spe === 1, b.log.join(" / "));
}
{
    const f = mon("Ditto", { ability: "imposter" }), d = mon("Snorlax", { moves: ["tackle", "bodyslam"] }), b = battle(f, d);
    const own = f.moves.map((m) => m.id).join();
    d.stages.atk = 2;
    M.enter(b, f, d); flush();
    const took = f.transformed && f.info.name === "Ditto" && f.info.types.join() === "normal" && f.stats.atk === d.stats.atk && f.stats.hp !== d.stats.hp
        && f.moves.map((m) => m.id).join() === "tackle,bodyslam" && f.moves[0].left === 5 && f.stages.atk === 2 && f.ability === d.ability;
    check("Imposter transforms into the other on coming in", took, b.log.join(" / "));
    M.untransform(f);
    check("and switching out gives Ditto back its own", !f.transformed && f.moves.map((m) => m.id).join() === own);
    const t = mon("Ditto", { ability: "limber", moves: ["transform"] }), tb = battle(t, mon("Pikachu"));
    M.useMove(tb, t, tb.foe, move("transform")); flush();
    check("Transform, the move, does the same", t.transformed && t.info.types.join() === "electric", tb.log.join(" / "));
}
