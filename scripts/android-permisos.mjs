// Inserta permisos y <queries> en android/app/src/main/AndroidManifest.xml (idempotente; correr tras cap add/sync).
import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "android/app/src/main/AndroidManifest.xml";
const PERMISOS = [
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.WAKE_LOCK",
  "android.permission.VIBRATE",
  "android.permission.RECORD_AUDIO"
];
const QUERIES = `    <queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
    </queries>
`;

let xml = readFileSync(RUTA, "utf8");
const faltan = PERMISOS.filter(p => !xml.includes(`"${p}"`));
let bloque = faltan.map(p => `    <uses-permission android:name="${p}" />\n`).join("");
if (!xml.includes("android.speech.RecognitionService")) bloque += QUERIES;
if (bloque) {
  xml = xml.replace(/(\n\s*<application)/, "\n" + bloque + "$1");
  writeFileSync(RUTA, xml);
}
console.log(bloque ? `Manifiesto actualizado (${faltan.length} permisos).` : "Manifiesto ya estaba al día.");
