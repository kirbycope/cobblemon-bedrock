// Each pack's description carries its version, which Bedrock's import and pack lists show, so an old copy of the
// add-on can be told from a new one (port.py's bump_pack_versions writes it)
import { readFileSync } from "node:fs";
import { check } from "../harness.mjs";

for (const pack of ["development_behavior_packs", "development_resource_packs"]) {
    const { header } = JSON.parse(readFileSync(new URL(`../../../${pack}/cobblemon/manifest.json`, import.meta.url), "utf8"));
    check(`${pack}'s description names its version ${header.version.join(".")}`, header.description.endsWith(` ${header.version.join(".")}`));
}
