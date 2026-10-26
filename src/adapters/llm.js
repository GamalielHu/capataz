// Cliente de la API de Anthropic con la clave del usuario.
// Android: clave en Keystore (SecureStorage) y petición nativa (CapacitorHttp, sin CORS).
// Electron: clave cifrada con safeStorage y petición desde el proceso principal (la clave nunca llega a la ventana).
// Web: clave en localStorage y fetch directo desde el navegador.
import { CapacitorHttp } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { plataforma, nativo } from "./plataforma.js";
import { ls } from "../core/util.js";

export const MODELO_POR_DEFECTO = "claude-sonnet-5-5";
const URL_API = "https://api.anthropic.com/v1/messages";
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

const errorPorEstado = s => ({ code: s===401||s===403 ? "clave_invalida" : s===429 ? "rate_limited" : s>=500 ? "sobrecargado" : "api_" + s });

// Devuelve el texto de la respuesta del modelo.
export async function enviar({ system, messages, modelo, maxTokens = 1024 }){
  const cuerpo = { model: modelo || MODELO_POR_DEFECTO, max_tokens: maxTokens, system, messages };
  if (plataforma === "electron")
    // ipcRenderer.invoke solo conserva el mensaje del error: "... Error: <código>"
    return nativo.ia(cuerpo).catch(e => { throw { code: String(e?.message || "").split("Error: ").pop() || "red" }; });
  const clave = await leerClave();
  if (!clave) throw { code:"sin_clave" };
  const headers = { "content-type":"application/json", "x-api-key":clave, "anthropic-version":"2023-06-01" };
  let estado, datos;
  try {
    if (plataforma === "android"){
      const r = await CapacitorHttp.request({ url:URL_API, method:"POST", headers, data:cuerpo, connectTimeout:30000, readTimeout:90000 });
      estado = r.status; datos = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    } else {
      const r = await fetch(URL_API, { method:"POST", headers:{ ...headers, "anthropic-dangerous-direct-browser-access":"true" }, body:JSON.stringify(cuerpo) });
      estado = r.status; datos = await r.json();
    }
  } catch { throw { code:"red" }; }
  if (estado !== 200) throw errorPorEstado(estado);
  return (datos.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}
