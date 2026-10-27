// Proveedores de IA según la clave: "sk-ant-…" = Anthropic Claude; cualquier otra ("AIza…", "AQ.…") = Google Gemini (gratis).
// Módulo CommonJS compartido por la ventana (vía esbuild) y el proceso principal de Electron.
const MODELOS = { gemini: "gemini-flash-lite-latest", anthropic: "claude-sonnet-5-5" };
// Si un modelo de Gemini está saturado o no existe, se prueba el siguiente.
// Rápido (~1 s) para charla y agenda; potente (razona, ~3 s) para cálculos, fotos y preguntas difíciles.
const RESPALDO_GEMINI = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];
const POTENTE_GEMINI = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"];

const proveedorDe = clave => /^sk-ant-/.test(clave) ? "anthropic" : "gemini";
const reintentable = codigo => codigo === "sobrecargado" || codigo === "rate_limited" || codigo === "api_404";

// Lista de pedidos a probar en orden.
function modelosA(clave, modelo, potente = false){
  if (proveedorDe(clave) !== "gemini") return [modelo];
  const base = potente ? POTENTE_GEMINI : RESPALDO_GEMINI;
  return modelo && /^gemini/.test(modelo) ? [modelo, ...base.filter(m => m !== modelo)] : base;
}
// Los modelos "lite" no piensan; los demás piensan poco para responder rápido.
const piensa = modelo => /^gemini-(3|flash-latest|pro)/.test(modelo) && !/lite/.test(modelo);

// {system, messages:[{role:"user"|"assistant", content}], modelo?, maxTokens?, audio?:{mime,data}, json?} → {url, headers, body}
// audio (solo Gemini) se adjunta al último mensaje; json:false pide texto libre.
// imagen:{mime,data} se adjunta al último mensaje (Gemini y Claude).
// stream:true pide la respuesta por partes (SSE) para mostrarla mientras se escribe.
function peticion(clave, { system, messages, modelo, maxTokens = 8192, audio, imagen, json = true, stream = false }, navegador = false){
  const p = proveedorDe(clave);
  if (audio && p !== "gemini") throw Object.assign(new Error("sin_audio"), { code: "sin_audio" });
  const model = modelo && (p === "gemini") === /^gemini/.test(modelo) ? modelo : MODELOS[p];
  if (p === "gemini") return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    headers: { "content-type": "application/json", "x-goog-api-key": clave },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m, i) => ({ role: m.role === "assistant" ? "model" : "user", parts: [
        ...(audio && i === messages.length - 1 ? [{ inline_data: { mime_type: audio.mime, data: audio.data } }] : []),
        ...(imagen && i === messages.length - 1 ? [{ inline_data: { mime_type: imagen.mime, data: imagen.data } }] : []),
        { text: m.content }] })),
      generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), maxOutputTokens: maxTokens,
        ...(audio ? { temperature: 0 } : piensa(model) ? { thinkingConfig: { thinkingLevel: "low" } } : { temperature: 0.5 }) }
    }
  };
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01",
      ...(navegador ? { "anthropic-dangerous-direct-browser-access": "true" } : {}) },
    body: { model, max_tokens: maxTokens, system, messages: imagen ? messages.map((m, i) => i < messages.length - 1 ? m : { role: m.role, content: [
      { type: "image", source: { type: "base64", media_type: imagen.mime, data: imagen.data } }, { type: "text", text: m.content }] }) : messages }
  };
}

function textoDe(clave, datos){
  if (proveedorDe(clave) === "gemini")
    return (datos?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  return (datos?.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

// Código de error para la interfaz.
function codigoError(estado, datos){
  const msg = JSON.stringify(datos || "");
  if (estado === 401 || estado === 403 || /API_KEY_INVALID|API key not valid/.test(msg)) return "clave_invalida";
  if (estado === 429) return "rate_limited";
  if (estado >= 500) return "sobrecargado";
  return "api_" + estado;
}

// Voz natural (texto → audio) con Gemini. Devuelve {mime, data base64}.
const MODELOS_VOZ = ["gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts", "gemini-3.8-flash-tts"];
function peticionVoz(clave, texto, modelo, voz = "Charon"){
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": clave },
    body: {
      contents: [{ parts: [{ text: texto }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } }
    }
  };
}
function audioDe(datos){
  const p = (datos?.candidates?.[0]?.content?.parts || []).find(p => p.inlineData || p.inline_data);
  const d = p && (p.inlineData || p.inline_data);
  return d ? { mime: d.mimeType || d.mime_type, data: d.data } : null;
}

module.exports = { POTENTE_GEMINI, MODELOS_VOZ, peticionVoz, audioDe, MODELOS, proveedorDe, peticion, textoDe, codigoError, modelosA, reintentable };
