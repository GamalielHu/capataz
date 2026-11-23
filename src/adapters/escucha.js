// "Oye Atlas": escucha permanente en Android, también con la pantalla apagada.
// Plugin nativo "Escucha" → EscuchaService (android/app/src/main/java/bo/capataz/app/). En PC y web no existe.
import { registerPlugin } from "@capacitor/core";
import { plataforma } from "./plataforma.js";

const E = plataforma === "android" ? registerPlugin("Escucha") : null;
export const hayEscucha = !!E;
const NADA = { activo:false, corriendo:false, estado:"detenido", superponer:true, bateria:true, pantallaCompleta:true };
const seguro = async f => { try { return (await f()) || NADA; } catch { return NADA; } };

// {activo, corriendo, estado, superponer, bateria, pantallaCompleta, falta?}
export const estadoEscucha = () => E ? seguro(() => E.estado()) : Promise.resolve(NADA);
export const activarEscucha = () => E ? seguro(() => E.activar({ nombre:"atlas" })) : Promise.resolve(NADA);
export const desactivarEscucha = () => E ? seguro(() => E.desactivar()) : Promise.resolve(NADA);
export const pedirSuperponer = () => E?.pedirSuperponer().catch(() => {});
export const pedirBateria = () => E?.pedirBateria().catch(() => {});
// Tras una conversación abierta con "Oye Atlas": deja que la pantalla se apague y vuelva el bloqueo.
export const dormirPantalla = () => E?.dormir().catch(() => {});

// Si quedó encendida y el sistema la cerró (reinicio, ahorro de batería), vuelve a arrancar al abrir la app.
export async function reanudarEscuchaSiToca(){
  if (!E) return;
  const e = await estadoEscucha();
  if (e.activo && !e.corriendo) await activarEscucha();
}

// Mientras la app usa el micrófono (conversación o dictado) el servicio lo suelta; al terminar vuelve a escuchar.
// Espera a que el micrófono quede libre antes de seguir, para no competir con el dictado nativo.
let usos = 0, latido = null;
export async function retenerMicrofono(){
  if (!E) return;
  if (usos++ === 0){
    await E.pausar().catch(() => {});
    latido = setInterval(() => E.pausar().catch(() => {}), 4 * 60e3); // el servicio vuelve solo a los 10 min si nadie insiste
  }
}
export function soltarMicrofono(){
  if (!E || !usos) return;
  if (--usos === 0){
    clearInterval(latido); latido = null;
    setTimeout(() => { if (!usos) E.reanudar().catch(() => {}); }, 700);
  }
}
