// Cliente de IA con la clave del usuario: Google Gemini (gratis) o Anthropic Claude, según la clave.
// La clave se guarda en secure_config.js. Android: petición nativa (CapacitorHttp).
// Electron: petición desde el proceso principal. Web: fetch directo desde el navegador.
import { CapacitorHttp } from "@capacitor/core";
import { plataforma, nativo } from "./plataforma.js";
import { getApiKey, setApiKey, hasApiKey } from "./secure_config.js";
import { peticion, textoDe, codigoError, modelosA, reintentable, MODELOS_VOZ, peticionVoz, audioDe, proveedorDe } from "../../electron/proveedores.js";

export const guardarClave = clave => setApiKey(clave);
const leerClave = async () => (await getApiKey()) || null;
export const tieneClave = hasApiKey;

// Devuelve el texto de la respuesta del modelo.
export async function enviar(pedido){
  if (plataforma === "electron")
    // ipcRenderer.invoke solo conserva el mensaje del error: "... Error: <código>"
    return nativo.ia(pedido).catch(e => { throw { code: String(e?.message || "").split("Error: ").pop() || "red" }; });
  const clave = await leerClave();
  if (!clave) throw { code:"sin_clave" };
  let error;
  for (const modelo of modelosA(clave, pedido.modelo, pedido.potente)){
    try { return await pedir(clave, { ...pedido, modelo }); }
    catch(e){ error = e; if (!reintentable(e?.code)) throw e; }
  }
  throw error;
}

async function pedir(clave, pedido, armado){
  const { url, headers, body } = armado || peticion(clave, pedido, plataforma === "web");
  let estado, datos;
  try {
    if (plataforma === "android"){
      const r = await CapacitorHttp.request({ url, method:"POST", headers, data:body, connectTimeout:30000, readTimeout:90000 });
      estado = r.status; datos = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    } else {
      const r = await fetch(url, { method:"POST", headers, body:JSON.stringify(body) });
      estado = r.status; datos = await r.json();
    }
  } catch { throw { code:"red" }; }
  if (estado !== 200) throw { code: codigoError(estado, datos) };
  return armado ? datos : textoDe(clave, datos);
}

// Transcribe audio con Gemini (para dictar donde no hay reconocimiento del sistema, como en la PC).
export async function transcribir(audio){
  const t = await enviar({
    system: "Transcribes audio en español latinoamericano. Devuelve solo el texto dicho, sin comillas ni comentarios. Si no se entiende nada, devuelve vacío.",
    messages: [{ role:"user", content:"Transcribe este audio." }], audio, json:false, maxTokens:1024 });
  return t.trim().replace(/^["“]|["”]$/g, "");
}

// Voz natural con Gemini: devuelve {mime, data base64} o lanza {code}.
export async function sintetizar(texto, voz){
  if (plataforma === "electron")
    return nativo.voz(texto, voz).catch(e => { throw { code: String(e?.message || "").split("Error: ").pop() || "red" }; });
  const clave = await leerClave();
  if (!clave || proveedorDe(clave) !== "gemini") throw { code:"sin_audio" };
  let error;
  for (const modelo of MODELOS_VOZ){
    try {
      const audio = audioDe(await pedir(clave, null, peticionVoz(clave, texto, modelo, voz)));
      if (audio) return audio; error = { code:"sin_audio" };
    } catch(e){ error = e; if (!reintentable(e?.code)) throw e; }
  }
  throw error;
}

// Clave de Gemini para la voz en tiempo real (WebSocket directo a Google). null si no hay o es de Claude.
export async function claveGemini(){
  if (plataforma === "electron") return nativo.claveGemini();
  const clave = await leerClave();
  return clave && proveedorDe(clave) === "gemini" ? clave : null;
}

// Respuesta por partes (streaming) con Gemini: onTexto(acumulado) se llama mientras el modelo escribe.
// Cuando Google está lento, si un modelo no empieza a escribir en ESCALON ms se lanza el siguiente en paralelo
// y se queda el primero que conteste. Si no hay streaming posible (Claude, fetch bloqueado) usa enviar().
const ESCALON = 4000, ESPERA_MAX = 75000, EN_PARALELO = 4;

// Una petición en streaming. alPrimero() se llama con el primer texto; si devuelve false, se corta.
async function flujo(clave, pedido, signal, alPrimero, onTexto){
  const { url, headers, body } = peticion(clave, { ...pedido, stream:true }, true);
  let r;
  try { r = await fetch(url, { method:"POST", headers, body:JSON.stringify(body), signal }); }
  catch { throw { code: signal.aborted ? "cancelado" : "red" }; }
  if (r.status !== 200){ let d; try { d = await r.json(); } catch {} throw { code: codigoError(r.status, Array.isArray(d) ? d[0] : d) }; }
  const lector = r.body.getReader(), dec = new TextDecoder();
  let buf = "", texto = "";
  try {
    for (;;){
      const { value, done } = await lector.read(); if (done) break;
      buf = (buf + dec.decode(value, { stream:true })).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0){
        const linea = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!linea.startsWith("data:")) continue;
        let d; try { d = JSON.parse(linea.slice(5)); } catch { continue; }
        const t = textoDe(clave, d);
        if (!t) continue;
        if (!texto && !alPrimero()){ lector.cancel().catch(() => {}); throw { code:"cancelado" }; }
        texto += t; onTexto(texto);
      }
    }
  } catch(e){ if (e?.code) throw e; throw { code: signal.aborted ? "cancelado" : "red", parcial: texto }; }
  return texto;
}

export async function enviarEnVivo(pedido, onTexto){
  const clave = await claveGemini();
  if (!clave) return enviar(pedido);
  const modelos = modelosA(clave, pedido.modelo, pedido.potente).slice(0, EN_PARALELO);
  const resultado = await new Promise(resolver => {
    const cortes = [], errores = [];
    let lanzados = 0, ganador = null, listo = false, escalon;
    const fin = v => {
      if (listo) return; listo = true; clearTimeout(escalon); clearTimeout(tope);
      cortes.forEach(c => c !== ganador && c.abort()); resolver(v);
    };
    const tope = setTimeout(() => fin({ error:{ code:"sobrecargado" } }), ESPERA_MAX);
    const fallo = e => {
      errores.push(e);
      if (!reintentable(e.code) && e.code !== "red" && e.code !== "cancelado") return fin({ error:e }); // clave inválida, etc.
      if (lanzados < modelos.length) return lanzar();
      if (errores.length >= lanzados) fin(errores.every(x => x.code === "red") ? { usarNormal:true } : { error: errores.find(x => x.code !== "red" && x.code !== "cancelado") || { code:"sobrecargado" } });
    };
    function lanzar(){
      if (listo || ganador || lanzados >= modelos.length) return;
      const modelo = modelos[lanzados++], corte = new AbortController();
      cortes.push(corte);
      clearTimeout(escalon); escalon = setTimeout(lanzar, ESCALON);
      const alPrimero = () => {
        if (ganador && ganador !== corte) return false;
        ganador = corte; clearTimeout(escalon);
        cortes.forEach(c => c !== corte && c.abort());
        return true;
      };
      flujo(clave, { ...pedido, modelo }, corte.signal, alPrimero, t => onTexto?.(t))
        .then(texto => {
          if (texto) return fin({ texto });
          if (ganador === corte) ganador = null;
          fallo({ code:"sobrecargado" });
        })
        .catch(e => {
          if (ganador === corte) return e.parcial ? fin({ texto:e.parcial }) : fin({ error:{ code:"red" } });
          if (e.code === "cancelado" && ganador) return;
          fallo(e);
        });
    }
    lanzar();
  });
  if (resultado.usarNormal) return enviar(pedido);  // fetch bloqueado o sin red: camino normal
  if (resultado.error) throw resultado.error;
  return resultado.texto;
}
