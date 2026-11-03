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
const worldProps = new Map();   // the world's dynamic properties, kept for a test to read back
export const world = new Proxy({
    getDynamicProperty(k) { return worldProps.get(k); },
    setDynamicProperty(k, v) { if (v === undefined) worldProps.delete(k); else worldProps.set(k, v); },
    getPlayers() { return []; },
    getAllPlayers() { return []; },
    afterEvents: anything(),
    beforeEvents: anything(),
}, handler);

export class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; } getLore() { return []; } setLore() { } }
export const BlockPermutation = anything(), MolangVariableMap = class { setFloat() { } setVector3() { } setColorRGB() { } setColorRGBA() { } };
export const EntityComponentTypes = new Proxy({}, { get: (t, k) => String(k) });
export const EntityInitializationCause = anything(), InputButton = anything(), ButtonState = anything(), EntityDamageCause = anything();
export const EquipmentSlot = anything(), BlockVolume = class { }, StructureRotation = anything(), StructureSaveMode = anything();
export const CommandPermissionLevel = anything(), CustomCommandParamType = anything(), CustomCommandStatus = anything();
