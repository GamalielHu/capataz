// Voz en tiempo real con Gemini Live: conversación hablada continua, como una llamada (estilo ChatGPT).
// Micrófono → PCM 16 kHz por WebSocket; la IA responde con audio PCM 24 kHz, transcripciones y llamadas a herramientas.
import { claveGemini } from "../adapters/llm.js";
import { sistemaViva, HERRAMIENTAS, ejecutarHerramienta } from "./ia.js";

// Primero el de nivel gratuito; los más nuevos pueden pedir plan de pago (cierre 1011 "quota").
const MODELOS = ["gemini-2.5-flash-native-audio-latest", "gemini-3.8-live", "gemini-3.1-flash-live-preview"];
const URL_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=";

const CAPTURA = `
class Captura extends AudioWorkletProcessor {
  process(entradas){ const c = entradas[0]?.[0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor("captura", Captura);`;

function aBase64(bytes){
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// eventos: {estado(e), oyendo(texto), diciendo(texto), turno({usuario, respuesta, hechos}), error(code)}
export async function iniciarVozViva({ voz = "Charon", interrumpir = false, eventos }){
  const clave = await claveGemini();
  if (!clave) throw { code:"sin_gemini" };

  let flujo;
  try { flujo = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 } }); }
  catch { throw { code:"not-allowed" }; }

  const ctxMic = new AudioContext();
  const ctxVoz = new AudioContext({ sampleRate:24000 });
  await ctxMic.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURA], { type:"application/javascript" })));
  const fuente = ctxMic.createMediaStreamSource(flujo);
  const nodo = new AudioWorkletNode(ctxMic, "captura");
  fuente.connect(nodo);

  const sistema = await sistemaViva();
  let ws = null, abierto = false, cerrado = false, modeloIdx = 0;
  let siguiente = 0, fuentes = new Set(), silenciado = false;
  let oido = "", dicho = "", hechos = [], cerrarTras = false;

  const hablando = () => ctxVoz.currentTime < siguiente;
  const emitir = (n, ...a) => { try { eventos?.[n]?.(...a); } catch {} };

  /* ----- micrófono: 48 kHz float → 16 kHz PCM16, ~100 ms por envío ----- */
  const factor = ctxMic.sampleRate / 16000;
  let pos = 0, acumulado = [];
  nodo.port.onmessage = ({ data }) => {
    if (!abierto || silenciado) return;
    if (!interrumpir && ctxVoz.currentTime < siguiente + 0.35){ pos = 0; return; } // medio dúplex: no se oye a sí mismo
    for (; pos < data.length; pos += factor){
      const a = Math.floor(pos), b = Math.min(data.length, Math.max(a + 1, Math.floor(pos + factor)));
      let suma = 0; for (let k = a; k < b; k++) suma += data[k];
      const v = Math.max(-1, Math.min(1, suma / (b - a)));
      acumulado.push(v < 0 ? v * 0x8000 : v * 0x7fff);
    }
    pos -= data.length;
    if (acumulado.length >= 1600){
      const pcm = Int16Array.from(acumulado); acumulado = [];
      ws.send(JSON.stringify({ realtimeInput:{ audio:{ data:aBase64(new Uint8Array(pcm.buffer)), mimeType:"audio/pcm;rate=16000" } } }));
    }
  };

  /* ----- reproducción: cola de trozos PCM 24 kHz ----- */
  function reproducir(b64){
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    const buf = ctxVoz.createBuffer(1, pcm.length, 24000), canal = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 0x8000;
    const src = ctxVoz.createBufferSource(); src.buffer = buf; src.connect(ctxVoz.destination);
    siguiente = Math.max(siguiente, ctxVoz.currentTime + 0.05);
    src.start(siguiente); siguiente += buf.duration;
    fuentes.add(src); src.onended = () => { fuentes.delete(src); if (!hablando()) emitir("estado", "escuchando"); };
    emitir("estado", "hablando");
  }
  function cortarVoz(){ fuentes.forEach(s => { try { s.stop(); } catch {} }); fuentes.clear(); siguiente = 0; }

  function cerrarTurno(){
    if (oido.trim() || dicho.trim()) emitir("turno", { usuario:oido.trim(), respuesta:dicho.trim(), hechos });
    oido = ""; dicho = ""; hechos = [];
  }

  /* ----- conexión ----- */
  function conectar(){
    ws = new WebSocket(URL_WS + encodeURIComponent(clave));
    ws.onopen = () => ws.send(JSON.stringify({ setup:{
      model:"models/" + MODELOS[modeloIdx],
      generationConfig:{ responseModalities:["AUDIO"], speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName:voz } } } },
      systemInstruction:{ parts:[{ text:sistema }] },
      tools:[{ functionDeclarations:HERRAMIENTAS }, { googleSearch:{} }],
      inputAudioTranscription:{}, outputAudioTranscription:{},
      realtimeInputConfig:{ automaticActivityDetection:{ silenceDurationMs:700 } }
    } }));
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : await ev.data.text()); } catch { return; }
      window.__depurarVoz?.(m, MODELOS[modeloIdx]);
      if (m.setupComplete){
        abierto = true; emitir("estado", "escuchando");
        ws.send(JSON.stringify({ clientContent:{ turns:[{ role:"user", parts:[{ text:"(Abrí la conversación por voz. Salúdame en una frase corta.)" }] }], turnComplete:true } }));
        return;
      }
      if (m.toolCall){
        emitir("estado", "pensando");
        const respuestas = [];
        for (const f of m.toolCall.functionCalls || []){
          const { resultado, hechos:h, cerrarVoz } = await ejecutarHerramienta(f.name, f.args || {});
          hechos.push(...h); if (cerrarVoz) cerrarTras = true; respuestas.push({ id:f.id, name:f.name, response:{ result:resultado } });
        }
        ws.send(JSON.stringify({ toolResponse:{ functionResponses:respuestas } }));
        return;
      }
      const sc = m.serverContent; if (!sc) return;
      if (sc.interrupted){ cortarVoz(); emitir("estado", "escuchando"); }
      if (sc.inputTranscription?.text){ oido += sc.inputTranscription.text; emitir("oyendo", oido.trim()); emitir("estado", "pensando"); }
      if (sc.outputTranscription?.text){ dicho += sc.outputTranscription.text; emitir("diciendo", dicho.trim()); }
      for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data) reproducir(p.inlineData.data);
      if (sc.turnComplete){
        cerrarTurno();
        // Abrió música, una llamada o una app: termina la conversación cuando acabe de hablar.
        if (cerrarTras){ cerrarTras = false; const fin = () => hablando() ? setTimeout(fin, 300) : emitir("terminar"); fin(); }
      }
    };
    ws.onclose = ev => {
      window.__depurarVoz?.({ cierre:{ code:ev.code, reason:ev.reason } }, MODELOS[modeloIdx]);
      const estaba = abierto; abierto = false;
      if (cerrado) return;
      if (!estaba && modeloIdx < MODELOS.length - 1){ modeloIdx++; conectar(); return; } // modelo no disponible: probar otro
      cerrarTurno();
      emitir("error", ev.code === 1007 || ev.code === 1008 ? "clave_invalida" : "cortado");
    };
  }
  conectar();
  if (ctxMic.state === "suspended") await ctxMic.resume();
  if (ctxVoz.state === "suspended") await ctxVoz.resume();

  return {
    interrumpir(){ cortarVoz(); emitir("estado", "escuchando"); },
    silenciar(v){ silenciado = v; },
    hablandoAhora: hablando,
    cerrar(){
      cerrado = true; cerrarTurno(); cortarVoz();
      try { ws?.close(); } catch {}
      flujo.getTracks().forEach(t => t.stop());
      ctxMic.close().catch(()=>{}); ctxVoz.close().catch(()=>{});
    }
  };
}
