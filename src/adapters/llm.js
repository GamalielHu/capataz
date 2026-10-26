// Cliente de IA con la clave del usuario: Google Gemini (gratis) o Anthropic Claude, según la clave.
// Android: clave en Keystore (SecureStorage) y petición nativa (CapacitorHttp, sin CORS).
// Electron: clave cifrada con safeStorage y petición desde el proceso principal (la clave nunca llega a la ventana).
// Web: clave en localStorage y fetch directo desde el navegador.
import { CapacitorHttp } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { plataforma, nativo } from "./plataforma.js";
import { ls } from "../core/util.js";
import { peticion, textoDe, codigoError } from "../../electron/proveedores.js";

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
  const { url, headers, body } = peticion(clave, pedido, plataforma === "web");
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
  return textoDe(clave, datos);
}
