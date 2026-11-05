// The pasture's crowding limit (PokemonPastureBlockEntity.canAddPokemon, pastureMaxPerChunk)
import { M, D, check } from "../harness.mjs";

const pikachu = Object.keys(D.POKEMON).find((id) => D.POKEMON[id].name === "Pikachu");
function pastureWith(count) {
    let asked;
    const dimension = {
        heightRange: { min: -64, max: 320 },
        getEntities(options) { asked = options; return [...Array(count)].map(() => ({ typeId: pikachu })).concat([{ typeId: "minecraft:cow" }]); },
    };
    return { block: { location: { x: 100, y: 64, z: -40 }, dimension }, asked: () => asked };
}
{
    const busy = pastureWith(64), quiet = pastureWith(63);
    check("a pasture with 64 Pokemon round it takes no more", M.pastureCrowded(busy.block));
    check("and one with 63 does", !M.pastureCrowded(quiet.block));
    const a = busy.asked();
    check("counted over the 32 block square at every height", a.volume.x === 32 && a.volume.z === 32 && a.location.y === -64 && a.volume.y === 384 && a.location.x === 84.5, JSON.stringify(a));
}
