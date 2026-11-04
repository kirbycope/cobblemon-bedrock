// spawnpokemonfrompool and checkspawn draw from the port's spawn tables: the natural spawns carry their species
import { M, F, check } from "../harness.mjs";

check("the natural spawn table names each spawn's species", F.WORLD_SPAWNS.length > 1000 && F.WORLD_SPAWNS.every((sp) => sp.entity), String(F.WORLD_SPAWNS.length));
{
    const pool = [{ entity: "cobblemon:p0019_rattata", bucket: "common", weight: 10 }, { entity: "cobblemon:p0025_pikachu", bucket: "rare", weight: 1 }];
    let common = 0;
    for (let n = 0; n < 2000; n++) if (M.drawSpawn(pool).bucket === "common") common++;
    check("a draw rolls the bucket by Cobblemon's weights first (94 to 0.5)", common > 1900, String(common));
    check("and draws nothing from an empty pool", M.drawSpawn([]) === null);
}
