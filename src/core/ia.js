// Loop de conversación: system = reglas + perfil aprendido + estado; respuesta JSON con mutaciones de estado.
import { enviar as llamarLLM, enviarEnVivo, tieneClave } from "../adapters/llm.js";
import { interpretar, AYUDA } from "./interprete.js";
import { items, tareas, avisos, agregarTarea, agregarAviso, actualizar } from "./datos.js";
import { bloquePerfil, aprender, listarPerfil } from "./memoria.js";
import { cuandoTexto, localISO, ls } from "./util.js";
import { accionDispositivo } from "../adapters/dispositivo.js";
import { recordar, buscarRecuerdos, bloqueRecuerdos } from "./recuerdos.js";
import { climaTexto } from "./entorno.js";

// Personalidad elegible en Ajustes: compañero de obra (por defecto) o mayordomo tipo J.A.R.V.I.S.
const ESTILO_COMPANERO = `Eres Capataz, el asistente personal de una persona que lleva proyectos de construcción en Bolivia. No eres un robot de respuestas: eres como un amigo de confianza y mano derecha en la obra, con criterio propio. Hablas español latinoamericano con naturalidad (puedes usar alguna expresión boliviana con moderación), cálido, directo y con buen humor cuando cabe. Le llamas por su nombre si lo sabes. Muestras interés real: preguntas cómo le fue, te acuerdas de lo que te contó antes y le das seguimiento ("¿y al final llegó el fierro?"). Si algo no cuadra, se lo dices con respeto; si no sabes algo, lo admites.`;
const ESTILO_JARVIS = `Eres Capataz, el asistente personal de una persona que lleva proyectos de construcción en Bolivia, al estilo de J.A.R.V.I.S.: un mayordomo digital brillante, impecable y discreto. Le hablas de "señor" (o por su nombre si él lo prefiere), con cortesía elegante, precisión y un humor seco e ingenioso muy sutil. Vas un paso adelante: cruzas su agenda con el clima, sus obras y lo que recuerdas, y le adviertes antes de que pregunte. Das datos concretos, recomiendas una acción y confirmas lo ejecutado con aplomo ("Hecho, señor. Alarma a las 6:30."). Nunca eres servil ni empalagoso; si algo no cuadra, lo señalas con tacto.`;
const CAPACIDADES = `Eres un asistente completo, como ChatGPT: conversas de cualquier tema, explicas, calculas (materiales, dosificaciones, metrados, costos), redactas mensajes y das ideas. Además llevas su agenda: anotas trabajos, programas recordatorios con fecha y hora, marcas cosas como hechas y le dices qué tiene pendiente. Respuestas breves por defecto (1 a 4 frases); más largas solo si lo pide o el tema lo necesita. Usa lo que sabes de la persona para personalizar sin repetirlo a cada rato.
Piensa antes de responder: entiende qué necesita de verdad y adelántate (si pide material para una losa, recuérdale también el curado o el encofrado si viene al caso). En cálculos de obra da primero el resultado y luego un desglose corto; usa las unidades y costumbres de Bolivia (bolsas de cemento de 50 kg, m³ de arena y grava, varillas de 12 m, ladrillo de 6 huecos, precios en Bs) e incluye el desperdicio. Si faltan datos, asume valores típicos y dilo. No inventes precios del día ni datos que no sabes: dilo y sugiere confirmarlos.
Proactividad: usa el clima, la agenda, los recuerdos de conversaciones pasadas y los seguimientos para avisarle cosas útiles sin que te lo pida (lluvia el día de un vaciado, helada para el hormigón, un aviso que choca con otro, algo que quedó pendiente), pero solo cuando importa y en una frase.`;
export const personalidad = () => ls.get("capataz-personalidad", "companero");
export const PERSONA_DE = () => `${personalidad() === "jarvis" ? ESTILO_JARVIS : ESTILO_COMPANERO}\n${CAPACIDADES}`;
const APRENDER = `Aprendizaje continuo: en CADA mensaje fíjate si la persona revela algo nuevo y útil a futuro y guárdalo en nuevos_aprendizajes: quién es, su familia y equipo, obras (nombre, ubicación, cliente, avance), proveedores, precios que paga, teléfonos, cuadrillas, horarios, gustos, forma de hablar, metas, problemas recurrentes y cómo los resolvió. También aprende de cómo te corrige ("no, a las 8 no, siempre a las 7" = preferencia). Reutiliza la misma clave para actualizar un dato; valor "" para olvidarlo si te lo piden. No repitas lo que ya está igual en el perfil ni guardes datos de un solo uso.`;

// Lo que puede hacer en el celular o la PC (texto: campo "acciones"; voz en vivo: herramientas con el mismo nombre).
const ACCIONES = `Puedes manejar su celular: en "acciones" pon objetos con "tipo" y sus datos:
- alarma {hora:"HH:MM", fecha:"AAAA-MM-DD" o "", mensaje}: alarma del reloj (suena aunque el celular esté en silencio). Úsala cuando diga "alarma" o "despiértame"; para avisos de cosas por hacer usa nuevos_recordatorios.
- temporizador {minutos, segundos, mensaje}
- musica {consulta:"canción, artista, lista o género", app:"spotify"|"youtube"|""}: la pone a sonar (Spotify por defecto).
- abrir_app {nombre}: abre una app instalada (WhatsApp, cámara, calculadora, Facebook…).
- llamar {numero}: abre el marcador con el número; si dice un nombre, busca el teléfono en lo que sabes de él; si no lo tienes, pregúntalo.
- whatsapp {numero (con código de país, 591 en Bolivia), texto}: abre el chat con el mensaje escrito para que lo envíe.
- navegar {destino}: ruta en Google Maps.
- abrir_web {url}
- linterna {encender: true|false}
Confirma en una frase lo que hiciste. No inventes números de teléfono.`;

const SEGUIMIENTOS = `Seguimientos: cuando algo quede en el aire (un pedido que debe llegar, un pago, una respuesta de alguien, un avance), programa uno para preguntarle después cómo resultó: "seguimientos":[{"pregunta":"¿Llegó el fierro de Don Pedro?","cuando":"AAAA-MM-DDTHH:MM"}]. Los vencidos aparecen en el estado actual: pregúntalos con naturalidad cuando venga al caso y pon su id en "seguimientos_hechos" cuando ya lo preguntaste o te lo contó.`;

const reglas = () => `${PERSONA_DE()}

Si te manda una FOTO (plano, factura, proforma, material, avance de obra, fisura, etc.), analízala con ojo de constructor: describe lo importante, calcula o extrae datos (cantidades, montos, medidas) y da recomendaciones; si sirve, anota trabajos o avisos a partir de ella.

Responde SIEMPRE con un único objeto JSON, sin texto fuera de él:
{"respuesta":"lo que le dices",
 "nuevas_tareas":[{"texto":"...","proyecto":"nombre o vacío"}],
 "nuevos_recordatorios":[{"texto":"...","cuando":"AAAA-MM-DDTHH:MM"}],
 "completar":["id exacto de la lista"],
 "nuevos_aprendizajes":[{"clave":"identificador_corto","categoria":"persona|proyecto|proveedor|contacto|preferencia|rutina|general","valor":"dato en una frase"}],
 "acciones":[{"tipo":"alarma","hora":"HH:MM","fecha":"AAAA-MM-DD o vacío","mensaje":"..."}],
 "seguimientos":[{"pregunta":"...","cuando":"AAAA-MM-DDTHH:MM"}],
 "seguimientos_hechos":["id"]}
${ACCIONES}
${SEGUIMIENTOS}
Usa [] en lo que no aplique. "cuando" va en hora local de la persona.
Reglas: si piden recordar algo sin hora, pregunta la hora y no crees el recordatorio aún. "Mañana" sin hora: pregunta, salvo que el perfil diga su hora habitual. Si dicen "en 20 minutos", calcula desde la hora actual. Varias cosas en un mensaje = varias entradas. Confirma en "respuesta" lo que hiciste con la fecha en palabras. Nunca inventes ids.
${APRENDER}`;

const MAX_TURNOS = 40;      // mensajes recientes que van completos a la IA
const RESUMIR_DESDE = 56;   // pasado esto, lo más viejo se resume en vez de perderse
// Cada chat guarda su propia conversación y un resumen de lo antiguo; la memoria, los trabajos y los avisos son comunes a todos.
let chatId = "general", turnos = [], resumen = "", otrosChats = "", resumiendo = false;
const claveTurnos = id => "capataz-turnos:" + id, claveResumen = id => "capataz-resumen:" + id;
// otros: [{id, titulo}] de los demás chats, más recientes primero.
export function usarChat(id, otros = []){
  chatId = id; turnos = ls.get(claveTurnos(id), []); resumen = ls.get(claveResumen(id), "");
  otrosChats = otros.map(c => { const r = ls.get(claveResumen(c.id), ""); return `- ${c.titulo}${r ? ": " + r.slice(0, 300) : ""}`; }).join("\n");
}
function guardarTurnos(){
  turnos = turnos.slice(-RESUMIR_DESDE - 20);
  ls.set(claveTurnos(chatId), turnos);
  if (turnos.length > RESUMIR_DESDE && !resumiendo) resumirViejos(chatId).catch(() => {});
}
// Condensa los mensajes más antiguos del chat en un resumen (en segundo plano, con el modelo rápido).
async function resumirViejos(id){
  resumiendo = true;
  try {
    const viejos = turnos.slice(0, turnos.length - MAX_TURNOS);
    const texto = viejos.map(t => (t.role === "user" ? "Persona: " + t.content : "Capataz: " + leerRespuesta(t.content))).join("\n");
    const nuevo = (await llamarLLM({ json:false, maxTokens:1024,
      system:"Resumes conversaciones entre una persona y su asistente de obra. Escribe en español un resumen de máximo 120 palabras con lo importante para seguir conversando: temas, decisiones, números, pendientes y lo que la persona quería. Sin saludos ni relleno.",
      messages:[{ role:"user", content:(resumen ? "Resumen anterior:\n" + resumen + "\n\n" : "") + "Conversación nueva:\n" + texto }] })).trim();
    if (!nuevo || id !== chatId) return;
    resumen = nuevo; ls.set(claveResumen(id), resumen);
    turnos = turnos.slice(viejos.length); ls.set(claveTurnos(id), turnos);
  } finally { resumiendo = false; }
}
const leerRespuesta = c => { try { return JSON.parse(c).respuesta ?? c; } catch { return c; } };
export function borrarHistorial(id = chatId){ if (id === chatId){ turnos = []; resumen = ""; } ls.del(claveTurnos(id)); ls.del(claveResumen(id)); }

// Preguntas que merecen el modelo que razona: cálculos, fotos, explicaciones, redacción o mensajes largos.
const DIFICIL = /calcul|cu[aá]nt[oa]s?\b|metr[ao]|m2|m3|m²|m³|\d+\s*(x|por)\s*\d+|dosific|presupuest|cost|precio|cotiz|planilla|resistenc|losa|viga|columna|zapata|fierro|encofr|por qu[eé]|c[oó]mo (se|hago|puedo)|explica|diferencia|compar|recomiend|conviene|redact|escrib|carta|informe|contrato|plan\b|analiz|revis/i;
export const esDificil = (texto, imagen) => !!imagen || String(texto).length > 160 || DIFICIL.test(String(texto));

// Saca lo que va del campo "respuesta" de un JSON a medio escribir.
export function respuestaParcial(buf){
  const m = /"respuesta"\s*:\s*"/.exec(buf); if (!m) return "";
  let out = "", i = m.index + m[0].length;
  const esc = { n:"\n", t:"\t", r:"", '"':'"', "\\":"\\", "/":"/", b:"", f:"" };
  for (; i < buf.length; i++){
    const c = buf[i];
    if (c === '"') break;
    if (c !== "\\"){ out += c; continue; }
    const n = buf[i + 1]; if (n === undefined) break;
    if (n === "u"){ const h = buf.slice(i + 2, i + 6); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 5; }
    else { out += esc[n] ?? n; i++; }
  }
  return out;
}

/* ---------- Seguimientos: preguntas que Capataz le hará más adelante ---------- */
let seguimientos = ls.get("capataz-seguimientos", []);
const guardarSeg = () => ls.set("capataz-seguimientos", seguimientos);
export const seguimientosVencidos = () => seguimientos.filter(x => x.cuando <= Date.now());
function bloqueSeguimientos(){
  const venc = seguimientosVencidos(), prox = seguimientos.filter(x => x.cuando > Date.now()).slice(0, 10);
  return (venc.length ? "\nSeguimientos para preguntarle ya:\n" + venc.map(x => `- [${x.id}] ${x.pregunta}`).join("\n") : "")
    + (prox.length ? "\nSeguimientos programados:\n" + prox.map(x => `- [${x.id}] ${localISO(new Date(x.cuando))} ${x.pregunta}`).join("\n") : "");
}

function contexto(clima = ""){
  const ahora=new Date();
  const fecha = new Intl.DateTimeFormat("es",{weekday:"long",day:"numeric",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(ahora);
  const pend = tareas().filter(t=>!t.hecho).slice(0,60).map(t=>`- [${t.id}] ${t.texto}${t.proyecto?" (proyecto: "+t.proyecto+")":""}`).join("\n") || "(ninguno)";
  const avs = avisos().filter(a=>!a.hecho).sort((a,b)=>a.cuando-b.cuando).slice(0,40).map(a=>`- [${a.id}] ${localISO(new Date(a.cuando))} ${a.texto}`).join("\n") || "(ninguno)";
  return `Ahora es ${fecha} (${localISO(ahora)}).${resumen ? "\nResumen de lo hablado antes en este chat:\n" + resumen : ""}${otrosChats ? "\nOtros chats que tiene contigo (temas aparte; lo importante de ellos está en el perfil):\n" + otrosChats : ""}${clima ? "\n" + clima : ""}\nTrabajos pendientes:\n${pend}\nRecordatorios pendientes:\n${avs}${bloqueSeguimientos()}`;
}

// JSON del modelo; si llegó cortado o como texto suelto, se rescata la respuesta en vez de fallar.
function parsear(texto){
  const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
  try { return JSON.parse(texto.slice(i, j+1)); } catch {}
  const parcial = respuestaParcial(texto).trim();
  if (parcial) return { respuesta: parcial };
  if (i < 0 && texto.trim()) return { respuesta: texto.trim() };
  throw { code:"invalid_json" };
}
const lista = v => Array.isArray(v) ? v : [];

async function aplicar(r){
  const hechos=[];
  for (const t of lista(r.nuevas_tareas)) try { const o=await agregarTarea(t?.texto, t?.proyecto); if(o) hechos.push("Trabajo anotado: "+o.texto); } catch {}
  for (const a of lista(r.nuevos_recordatorios)) try { const o=await agregarAviso(a?.texto, a?.cuando); if(o) hechos.push("Aviso: "+o.texto+" · "+cuandoTexto(o.cuando)); } catch {}
  for (const id of lista(r.completar)) try {
    const it=items.find(x=>x.id===String(id?.id ?? id));
    if(it && !it.hecho){ await actualizar(it.id,{hecho:true,terminado:Date.now()}); hechos.push("Marcado como hecho: "+it.texto); }
  } catch {}
  try { hechos.push(...await aprender(r.nuevos_aprendizajes)); } catch {}
  for (const sg of lista(r.seguimientos)) try {
    const cuando = new Date(sg?.cuando).getTime();
    if (sg?.pregunta && cuando){ seguimientos.push({ id:"s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), pregunta:String(sg.pregunta).slice(0, 200), cuando }); hechos.push("Te preguntaré " + cuandoTexto(cuando) + ": " + sg.pregunta); }
  } catch {}
  if (lista(r.seguimientos_hechos).length) seguimientos = seguimientos.filter(x => !lista(r.seguimientos_hechos).map(String).includes(x.id));
  if (lista(r.seguimientos).length || lista(r.seguimientos_hechos).length) guardarSeg();
  for (const a of lista(r.acciones)) try {
    const res = await accionDispositivo(a?.tipo, a || {});
    if (res.usarAviso){ // sin reloj del sistema: se programa como aviso de Capataz
      const cuando = a.tipo === "temporizador" ? localISO(new Date(Date.now() + res.segundos * 1000)) : siguienteHora(a.hora, a.fecha);
      const o = await agregarAviso(a.mensaje || (a.tipo === "temporizador" ? "Temporizador" : "Alarma"), cuando);
      if (o) hechos.push("Alarma: " + o.texto + " · " + cuandoTexto(o.cuando));
    } else if (res.ok) { hechos.push(res.texto); if (res.cerrarVoz) hechos.cerrarVoz = true; }
    else hechos.push("No se pudo: " + res.texto);
  } catch { hechos.push("No se pudo hacer eso en este equipo"); }
  return hechos;
}

// "HH:MM" (+ fecha opcional) → la próxima vez que llegue esa hora, en AAAA-MM-DDTHH:MM.
function siguienteHora(hora, fecha){
  const [h, m] = String(hora).split(":").map(Number);
  const d = fecha ? new Date(fecha + "T00:00") : new Date();
  d.setHours(h, m, 0, 0);
  if (!fecha && d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return localISO(d);
}

// Devuelve {respuesta, hechos}. Lanza {code} si falla.
// Sin clave (o sin internet) responde el intérprete propio; con clave conversa la IA.
// soloSiEntiende: devuelve null en vez de "No te entendí".
async function sinIA(texto, soloSiEntiende = false){
  const estado = {
    tareas: tareas().filter(t=>!t.hecho).sort((a,b)=>b.creado-a.creado),
    avisos: avisos().filter(a=>!a.hecho).sort((a,b)=>a.cuando-b.cuando),
    perfil: listarPerfil(),
    proyectos: [...new Set(tareas().map(t=>t.proyecto).filter(Boolean))]
  };
  const r = interpretar(texto, estado) || (soloSiEntiende ? null : { respuesta: "No te entendí. " + AYUDA });
  if (!r) return null;
  const hechos = (await aplicar(r)).filter(h => !/^Aprendí|^Olvidé/.test(h));
  return { respuesta: r.respuesta, hechos };
}

const VOZ = "\n\nAhora conversan por VOZ: responde como se habla, en frases cortas, sin listas, viñetas, emojis ni símbolos; di las fechas y horas en palabras.";

// Lo que se pide para el informe automático de la mañana (no se muestra como mensaje de la persona).
export const INFORME = "[Informe del día] Dame el informe de hoy como un asistente personal de primera: saludo según la hora, el clima y si afecta a la obra, lo importante que tengo hoy (avisos y trabajos), los seguimientos que tengas para preguntarme y una recomendación concreta. Máximo 5 frases, sin listas.";

// Órdenes de un toque desde Inicio: el asistente resuelve todo sin hacer preguntas.
export const ORDENES = {
  dia: "[Organiza mi día] Organiza mi día de forma realista, desde ahora hasta la noche (si ya pasaron las 19:00, organiza el día de mañana y dilo): usa mis trabajos pendientes, avisos, seguimientos, el clima y lo que sabes de mi rutina. Prioriza lo urgente y lo que depende del clima, agrupa lo que se puede hacer junto y deja tiempo para comer y moverme. Crea en nuevos_recordatorios un aviso con fecha y hora futura para cada bloque importante (máximo 6) y dime el plan en líneas cortas con su hora. No me hagas preguntas: asume lo razonable y dime en una frase qué asumiste.",
  semana: "[Planifica mi semana] Planifica mi semana desde hoy hasta el domingo: reparte mis trabajos pendientes por día según urgencia, clima pronosticado y lo que sabes de mis obras y rutina; marca qué conviene comprar o coordinar antes. Crea recordatorios para los hitos clave (máximo 7) y dímelo por día en líneas cortas. No me hagas preguntas: asume lo razonable y dime en una frase qué asumiste."
};

// onParcial(texto): la respuesta mientras se escribe (streaming).
export async function conversar(texto, modelo, { voz = false, imagen = null, onParcial = null } = {}){
  if (!(await tieneClave())){
    if (imagen) return { respuesta:"Para mirar fotos necesito una clave de IA. Ponla gratis en Ajustes (la de Gemini).", hechos:[] };
    return sinIA(texto);
  }
  try { return await conIA(texto, modelo, voz, imagen, onParcial); }
  catch(e){
    if (e?.code === "red") return sinIA(texto);
    // IA saturada o respuesta ilegible: si es una orden de agenda, el intérprete propio la resuelve igual.
    if (!imagen && ["sobrecargado", "rate_limited", "invalid_json"].includes(e?.code)){
      const r = await sinIA(texto, true);
      if (r) return { ...r, respuesta: r.respuesta + " (La IA de Google está saturada, así que lo resolví yo solo.)" };
    }
    throw e;
  }
}

async function conIA(texto, modelo, voz, imagen, onParcial){
  if (imagen && !texto) texto = "Mira esta foto y dime qué ves y qué me recomiendas.";
  const primero = !turnos.length;
  // Contexto inteligente en paralelo y con tope de tiempo: memoria, clima y recuerdos parecidos.
  const tope = (p, ms, d) => Promise.race([p, new Promise(ok => setTimeout(() => ok(d), ms))]);
  const [perfilTxt, clima, recuerdos] = await Promise.all([bloquePerfil(), tope(climaTexto(), 3000, ""), tope(buscarRecuerdos(texto, 6, chatId), 3000, [])]);
  const system = `${reglas()}${primero ? '\nEs el primer mensaje de este chat: agrega también "titulo" con 2 a 5 palabras que nombren el tema (ej. "Obra Achumani", "Cálculo de losa").' : ""}${voz ? VOZ : ""}\n\n## Lo que sabes de la persona\n${perfilTxt}${recuerdos.length ? "\n\n## Recuerdos de conversaciones pasadas que pueden servir\n" + bloqueRecuerdos(recuerdos) : ""}\n\n## Estado actual\n${contexto(clima)}`;
  const messages = [...turnos.slice(-MAX_TURNOS), { role:"user", content:texto }];
  const pedido = { system, messages, modelo, imagen, potente: esDificil(texto, imagen) };
  let ultimo = "";
  const r = parsear(onParcial
    ? await enviarEnVivo(pedido, buf => { const p = respuestaParcial(buf); if (p && p !== ultimo){ ultimo = p; onParcial(p); } })
    : await llamarLLM(pedido));
  const respuesta = typeof r?.respuesta==="string" && r.respuesta.trim() ? r.respuesta.trim() : "Listo.";
  const hechos = await aplicar(r);
  turnos.push({role:"user",content:(imagen ? "[envió una foto] " : "") + texto},{role:"assistant",content:JSON.stringify({respuesta, aplicado:hechos})});
  guardarTurnos();
  if (!/^\[(Informe|Organiza|Planifica)/.test(texto)) recordar(`Persona: ${texto}\nCapataz: ${respuesta}`, chatId);
  const titulo = primero && typeof r?.titulo === "string" ? r.titulo.trim().slice(0, 40) : "";
  return { respuesta, hechos, titulo };
}

export function agregarTurno(usuario, respuesta){
  turnos.push({role:"user",content:usuario},{role:"assistant",content:JSON.stringify({respuesta, aplicado:[]})});
  guardarTurnos();
  recordar(`Persona: ${usuario}\nCapataz: ${respuesta}`, chatId);
}

/* ---------- Voz en tiempo real (Gemini Live): herramientas en vez de JSON ---------- */
export async function sistemaViva(){
  const previos = turnos.slice(-16).map(t => (t.role === "user" ? "Persona: " + t.content : "Tú: " + leerRespuesta(t.content))).join("\n");
  const clima = await Promise.race([climaTexto(), new Promise(ok => setTimeout(() => ok(""), 3000))]);
  return `${PERSONA_DE()}

Ahora están conversando POR VOZ en tiempo real, como una llamada. Habla como una persona: frases cortas y naturales, con pausas, sin listas ni símbolos; di fechas y horas en palabras. Si te interrumpe, deja lo que estabas diciendo y escúchale. Saluda brevemente al empezar, por su nombre si lo sabes, y si tiene algo vencido o importante hoy, menciónalo.
HERRAMIENTAS (obligatorio): cuando pida anotar algo, llama a crear_trabajo; cuando pida que le recuerdes o avises algo con hora, llama a crear_recordatorio (si no dijo la hora, pregúntala primero); cuando diga que terminó algo, llama a marcar_hecho con el id exacto de la lista; cuando te cuente un dato útil de sí mismo, su obra o su gente, llama a aprender_dato. También manejas su celular: alarma, temporizador, musica (Spotify), abrir_app, llamar, whatsapp, navegar, abrir_web y linterna; úsalas cuando te lo pida. Si te pregunta por algo que hablaron antes y no está aquí, llama a buscar_recuerdos. Cuando algo quede en el aire, llama a programar_seguimiento para preguntarle después; cuando ya preguntaste un seguimiento vencido, llama a seguimiento_hecho. NUNCA digas que anotaste, agendaste o recordarás algo sin haber llamado antes a la herramienta. Después de usarla, confírmalo en una frase. Para datos actuales (precios, clima, noticias, horarios) busca en Google.
${APRENDER.replace("guárdalo en nuevos_aprendizajes", "guárdalo con aprender_dato")}

## Lo que sabes de la persona
${await bloquePerfil()}

## Estado actual
${contexto(clima)}
${previos ? "\n## Lo último que hablaron por escrito\n" + previos : ""}`;
}

export const HERRAMIENTAS = [
  { name:"crear_trabajo", description:"Anota un trabajo/tarea pendiente.", parameters:{ type:"OBJECT", properties:{
    texto:{ type:"STRING" }, proyecto:{ type:"STRING", description:"obra o proyecto; vacío si no aplica" } }, required:["texto"] } },
  { name:"crear_recordatorio", description:"Programa un aviso que suena en el celular a la fecha y hora indicadas.", parameters:{ type:"OBJECT", properties:{
    texto:{ type:"STRING" }, cuando:{ type:"STRING", description:"AAAA-MM-DDTHH:MM en hora local de la persona" } }, required:["texto","cuando"] } },
  { name:"marcar_hecho", description:"Marca como hecho un trabajo o aviso de la lista.", parameters:{ type:"OBJECT", properties:{
    id:{ type:"STRING", description:"id exacto de la lista de pendientes" } }, required:["id"] } },
  { name:"aprender_dato", description:"Guarda en la memoria a largo plazo un dato útil sobre la persona, su trabajo o sus preferencias.", parameters:{ type:"OBJECT", properties:{
    clave:{ type:"STRING", description:"identificador corto, igual para actualizar" },
    categoria:{ type:"STRING", enum:["persona","proyecto","proveedor","contacto","preferencia","rutina","general"] },
    valor:{ type:"STRING", description:"el dato en una frase; vacío para olvidarlo" } }, required:["clave","valor"] } },
  { name:"alarma", description:"Pone una alarma en el reloj del celular. Para 'alarma' o 'despiértame'.", parameters:{ type:"OBJECT", properties:{
    hora:{ type:"STRING", description:"HH:MM en 24 h" }, fecha:{ type:"STRING", description:"AAAA-MM-DD si no es la próxima vez que llegue esa hora" }, mensaje:{ type:"STRING" } }, required:["hora"] } },
  { name:"temporizador", description:"Pone un temporizador (cuenta regresiva).", parameters:{ type:"OBJECT", properties:{
    minutos:{ type:"NUMBER" }, segundos:{ type:"NUMBER" }, mensaje:{ type:"STRING" } } } },
  { name:"musica", description:"Pone a sonar una canción, artista, lista o género en Spotify (o YouTube si lo pide).", parameters:{ type:"OBJECT", properties:{
    consulta:{ type:"STRING" }, app:{ type:"STRING", description:"spotify (por defecto) o youtube" } }, required:["consulta"] } },
  { name:"abrir_app", description:"Abre una app instalada en el celular por su nombre.", parameters:{ type:"OBJECT", properties:{ nombre:{ type:"STRING" } }, required:["nombre"] } },
  { name:"llamar", description:"Abre el marcador con un número para llamar. Si te dicen un nombre, usa el teléfono que sabes de esa persona; no inventes números.", parameters:{ type:"OBJECT", properties:{ numero:{ type:"STRING" } }, required:["numero"] } },
  { name:"whatsapp", description:"Abre WhatsApp con un chat y el mensaje ya escrito. Número con código de país (591 Bolivia).", parameters:{ type:"OBJECT", properties:{ numero:{ type:"STRING" }, texto:{ type:"STRING" } } } },
  { name:"navegar", description:"Abre la ruta en Google Maps hacia un lugar.", parameters:{ type:"OBJECT", properties:{ destino:{ type:"STRING" } }, required:["destino"] } },
  { name:"abrir_web", description:"Abre una página web.", parameters:{ type:"OBJECT", properties:{ url:{ type:"STRING" } }, required:["url"] } },
  { name:"linterna", description:"Enciende o apaga la linterna del celular.", parameters:{ type:"OBJECT", properties:{ encender:{ type:"BOOLEAN" } }, required:["encender"] } }
];
HERRAMIENTAS.push(
  { name:"buscar_recuerdos", description:"Busca en las conversaciones pasadas (de cualquier chat y fecha) lo que se habló sobre un tema.", parameters:{ type:"OBJECT", properties:{ consulta:{ type:"STRING" } }, required:["consulta"] } },
  { name:"programar_seguimiento", description:"Programa una pregunta para hacerle más adelante sobre algo que quedó pendiente.", parameters:{ type:"OBJECT", properties:{
    pregunta:{ type:"STRING" }, cuando:{ type:"STRING", description:"AAAA-MM-DDTHH:MM en hora local" } }, required:["pregunta","cuando"] } },
  { name:"seguimiento_hecho", description:"Marca un seguimiento como ya preguntado.", parameters:{ type:"OBJECT", properties:{ id:{ type:"STRING" } }, required:["id"] } }
);
const TIPOS_ACCION = ["alarma","temporizador","musica","abrir_app","llamar","whatsapp","navegar","abrir_web","linterna"];

// Ejecuta una herramienta pedida por la IA. Devuelve {resultado (para la IA), hechos (para mostrar)}.
export async function ejecutarHerramienta(nombre, a = {}){
  if (nombre === "seguimiento_hecho"){ await aplicar({ seguimientos_hechos:[a.id] }); return { resultado:"Listo.", hechos:[] }; }
  if (nombre === "buscar_recuerdos"){
    const r = await buscarRecuerdos(a.consulta || "", 8);
    return { resultado: r.length ? bloqueRecuerdos(r) : "No encontré nada sobre eso en conversaciones pasadas.", hechos:[] };
  }
  const r = {
    programar_seguimiento: { seguimientos:[{ pregunta:a.pregunta, cuando:a.cuando }] },
    seguimiento_hecho: { seguimientos_hechos:[a.id] },
    crear_trabajo: { nuevas_tareas:[{ texto:a.texto, proyecto:a.proyecto }] },
    crear_recordatorio: { nuevos_recordatorios:[{ texto:a.texto, cuando:a.cuando }] },
    marcar_hecho: { completar:[a.id] },
    aprender_dato: { nuevos_aprendizajes:[{ clave:a.clave, categoria:a.categoria, valor:a.valor }] }
  }[nombre] || (TIPOS_ACCION.includes(nombre) ? { acciones:[{ ...a, tipo:nombre }] } : null);
  if (!r) return { resultado:"herramienta desconocida", hechos:[] };
  const hechos = await aplicar(r);
  return { resultado: hechos.length ? "Hecho: " + hechos.join("; ") : "No se pudo (revisa los datos o el id).", hechos, cerrarVoz:!!hechos.cerrarVoz };
}
