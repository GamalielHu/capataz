"""Prueba del detector de "Oye Atlas" (Vosk, modelo pequeño en español), imitando al servicio de Android:
lee el audio en trozos de 100 ms, solo procesa cuando hay sonido y revisa cada resultado parcial.
Uso: python probar.py <carpeta_modelo> <carpeta_wav>
Compara dos formas de escuchar:
  LIBRE     reconocimiento libre de español + regla sobre el texto
  GRAMATICA vocabulario reducido (palabras comunes + parecidas a "atlas") y la frase "oye atlas"
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

# Palabras de relleno: lo que se dice normalmente, para que el habla ajena no "caiga" en la frase.
RELLENO = """a al algo alguien alla alli ahi ahora antes año años aqui asi aun aunque ayer bien bueno buena buenos cada casa casi
como con cosa cosas cuando cual cuanto creo da dar de del desde despues dia dias dice dijo donde dos el ella ellos en entonces entre
era es esa ese eso esta estaba estan estar este esto estoy fue gente gracias gran ha habia hace hacer hasta hay he hecho hola hombre
hoy la las le les lo los luego mas me mejor menos mi mientras mira mis mismo mucho muy nada ni no nos nosotros nunca o obra otra
otro para pero poco por porque puede pues que quien quiero se sea segun ser si sido siempre sin sobre solo son soy su sus tal tambien
tan tanto te tengo tiempo tiene tienen todo todos trabajo tres tu tus un una uno unos usted va vamos van veces ver vez voy y ya yo
oye oyes oiga mira espera vale claro bueno dale listo
cinco seis siete ocho nueve diez mañana tarde noche semana mes hora horas camion techo galpon herramientas mapa estante
atras alas alta altas ala atlantico atleta atletas plata platas latas talas salas malas palas tablas hablas atas ratas patas
gatos datos antes ante actas aptas hasta pasta basta alla ellas estas otras atrasa atraso abras""".split()
FRASES = ["oye atlas", "hola atlas", "oiga atlas", "hey atlas"]
GRAMATICA = json.dumps(FRASES + RELLENO + ["[unk]"], ensure_ascii=False)

INICIO = "oye|oyes|oi|oiga|oigan|hoy|hola|ola|hey|ey"
REGLAS = {
    "estricta": re.compile(rf"(^|\s)({INICIO})\s+atlas(\s|$)"),
    "difusa": re.compile(rf"(^|\s)({INICIO})\s+(atlas|atras|altas|adlas|atletas?)(\s|$)"),
}


def escuchar(ruta, gramatica, regla, persistir=1):
    """Devuelve (se_activo, textos_distintos, costo, confianza_de_atlas)."""
    w = wave.open(ruta, "rb")
    assert w.getframerate() == 16000 and w.getnchannels() == 1, ruta
    datos = w.readframes(w.getnframes())
    silencio = bytes(TROZO * 2)
    trozos = [silencio] * 5 + [datos[i:i + TROZO * 2] for i in range(0, len(datos), TROZO * 2)] + [silencio] * 25
    rec = KaldiRecognizer(modelo, 16000, gramatica) if gramatica else KaldiRecognizer(modelo, 16000)
    rec.SetWords(True)
    textos, activo, conf, seguidos = [], False, None, 0
    previos, cola, abierto, t0 = deque(maxlen=PREVIO), 0, False, time.time()

    def revisar(texto, final=None):
        nonlocal activo, conf, seguidos
        texto = norm(texto)
        if texto and (not textos or textos[-1] != texto): textos.append(texto)
        if regla.search(texto):
            seguidos += 1
            if seguidos >= persistir or final is not None:
                activo = True
                if final:
                    for p in final.get("result", []):
                        if norm(p["word"]) == "atlas": conf = p["conf"]
        else:
            seguidos = 0

    def pasar(d):
        if rec.AcceptWaveform(d):
            r = json.loads(rec.Result()); revisar(r.get("text", ""), r)
        else:
            revisar(json.loads(rec.PartialResult()).get("partial", ""))

    for d in trozos:
        a = array("h", d)
        rms = math.sqrt(sum(x * x for x in a) / len(a)) if a else 0
        if rms > UMBRAL: cola = COLA
        if cola <= 0:
            if abierto:
                abierto = False
                r = json.loads(rec.FinalResult()); revisar(r.get("text", ""), r)
            previos.append(d)
            continue
        cola -= 1
        if not abierto:
            abierto = True
            for p in previos: pasar(p)
            previos.clear()
        pasar(d)
    r = json.loads(rec.FinalResult()); revisar(r.get("text", ""), r)
    return activo, textos, (time.time() - t0) / (len(datos) / 32000), conf


def clase(base):
    if base.startswith("neg"): return "neg"
    if "atlas" in base: return "pos"
    return "otro"      # "oye capataz", "oye cóndor"…: tampoco deben activar a Atlas


def informe(titulo, gramatica, regla, persistir=1, detalle=True):
    print(f"\n===== {titulo}")
    cuenta = {"pos": [0, 0], "neg": [0, 0], "otro": [0, 0]}; costo = []
    for a in audios:
        base = os.path.basename(a); c = clase(base)
        activo, textos, rtf, conf = escuchar(a, gramatica, regla, persistir); costo.append(rtf)
        cuenta[c][1] += 1; cuenta[c][0] += activo
        bien = activo == (c == "pos")
        if detalle or not bien:
            print(f"  {'OK   ' if bien else 'FALLA'} {base:36s} activó={activo!s:5} conf={conf if conf is not None else '-':<8} oyó: {' | '.join(textos[-3:])}")
    print(f"  RESUMEN {titulo}: detectó {cuenta['pos'][0]}/{cuenta['pos'][1]}, falsos en frases ajenas {cuenta['neg'][0]}/{cuenta['neg'][1]}, "
          f"falsos con otros nombres {cuenta['otro'][0]}/{cuenta['otro'][1]}, CPU {100 * sum(costo) / len(costo):.0f}% de tiempo real")


informe("LIBRE + regla estricta", None, REGLAS["estricta"])
informe("LIBRE + regla difusa", None, REGLAS["difusa"], detalle=False)
informe("GRAMATICA + regla estricta", GRAMATICA, REGLAS["estricta"])
informe("GRAMATICA + estricta, 2 parciales seguidos", GRAMATICA, REGLAS["estricta"], persistir=2, detalle=False)
informe("GRAMATICA + estricta, 3 parciales seguidos", GRAMATICA, REGLAS["estricta"], persistir=3, detalle=False)
