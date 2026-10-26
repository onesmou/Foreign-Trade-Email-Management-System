import AdmZip from "adm-zip";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const file = path.resolve(
  process.argv[2] || "outputs/android/RehabIntl-CRM-1.0.0.apk",
);
const bytes = await readFile(file),
  zip = new AdmZip(bytes),
  entries = zip.getEntries().map((entry) => entry.entryName);
const forbidden = entries.filter((name) =>
  /(^|\/)(\.env(?:\.|$)|key\.properties$|.*\.(?:sqlite|jks|keystore)$|customer-inquiries\/|v2-preview\/)/i.test(
    name,
  ),
);
if (forbidden.length)
  throw new Error("Private material included in APK: " + forbidden.join(", "));
if (
  !entries.includes("AndroidManifest.xml") ||
  !entries.some((name) => /^classes\d*\.dex$/.test(name))
)
  throw new Error("APK manifest or bytecode missing");
const bytecode = Buffer.concat(
  zip
    .getEntries()
    .filter((entry) => /^classes\d*\.dex$/.test(entry.entryName))
    .map((entry) => entry.getData()),
);
const chineseUiStringsPresent = bytecode.includes(
  Buffer.from("服务器证书校验失败", "utf8"),
);
const pinnedServerInBytecode = bytecode.includes(
  Buffer.from("https://wmcrm.jbenlz.com/", "utf8"),
);
if (!chineseUiStringsPresent || !pinnedServerInBytecode)
  throw new Error("Packaged language or server configuration is incorrect");
const report = {
  file: path.basename(file),
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  entries: entries.length,
  privateMaterialFound: forbidden.length,
  nativeLibraries: entries.filter((name) => name.startsWith("lib/")).length,
  chineseUiStringsPresent,
  pinnedServerInBytecode,
  verification:
    "APK contents checked; signature separately verified by Android apksigner. No real-device acceptance claimed.",
};
await writeFile(
  file + ".verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
