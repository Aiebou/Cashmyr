// Contrôle du latest.json d'une Release avant sa publication (job « Publication » de release.yml).
// Un paquet signé par une autre clé que celle de tauri.conf.json ferait refuser toutes les mises
// à jour par les applications installées, sans que la construction échoue : on le bloque ici.
//
//   node .github/scripts/check-latest.mjs <latest.json> <tauri.conf.json> <version>

import { readFileSync } from "node:fs";

const [latestPath, confPath, version] = process.argv.slice(2);
if (!latestPath || !confPath || !version) {
  console.error("usage : node check-latest.mjs <latest.json> <tauri.conf.json> <version>");
  process.exit(2);
}

/** Plateformes que l'updater doit trouver : macOS (deux architectures), Linux, Windows. */
const REQUIRED = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];

/**
 * Identifiant de la clé d'une clé publique ou d'une signature minisign, telles que Tauri les
 * écrit : base64 d'un texte dont la deuxième ligne, en base64, commence par deux octets
 * d'algorithme puis les huit octets de l'identifiant.
 */
function keyId(minisign) {
  const line = Buffer.from(minisign, "base64").toString("utf8").split("\n")[1];
  const bytes = line ? Buffer.from(line, "base64").subarray(2, 10) : Buffer.alloc(0);
  if (bytes.length !== 8) throw new Error("format minisign inattendu");
  // Affiché comme minisign : entier de 64 bits, petit-boutiste, en hexadécimal.
  return BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`).toString(16).toUpperCase();
}

const errors = [];
const latest = JSON.parse(readFileSync(latestPath, "utf8"));
const expectedKey = keyId(JSON.parse(readFileSync(confPath, "utf8")).plugins.updater.pubkey);

if (latest.version !== version) errors.push(`latest.json annonce la version ${latest.version} au lieu de ${version}`);

const platforms = latest.platforms ?? {};
const missing = REQUIRED.filter((p) => !platforms[p]?.url || !platforms[p]?.signature);
if (missing.length > 0) errors.push(`latest.json ne couvre pas ${missing.join(", ")}`);

for (const [name, entry] of Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b))) {
  let signer;
  try {
    signer = keyId(entry.signature ?? "");
  } catch {
    errors.push(`${name} : signature illisible`);
    continue;
  }
  if (signer !== expectedKey) {
    errors.push(`${name} : signé par la clé ${signer}, alors que tauri.conf.json attend ${expectedKey}`);
  } else {
    console.log(`${name.padEnd(24)} clé ${signer}  ${String(entry.url).split("/").pop()}`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}
console.log(`latest.json ${version} : ${Object.keys(platforms).length} entrées, toutes signées par la clé ${expectedKey}.`);
