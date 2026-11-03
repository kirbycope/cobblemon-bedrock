// Node module hook for tools/battle_test: the add-on's scripts import Minecraft's script modules, which exist only
// inside the game, so these two resolve to the stubs beside this file.
const STUBS = { "@minecraft/server": "./stub_server.mjs", "@minecraft/server-ui": "./stub_ui.mjs" };

export async function resolve(specifier, context, next) {
    if (STUBS[specifier]) return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
}
