// Dictado y lectura en voz alta.
// Android: reconocimiento y TTS nativos (plugins community). Web: Web Speech API.
// Electron: Chromium no trae servicio de reconocimiento; se sugiere el dictado de Windows (Win+H). TTS con speechSynthesis.
import { SpeechRecognition as SRNativo } from "@capacitor-community/speech-recognition";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { plataforma } from "./plataforma.js";

const IDIOMA = "es-419";
const SRWeb = plataforma === "web" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let recWeb = null;

export const consejoDictado = plataforma === "electron"
  ? "Pulsa Win+H para dictar con Windows."
  : "Toca el micrófono de tu teclado para dictar.";

export const puedeDictar = () => plataforma === "android" || !!SRWeb;

// Resuelve con el texto final ("" si no hubo). Lanza {code:"not-allowed"} si no hay permiso.
export async function dictar(onParcial){
  if (plataforma === "android"){
    if (!(await SRNativo.available()).available) throw { code:"no-disponible" };
    const p = await SRNativo.checkPermissions();
    if (p.speechRecognition !== "granted" && (await SRNativo.requestPermissions()).speechRecognition !== "granted") throw { code:"not-allowed" };
    const r = await SRNativo.start({ language:IDIOMA, maxResults:1, partialResults:false, popup:true });
    return r?.matches?.[0] || "";
  }
  if (!SRWeb) throw { code:"no-disponible" };
  return new Promise((ok, mal) => {
    recWeb = new SRWeb(); recWeb.lang = IDIOMA; recWeb.interimResults = true; recWeb.continuous = false;
    let final = "";
    recWeb.onresult = ev => { let t=""; for (const r of ev.results){ t += r[0].transcript; if (r.isFinal) final = t; } onParcial?.(t); };
    recWeb.onerror = ev => mal({ code: ev.error });
    recWeb.onend = () => ok(final.trim());
    recWeb.start();
  });
}
export function detener(){
  if (plataforma === "android") SRNativo.stop().catch(()=>{});
  else try { recWeb?.stop(); } catch {}
}

export async function hablar(texto){
  try {
    if (plataforma === "android"){ await TextToSpeech.stop(); await TextToSpeech.speak({ text:texto, lang:IDIOMA, rate:1 }); return; }
    speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(texto); u.lang = IDIOMA; speechSynthesis.speak(u);
  } catch {}
}
