"""Prueba del detector de "Oye Atlas" (Vosk, modelo pequeño en español), imitando al servicio de Android:
lee el audio en trozos de 100 ms, solo procesa cuando hay sonido y revisa cada resultado.
Uso: python probar.py <carpeta_modelo> <carpeta_wav> <EscuchaService.java>

Las constantes (vocabulario, trozos seguidos, pausa máxima entre palabras) se leen del propio servicio de
Android, así la prueba mide exactamente la regla que va en el APK:
  - vocabulario reducido: la frase "oye atlas" más palabras comunes y parecidas (atrás, a las, alas…),
    para que el habla ajena caiga en ellas y no en la frase;
  - la frase debe aguantar SEGUIDOS trozos, o llegar como resultado final;
  - "oye" y "atlas" deben ir pegadas (pausa <= HUECO_MAX) y "atlas" durar entre DUR_MIN y DUR_MAX.
Sale con error si pierde demasiadas llamadas o da alguna falsa alarma.
"""
import glob, json, math, os, re, sys, time, unicodedata, wave
from array import array
from collections import deque
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
modelo = Model(sys.argv[1])
audios = sorted(glob.glob(os.path.join(sys.argv[2], "*.wav")))
norm = lambda s: "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")

java = open(sys.argv[3], encoding="utf-8").read()
def constante(nombre):
    return float(re.search(rf"\b{nombre} = ([\d.]+)", java).group(1))
TROZO, UMBRAL = int(constante("TROZO")), constante("UMBRAL")
COLA, PREVIO = int(constante("COLA_MS")) // 100, int(constante("PREVIO"))
SEGUIDOS, HUECO_MAX, DUR_MIN, DUR_MAX = int(constante("SEGUIDOS")), constante("HUECO_MAX"), constante("DUR_MIN"), constante("DUR_MAX")
RELLENO = " ".join(re.findall(r'"([^"]*)"', re.search(r"String RELLENO = (.*?);", java, re.S).group(1))).split()
FRASES = ["oye atlas", "hola atlas", "oiga atlas"]
GRAMATICA = json.dumps(FRASES + RELLENO + ["[unk]"], ensure_ascii=False)
FRASE = re.compile(r"(^|\s)(oye|oiga|hola)\s+atlas(\s|$)")
print(f"Regla: {SEGUIDOS} trozos seguidos, pausa <= {HUECO_MAX} s, atlas entre {DUR_MIN} y {DUR_MAX} s, {len(RELLENO)} palabras de relleno, volumen > {UMBRAL}")


def pegadas(palabras):
    """Con los tiempos de cada palabra: (hay "oye atlas" pegado y de duración normal, hueco, duración de atlas)."""
    visto = (False, None, None)
    for i in range(1, len(palabras)):
        a, b = palabras[i - 1], palabras[i]
        if norm(b["word"]) != "atlas" or norm(a["word"]) not in ("oye", "oiga", "hola"): continue
        hueco, dur = b["start"] - a["end"], b["end"] - b["start"]
        visto = (False, round(hueco, 2), round(dur, 2))
        if hueco <= HUECO_MAX and DUR_MIN <= dur <= DUR_MAX: return True, round(hueco, 2), round(dur, 2)
    return visto


def escuchar(ruta):
    """Devuelve la lista de pasos: (segundo, texto, es_final, coincide, pegadas, hueco, dur_atlas)."""
    w = wave.open(ruta, "rb")
    assert w.getframerate() == 16000 and w.getnchannels() == 1, ruta
    datos = w.readframes(w.getnframes())
    silencio = bytes(TROZO * 2)
    trozos = [silencio] * 5 + [datos[i:i + TROZO * 2] for i in range(0, len(datos), TROZO * 2)] + [silencio] * 25
    rec = KaldiRecognizer(modelo, 16000, GRAMATICA); rec.SetWords(True)
    try: rec.SetPartialWords(True)
    except Exception: pass
    pasos, previos, cola, abierto, t0 = [], deque(maxlen=PREVIO), 0, False, time.time()

    def paso(i, r, final):
        texto = norm(r.get("text" if final else "partial", ""))
        palabras = r.get("result" if final else "partial_result", [])
        ok, hueco, dur = pegadas(palabras) if palabras else (None, None, None)
        pasos.append((i / 10, texto, final, bool(FRASE.search(texto)), ok, hueco, dur))

    def pasar(i, d):
        if rec.AcceptWaveform(d): paso(i, json.loads(rec.Result()), True)
        else: paso(i, json.loads(rec.PartialResult()), False)

    for i, d in enumerate(trozos):
        a = array("h", d)
        rms = math.sqrt(sum(x * x for x in a) / len(a)) if a else 0
        if rms > UMBRAL: cola = COLA
        if cola <= 0:
            if abierto:
                abierto = False
                paso(i, json.loads(rec.FinalResult()), True)
            previos.append(d)
            continue
        cola -= 1
        if not abierto:
            abierto = True
            for p in previos: pasar(i, p)
            previos.clear()
        pasar(i, d)
    paso(len(trozos), json.loads(rec.FinalResult()), True)
    return pasos, (time.time() - t0) / (len(datos) / 32000), len(datos) / 32000 + 0.5


def decidir(pasos, n=SEGUIDOS):
    """Igual que EscuchaService.revisar: n trozos seguidos con la frase, o un resultado final. Devuelve (activó, segundo)."""
    seguidos = 0
    for seg, texto, final, coincide, ok, hueco, dur in pasos:
        if not coincide or ok is False: seguidos = 0; continue
        seguidos += 1
        if final or seguidos >= n: return True, seg
    return False, None


def clase(base):
    if base.startswith("neg"): return "neg"
    if "atlas" in base: return "pos"
    return "otro"      # "oye capataz", "oye cóndor"…: tampoco deben activar a Atlas


todo = {a: escuchar(a) for a in audios}
print(f"CPU: {100 * sum(c for _, c, _ in todo.values()) / len(todo):.0f}% de tiempo real\n")
print("===== Por audio: racha más larga de «oye atlas», huecos vistos y lo último que oyó")
for a, (pasos, _, _) in todo.items():
    racha = mejor = 0; huecos = set(); finales = []
    for seg, texto, final, coincide, ok, hueco, dur in pasos:
        racha = racha + 1 if coincide else 0; mejor = max(mejor, racha)
        if coincide and hueco is not None: huecos.add((hueco, dur))
        if final and texto: finales.append(texto)
    print(f"  {clase(os.path.basename(a)):4s} {os.path.basename(a):34s} racha={mejor:2d} huecos/dur={sorted(huecos)[:4]} final: {' / '.join(finales)[:110]}")

salida = 0
for n in sorted({3, SEGUIDOS, 8}):
    cuenta = {"pos": [0, 0], "neg": [0, 0], "otro": [0, 0]}; fallas = []; demoras = []
    for a, (pasos, _, fin_habla) in todo.items():
        base = os.path.basename(a); c = clase(base)
        activo, seg = decidir(pasos, n)
        cuenta[c][1] += 1; cuenta[c][0] += activo
        if activo and c == "pos" and re.match(r"(oye|hola)_atlas_[A-Z][a-z]+(_ruido|_lejos)?\.wav$", base): demoras.append(seg - fin_habla)
        if activo != (c == "pos"): fallas.append(f"{'falso' if activo else 'perdió'} {base}")
    print(f"\n===== {n} trozos seguidos{' (la regla del APK)' if n == SEGUIDOS else ''}: detectó {cuenta['pos'][0]}/{cuenta['pos'][1]}, "
          f"falsos en frases ajenas {cuenta['neg'][0]}/{cuenta['neg'][1]}, falsos con otros nombres {cuenta['otro'][0]}/{cuenta['otro'][1]}, "
          f"demora media {sum(demoras) / max(1, len(demoras)):.1f} s tras terminar de decirlo")
    print("      " + "; ".join(fallas))
    if n == SEGUIDOS and (cuenta["neg"][0] or cuenta["otro"][0] or cuenta["pos"][0] < 0.8 * cuenta["pos"][1]): salida = 1
sys.exit(salida)
