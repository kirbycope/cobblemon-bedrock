// A stand-in for @minecraft/server, enough for scripts/main.js to load in Node and its battle functions to run:
// every event subscription and world call is accepted and does nothing, and system.run and runTimeout queue their
// callbacks for the harness to flush (harness.mjs) instead of waiting on game ticks.
const handler = {
    get(target, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === "then") return undefined;   // not a promise
        if (key in target) return target[key];
        return anything();
    },
    apply() { return anything(); },
    construct() { return anything(); },
};
export function anything() { return new Proxy(function () { }, handler); }

export const queue = [];
export const system = new Proxy({
    currentTick: 0,
    run(fn) { queue.push(fn); return 0; },
    runTimeout(fn) { queue.push(fn); return 0; },
    runInterval() { return 0; },
    runJob() { return 0; },
    clearRun() { },
    afterEvents: anything(),
    beforeEvents: anything(),
}, handler);
// Bedrock's own limit on a string dynamic property, in bytes of UTF-8 (BDS 1.26.63 takes 32767 ASCII characters and
// refuses 16384 two-byte ones), which setDynamicProperty enforces by throwing; the stand-ins keep
// it too, so a test finds a value that would not save in the game (issue #68: a PC box written as one string)
export const STRING_PROPERTY_MAX = 32767;
export function checkProperty(k, v) {
    const bytes = typeof v === "string" ? Buffer.byteLength(v, "utf8") : 0;
    if (bytes > STRING_PROPERTY_MAX) throw new Error(`dynamic property ${k} is ${bytes} bytes, over ${STRING_PROPERTY_MAX}`);
}
const worldProps = new Map();   // the world's dynamic properties, kept for a test to read back
export const clock = { ticks: 0 };   // world.getAbsoluteTime, which a test moves on
export const world = new Proxy({
    getAbsoluteTime() { return clock.ticks; },
    getDynamicProperty(k) { return worldProps.get(k); },
    setDynamicProperty(k, v) { checkProperty(k, v); if (v === undefined) worldProps.delete(k); else worldProps.set(k, v); },
    getPlayers() { return []; },
    getAllPlayers() { return []; },
    afterEvents: anything(),
    beforeEvents: anything(),
}, handler);

export class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } getLore() { return []; } setLore() { } }
// a permutation that remembers its block and states, for a test's stand-in blocks to read back
export const BlockPermutation = { resolve: (id, states = {}) => ({ type: { id }, states, getState: (k) => states[k], withState: (k, v) => BlockPermutation.resolve(id, { ...states, [k]: v }) }) };
// keeps what is set on it, for a test to read back what a particle was given
export const MolangVariableMap = class { constructor() { this.values = {}; } setFloat(k, v) { this.values[k] = v; } setVector3(k, v) { this.values[k] = v; } setColorRGB(k, v) { this.values[k] = v; } setColorRGBA(k, v) { this.values[k] = v; } };
export const EntityComponentTypes = new Proxy({}, { get: (t, k) => String(k) });
export const EntityInitializationCause = anything(), InputButton = anything(), ButtonState = anything(), EntityDamageCause = anything();
export const EquipmentSlot = anything(), BlockVolume = class { constructor(from, to) { this.from = from; this.to = to; } }, StructureRotation = anything(), StructureSaveMode = anything();
export const CommandPermissionLevel = anything(), CustomCommandParamType = anything(), CustomCommandStatus = anything();
// BlockTypes.get: the block ids a test names, as a set it fills
export const blockIds = new Set();
export const BlockTypes = { get: (id) => (blockIds.has(id) ? { id } : undefined) };
