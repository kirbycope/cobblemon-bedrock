// FossilMultiblockBuilder's layout: a Monitor on the Analyzer, the Analyzer beside the tank's lower half
import { M, check } from "../harness.mjs";

function world(blocks) {
    const map = new Map(), dim = { id: "overworld" };
    for (const [type, x, y, z, part] of blocks) map.set(`${x},${y},${z}`, { typeId: type, location: { x, y, z }, dimension: dim, permutation: { getState: (k) => (k === "cobblemon:part" ? part : undefined) } });
    dim.getBlock = (p) => map.get(`${p.x},${p.y},${p.z}`) ?? { typeId: "minecraft:air", location: p, dimension: dim, permutation: { getState: () => undefined } };
    return (x, y, z) => map.get(`${x},${y},${z}`);
}
const tank = [["cobblemon:restoration_tank", 0, 0, 0, "bottom"], ["cobblemon:restoration_tank", 0, 1, 0, "top"]];
const good = world([...tank, ["cobblemon:fossil_analyzer", 1, 0, 0], ["cobblemon:monitor", 1, 1, 0]]);
check("a tank, an analyzer beside it and a monitor on the analyzer form the machine", M.findMachine(good(0, 0, 0))?.monitor?.typeId === "cobblemon:monitor");
check("found from the monitor too", !!M.findMachine(good(1, 1, 0)));
const noMonitor = world([...tank, ["cobblemon:fossil_analyzer", 1, 0, 0]]);
check("no monitor, no machine", M.findMachine(noMonitor(0, 0, 0)) === undefined);
const diagonal = world([...tank, ["cobblemon:fossil_analyzer", 1, 0, 1], ["cobblemon:monitor", 1, 1, 1]]);
check("an analyzer on the diagonal is not beside the tank", M.findMachine(diagonal(0, 0, 0)) === undefined);
const offset = world([...tank, ["cobblemon:fossil_analyzer", 1, 0, 0], ["cobblemon:monitor", 2, 0, 0]]);
check("a monitor beside the analyzer rather than on it does not count", M.findMachine(offset(0, 0, 0)) === undefined);
