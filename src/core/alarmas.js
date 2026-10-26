// Franja de alarma dentro de la app (complementa a la notificación del sistema).
import { avisos, actualizar, posponer } from "./datos.js";
import { avisarAhora } from "../adapters/notifications.js";
import { $, el, cuandoTexto } from "./util.js";

let audioCtx=null;
function pitido(){
  try{
    audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();
    [0,.25,.5].forEach(t=>{ const o=audioCtx.createOscillator(), g=audioCtx.createGain(); o.frequency.value=880; o.connect(g); g.connect(audioCtx.destination);
      const s=audioCtx.currentTime+t; g.gain.setValueAtTime(.0001,s); g.gain.exponentialRampToValueAtTime(.3,s+.02); g.gain.exponentialRampToValueAtTime(.0001,s+.18); o.start(s); o.stop(s+.2); });
  }catch{}
}
document.addEventListener("pointerdown", ()=>{ try{ audioCtx ??= new (window.AudioContext||window.webkitAudioContext)(); audioCtx.resume(); }catch{} }, {once:true});

const sonados = new Set();
export function revisarAlarmas(hablar){
  const ahora=Date.now();
  const due = avisos().filter(a=>!a.hecho && a.cuando<=ahora).sort((a,b)=>a.cuando-b.cuando);
  const caja=$("#alarma"), lista=$("#alarma-lista");
  caja.hidden = !due.length;
  lista.replaceChildren(...due.slice(0,4).map(a => el("div",{class:"alarm-row"},
    el("strong",{},a.texto), el("small",{},cuandoTexto(a.cuando)),
    el("button",{type:"button",onclick:()=>{sonados.delete(a.id+":"+a.cuando);posponer(a.id);}},"+10 min"),
    el("button",{type:"button",class:"solid",onclick:()=>actualizar(a.id,{hecho:true,terminado:Date.now()})},"Hecho"))));
  const nuevos = due.filter(a=>!sonados.has(a.id+":"+a.cuando) && ahora-a.cuando < 6*3600e3);
  due.forEach(a=>sonados.add(a.id+":"+a.cuando));
  if(nuevos.length && !document.hidden){ pitido(); hablar?.("Recordatorio: " + nuevos.map(a=>a.texto).join(". ")); }
  if(nuevos.length){ avisarAhora(nuevos.map(a=>a.texto)); document.title = "⏰ " + nuevos[0].texto; }
  else if(!due.length) document.title = "Capataz";
}
