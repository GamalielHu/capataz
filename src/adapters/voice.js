// Dictado y lectura en voz alta.
// Android: reconocimiento nativo en segundo plano (sin la ventana de Google) y TTS nativo.
// Web: Web Speech API. Electron (y navegadores sin reconocimiento): graba el micrófono y transcribe con Gemini.
import { SpeechRecognition as SRNativo } from "@capacitor-community/speech-recognition";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { plataforma } from "./plataforma.js";
import { transcribir, sintetizar } from "./llm.js";

const IDIOMA = "es-419";
const IDIOMA_TTS = plataforma === "android" ? "es-US" : "es-419";
const SRWeb = plataforma === "web" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
let recWeb = null, cancelarNativo = null;

const puedeGrabar = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export const consejoDictado = plataforma === "electron"
  ? "Para hablar con Capataz en la PC pon tu clave de Gemini en Ajustes, o pulsa Win+H para dictar con Windows."
  : "Toca el micrófono de tu teclado para dictar.";

export const puedeDictar = () => plataforma === "android" || !!SRWeb || puedeGrabar;

async function permisoNativo(){
  if (!(await SRNativo.available()).available) throw { code:"no-disponible" };
  const p = await SRNativo.checkPermissions();
  if (p.speechRecognition !== "granted" && (await SRNativo.requestPermissions()).speechRecognition !== "granted") throw { code:"not-allowed" };
}

// Escucha una frase. onParcial(texto) recibe lo que va entendiendo. Resuelve con el texto final ("" si no hubo).
export async function dictar(onParcial){
  if (plataforma === "android"){
    await permisoNativo();
    return new Promise(async (ok, mal) => {
      let ultimo = "", listo = false, oyentes = [];
      const fin = v => { if (listo) return; listo = true; cancelarNativo = null; oyentes.forEach(o => o.remove()); ok(v.trim()); };
      cancelarNativo = () => { SRNativo.stop().catch(()=>{}); fin(ultimo); };
      oyentes.push(await SRNativo.addListener("partialResults", d => { ultimo = d?.matches?.[0] || ultimo; onParcial?.(ultimo); }));
      oyentes.push(await SRNativo.addListener("listeningState", d => { if (d?.status === "stopped") setTimeout(() => fin(ultimo), 250); }));
      SRNativo.start({ language:IDIOMA, maxResults:1, partialResults:true, popup:false })
        .then(r => { if (r?.matches?.[0]) ultimo = r.matches[0]; })
        .catch(e => { if (!listo){ listo = true; oyentes.forEach(o => o.remove()); /no match|didn't understand|7|6/i.test(String(e?.message)) ? ok("") : mal({ code: e?.message || "error" }); } });
    });
  }
  if (!SRWeb) return dictarGrabando(onParcial);
  return new Promise((ok, mal) => {
    recWeb = new SRWeb(); recWeb.lang = IDIOMA; recWeb.interimResults = true; recWeb.continuous = false;
    let final = "", parcial = "";
    recWeb.onresult = ev => { let t=""; for (const r of ev.results){ t += r[0].transcript; if (r.isFinal) final = t; } parcial = t; onParcial?.(t); };
    recWeb.onerror = ev => ev.error === "no-speech" || ev.error === "aborted" ? null : mal({ code: ev.error });
    recWeb.onend = () => ok((final || parcial).trim());
    recWeb.start();
  });
}
// Graba hasta que la persona deja de hablar (1,2 s de silencio) y transcribe con Gemini.
let pararGrabacion = null;
async function dictarGrabando(onParcial){
  let flujo;
  try { flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true } }); }
  catch { throw { code:"not-allowed" }; }
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const analizador = ctx.createAnalyser(); analizador.fftSize = 1024;
  ctx.createMediaStreamSource(flujo).connect(analizador);
  const muestras = new Uint8Array(analizador.fftSize);
  const tipo = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";
  const grabador = new MediaRecorder(flujo, tipo ? { mimeType:tipo } : {});
  const trozos = []; grabador.ondataavailable = e => e.data.size && trozos.push(e.data);
  let hablo = false;
  const inicio = Date.now(); let ultimaVoz = inicio;
  await new Promise(ok => {
    pararGrabacion = ok;
    grabador.onstop = ok;
    grabador.start(250);
    onParcial?.("…");
    const vigilar = () => {
      if (grabador.state !== "recording") return;
      analizador.getByteTimeDomainData(muestras);
      let suma = 0; for (const v of muestras){ const x = (v - 128) / 128; suma += x*x; }
      const nivel = Math.sqrt(suma / muestras.length), ahora = Date.now();
      if (nivel > 0.04){ hablo = true; ultimaVoz = ahora; }
      if ((hablo && ahora - ultimaVoz > 1200) || (!hablo && ahora - inicio > 7000) || ahora - inicio > 45000) return grabador.stop();
      requestAnimationFrame(vigilar);
    };
    vigilar();
  });
  if (grabador.state === "recording"){ grabador.stop(); await new Promise(ok => grabador.onstop = ok); }
  pararGrabacion = null;
  flujo.getTracks().forEach(t => t.stop()); ctx.close().catch(()=>{});
  if (!hablo || !trozos.length) return "";
  onParcial?.("Entendiendo…");
  const blob = new Blob(trozos, { type: (tipo || "audio/webm").split(";")[0] });
  const data = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
  try { const t = await transcribir({ mime: blob.type, data }); onParcial?.(t); return t; }
  catch(e){ throw { code: e?.code === "sin_clave" || e?.code === "sin_audio" ? "no-disponible" : (e?.code || "red") }; }
}

export function detener(){
  if (plataforma === "android") cancelarNativo ? cancelarNativo() : SRNativo.stop().catch(()=>{});
  else if (pararGrabacion) pararGrabacion();
  else try { recWeb?.stop(); } catch {}
}

// Elige la mejor voz en español disponible en el navegador/PC.
let vozWeb = null;
function elegirVoz(){
  const voces = (window.speechSynthesis?.getVoices?.() || []).filter(v => /^es/i.test(v.lang));
  const pref = [/natural|neural|online/i, /google/i, /es-(419|US|MX|BO)/i, /.*/];
  for (const re of pref){ const v = voces.find(v => re.test(v.name + " " + v.lang)); if (v) return v; }
  return null;
}
try { speechSynthesis.onvoiceschanged = () => { vozWeb = elegirVoz(); }; vozWeb = elegirVoz(); } catch {}

// Audio de Gemini → Blob WAV reproducible (PCM L16 viene sin cabecera).
function aWav({ mime, data }){
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  if (/wav/i.test(mime)) return new Blob([bytes], { type:"audio/wav" });
  const tasa = +(/rate=(\d+)/.exec(mime)?.[1] || 24000);
  const cab = new DataView(new ArrayBuffer(44));
  const txt = (o, t) => [...t].forEach((c, i) => cab.setUint8(o + i, c.charCodeAt(0)));
  txt(0,"RIFF"); cab.setUint32(4, 36 + bytes.length, true); txt(8,"WAVE"); txt(12,"fmt ");
  cab.setUint32(16,16,true); cab.setUint16(20,1,true); cab.setUint16(22,1,true); cab.setUint32(24,tasa,true);
  cab.setUint32(28,tasa*2,true); cab.setUint16(32,2,true); cab.setUint16(34,16,true); txt(36,"data"); cab.setUint32(40,bytes.length,true);
  return new Blob([cab, bytes], { type:"audio/wav" });
}

let reproductor = null, cortar = null;
async function hablarNatural(texto){
  const audio = await sintetizar(texto.slice(0, 700));
  const url = URL.createObjectURL(aWav(audio));
  try {
    await new Promise((ok, mal) => {
      reproductor = new Audio(url);
      cortar = ok;
      reproductor.onended = ok; reproductor.onerror = () => mal({ code:"audio" });
      reproductor.play().catch(mal);
    });
  } finally { reproductor = null; cortar = null; URL.revokeObjectURL(url); }
}

let naturalFalla = 0; // tras 3 fallos seguidos (sin clave, límite gratis) usa la voz del sistema un rato
// Habla y resuelve cuando termina de hablar. natural: intenta la voz de Gemini primero.
export async function hablar(texto, { natural = true } = {}){
  texto = String(texto||"").replace(/[*_#`•]/g, "").trim(); if (!texto) return;
  if (natural && naturalFalla < 3){
    try { await hablarNatural(texto); naturalFalla = 0; return; }
    catch(e){ if (e?.code === "sin_audio" || e?.code === "sin_clave") naturalFalla = 3; else naturalFalla++; if (e?.code === "cortado") return; }
  }
  try {
    if (plataforma === "android"){ await TextToSpeech.stop(); await TextToSpeech.speak({ text:texto, lang:IDIOMA_TTS, rate:1.05, pitch:1, category:"playback" }); return; }
    await new Promise(ok => {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto); u.lang = IDIOMA_TTS; if (vozWeb) u.voice = vozWeb; u.rate = 1.05;
      u.onend = u.onerror = () => ok();
      speechSynthesis.speak(u);
      setTimeout(ok, 1000 + texto.length * 90); // por si el navegador no avisa al terminar
    });
  } catch {}
}
export function callar(){
  try { if (reproductor){ reproductor.pause(); cortar?.(); } } catch {}
  try { plataforma === "android" ? TextToSpeech.stop() : speechSynthesis.cancel(); } catch {}
}
export const reiniciarVozNatural = () => { naturalFalla = 0; };
