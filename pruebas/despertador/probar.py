"""Prueba del detector de "Oye Atlas" (Vosk, modelo pequeño en español), imitando al servicio de Android:
lee el audio en trozos de 100 ms, solo procesa cuando hay sonido y revisa cada resultado parcial.
Uso: python probar.py <carpeta_modelo> <carpeta_wav>

Estrategias que compara:
  LIBRE      reconocimiento libre de español + regla sobre el texto (estricta o difusa)
  VERIFICADA lo mismo, pero cada candidato se confirma repasando ese mismo audio con una gramática
             reducida que solo distingue "oye atlas" de lo que se le parece (atrás, a las, alas, altas…)
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
MEMORIA = 60                                          # audio que se guarda para verificar: 6 s

RELLENO = """a al algo alguien alla alli ahi ahora antes año años aqui asi aun aunque ayer bien bueno buena buenos cada casa casi
como con cosa cosas cuando cual cuanto creo da dar de del desde despues dia dias dice dijo donde dos el ella ellos en entonces entre
era es esa ese eso esta estaba estan estar este esto estoy fue gente gracias gran ha habia hace hacer hasta hay he hecho hola hombre
hoy la las le les lo los luego mas me mejor menos mi mientras mira mis mismo mucho muy nada ni no nos nosotros nunca o obra otra
otro para pero poco por porque puede pues que quien quiero se sea segun ser si sido siempre sin sobre solo son soy su sus tal tambien
tan tanto te tengo tiempo tiene tienen todo todos trabajo tres tu tus un una uno unos usted va vamos van veces ver vez voy y ya yo
oye oyes oiga mira espera vale claro dale listo cinco seis siete ocho nueve diez mañana tarde noche semana mes hora horas
atras alas alta altas ala atleta atletas plata latas talas salas malas palas tablas hablas atas ratas patas
gatos datos ante actas aptas pasta basta ellas estas otras atrasa atraso abras""".split()
GRAMATICAS = {
    "chica": ["oye atlas", "hola atlas", "oiga atlas", "hoy atras", "oye atras", "hola atras", "oye a las", "hoy a las", "hola a las",
              "oye alas", "hoy alas", "oye altas", "hoy altas", "oye mas", "oye", "hoy", "hola", "atras", "a las", "[unk]"],
    "grande": ["oye atlas", "hola atlas", "oiga atlas"] + RELLENO + ["[unk]"],
}
GRAMATICAS = {k: json.dumps(v, ensure_ascii=False) for k, v in GRAMATICAS.items()}

INICIO = "oye|oyes|oi|oiga|oigan|hoy|hola|ola|hey|ey"
REGLAS = {
    "estricta": re.compile(rf"(^|\s)({INICIO})\s+atlas(\s|$)"),
    "difusa": re.compile(rf"(^|\s)({INICIO})\s+(atlas|atras|altas|adlas|alas|atletas?|atla|a las|al as|a tras|a tlas|mas)(\s|$)"),
}


class Escucha:
    """Un audio pasado por el reconocedor libre, con la compuerta de volumen. Guarda el texto de cada trozo y el audio reciente."""
    def __init__(self, ruta):
        w = wave.open(ruta, "rb")
        assert w.getframerate() == 16000 and w.getnchannels() == 1, ruta
        datos = w.readframes(w.getnframes())
        silencio = bytes(TROZO * 2)
        trozos = [silencio] * 5 + [datos[i:i + TROZO * 2] for i in range(0, len(datos), TROZO * 2)] + [silencio] * 25
        rec = KaldiRecognizer(modelo, 16000)
        self.pasos = []                 # (texto normalizado, es_final, inicio, fin): el audio del tramo es self.audio[inicio:fin]
        self.audio = []
        previos, cola, abierto, inicio, t0 = deque(maxlen=PREVIO), 0, False, 0, time.time()

        def paso(texto, final=True):
            fin = len(self.audio)
            self.pasos.append((norm(texto), final, max(inicio, fin - MEMORIA), fin))

        def pasar(d):
            self.audio.append(d)
            if rec.AcceptWaveform(d): paso(json.loads(rec.Result()).get("text", ""))
            else: paso(json.loads(rec.PartialResult()).get("partial", ""), False)

        for d in trozos:
            a = array("h", d)
            rms = math.sqrt(sum(x * x for x in a) / len(a)) if a else 0
            if rms > UMBRAL: cola = COLA
            if cola <= 0:
                if abierto:
                    abierto = False
                    paso(json.loads(rec.FinalResult()).get("text", ""))
                previos.append(d)
                continue
            cola -= 1
            if not abierto:
                abierto = True; inicio = len(self.audio)
                for p in previos: pasar(p)
                previos.clear()
            pasar(d)
        paso(json.loads(rec.FinalResult()).get("text", ""))
        self.costo = (time.time() - t0) / (len(datos) / 32000)
        self.textos = []
        for t, *_ in self.pasos:
            if t and (not self.textos or self.textos[-1] != t): self.textos.append(t)


def verificar(audio, gramatica):
    """Repasa el audio del tramo con la gramática reducida. Devuelve (texto, confianza de 'atlas')."""
    rec = KaldiRecognizer(modelo, 16000, GRAMATICAS[gramatica]); rec.SetWords(True)
    rec.AcceptWaveform(audio + bytes(TROZO * 2 * 3))
    r = json.loads(rec.FinalResult())
    conf = next((p["conf"] for p in r.get("result", []) if norm(p["word"]) == "atlas"), None)
    return norm(r.get("text", "")), conf


def decidir(e, regla, gramatica=None, intentos=4, conf_min=0.0):
    """True si se activaría. Con gramática, cada candidato se confirma (hasta 'intentos' veces por audio)."""
    usados, nota = 0, ""
    for texto, final, i, j in e.pasos:
        if not REGLAS[regla].search(texto): continue
        if not gramatica: return True, texto
        if usados >= intentos: break
        usados += 1
        t, conf = verificar(b"".join(e.audio[i:j]), gramatica)
        nota = f"{texto} → {t} ({conf})"
        if REGLAS["estricta"].search(t) and (conf or 0) >= conf_min: return True, nota
    return False, nota


def clase(base):
    if base.startswith("neg"): return "neg"
    if "atlas" in base: return "pos"
    return "otro"      # "oye capataz", "oye cóndor"…: tampoco deben activar a Atlas


escuchas = {a: Escucha(a) for a in audios}
print("===== Lo que oye el reconocimiento libre")
for a, e in escuchas.items():
    print(f"  {os.path.basename(a):36s} {' | '.join(e.textos[-4:])}")
print(f"  CPU del reconocimiento libre: {100 * sum(e.costo for e in escuchas.values()) / len(escuchas):.0f}% de tiempo real")


def informe(titulo, regla, gramatica=None, conf_min=0.0):
    cuenta = {"pos": [0, 0], "neg": [0, 0], "otro": [0, 0]}; fallas = []
    for a, e in escuchas.items():
        base = os.path.basename(a); c = clase(base)
        activo, nota = decidir(e, regla, gramatica, conf_min=conf_min)
        cuenta[c][1] += 1; cuenta[c][0] += activo
        if activo != (c == "pos"): fallas.append(f"      {'falso ' if activo else 'perdió'} {base:34s} {nota}")
    print(f"\n===== {titulo}: detectó {cuenta['pos'][0]}/{cuenta['pos'][1]}, falsos en frases ajenas {cuenta['neg'][0]}/{cuenta['neg'][1]}, "
          f"falsos con otros nombres {cuenta['otro'][0]}/{cuenta['otro'][1]}")
    print("\n".join(fallas))


informe("LIBRE estricta", "estricta")
informe("LIBRE difusa", "difusa")
for g in GRAMATICAS:
    informe(f"LIBRE difusa + verificación {g}", "difusa", g)
    informe(f"LIBRE difusa + verificación {g}, confianza 0.5", "difusa", g, conf_min=0.5)
    informe(f"LIBRE difusa + verificación {g}, confianza 0.8", "difusa", g, conf_min=0.8)

print("\n===== Detalle de la verificación de cada candidato (gramática chica | grande)")
for a, e in escuchas.items():
    vistos = set()
    for texto, final, i, j in e.pasos:
        if not REGLAS["difusa"].search(texto) or texto in vistos or len(vistos) >= 3: continue
        vistos.add(texto); audio = b"".join(e.audio[i:j])
        print(f"  {os.path.basename(a):34s} «{texto}» → chica: {verificar(audio, 'chica')} | grande: {verificar(audio, 'grande')}")
