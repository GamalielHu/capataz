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
// Si el modelo tarda en empezar se pasa al siguiente; si no hay streaming posible (Claude, sin red) usa enviar().
const ESPERA_INICIO = 15000;
export async function enviarEnVivo(pedido, onTexto){
  const clave = await claveGemini();
  if (!clave) return enviar(pedido);
  let error;
  for (const modelo of modelosA(clave, pedido.modelo, pedido.potente)){
    const { url, headers, body } = peticion(clave, { ...pedido, modelo, stream:true }, true);
    const corte = new AbortController();
    let reloj = setTimeout(() => corte.abort(), ESPERA_INICIO), texto = "", recibio = false;
    try {
      const r = await fetch(url, { method:"POST", headers, body:JSON.stringify(body), signal:corte.signal });
      if (r.status !== 200){ let d; try { d = await r.json(); } catch {} throw { code: codigoError(r.status, Array.isArray(d) ? d[0] : d) }; }
      const lector = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;){
        const { value, done } = await lector.read(); if (done) break;
        buf = (buf + dec.decode(value, { stream:true })).replace(/\r/g, "");
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0){
          const linea = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!linea.startsWith("data:")) continue;
          let d; try { d = JSON.parse(linea.slice(5)); } catch { continue; }
          const t = textoDe(clave, d);
          if (t){
            if (!recibio){ recibio = true; clearTimeout(reloj); reloj = setTimeout(() => corte.abort(), 90000); }
            texto += t; onTexto?.(texto);
          }
        }
      }
      clearTimeout(reloj);
      if (texto) return texto;
      error = { code:"sobrecargado" };
    } catch(e){
      clearTimeout(reloj);
      if (recibio) throw { code:"red" };            // se cortó a la mitad
      error = e?.code ? e : { code: corte.signal.aborted ? "sobrecargado" : "red" };
      if (error.code === "red") return enviar(pedido); // fetch bloqueado o sin red: camino normal
      if (!reintentable(error.code)) throw error;
    }
  }
  throw error;
}
