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

// Deja programados en el sistema exactamente los avisos pendientes futuros.
export async function sincronizar(avisos){
  if (plataforma === "electron"){ nativo.avisosCambiaron(); return; }
  if (plataforma !== "android") return;
  try {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map(n => ({ id:n.id })) });
    const ahora = Date.now();
    const futuros = avisos.filter(a => !a.hecho && a.cuando > ahora).sort((a,b) => a.cuando - b.cuando).slice(0, 60);
    if (futuros.length) await LocalNotifications.schedule({ notifications: futuros.map(a => ({
      id: idNumerico(a.id + a.cuando), title:"Capataz", body:a.texto, channelId:"avisos", actionTypeId:"AVISO",
      extra:{ id:a.id }, schedule:{ at:new Date(a.cuando), allowWhileIdle:true }
    })) });
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
