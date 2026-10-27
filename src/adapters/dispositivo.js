// Acciones sobre el equipo que pide el asistente: alarmas, temporizador, música, apps, llamadas, WhatsApp, mapas, linterna.
// Android: plugin nativo "Dispositivo" (android/app/src/main/java/bo/capataz/app/Dispositivo.java).
// Windows: abre enlaces con el sistema (Spotify, YouTube, WhatsApp, Maps). Web: nueva pestaña.
import { registerPlugin } from "@capacitor/core";
import { plataforma, nativo } from "./plataforma.js";

const Disp = plataforma === "android" ? registerPlugin("Dispositivo") : null;
const q = encodeURIComponent;
const soloNumero = n => String(n || "").replace(/[^\d+]/g, "");

async function abrirEnlace(url){
  if (plataforma === "android") return (await Disp.abrirUrl({ url })).ok;
  if (plataforma === "electron") return nativo.abrir(url);
  return !!window.open(url, "_blank", "noopener");
}

// Devuelve {ok, texto} | {usarAviso:true} cuando el equipo no tiene reloj propio (se programa como aviso de Capataz).
export async function accionDispositivo(tipo, a = {}){
  switch (tipo){
    case "alarma": {
      const [h, m] = String(a.hora || "").split(":").map(Number);
      if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return { ok:false, texto:"hora inválida" };
      if (plataforma !== "android") return { usarAviso:true };
      // El reloj de Android solo pone alarmas dentro de las próximas 24 h; más lejos se usa un aviso de Capataz.
      if (a.fecha){
        const cuando = new Date(`${a.fecha}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`).getTime();
        if (cuando - Date.now() > 24 * 3600e3) return { usarAviso:true };
      }
      const r = await Disp.alarma({ hora:h, minuto:m, mensaje:a.mensaje || "Capataz" });
      return { ok:r.ok, texto: r.ok ? `Alarma ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}${a.mensaje ? " · " + a.mensaje : ""}` : "no se pudo abrir el reloj" };
    }
    case "temporizador": {
      const s = Math.round(Number(a.minutos || 0) * 60 + Number(a.segundos || 0));
      if (!(s > 0)) return { ok:false, texto:"duración inválida" };
      if (plataforma !== "android") return { usarAviso:true, segundos:s };
      const r = await Disp.temporizador({ segundos:s, mensaje:a.mensaje || "Capataz" });
      return { ok:r.ok, texto: r.ok ? `Temporizador de ${s >= 60 ? Math.round(s / 60) + " min" : s + " s"}` : "no se pudo abrir el reloj" };
    }
    case "musica": {
      const c = String(a.consulta || "").trim(); if (!c) return { ok:false, texto:"falta qué poner" };
      const app = String(a.app || "").toLowerCase();
      if (plataforma === "android"){ const r = await Disp.musica({ consulta:c, app }); return { ok:r.ok, texto:`Poniendo “${c}” en ${r.detalle}`, cerrarVoz:r.ok }; }
      const yt = app.includes("youtube");
      const ok = await abrirEnlace(yt ? `https://www.youtube.com/results?search_query=${q(c)}` : plataforma === "electron" ? `spotify:search:${c}` : `https://open.spotify.com/search/${q(c)}`)
        || (!yt && await abrirEnlace(`https://open.spotify.com/search/${q(c)}`));
      return { ok, texto:`Buscando “${c}” en ${yt ? "YouTube" : "Spotify"}`, cerrarVoz:ok };
    }
    case "abrir_app": {
      if (plataforma !== "android") return { ok:false, texto:"en la PC no puedo abrir apps, solo enlaces" };
      const r = await Disp.abrirApp({ nombre:a.nombre || "" });
      return { ok:r.ok, texto: r.ok ? "Abriendo " + r.detalle : r.detalle, cerrarVoz:r.ok };
    }
    case "llamar": {
      const n = soloNumero(a.numero); if (!n) return { ok:false, texto:"no tengo el número" };
      const ok = plataforma === "android" ? (await Disp.llamar({ numero:n })).ok : await abrirEnlace("tel:" + n);
      return { ok, texto:"Marcando " + n, cerrarVoz:ok };
    }
    case "whatsapp": {
      const n = soloNumero(a.numero).replace(/^\+/, "");
      const ok = await abrirEnlace(`https://wa.me/${n}${a.texto ? "?text=" + q(a.texto) : ""}`);
      return { ok, texto: n ? "WhatsApp a " + n : "WhatsApp", cerrarVoz:ok };
    }
    case "navegar": {
      const d = String(a.destino || "").trim(); if (!d) return { ok:false, texto:"falta el destino" };
      const ok = await abrirEnlace(`https://www.google.com/maps/dir/?api=1&destination=${q(d)}`);
      return { ok, texto:"Ruta a " + d, cerrarVoz:ok };
    }
    case "abrir_web": {
      const u = String(a.url || "").trim(); if (!/^https?:\/\//i.test(u)) return { ok:false, texto:"enlace inválido" };
      const ok = await abrirEnlace(u); return { ok, texto:"Abriendo " + u.replace(/^https?:\/\//, "").slice(0, 40), cerrarVoz:ok };
    }
    case "linterna": {
      if (plataforma !== "android") return { ok:false, texto:"este equipo no tiene linterna" };
      const encender = a.encender !== false && a.encender !== "false";
      const r = await Disp.linterna({ encender });
      return { ok:r.ok, texto: r.ok ? (encender ? "Linterna encendida" : "Linterna apagada") : "no hay linterna" };
    }
  }
  return { ok:false, texto:"acción desconocida" };
}

// Widget / atajo "Hablar" de Android: cb() al abrir la app desde ahí.
export async function alPedirHablar(cb){
  if (plataforma === "android"){
    Disp.addListener("hablar", () => cb());
    try { if ((await Disp.accionInicial()).hablar) cb(); } catch {}
  } else if (plataforma === "electron") nativo.alHablar?.(cb);
}
