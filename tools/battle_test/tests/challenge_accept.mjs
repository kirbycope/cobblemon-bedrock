// A challenge between players: the receiver's Battle Request (Accept and Decline) opens as it arrives, since a pack can
// add neither Cobblemon's toast nor its respond keybind
import { M, check, flush } from "../harness.mjs";
import { world } from "../stub_server.mjs";
import { shown } from "../stub_ui.mjs";

function player(name) {
    const log = [];
    const p = { id: `${name}-${Math.random()}`, name, isValid: true, location: { x: 0, y: 0, z: 0 }, dimension: { id: "minecraft:overworld" }, log,
                getDynamicProperty() { }, setDynamicProperty() { }, sendMessage: (t) => log.push(String(t).replace(/§./g, "")), playSound() { } };
    world.setDynamicProperty(`cobblemon:party_${p.id}`, JSON.stringify([{ pid: `${name}-1`, rec: { t: "cobblemon:p0025_pikachu", lv: 50 } }]));
    return p;
}
const from = player("Ash"), to = player("Gary");
shown.length = 0;
M.sendChallenge(from, to, -1, "doubles");
flush();
check("the challenge reaches the receiver", to.log.some((l) => /Ash challenged you to a Double Battle/.test(l)), to.log.join(" | "));
check("and their Battle Request opens at once, for them only", shown.length === 1 && shown[0].title === "cbm:challenge" && shown[0].player === to,
      JSON.stringify(shown.map((s) => [s.title, s.player.name])));
