// Cliente de IA con la clave del usuario: Google Gemini (gratis) o Anthropic Claude, según la clave.
// Android: clave en Keystore (SecureStorage) y petición nativa (CapacitorHttp, sin CORS).
// Electron: clave cifrada con safeStorage y petición desde el proceso principal (la clave nunca llega a la ventana).
// Web: clave en localStorage y fetch directo desde el navegador.
import { CapacitorHttp } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { plataforma, nativo } from "./plataforma.js";
import { ls } from "../core/util.js";
import { peticion, textoDe, codigoError, modelosA, reintentable, MODELOS_VOZ, peticionVoz, audioDe, proveedorDe } from "../../electron/proveedores.js";

const K = "capataz-clave-api";

export async function guardarClave(clave){
  clave = String(clave||"").trim();
  if (plataforma === "electron") return nativo.guardarClave(clave);
  if (plataforma === "android") return clave ? SecureStorage.set(K, clave) : SecureStorage.remove(K);
  ls.set(K, clave || null);
}
async function leerClave(){
  if (plataforma === "android") try { return await SecureStorage.get(K); } catch { return null; }
  return ls.get(K, null);
}
export const tieneClave = async () => plataforma === "electron" ? nativo.tieneClave() : !!(await leerClave());

// Devuelve el texto de la respuesta del modelo.
export async function enviar(pedido){
  if (plataforma === "electron")
    // ipcRenderer.invoke solo conserva el mensaje del error: "... Error: <código>"
    return nativo.ia(pedido).catch(e => { throw { code: String(e?.message || "").split("Error: ").pop() || "red" }; });
  const clave = await leerClave();
  if (!clave) throw { code:"sin_clave" };
  let error;
  for (const modelo of modelosA(clave, pedido.modelo)){
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
export async function sintetizar(texto){
  if (plataforma === "electron")
    return nativo.voz(texto).catch(e => { throw { code: String(e?.message || "").split("Error: ").pop() || "red" }; });
  const clave = await leerClave();
  if (!clave || proveedorDe(clave) !== "gemini") throw { code:"sin_audio" };
  let error;
  for (const modelo of MODELOS_VOZ){
    try {
      const audio = audioDe(await pedir(clave, null, peticionVoz(clave, texto, modelo)));
      if (audio) return audio; error = { code:"sin_audio" };
    } catch(e){ error = e; if (!reintentable(e?.code)) throw e; }
  }
  throw error;
}
