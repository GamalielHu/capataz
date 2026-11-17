"""Prueba del detector de la palabra de activación (Vosk, modelo pequeño en español).
Uso: python probar.py <carpeta_modelo> <carpeta_wav> nombre1 nombre2 ...
Para cada nombre arma la misma gramática que usa la app y dice en qué audios se activa."""
import json, sys, time, wave, glob, os, unicodedata
from vosk import Model, KaldiRecognizer

modelo = Model(sys.argv[1])
audios = sorted(glob.glob(os.path.join(sys.argv[2], "*.wav")))
norm = lambda s: "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")

def escuchar(ruta, nombre, gramatica):
    w = wave.open(ruta, "rb")
    rec = KaldiRecognizer(modelo, w.getframerate(), gramatica) if gramatica else KaldiRecognizer(modelo, w.getframerate())
    oido, activo, t0 = [], False, time.time()
    while True:
        datos = w.readframes(1600)  # 100 ms
        if not datos: break
        fin = rec.AcceptWaveform(datos)
        texto = json.loads(rec.Result())["text"] if fin else json.loads(rec.PartialResult())["partial"]
        if texto and (not oido or oido[-1] != texto): oido.append(texto)
        if nombre in norm(texto): activo = True
    texto = json.loads(rec.FinalResult())["text"]
    if texto: oido.append(texto)
    if nombre in norm(texto): activo = True
    dur = w.getnframes() / w.getframerate()
    return activo, oido[-1] if oido else "", (time.time() - t0) / dur

for nombre in sys.argv[3:]:
    n = norm(nombre)
    gram = json.dumps([f"oye {nombre}", f"hola {nombre}", nombre, "[unk]"], ensure_ascii=False)
    print(f"\n===== {nombre} · gramática {gram}")
    ok = falsos = total_pos = 0; costo = []
    for a in audios:
        base = os.path.basename(a)
        esperado = n in base.replace("_", " ")
        negativo = base.startswith("neg")
        if not esperado and not negativo: continue
        activo, oido, rtf = escuchar(a, n, gram); costo.append(rtf)
        if esperado: total_pos += 1; ok += activo
        if negativo and activo: falsos += 1
        print(f"  {'OK   ' if activo == esperado else 'FALLA'} {base:32s} activó={activo!s:5} oyó: {oido}")
    print(f"  RESUMEN {nombre}: detectó {ok}/{total_pos}, falsos {falsos}, CPU {100 * sum(costo) / len(costo):.0f}% de tiempo real")

print("\n===== Sin gramática (reconocimiento libre), como referencia")
for a in audios:
    _, oido, rtf = escuchar(a, "capataz", None)
    print(f"  {os.path.basename(a):32s} {rtf * 100:4.0f}%  {oido}")
