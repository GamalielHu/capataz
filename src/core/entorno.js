// Lo que pasa alrededor: el clima de donde está la persona (Open-Meteo, gratis y sin clave), en caché 30 min.
import { ls } from "./util.js";

const CODIGOS = { 0:"despejado", 1:"casi despejado", 2:"parcialmente nublado", 3:"nublado", 45:"niebla", 48:"niebla con escarcha",
  51:"llovizna débil", 53:"llovizna", 55:"llovizna fuerte", 61:"lluvia débil", 63:"lluvia", 65:"lluvia fuerte", 66:"lluvia helada", 67:"lluvia helada fuerte",
  71:"nevada débil", 73:"nevada", 75:"nevada fuerte", 77:"granizo fino", 80:"chubascos", 81:"chubascos fuertes", 82:"chubascos muy fuertes",
  85:"chubascos de nieve", 86:"chubascos de nieve fuertes", 95:"tormenta", 96:"tormenta con granizo", 99:"tormenta con granizo fuerte" };
const LA_PAZ = { lat:-16.5, lon:-68.15, lugar:"La Paz" };

function ubicacion(){
  const guardada = ls.get("capataz-ubicacion", null);
  if (guardada && Date.now() - guardada.t < 6 * 3600e3) return Promise.resolve(guardada);
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(guardada || LA_PAZ);
    navigator.geolocation.getCurrentPosition(
      p => { const u = { lat:+p.coords.latitude.toFixed(3), lon:+p.coords.longitude.toFixed(3), lugar:"tu ubicación", t:Date.now() }; ls.set("capataz-ubicacion", u); ok(u); },
      () => ok(guardada || LA_PAZ), { timeout:6000, maximumAge:3 * 3600e3, enableHighAccuracy:false });
  });
}

// Texto corto del clima para el asistente, o "" si no hay internet.
export async function climaTexto(){
  const cache = ls.get("capataz-clima", null);
  if (cache && Date.now() - cache.t < 30 * 60e3) return cache.texto;
  try {
    const u = await ubicacion();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${u.lat}&longitude=${u.lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto&forecast_days=3`;
    const d = await (await fetch(url, { signal:AbortSignal.timeout(6000) })).json();
    const c = d.current, dd = d.daily, dias = ["Hoy", "Mañana", "Pasado mañana"];
    const texto = `Clima en ${u.lugar}: ahora ${Math.round(c.temperature_2m)}°C, ${CODIGOS[c.weather_code] || "—"}, viento ${Math.round(c.wind_speed_10m)} km/h.\n`
      + dd.time.map((_, i) => `${dias[i]}: ${CODIGOS[dd.weather_code[i]] || "—"}, ${Math.round(dd.temperature_2m_min[i])} a ${Math.round(dd.temperature_2m_max[i])}°C, lluvia ${dd.precipitation_probability_max[i] ?? 0}% (${dd.precipitation_sum[i] ?? 0} mm)`).join("\n");
    ls.set("capataz-clima", { t:Date.now(), texto });
    return texto;
  } catch { return cache?.texto || ""; }
}
