// Clave de IA permanente y editable.
// Android: Keystore (SecureStorage) + respaldo "ConfigSegura" (copia de Google y Documentos/Capataz/config.enc).
// Electron: %APPDATA%/CapatazConfig/secrets.json cifrado con DPAPI (proceso principal).
// Web: localStorage.
import { registerPlugin } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { plataforma, nativo } from "./plataforma.js";
import { ls } from "../core/util.js";

const K = "capataz-clave-api";
const Respaldo = plataforma === "android" ? registerPlugin("ConfigSegura") : null;
let origen = "";   // "", "copia" o "archivo": de dónde se recuperó la clave tras reinstalar

export async function getApiKey(){
  if (plataforma === "electron") return (await nativo.getKey()) || "";
  if (plataforma === "web") return ls.get(K, null) || "";
  let clave = null;
  try { clave = await SecureStorage.get(K); } catch {}
  if (clave) return clave;
  try {
    const r = await Respaldo.leer();
    if (r?.clave){ origen = r.origen; try { await SecureStorage.set(K, r.clave); } catch {} return r.clave; }
  } catch {}
  return "";
}

export async function setApiKey(clave){
  clave = String(clave || "").trim();
  if (plataforma === "electron") return nativo.saveKey(clave);
  if (plataforma === "web") return ls.set(K, clave || null);
  if (clave) await SecureStorage.set(K, clave); else try { await SecureStorage.remove(K); } catch {}
  try { return await Respaldo.guardar({ clave }); } catch { return { ok:false }; }
}

export const deleteApiKey = () => setApiKey("");
export const hasApiKey = async () => !!(await getApiKey());
export const origenRecuperado = () => origen;

// Restaura desde el contenido de un config.enc elegido por la persona (solo Android).
export async function importarRespaldo(texto){
  const { clave } = await Respaldo.importar({ texto });
  await SecureStorage.set(K, clave);
  return clave;
}
export const puedeImportar = plataforma === "android";

export const proveedor = clave => /^sk-ant-/.test(clave) ? "Claude" : "Gemini";
export function maskKey(clave){
  clave = String(clave || "");
  return clave.length <= 10 ? "•".repeat(clave.length) : clave.slice(0, 4) + "•".repeat(8) + clave.slice(-4);
}

// Prueba la clave contra el servicio. {ok, mensaje}
export async function validateApiKey(clave){
  clave = String(clave || "").trim();
  if (clave.length < 20) return { ok:false, mensaje:"La clave es muy corta." };
  const claude = /^sk-ant-/.test(clave);
  try {
    const r = claude
      ? await fetch("https://api.anthropic.com/v1/models?limit=1", { headers:{ "x-api-key":clave, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true" }, signal:AbortSignal.timeout(15000) })
      : await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers:{ "x-goog-api-key":clave }, signal:AbortSignal.timeout(15000) });
    if (r.ok) return { ok:true, mensaje:`Conexión correcta con ${claude ? "Claude" : "Gemini"}.` };
    if (r.status === 429) return { ok:true, mensaje:"La clave es válida (llegaste al límite por ahora)." };
    return { ok:false, mensaje: r.status === 400 || r.status === 401 || r.status === 403 ? "La clave no es válida." : `El servicio respondió ${r.status}.` };
  } catch { return { ok:false, mensaje:"Sin conexión: no pude probar la clave." }; }
}
