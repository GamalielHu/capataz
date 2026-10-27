// Puente de notificaciones.
// Android: LocalNotifications (AlarmManager exacto, suena con la app cerrada y se reprograma al reiniciar).
// Electron: el proceso principal revisa la base cada 30 s y lanza la notificación de Windows.
// Web: Notification API mientras la página esté abierta.
import { LocalNotifications } from "@capacitor/local-notifications";
import { plataforma, nativo } from "./plataforma.js";

const idNumerico = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) || 1; };

export async function pedirPermiso(){
  try {
    if (plataforma === "android"){
      if ((await LocalNotifications.checkPermissions()).display !== "granted") await LocalNotifications.requestPermissions();
      if ((await LocalNotifications.checkExactNotificationSetting()).exact_alarm !== "granted") await LocalNotifications.changeExactNotificationSetting();
      await LocalNotifications.createChannel({ id:"avisos", name:"Avisos", importance:5, visibility:1, vibration:true, lights:true });
      await LocalNotifications.registerActionTypes({ types:[{ id:"AVISO", actions:[
        { id:"posponer", title:"+10 min" }, { id:"hecho", title:"Hecho" }] }] });
    } else if (plataforma === "web" && "Notification" in window && Notification.permission === "default"){
      await Notification.requestPermission();
    }
  } catch {}
}

// Resumen de la mañana (7:00) con lo pendiente: Capataz te busca a ti, no solo al revés.
const ID_RESUMEN = 7000007;
function proximas7(){ const d = new Date(); d.setHours(7, 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d; }
export function textoResumen(avisos, tareas, dia){
  const ini = new Date(dia); ini.setHours(0,0,0,0); const fin = new Date(ini); fin.setDate(fin.getDate() + 1);
  const hoy = avisos.filter(a => !a.hecho && a.cuando >= ini && a.cuando < fin).sort((a,b) => a.cuando - b.cuando);
  const pend = tareas.filter(t => !t.hecho);
  if (!hoy.length && !pend.length) return null;
  const partes = [];
  if (hoy.length) partes.push(`${hoy.length} ${hoy.length === 1 ? "aviso" : "avisos"} hoy (primero: ${hoy[0].texto})`);
  if (pend.length) partes.push(`${pend.length} ${pend.length === 1 ? "trabajo pendiente" : "trabajos pendientes"}`);
  return "Buenos días. Tienes " + partes.join(" y ") + ".";
}

// Deja programados en el sistema exactamente los avisos pendientes futuros (y el resumen de la mañana).
export async function sincronizar(avisos, tareas = []){
  if (plataforma === "electron"){ nativo.avisosCambiaron(); return; }
  if (plataforma !== "android") return;
  try {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map(n => ({ id:n.id })) });
    const ahora = Date.now();
    const futuros = avisos.filter(a => !a.hecho && a.cuando > ahora).sort((a,b) => a.cuando - b.cuando).slice(0, 60);
    const lista = futuros.map(a => ({
      id: idNumerico(a.id + a.cuando), title:"Capataz", body:a.texto, channelId:"avisos", actionTypeId:"AVISO",
      extra:{ id:a.id }, schedule:{ at:new Date(a.cuando), allowWhileIdle:true }
    }));
    const at = proximas7(), resumen = textoResumen(avisos, tareas, at);
    if (resumen) lista.push({ id:ID_RESUMEN, title:"Capataz · tu día", body:resumen, channelId:"avisos", extra:{ id:"resumen" }, schedule:{ at, allowWhileIdle:true } });
    if (lista.length) await LocalNotifications.schedule({ notifications: lista });
  } catch {}
}

// Solo web: con la página abierta avisa también fuera de la pestaña.
export function avisarAhora(textos){
  if (plataforma !== "web" || !("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification("Capataz", { body: textos.join("\n") }); } catch {}
}

// cb(accion: "posponer" | "hecho" | "abrir", id)
export function alAccionar(cb){
  if (plataforma === "android")
    LocalNotifications.addListener("localNotificationActionPerformed", e => {
      const id = e.notification?.extra?.id; if (id) cb(e.actionId === "tap" ? "abrir" : e.actionId, id);
    });
  else if (plataforma === "electron") nativo.alAccionar((accion, id) => cb(accion, id));
}
