export const $ = s => document.querySelector(s);
export function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==="class") n.className=v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k==="html") n.innerHTML=v;
    else n.setAttribute(k, v===true?"":v);
  }
  for (const c of kids.flat()) if (c!=null && c!==false) n.append(c.nodeType?c:document.createTextNode(String(c)));
  return n;
}
export const ls = { get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}}, set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}, del(k){try{localStorage.removeItem(k)}catch{}} };
export const nuevoId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* ---------- Fechas ---------- */
const fmtHora = new Intl.DateTimeFormat("es",{hour:"2-digit",minute:"2-digit"});
const fmtDia = new Intl.DateTimeFormat("es",{weekday:"short",day:"numeric",month:"short"});
export function cuandoTexto(ms){
  const d=new Date(ms), hoy=new Date(); hoy.setHours(0,0,0,0);
  const dia=new Date(d); dia.setHours(0,0,0,0);
  const diff=Math.round((dia-hoy)/864e5);
  const pre = diff===0?"hoy":diff===1?"mañana":diff===-1?"ayer":fmtDia.format(d);
  return pre + " " + fmtHora.format(d);
}
const pad=n=>String(n).padStart(2,"0");
export function localISO(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes()); }
