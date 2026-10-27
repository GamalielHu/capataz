// Proveedores de IA según la clave: "sk-ant-…" = Anthropic Claude; cualquier otra ("AIza…", "AQ.…") = Google Gemini (gratis).
// Módulo CommonJS compartido por la ventana (vía esbuild) y el proceso principal de Electron.
const MODELOS = { gemini: "gemini-flash-lite-latest", anthropic: "claude-sonnet-5-5" };
// Si un modelo de Gemini está saturado o no existe, se prueba el siguiente.
const RESPALDO_GEMINI = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash"];

const proveedorDe = clave => /^sk-ant-/.test(clave) ? "anthropic" : "gemini";
const reintentable = codigo => codigo === "sobrecargado" || codigo === "rate_limited" || codigo === "api_404";

// Lista de pedidos a probar en orden.
function modelosA(clave, modelo){
  if (proveedorDe(clave) !== "gemini") return [modelo];
  return modelo && /^gemini/.test(modelo) ? [modelo, ...RESPALDO_GEMINI.filter(m => m !== modelo)] : RESPALDO_GEMINI;
}

// {system, messages:[{role:"user"|"assistant", content}], modelo?, maxTokens?, audio?:{mime,data}, json?} → {url, headers, body}
// audio (solo Gemini) se adjunta al último mensaje; json:false pide texto libre.
function peticion(clave, { system, messages, modelo, maxTokens = 4096, audio, json = true }, navegador = false){
  const p = proveedorDe(clave);
  if (audio && p !== "gemini") throw Object.assign(new Error("sin_audio"), { code: "sin_audio" });
  const model = modelo && (p === "gemini") === /^gemini/.test(modelo) ? modelo : MODELOS[p];
  if (p === "gemini") return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": clave },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m, i) => ({ role: m.role === "assistant" ? "model" : "user", parts: [
        ...(audio && i === messages.length - 1 ? [{ inline_data: { mime_type: audio.mime, data: audio.data } }] : []),
        { text: m.content }] })),
      generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), maxOutputTokens: maxTokens, temperature: audio ? 0 : 0.4 }
    }
  };
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01",
      ...(navegador ? { "anthropic-dangerous-direct-browser-access": "true" } : {}) },
    body: { model, max_tokens: maxTokens, system, messages }
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

module.exports = { MODELOS_VOZ, peticionVoz, audioDe, MODELOS, proveedorDe, peticion, textoDe, codigoError, modelosA, reintentable };
