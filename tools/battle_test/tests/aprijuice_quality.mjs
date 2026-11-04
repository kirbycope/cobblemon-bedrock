// The Aprijuice's quality look: a Tasty one is its own leaf item, a Delicious one its umbrella item, read back as the
// same Aprijuice
import { M, check } from "../harness.mjs";

const plain = M.slotStack(["cobblemon:aprijuice_red", 1, { boosts: {} }]);
const big = M.slotStack(["cobblemon:aprijuice_red", 1, { boosts: { SPEED: 60, SKILL: 60 } }]);
check("a plain Aprijuice keeps the plain item", plain.typeId === "cobblemon:aprijuice_red");
check("a Delicious one is the umbrella item", big.typeId === "cobblemon:aprijuice_red_delicious", big.typeId);
check("and reads back as the same Aprijuice", M.stackSlot(big)[0] === "cobblemon:aprijuice_red");
