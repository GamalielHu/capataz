// Intérprete propio en español: funciona sin internet y sin clave de API.
// Entiende avisos con fecha/hora, trabajos con proyecto, consultas, marcar hecho y datos para recordar.
// Devuelve el mismo formato que la IA: {respuesta, nuevas_tareas, nuevos_recordatorios, completar, nuevos_aprendizajes}.
import { cuandoTexto } from "./util.js";

// Minúsculas y sin tildes, misma longitud que el original (para recortar el texto original por índices).
const SIN = { "á":"a","é":"e","í":"i","ó":"o","ú":"u","ü":"u","Á":"a","É":"e","Í":"i","Ó":"o","Ú":"u","Ü":"u","ñ":"n","Ñ":"n" };
const norm = s => [...s].map(c => SIN[c] ?? c.toLowerCase()).join("");
const palabras = s => norm(s).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !VACIAS.has(w));
const VACIAS = new Set("que los las del por para con una uno unos unas este esta esto ese esa eso como cual mas pero sus mis tus hay muy ya the".split(" "));
const capital = s => s ? s[0].toUpperCase() + s.slice(1) : s;

const NUM = { un:1, una:1, uno:1, dos:2, tres:3, cuatro:4, cinco:5, seis:6, siete:7, ocho:8, nueve:9, diez:10, once:11, doce:12,
  quince:15, veinte:20, treinta:30, cuarenta:40, cuarentaycinco:45, media:.5, medio:.5 };
const aNum = s => /^\d+$/.test(s) ? +s : NUM[s];
const NUMS = "\\d{1,2}|una|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce";
const DIAS = ["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

/* ---------- Fechas ---------- */
// Busca fecha/hora en el texto. Devuelve {ms, hayHora, hayDia, quitar:[[i,j],...]} o null si no hay nada.
export function extraerFecha(original, ahora = new Date()){
  const n = norm(original), quitar = [];
  const usar = m => { quitar.push([m.index, m.index + m[0].length]); return m; };
  let m;

  // Relativo: "en 20 minutos", "dentro de una hora", "en media hora", "en 2 horas y media"
  if ((m = /\b(?:dentro de|en) (\d+|una|un|media|medio|dos|tres|cuatro|cinco|diez|quince|veinte|treinta|cuarenta) ?(minutos?|mins?|horas?|hrs?)( y media)?\b/.exec(n))){
    usar(m);
    let cant = aNum(m[1]); if (m[3]) cant += .5;
    const min = /^h/.test(m[2]) ? cant * 60 : cant;
    return { ms: ahora.getTime() + min * 60e3, hayHora:true, hayDia:true, quitar };
  }

  const d = new Date(ahora); d.setSeconds(0, 0);
  let hayDia = false, hayHora = false, tarde = null;

  // Hora: "a las 7:30", "a las 7 y media", "a las 8 de la mañana", "a las 3 pm", "7:30", "al mediodía"
  const reHora = new RegExp(`\\b(?:(?:a|para|desde|tipo|a eso de) las?|a la) (${NUMS})(?:[:.h](\\d{2})| y (media|cuarto)| menos cuarto)?(?: ?(am|a\\.m\\.|pm|p\\.m\\.|hrs|horas|de la manana|de la tarde|de la noche|de la madrugada))?`);
  let conLas = !!(m = reHora.exec(n));
  if (conLas || (m = /\b(\d{1,2})[:.](\d{2})(?: ?(am|pm|hrs))?\b/.exec(n))){
    usar(m);
    let h = aNum(m[1]), min = 0, periodo;
    if (conLas){
      min = m[2] ? +m[2] : m[3]==="media" ? 30 : m[3]==="cuarto" ? 15 : 0;
      if (/menos cuarto/.test(m[0])){ h -= 1; min = 45; }
      periodo = m[4];
    } else { min = +m[2]; periodo = m[3]; }
    if (periodo) tarde = /pm|p\.m\.|tarde|noche/.test(periodo) ? true : /am|a\.m\.|manana|madrugada/.test(periodo) ? false : null;
    d.setHours(h, min); hayHora = true;
    if (tarde === true && h < 12) d.setHours(h + 12);
    if (tarde === null && h >= 1 && h <= 6) d.setHours(h + 12); // "a las 3" en obra = 15:00
  } else if ((m = /\b(?:al|a|de) mediodia\b/.exec(n))){ usar(m); d.setHours(12, 0); hayHora = true; }

  // Día
  const nSinHora = quitar.length ? n.slice(0, quitar[0][0]) + " ".repeat(quitar[0][1]-quitar[0][0]) + n.slice(quitar[0][1]) : n;
  if ((m = /\b(pasado manana|manana|hoy|esta noche|esta tarde|esta manana)\b/.exec(nSinHora))){
    usar(m); hayDia = true;
    if (m[1] === "manana") d.setDate(d.getDate() + 1);
    if (m[1] === "pasado manana") d.setDate(d.getDate() + 2);
    if (/noche|tarde/.test(m[1]) && hayHora && d.getHours() < 12) d.setHours(d.getHours() + 12);
    if (/noche/.test(m[1]) && !hayHora){ d.setHours(20, 0); hayHora = true; }
  } else if ((m = /\b(?:el |este |el proximo |proximo |el otro )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(nSinHora))){
    usar(m); hayDia = true;
    let dif = (DIAS.indexOf(m[1]) - d.getDay() + 7) % 7;
    if (dif === 0 || /proximo|otro/.test(m[0])) dif = dif || 7;
    d.setDate(d.getDate() + dif);
  } else if ((m = new RegExp(`\\b(?:el )?(\\d{1,2})(?: de (${MESES.join("|")})|/(\\d{1,2}))\\b`).exec(nSinHora)) || (m = /\bel (\d{1,2})\b(?! de la)/.exec(nSinHora))){
    usar(m); hayDia = true;
    const dia = +m[1], mes = m[2] ? MESES.indexOf(m[2]) : m[3] ? +m[3] - 1 : d.getMonth();
    d.setMonth(mes, dia);
    if (d < new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())) m[2]||m[3] ? d.setFullYear(d.getFullYear()+1) : d.setMonth(d.getMonth()+1, dia);
  }

  if (!hayDia && !hayHora) return null;
  if (hayHora && !hayDia && d.getTime() <= ahora.getTime()) d.setDate(d.getDate() + 1); // hora ya pasada = mañana
  return { ms: d.getTime(), hayHora, hayDia, quitar };
}

// Quita del texto las partes de fecha y las palabras de orden, y lo deja como frase limpia.
function limpiar(original, quitar){
  let s = original;
  for (const [i,j] of [...quitar].sort((a,b) => b[0]-a[0])) s = s.slice(0,i) + " " + s.slice(j);
  s = s.replace(/\s+/g, " ").trim()
    .replace(/^(?:[,:;.\-]\s*)+/, "")
    .replace(/^(?:que|de|a|para|el|la|lo)\s+(?=\S)/i, "")
    .replace(/^(?:que|de|a)\s+/i, "")
    .replace(/[\s,;:.]+$/, "")
    .replace(/\s+(?:de|a|para|el|la|y)$/i, "");
  return capital(s);
}

/* ---------- Intenciones ---------- */
const RE_AVISO = /\b(?:recuerdame|recuerdale|recordarme|recordame|avisame|avisarme|despiertame|pon(?:me)?(?: un| una)? (?:aviso|alarma|recordatorio)|programa(?: un| una)? (?:aviso|alarma|recordatorio)|(?:nuevo )?(?:aviso|recordatorio|alarma)(?: para)?)\b[:,]?/;
const RE_TAREA = /^(?:capataz[,:]?\s*)?(?:anota(?:me)?|apunta(?:me)?|agrega(?:r)?|anade|registra|nuevo trabajo|nueva tarea|tarea|trabajo|pendiente|tengo que|hay que|falta)\b[:,]?\s*/;
const RE_HECHO = /^(?:ya\s+)?(?:termine|terminamos|hice|hicimos|acabe|acabamos|complete|listo|hecho|ya esta|marca(?:r)?(?: como)? hecho|marca|tacha|cumpli)\b[:,]?\s*(?:con\s+)?(?:el |la |lo de |los |las |de )?/;
const RE_CONSULTA = /(?:\b(?:que|cuales?|cuantos?|cuantas?) (?:tengo|hay|me falta|falta|quedan?|toca)\b|\bpendientes?\s*\??$|\bmis (?:trabajos|tareas|avisos|recordatorios|pendientes)\b|\b(?:resumen|agenda)\b|\bque hay (?:para )?hoy\b|\blista de\b)/;
const RE_APRENDER = /^(?:recuerda|acuerdate|ten en cuenta|toma nota de|toma nota|para que sepas|anota que|apunta que|aprende)\s+(?:que\s+)?(.+)$/;
const RE_NOMBRE = /^(?:me llamo|mi nombre es|soy)\s+([a-z]+(?: [a-z]+)?)\s*$/;
const RE_OLVIDA = /^(?:olvida|borra|olvidate de)\s+(?:que\s+|lo de\s+|el dato\s+)?(.+)$/;
const RE_SABES = /\bque sabes de mi\b|\bque recuerdas\b|\bque te he dicho\b/;
const RE_SALUDO = /^(?:hola|buen(?:os|as)? (?:dias|tardes|noches)|que tal|hey|ola)\b/;
const RE_AYUDA = /^(?:ayuda|que puedes hacer|como funciona|que sabes hacer)/;
const RE_PREGUNTA = /^(?:cual|cuales|quien|quienes|donde|cuando|como|que|cuanto|cuanta|sabes|dime|me recuerdas)\b/;

let avisoSinHora = null; // {texto} esperando la hora

const vacio = r => ({ nuevas_tareas:[], nuevos_recordatorios:[], completar:[], nuevos_aprendizajes:[], ...r });
const nuevoAviso = (texto, ms) => vacio({
  respuesta: `Listo, te aviso ${cuandoTexto(ms)}: ${texto}.`,
  nuevos_recordatorios: [{ texto, cuando: ms }]
});

function proyectoDe(cuerpo, proyectosExistentes){
  const n = norm(cuerpo);
  const m = /\s(?:para|en|de) (?:la |el )?(obra|proyecto) (?:de |del |en )?([a-z0-9][a-z0-9 ]{0,30}?)\s*$/.exec(n);
  if (!m) return { texto: cuerpo, proyecto: "" };
  const nombre = cuerpo.slice(m.index + m[0].length - m[2].length).trim();
  const existe = proyectosExistentes.find(p => norm(p).includes(norm(nombre)));
  return { texto: cuerpo.slice(0, m.index).trim(), proyecto: existe || capital(m[1]) + " " + capital(nombre) };
}

const parecido = (consulta, texto) => {
  const q = palabras(consulta); if (!q.length) return 0;
  const t = new Set(palabras(texto));
  return q.filter(w => t.has(w) || [...t].some(x => x.startsWith(w.slice(0,5)) && w.length >= 5)).length / q.length;
};

function listar(pend, avs, filtro){
  const lineas = [];
  if (filtro !== "avisos"){
    lineas.push(pend.length ? `Trabajos pendientes (${pend.length}):` : "No tienes trabajos pendientes.");
    pend.slice(0, 10).forEach(t => lineas.push(`• ${t.texto}${t.proyecto ? " (" + t.proyecto + ")" : ""}`));
    if (pend.length > 10) lineas.push(`… y ${pend.length - 10} más en la pestaña Trabajos.`);
  }
  if (filtro !== "trabajos"){
    lineas.push(avs.length ? `Avisos (${avs.length}):` : "No tienes avisos pendientes.");
    avs.slice(0, 10).forEach(a => lineas.push(`• ${cuandoTexto(a.cuando)}: ${a.texto}`));
  }
  return lineas.join("\n");
}

function claveDe(texto){ return palabras(texto).slice(0, 4).join("_") || "dato"; }
function categoriaDe(t){
  const n = norm(t);
  return /\b\d{7,8}\b|telefono|celular|numero|whatsapp/.test(n) ? "contacto"
    : /proveedor|ferreteria|vende|compro|compramos|distribuidor/.test(n) ? "proveedor"
    : /\bobra\b|proyecto/.test(n) ? "proyecto"
    : /prefiero|me gusta|siempre|nunca|horario|entro|salgo/.test(n) ? "preferencia"
    : "general";
}

// estado: {tareas: [...pendientes], avisos: [...pendientes], perfil: [...], proyectos: [...]}
export function interpretar(original, estado, ahora = new Date()){
  const texto = original.trim().replace(/^[¿¡\s]+/, "").replace(/^capataz[,:]?\s*/i, "");
  const n = norm(texto);

  // ¿Responde a "¿a qué hora?" de un aviso anterior?
  if (avisoSinHora){
    const f = extraerFecha(texto, ahora);
    if (f?.hayHora){ const t = avisoSinHora.texto; avisoSinHora = null; return nuevoAviso(t, f.ms); }
    if (/^(?:no|cancela|olvidalo|dejalo)\b/.test(n)){ avisoSinHora = null; return vacio({ respuesta: "Bueno, no pongo ese aviso." }); }
    avisoSinHora = null;
  }

  if (RE_AYUDA.test(n)) return vacio({ respuesta: AYUDA });

  // Aviso: "recuérdame mañana a las 7:30 llamar al proveedor"
  const mAviso = RE_AVISO.exec(n);
  if (mAviso && !RE_CONSULTA.test(n)){
    const f = extraerFecha(texto, ahora);
    const quitar = [[mAviso.index, mAviso.index + mAviso[0].length], ...(f?.quitar || [])];
    const cuerpo = limpiar(texto, quitar);
    if (!cuerpo && f?.hayHora) return nuevoAviso("Alarma", f.ms);
    if (!cuerpo) return vacio({ respuesta: "¿Qué quieres que te recuerde?" });
    if (!f?.hayHora){
      avisoSinHora = { texto: cuerpo };
      return vacio({ respuesta: `¿A qué hora te recuerdo "${cuerpo}"?` });
    }
    let ms = f.ms;
    if (f.hayDia && !f.hayHora) ms = new Date(ms).setHours(8, 0, 0, 0);
    return nuevoAviso(cuerpo, ms);
  }

  // Dato para recordar (sin hora): "recuerda que el proveedor de fierro es Ferretería López"
  const mApr = RE_APRENDER.exec(n);
  if (mApr && !extraerFecha(texto, ahora)?.hayHora){
    const valor = capital(texto.slice(texto.length - mApr[1].length).trim().replace(/[.]+$/, ""));
    return vacio({ respuesta: "Anotado, lo tendré en cuenta.", nuevos_aprendizajes: [{ clave: claveDe(valor), categoria: categoriaDe(valor), valor }] });
  }
  const mNombre = RE_NOMBRE.exec(n);
  if (mNombre){
    const nombre = capital(texto.slice(texto.length - mNombre[1].length).trim());
    return vacio({ respuesta: `Mucho gusto, ${nombre}.`, nuevos_aprendizajes: [{ clave:"nombre", categoria:"persona", valor:`Se llama ${nombre}` }] });
  }
  if (RE_SABES.test(n)){
    return vacio({ respuesta: estado.perfil.length ? "Esto es lo que sé de ti:\n" + estado.perfil.map(f => "• " + f.valor).join("\n") : "Todavía no me has contado nada. Dime por ejemplo: \"recuerda que el cemento lo compro en Soboce\"." });
  }
  const mOlv = RE_OLVIDA.exec(n);
  if (mOlv){
    const q = mOlv[1];
    const f = estado.perfil.map(f => [f, parecido(q, f.valor + " " + f.clave)]).sort((a,b) => b[1]-a[1])[0];
    if (f && f[1] >= .5) return vacio({ respuesta: `Listo, olvidé: ${f[0].valor}.`, nuevos_aprendizajes: [{ clave: f[0].clave, valor: "" }] });
  }

  // Consulta: "¿qué tengo pendiente?", "¿qué avisos tengo?", "¿qué hay para hoy?"
  if (RE_CONSULTA.test(n)){
    const filtro = /\b(?:avisos?|recordatorios?|alarmas?)\b/.test(n) ? "avisos" : /\b(?:trabajos?|tareas?)\b/.test(n) ? "trabajos" : "todo";
    let pend = estado.tareas, avs = estado.avisos;
    const mObra = /\b(?:de|en|para) (?:la |el )?(?:obra|proyecto) ([a-z0-9 ]+?)\s*\??$/.exec(n);
    if (mObra) pend = pend.filter(t => norm(t.proyecto).includes(mObra[1].trim()));
    if (/\bhoy\b/.test(n)){ const fin = new Date(ahora); fin.setHours(23,59,59,999); avs = avs.filter(a => a.cuando <= fin.getTime()); }
    if (/\bmanana\b/.test(n)){ const i = new Date(ahora); i.setHours(24,0,0,0); const fin = new Date(i); fin.setHours(23,59,59,999); avs = avs.filter(a => a.cuando >= i.getTime() && a.cuando <= fin.getTime()); }
    return vacio({ respuesta: listar(pend, avs, filtro) });
  }

  // Marcar hecho: "ya terminé lo del encofrado", "listo comprar cemento"
  const mHecho = RE_HECHO.exec(n);
  if (mHecho){
    const q = texto.slice(mHecho[0].length);
    const todos = [...estado.tareas, ...estado.avisos];
    if (!q.trim()) return vacio({ respuesta: "¿Qué cosa terminaste? Dime una parte del texto, por ejemplo \"terminé encofrado\"." });
    const mejor = todos.map(it => [it, parecido(q, it.texto + " " + (it.proyecto||""))]).sort((a,b) => b[1]-a[1])[0];
    if (mejor && mejor[1] >= .5) return vacio({ respuesta: `Bien hecho. Marqué como hecho: ${mejor[0].texto}.`, completar: [mejor[0].id] });
    if (!RE_TAREA.test(n)) return vacio({ respuesta: `No encontré "${q.trim()}" entre tus pendientes. Revisa la pestaña Trabajos.` });
  }

  // Trabajo: "anota comprar 20 bolsas de cemento para la obra Sur"
  const mTarea = RE_TAREA.exec(n);
  if (mTarea){
    const f = extraerFecha(texto, ahora);
    if (f?.hayHora && /^(?:tengo que|hay que)/.test(n)){
      const cuerpo = limpiar(texto.slice(mTarea[0].length), f.quitar.map(([i,j]) => [i - mTarea[0].length, j - mTarea[0].length]));
      return nuevoAviso(cuerpo, f.ms);
    }
    const partes = texto.slice(mTarea[0].length).split(/\s*(?:;|\n|\s-\s)\s*/).map(s => s.trim()).filter(Boolean);
    const tareas = partes.map(p => { const { texto: t, proyecto } = proyectoDe(p, estado.proyectos); return { texto: capital(limpiar(t, [])), proyecto }; }).filter(t => t.texto);
    if (!tareas.length) return vacio({ respuesta: "¿Qué trabajo anoto?" });
    const donde = tareas[0].proyecto ? ` en ${tareas[0].proyecto}` : "";
    return vacio({ respuesta: tareas.length === 1 ? `Anotado${donde}: ${tareas[0].texto}.` : `Anoté ${tareas.length} trabajos${donde}.`, nuevas_tareas: tareas });
  }

  // Pregunta sobre algo que aprendió: "¿cuál es el número del proveedor de cemento?"
  if (RE_PREGUNTA.test(n) && estado.perfil.length){
    const f = estado.perfil.map(f => [f, parecido(texto, f.valor + " " + f.clave.replace(/_/g, " "))]).sort((a,b) => b[1]-a[1])[0];
    if (f && f[1] >= .34) return vacio({ respuesta: f[0].valor + "." });
  }

  if (RE_SALUDO.test(n)){
    const nombre = estado.perfil.find(f => f.clave === "nombre")?.valor.replace(/^Se llama /, "");
    const h = ahora.getHours(), saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
    return vacio({ respuesta: `${saludo}${nombre ? ", " + nombre : ""}. Tienes ${estado.tareas.length} ${estado.tareas.length===1?"trabajo":"trabajos"} y ${estado.avisos.length} ${estado.avisos.length===1?"aviso":"avisos"} pendientes. ¿Qué anotamos?` });
  }

  // Si trae fecha/hora, lo tomo como aviso: "mañana a las 8 reunión con el ingeniero"
  const f = extraerFecha(texto, ahora);
  if (f?.hayHora){ const cuerpo = limpiar(texto, f.quitar); if (cuerpo) return nuevoAviso(cuerpo, f.ms); }

  return null;
}

export const AYUDA = `Puedo hacer esto sin internet:
• Avisos: "recuérdame mañana a las 7:30 llamar al proveedor", "avísame en 20 minutos sacar el vaciado"
• Trabajos: "anota comprar 20 bolsas de cemento para la obra Sur"
• Consultas: "¿qué tengo pendiente?", "¿qué avisos tengo para hoy?"
• Terminar: "ya terminé el encofrado"
• Datos: "recuerda que el fierro lo compro en Ferretería López" y luego "¿dónde compro el fierro?"`;
