// Interfaz de Capataz (misma UI que la versión artifact) sobre el core y los adaptadores nativos.
import { $, el, ls, cuandoTexto, localISO } from "./core/util.js";
import { cargar, alCambiar, recargar, tareas, avisos, agregarTarea, agregarAviso, actualizar, borrar, alternarHecho, posponer } from "./core/datos.js";
import { cargarPerfil, listarPerfil, olvidar } from "./core/memoria.js";
import { conversar, borrarHistorial, agregarTurno } from "./core/ia.js";
import { iniciarVozViva } from "./core/vozViva.js";
import { revisarAlarmas } from "./core/alarmas.js";
import { plataforma, nativo } from "./adapters/plataforma.js";
import { pedirPermiso, alAccionar } from "./adapters/notifications.js";
import { dictar, detener, puedeDictar, consejoDictado, hablar as decir, callar, reiniciarVozNatural } from "./adapters/voice.js";
import { guardarClave, tieneClave } from "./adapters/llm.js";

const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
function setSync(on, texto){ const s=$("#sync"); s.classList.toggle("on", on); s.querySelector("span").textContent=texto; }

/* ---------- Pestañas ---------- */
document.querySelectorAll("nav button").forEach(b => b.addEventListener("click", () => abrir(b.dataset.p)));
function abrir(p){
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.p===p)));
  ["hablar","trabajos","recordatorios"].forEach(x => $("#p-"+x).hidden = x!==p);
  ls.set("capataz-tab", p);
}
const tabGuardada = ls.get("capataz-tab","hablar"); if(["hablar","trabajos","recordatorios"].includes(tabGuardada)) abrir(tabGuardada);

/* ---------- Render ---------- */
function botonBorrar(id){
  let armado=false, t;
  const b = el("button",{class:"del",type:"button","aria-label":"Borrar"},"Borrar");
  b.addEventListener("click",()=>{
    if(!armado){ armado=true; b.textContent="¿Seguro?"; b.classList.add("confirmar"); t=setTimeout(()=>{armado=false;b.textContent="Borrar";b.classList.remove("confirmar")},3000); return; }
    clearTimeout(t); borrar(id);
  });
  return b;
}
function check(it){
  return el("button",{class:"check"+(it.hecho?" on":""),type:"button","aria-label":it.hecho?"Marcar pendiente":"Marcar hecho",html:it.hecho?ICON_CHECK:"",onclick:()=>alternarHecho(it)});
}
function filaTarea(it){
  return el("li",{}, check(it),
    el("div",{class:"txt"+(it.hecho?" tachado":"")}, el("span",{},it.texto), it.proyecto? el("div",{class:"meta"}, el("span",{class:"chip"},it.proyecto)) : null),
    botonBorrar(it.id));
}
function filaAviso(it){
  const venc = !it.hecho && it.cuando<=Date.now();
  return el("li",{class:venc?"vencido":""}, check(it),
    el("div",{class:"txt"+(it.hecho?" tachado":"")}, el("span",{},it.texto), el("div",{class:"meta"}, el("span",{class:"hora"}, (venc?"Venció ":"")+cuandoTexto(it.cuando)))),
    botonBorrar(it.id));
}
function render(){
  const ts = tareas(), pend = ts.filter(t=>!t.hecho).sort((a,b)=>b.creado-a.creado), hechas = ts.filter(t=>t.hecho).sort((a,b)=>(b.terminado||0)-(a.terminado||0));
  $("#n-trabajos").textContent = pend.length;
  const lt = $("#lista-trabajos"); lt.replaceChildren();
  if(!ts.length) lt.append(el("div",{class:"vacio"},"Aún no hay trabajos. Escríbelos arriba o díselos a Capataz en la pestaña Hablar."));
  else {
    const grupos = {};
    pend.forEach(t => (grupos[t.proyecto||""] ??= []).push(t));
    const claves = Object.keys(grupos).sort((a,b)=> a===""?1:b===""?-1:a.localeCompare(b));
    for (const k of claves){ lt.append(el("h3",{}, k || "Sin proyecto")); lt.append(el("ul",{class:"lista"}, grupos[k].map(filaTarea))); }
    if(!pend.length) lt.append(el("div",{class:"vacio"},"Todo al día. No tienes trabajos pendientes."));
    if(hechas.length) lt.append(el("details",{}, el("summary",{},"Terminados ("+hechas.length+")"), el("ul",{class:"lista"}, hechas.slice(0,50).map(filaTarea))));
  }
  const dl=$("#proyectos"); dl.replaceChildren(...[...new Set(ts.map(t=>t.proyecto).filter(Boolean))].map(p=>el("option",{value:p})));

  const av = avisos(), ahora=Date.now();
  const venc = av.filter(a=>!a.hecho && a.cuando<=ahora).sort((a,b)=>a.cuando-b.cuando);
  const prox = av.filter(a=>!a.hecho && a.cuando>ahora).sort((a,b)=>a.cuando-b.cuando);
  const listos = av.filter(a=>a.hecho).sort((a,b)=>b.cuando-a.cuando);
  $("#n-recordatorios").textContent = venc.length+prox.length;
  const lr=$("#lista-recordatorios"); lr.replaceChildren();
  if(!av.length) lr.append(el("div",{class:"vacio"},"No tienes avisos programados. Ejemplo: “Recuérdame el viernes a las 8 pagar a los trabajadores”."));
  if(venc.length){ lr.append(el("h3",{},"Vencidos")); lr.append(el("ul",{class:"lista"}, venc.map(filaAviso))); }
  if(prox.length){ lr.append(el("h3",{},"Próximos")); lr.append(el("ul",{class:"lista"}, prox.map(filaAviso))); }
  if(listos.length) lr.append(el("details",{}, el("summary",{},"Hechos ("+listos.length+")"), el("ul",{class:"lista"}, listos.slice(0,50).map(filaAviso))));
  revisarAlarmas(hablar);
}
alCambiar(render);
setInterval(render, 20000);

/* ---------- Formularios ---------- */
$("#f-tarea").addEventListener("submit", async e => { e.preventDefault();
  await agregarTarea($("#in-tarea").value, $("#in-proyecto").value); $("#in-tarea").value=""; $("#in-tarea").focus(); });
function horaPorDefecto(){ const d=new Date(Date.now()+3600e3); d.setMinutes(d.getMinutes()<30?30:60,0,0); return localISO(d); }
$("#in-cuando").value = horaPorDefecto();
$("#f-rec").addEventListener("submit", async e => { e.preventDefault();
  await agregarAviso($("#in-rec").value, $("#in-cuando").value); $("#in-rec").value=""; $("#in-cuando").value=horaPorDefecto(); });

/* ---------- Voz ---------- */
const chkVoz = $("#chk-voz"); chkVoz.checked = ls.get("capataz-voz", false);
chkVoz.addEventListener("change", () => ls.set("capataz-voz", chkVoz.checked));
function hablar(texto){ if(chkVoz.checked && !modoVoz.activo) decir(texto); }

const btnMic = $("#btn-mic"), notaChat = $("#nota-chat");
let grabando=false;
btnMic.addEventListener("click", async () => {
  if(!puedeDictar()){ notaChat.textContent = consejoDictado; $("#in-chat").focus(); return; }
  if(grabando){ detener(); return; }
  grabando=true; btnMic.classList.add("grabando"); notaChat.textContent="Escuchando…";
  try{
    const final = await dictar(t => $("#in-chat").value = t);
    notaChat.textContent="";
    if(final) enviar(final);
  }catch(e){
    notaChat.textContent = (e?.code==="not-allowed"||e?.code==="service-not-allowed"||e?.code==="no-disponible") ? consejoDictado : "No te escuché bien. Intenta de nuevo.";
  }finally{ grabando=false; btnMic.classList.remove("grabando"); }
});

/* ---------- Fotos ---------- */
// Reduce la foto (lado mayor 1280 px, JPEG) para enviarla rápido; guarda además una miniatura para el historial.
let imagenAdjunta = null;
function reducir(img, lado, calidad){
  const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", calidad);
}
$("#in-foto").addEventListener("change", async e => {
  const f = e.target.files?.[0]; e.target.value = ""; if(!f) return;
  const url = URL.createObjectURL(f), img = new Image();
  await new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; img.src = url; }).catch(()=>{});
  URL.revokeObjectURL(url); if(!img.naturalWidth) return;
  const grande = reducir(img, 1280, .82);
  imagenAdjunta = { mime:"image/jpeg", data:grande.split(",")[1], mini:reducir(img, 240, .7) };
  $("#adjunto-img").src = grande; $("#adjunto").hidden = false; $("#in-chat").focus();
});
$("#adjunto-quitar").addEventListener("click", () => { imagenAdjunta = null; $("#adjunto").hidden = true; });

/* ---------- Conversación con la IA ---------- */
const chat = $("#chat");
let ocupado=false;
function burbuja(cls, texto){ const b=el("div",{class:"msg "+cls}, texto); chat.append(b); b.scrollIntoView({block:"end",behavior:"smooth"}); return b; }
function conHechos(b, hechos){ if(hechos?.length) b.append(el("div",{class:"hechos"}, hechos.map(h=>el("span",{class:"hecho"},h)))); return b; }

// Historial visible: se conserva entre sesiones (últimos 120 mensajes).
let historialChat = ls.get("capataz-chat", []);
function guardarChat(m){
  historialChat.push(m); historialChat = historialChat.slice(-120);
  historialChat.slice(0, -30).forEach(x => delete x.mini); // miniaturas solo en los últimos 30
  ls.set("capataz-chat", historialChat);
}
if(historialChat.length){
  $("#intro")?.remove();
  for(const m of historialChat) chat.append(conHechos(el("div",{class:"msg "+m.de}, m.mini ? el("img",{src:m.mini, alt:"Foto"}) : null, m.texto), m.hechos));
  requestAnimationFrame(() => chat.lastElementChild?.scrollIntoView({block:"end"}));
}

const ERRORES = {
  sin_clave:"Para conversar libremente, pon una clave gratuita de Gemini en Ajustes (engranaje arriba).",
  clave_invalida:"La clave de IA no es válida. Revísala en Ajustes.",
  rate_limited:"Llegaste al límite gratuito por ahora. Intenta de nuevo en un rato.",
  sobrecargado:"La IA está ocupada. Intenta de nuevo en un momento.",
  red:"Sin conexión a internet. Tus listas y avisos siguen funcionando.",
  invalid_json:"No entendí bien la respuesta. Repite el mensaje, por favor."
};

// Devuelve la respuesta (o null si falló).
async function enviar(texto, { voz = false } = {}){
  texto = String(texto||"").trim();
  const imagen = voz ? null : imagenAdjunta;
  if((!texto && !imagen) || ocupado) return null;
  if(imagen){ imagenAdjunta = null; $("#adjunto").hidden = true; }
  $("#intro")?.remove();
  $("#in-chat").value=""; notaChat.textContent=""; notaChat.classList.remove("error");
  const b = burbuja("yo", texto); if(imagen) b.prepend(el("img",{src:imagen.mini, alt:"Foto"}));
  guardarChat({ de:"yo", texto, ...(imagen ? { mini:imagen.mini } : {}) });
  const pensando = burbuja("ia pensando","Pensando…");
  ocupado=true;
  try{
    const { respuesta, hechos } = await conversar(texto, ls.get("capataz-modelo", ""), { voz, imagen });
    pensando.classList.remove("pensando"); pensando.textContent = respuesta; conHechos(pensando, hechos);
    guardarChat({ de:"ia", texto:respuesta, hechos });
    hablar(respuesta);
    return { respuesta, hechos };
  }catch(e){
    pensando.remove();
    notaChat.textContent = ERRORES[e?.code] || "Se cortó la conexión. Vuelve a enviar el mensaje."; notaChat.classList.add("error"); $("#in-chat").value=texto;
    if(imagen){ imagenAdjunta = imagen; $("#adjunto").hidden = false; }
    if(e?.code==="clave_invalida") abrirAjustes();
    return { error: ERRORES[e?.code] || "Se cortó la conexión." };
  }finally{ ocupado=false; }
}
$("#f-chat").addEventListener("submit", e => { e.preventDefault(); enviar($("#in-chat").value); });
$("#ejemplos")?.addEventListener("click", e => { if(e.target.matches("button")) enviar(e.target.textContent); });

/* ---------- Modo conversación por voz (tipo ChatGPT) ---------- */
// Escucha → piensa → habla → vuelve a escuchar, manos libres, hasta que lo cierres.
const modoVoz = { activo:false, estado:"" };
const capa = $("#voz"), orbe = $("#voz-orbe"), vozEstado = $("#voz-estado"), vozTexto = $("#voz-texto");
function estadoVoz(e, texto){
  modoVoz.estado = e; capa.dataset.estado = e;
  vozEstado.textContent = { escuchando:"Te escucho…", pensando:"Pensando…", hablando:"Hablando… toca para interrumpir", pausa:"Toca el círculo para hablar" }[e] || "";
  if(texto!=null) vozTexto.textContent = texto;
}
async function cicloVoz(){
  let silencios = 0;
  while(modoVoz.activo){
    estadoVoz("escuchando", "");
    let dicho = "";
    try{ dicho = await dictar(t => { vozTexto.textContent = t; }); }
    catch(e){ estadoVoz("pausa", (e?.code==="not-allowed") ? "Necesito permiso del micrófono." : consejoDictado); return; }
    if(!modoVoz.activo) return;
    if(!dicho){ if(++silencios >= 2){ estadoVoz("pausa", ""); return; } continue; }
    silencios = 0;
    estadoVoz("pensando", dicho);
    const r = await enviar(dicho, { voz:true });
    if(!modoVoz.activo) return;
    const decirEsto = r?.respuesta || r?.error || "No te entendí.";
    estadoVoz("hablando", decirEsto);
    await decir(decirEsto);
  }
}
// Primero intenta la voz en tiempo real (Gemini Live); si no hay clave de Gemini o falla, usa escuchar/responder por turnos.
let viva = null;
async function abrirVoz(){
  modoVoz.activo = true; capa.hidden = false; abrir("hablar");
  estadoVoz("pensando", "Conectando…");
  try{
    viva = await iniciarVozViva({ voz: ls.get("capataz-voz-nombre", "Charon"), interrumpir: ls.get("capataz-interrumpir", false), eventos:{
      estado: e => { if(modoVoz.activo) estadoVoz(e); },
      oyendo: t => { vozTexto.textContent = t; },
      diciendo: t => { vozTexto.textContent = t; },
      turno: ({ usuario, respuesta, hechos }) => {
        $("#intro")?.remove();
        if(usuario){ burbuja("yo", usuario); guardarChat({ de:"yo", texto:usuario }); }
        if(respuesta || hechos.length){ conHechos(burbuja("ia", respuesta || "Listo."), hechos); guardarChat({ de:"ia", texto:respuesta || "Listo.", hechos }); }
        if(usuario && respuesta) agregarTurno(usuario, respuesta);
      },
      error: code => { viva = null; if(!modoVoz.activo) return;
        estadoVoz("pausa", code === "clave_invalida" ? "La clave de Gemini no sirvió para la voz en vivo." : "Se cortó la llamada. Toca el círculo para volver a conectar."); modoVoz.reconectar = true; }
    }});
    modoVoz.vivo = true;
  }catch(e){
    viva = null; modoVoz.vivo = false;
    if(!modoVoz.activo) return;
    if(!puedeDictar()){ estadoVoz("pausa", e?.code === "not-allowed" ? "Necesito permiso del micrófono." : consejoDictado); return; }
    cicloVoz();
  }
}
function cerrarVoz(){ modoVoz.activo = false; modoVoz.vivo = false; viva?.cerrar(); viva = null; detener(); callar(); capa.hidden = true; }
$("#btn-voz").addEventListener("click", abrirVoz);
$("#voz-cerrar").addEventListener("click", cerrarVoz);
orbe.addEventListener("click", () => {
  if(modoVoz.reconectar){ modoVoz.reconectar = false; abrirVoz(); return; }
  if(viva){ if(viva.hablandoAhora()) viva.interrumpir(); return; }
  if(modoVoz.estado === "hablando"){ callar(); }               // interrumpe y vuelve a escuchar
  else if(modoVoz.estado === "escuchando"){ detener(); }       // ya terminé de hablar
  else if(modoVoz.estado === "pausa"){ cicloVoz(); }
});

/* ---------- Ajustes ---------- */
const dlg = $("#ajustes");
function renderPerfil(){
  $("#lista-perfil").replaceChildren(...listarPerfil().map(f => el("li",{},
    el("div",{class:"txt"}, el("span",{}, f.valor), el("div",{class:"meta"}, el("span",{class:"chip"}, f.categoria), el("span",{class:"hora"}, "×"+f.frecuencia))),
    el("button",{class:"del",type:"button",onclick:async()=>{ await olvidar(f.clave); renderPerfil(); }},"Olvidar"))));
}
async function abrirAjustes(){
  $("#in-clave").value = ""; $("#in-modelo").value = ls.get("capataz-modelo", "");
  $("#sel-voz").value = ls.get("capataz-voz-nombre", "Charon"); $("#chk-interrumpir").checked = ls.get("capataz-interrumpir", false);
  $("#nota-clave").textContent = (await tieneClave()) ? "Hay una clave guardada: Capataz conversa libremente. Escribe otra solo si quieres cambiarla." : "Opcional y gratis: entra a aistudio.google.com/apikey con tu cuenta de Google, toca “Create API key” y pégala aquí. Sin clave, Capataz igual anota avisos y trabajos sin internet.";
  if(plataforma==="electron"){ $("#fila-autoinicio").hidden=false; $("#chk-autoinicio").checked = await nativo.autoinicio(); }
  renderPerfil();
  dlg.showModal();
}
$("#btn-ajustes").addEventListener("click", abrirAjustes);
$("#btn-borrar-chat").addEventListener("click", () => {
  historialChat = []; ls.set("capataz-chat", []); borrarHistorial();
  chat.querySelectorAll(".msg").forEach(m => m.remove()); dlg.close();
});
$("#btn-guardar-ajustes").addEventListener("click", async () => {
  const clave = $("#in-clave").value.trim();
  if(clave) try { await guardarClave(clave); reiniciarVozNatural(); } catch { $("#nota-clave").textContent = "No se pudo guardar la clave en este equipo."; return; }
  ls.set("capataz-modelo", $("#in-modelo").value.trim());
  ls.set("capataz-voz-nombre", $("#sel-voz").value);
  ls.set("capataz-interrumpir", $("#chk-interrumpir").checked);
  if(plataforma==="electron") await nativo.autoinicio($("#chk-autoinicio").checked);
  dlg.close();
});

/* ---------- Arranque ---------- */
if(plataforma==="web") $("#nota-avisos").textContent = "En la versión web los avisos solo suenan con la página abierta.";
alAccionar(async (accion, id) => {
  if(plataforma==="electron") await recargar();
  if(accion==="posponer") posponer(id);
  else if(accion==="hecho") actualizar(id,{hecho:true,terminado:Date.now()});
  else abrir("recordatorios");
});
(async () => {
  try{
    await cargar();
    await cargarPerfil();
    setSync(true, plataforma==="web" ? "Guardado en este navegador" : "Guardado en este dispositivo");
  }catch{ setSync(false, "No se pudo abrir la base de datos"); }
  await pedirPermiso();
})();
