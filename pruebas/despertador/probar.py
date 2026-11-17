"""Prueba del detector de "Oye Atlas" (Vosk, modelo pequeño en español), imitando al servicio de Android:
lee el audio en trozos de 100 ms, solo procesa cuando hay sonido y revisa cada resultado.
Uso: python probar.py <carpeta_modelo> <carpeta_wav>

El reconocedor usa un vocabulario reducido: la frase "oye atlas" más palabras comunes y parecidas
(atrás, a las, alas, altas…) para que el habla ajena caiga en ellas y no en la frase.
Se activa cuando "oye atlas" se mantiene N trozos seguidos (o llega como resultado final), con las
dos palabras pegadas. La prueba mide con qué N se pierde menos y se equivoca menos.
"""
import glob, json, math, os, re, sys, time, unicodedata, wave
from array import array
from collections import deque
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
modelo = Model(sys.argv[1])
audios = sorted(glob.glob(os.path.join(sys.argv[2], "*.wav")))
norm = lambda s: "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")

TROZO, UMBRAL, COLA, PREVIO = 1600, 110, 15, 4        # 100 ms; RMS mínimo; 1,5 s de cola; 0,4 s previos

# Debe ser idéntico a EscuchaService.RELLENO (Android).
RELLENO = """a al algo alguien alla alli ahi ahora antes año años aqui asi aun aunque ayer bien bueno buena buenos cada casa casi
como con cosa cosas cuando cual cuanto creo da dar de del desde despues dia dias dice dijo donde dos el ella ellos en entonces entre
era es esa ese eso esta estaba estan estar este esto estoy fue gente gracias gran ha habia hace hacer hasta hay he hecho hola hombre
hoy la las le les lo los luego mas me mejor menos mi mientras mira mis mismo mucho muy nada ni no nos nosotros nunca o obra otra
otro para pero poco por porque puede pues que quien quiero se sea segun ser si sido siempre sin sobre solo son soy su sus tal tambien
tan tanto te tengo tiempo tiene tienen todo todos trabajo tres tu tus un una uno unos usted va vamos van veces ver vez voy y ya yo
oye oyes oiga mira espera vale claro dale listo cinco seis siete ocho nueve diez mañana tarde noche semana mes hora horas
atras alas alta altas ala atleta atletas plata latas talas salas malas palas tablas hablas atas ratas patas
gatos datos ante actas aptas pasta basta ellas estas otras atrasa atraso abras
tomas matias carlos lucas nicolas elias casas cartas mapas llaves clases armas habas hagas haces dame trae llama
capataz titan condor amigo jefe maestro ingeniero don señor hermano""".split()
FRASES = ["oye atlas", "hola atlas", "oiga atlas"]
GRAMATICA = json.dumps(FRASES + RELLENO + ["[unk]"], ensure_ascii=False)
FRASE = re.compile(r"(^|\s)(oye|oiga|hola)\s+atlas(\s|$)")
HUECO_MAX = 0.35      # segundos como mucho entre "oye" y "atlas"


def pegadas(palabras):
    """Con los tiempos de cada palabra: (hay "oye atlas" pegado, hueco, duración de atlas)."""
    for i in range(1, len(palabras)):
        a, b = palabras[i - 1], palabras[i]
        if norm(b["word"]) == "atlas" and norm(a["word"]) in ("oye", "oiga", "hola"):
            return b["start"] - a["end"] <= HUECO_MAX, round(b["start"] - a["end"], 2), round(b["end"] - b["start"], 2)
    return False, None, None


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


def decidir(pasos, n, exigir_pegadas):
    """Se activa si la frase aguanta n trozos seguidos, o llega en un resultado final. Devuelve (activó, segundo)."""
    seguidos = 0
    for seg, texto, final, coincide, ok, hueco, dur in pasos:
        if coincide and exigir_pegadas and ok is False: coincide = False
        if not coincide: seguidos = 0; continue
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

for exigir in (False, True):
    for n in (3, 5, 7, 9):
        cuenta = {"pos": [0, 0], "neg": [0, 0], "otro": [0, 0]}; fallas = []; demoras = []
        for a, (pasos, _, fin_habla) in todo.items():
            base = os.path.basename(a); c = clase(base)
            activo, seg = decidir(pasos, n, exigir)
            cuenta[c][1] += 1; cuenta[c][0] += activo
            if activo and c == "pos" and "pregunta" not in base and "frase" not in base and "buenos" not in base: demoras.append(seg - fin_habla)
            if activo != (c == "pos"): fallas.append(f"{'falso' if activo else 'perdió'} {base}")
        print(f"\n===== {n} trozos seguidos{', palabras pegadas' if exigir else ''}: detectó {cuenta['pos'][0]}/{cuenta['pos'][1]}, "
              f"falsos en frases ajenas {cuenta['neg'][0]}/{cuenta['neg'][1]}, falsos con otros nombres {cuenta['otro'][0]}/{cuenta['otro'][1]}, "
              f"demora media {sum(demoras) / max(1, len(demoras)):.1f} s tras terminar de decirlo")
        print("      " + "; ".join(fallas))
