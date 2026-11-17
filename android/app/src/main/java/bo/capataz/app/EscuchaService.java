package bo.capataz.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.StorageService;

// Escucha permanente de la frase de activación ("Oye Atlas"), también con la pantalla apagada.
// Reconoce el habla en el propio celular con Vosk (sin internet); al oír la frase enciende la pantalla
// y abre la conversación por voz. Solo procesa audio cuando hay sonido, para gastar poca batería.
// La regla de detección es la misma que mide pruebas/despertador/probar.py con audios de ejemplo:
// vocabulario reducido (la frase + palabras comunes y parecidas, para que el habla ajena caiga en ellas),
// la frase debe aguantar SEGUIDOS trozos o llegar como resultado final, y "oye" y "atlas" deben ir pegadas.
public class EscuchaService extends Service {
    static final String ACCION_PAUSAR = "bo.capataz.app.ESCUCHA_PAUSAR";
    static final String ACCION_REANUDAR = "bo.capataz.app.ESCUCHA_REANUDAR";
    static final String ACCION_PARAR = "bo.capataz.app.ESCUCHA_PARAR";
    static final String PREFS = "capataz_escucha", ACTIVO = "activo";
    private static final String CANAL = "escucha", CANAL_DESPERTAR = "despertar";
    private static final int ID_NOTA = 4201, ID_DESPERTAR = 4202;
    private static final int TASA = 16000, TROZO = 1600;            // 100 ms por lectura
    private static final double UMBRAL = 110;                       // volumen mínimo (RMS) para procesar
    private static final int COLA_MS = 1500, PREVIO = 4;            // sigue 1,5 s tras el sonido; 0,4 s previos
    private static final int SEGUIDOS = 5;                          // trozos seguidos que debe aguantar la frase
    private static final double HUECO_MAX = 0.2, DUR_MIN = 0.2, DUR_MAX = 1.0;   // segundos: pausa entre "oye" y "atlas"; duración de "atlas"
    private static final Pattern FRASE = Pattern.compile("(^|\\s)(oye|oiga|hola)\\s+atlas(\\s|$)");
    // Debe ser idéntico a RELLENO de pruebas/despertador/probar.py.
    private static final String RELLENO = "a al algo alguien alla alli ahi ahora antes año años aqui asi aun aunque ayer bien bueno buena buenos cada casa casi "
        + "como con cosa cosas cuando cual cuanto creo da dar de del desde despues dia dias dice dijo donde dos el ella ellos en entonces entre "
        + "era es esa ese eso esta estaba estan estar este esto estoy fue gente gracias gran ha habia hace hacer hasta hay he hecho hola hombre "
        + "hoy la las le les lo los luego mas me mejor menos mi mientras mira mis mismo mucho muy nada ni no nos nosotros nunca o obra otra "
        + "otro para pero poco por porque puede pues que quien quiero se sea segun ser si sido siempre sin sobre solo son soy su sus tal tambien "
        + "tan tanto te tengo tiempo tiene tienen todo todos trabajo tres tu tus un una uno unos usted va vamos van veces ver vez voy y ya yo "
        + "oye oyes oiga mira espera vale claro dale listo cinco seis siete ocho nueve diez mañana tarde noche semana mes hora horas "
        + "atras alas alta altas ala atleta atletas plata latas talas salas malas palas tablas hablas atas ratas patas "
        + "gatos datos ante actas aptas pasta basta ellas estas otras atrasa atraso abras "
        + "tomas matias carlos lucas nicolas elias casas cartas mapas llaves clases haces dame trae llama "
        + "capataz titan condor amigo jefe maestro ingeniero don señor hermano";

    static volatile boolean corriendo = false;
    static volatile String estado = "detenido";   // detenido | cargando | escuchando | pausa | sin_modelo | sin_microfono | sin_permiso

    private final Handler mano = new Handler(Looper.getMainLooper());
    private Model modelo;
    private Thread hilo;
    private volatile boolean oir = false;
    private long ultimaVez = 0;
    private int seguidos = 0;
    private String gramatica;
    private boolean cargando = false, pausado = false;   // solo se tocan en el hilo principal

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel c = new NotificationChannel(CANAL, "Escucha de «Oye Atlas»", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
            NotificationChannel d = new NotificationChannel(CANAL_DESPERTAR, "Despertar a Atlas", NotificationManager.IMPORTANCE_HIGH);
            d.setSound(null, null);
            nm.createNotificationChannel(d);
        }
        try { LibVosk.setLogLevel(LogLevel.WARNINGS); } catch (Throwable ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent == null ? null : intent.getAction();
        if (ACCION_PARAR.equals(accion)) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(ACTIVO, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!primerPlano()) { stopSelf(); return START_NOT_STICKY; }
        corriendo = true;
        if (ACCION_PAUSAR.equals(accion)) pausar(10 * 60 * 1000L);
        else if (ACCION_REANUDAR.equals(accion)) reanudar();
        else iniciar();
        return START_STICKY;
    }

    private Notification nota(String texto) {
        PendingIntent abrir = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent parar = PendingIntent.getService(this, 3, new Intent(this, EscuchaService.class).setAction(ACCION_PARAR), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.widget_mic)
            .setContentTitle("Atlas te escucha")
            .setContentText(texto)
            .setOngoing(true).setShowWhen(false).setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(abrir)
            .addAction(0, "Apagar", parar)
            .build();
    }
    private String textoNota() { return "Di «Oye Atlas» para hablarle."; }

    private boolean primerPlano() {
        try {
            int tipo = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
            ServiceCompat.startForeground(this, ID_NOTA, nota(textoNota()), tipo);
            return true;
        } catch (Exception e) { estado = "sin_permiso"; corriendo = false; return false; }
    }

    private static String norm(String s) {
        return Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase().trim();
    }

    private void iniciar() {
        if (gramatica == null) {
            JSONArray g = new JSONArray();
            g.put("oye atlas"); g.put("hola atlas"); g.put("oiga atlas");
            for (String palabra : RELLENO.split(" ")) g.put(palabra);
            g.put("[unk]");
            gramatica = g.toString();
        }
        pausado = false;
        if (modelo != null) { reanudar(); return; }
        if (cargando) return;
        cargando = true; estado = "cargando";
        StorageService.unpack(this, "model-es", "model",
            m -> {
                cargando = false; modelo = m;
                if (!corriendo) { try { m.close(); } catch (Exception ignored) {} modelo = null; }
                else if (!pausado) reanudar();
            },
            e -> { cargando = false; estado = "sin_modelo"; });
    }

    private final Runnable reanudarSolo = this::reanudar;

    private void reanudar() {
        mano.removeCallbacks(reanudarSolo);
        pausado = false;
        if (modelo == null) { if (cargando) estado = "cargando"; else iniciar(); return; }
        if (hilo != null && hilo.isAlive()) return;
        oir = true;
        hilo = new Thread(this::bucle, "capataz-escucha");
        hilo.start();
    }

    // Suelta el micrófono (la app lo necesita para conversar). Si nadie la reanuda, vuelve sola pasado retornoMs (0 = no vuelve).
    private void pausar(long retornoMs) {
        pausado = true;
        oir = false;
        Thread h = hilo; hilo = null;
        if (h != null) { try { h.join(1500); } catch (InterruptedException ignored) {} }
        if (corriendo) estado = "pausa";
        mano.removeCallbacks(reanudarSolo);
        if (retornoMs > 0) mano.postDelayed(reanudarSolo, retornoMs);
    }

    private void bucle() {
        AudioRecord mic = null; Recognizer rec = null; PowerManager.WakeLock despierto = null;
        try {
            // Mantiene el procesador despierto con la pantalla apagada mientras escucha.
            despierto = ((PowerManager) getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "capataz:escucha");
            despierto.acquire();
            int minimo = AudioRecord.getMinBufferSize(TASA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            mic = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, TASA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimo, TROZO * 8));
            if (mic.getState() != AudioRecord.STATE_INITIALIZED) { estado = "sin_microfono"; return; }
            rec = new Recognizer(modelo, TASA, gramatica);
            rec.setWords(true);
            rec.setPartialWords(true);
            mic.startRecording();
            if (mic.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) { estado = "sin_microfono"; return; }
            estado = "escuchando";
            seguidos = 0;
            ArrayDeque<short[]> previos = new ArrayDeque<>();
            long hastaMs = 0; boolean abierto = false;
            while (oir) {
                short[] buf = new short[TROZO];
                int n = mic.read(buf, 0, TROZO);
                if (n <= 0) { if (n < 0) { estado = "sin_microfono"; break; } continue; }
                double suma = 0; for (int i = 0; i < n; i++) suma += (double) buf[i] * buf[i];
                long ahora = System.currentTimeMillis();
                if (Math.sqrt(suma / n) > UMBRAL) hastaMs = ahora + COLA_MS;
                if (ahora > hastaMs) {              // silencio: no se procesa nada
                    if (abierto) { abierto = false; if (revisar(rec.getFinalResult(), true)) return; }
                    previos.addLast(buf); if (previos.size() > PREVIO) previos.removeFirst();
                    continue;
                }
                if (!abierto) { abierto = true; for (short[] p : previos) if (oyo(rec, p, p.length)) return; previos.clear(); }
                if (oyo(rec, buf, n)) return;
            }
        } catch (Throwable e) {
            estado = "sin_microfono";
        } finally {
            try { if (mic != null) { mic.stop(); mic.release(); } } catch (Exception ignored) {}
            try { if (rec != null) rec.close(); } catch (Exception ignored) {}
            try { if (despierto != null && despierto.isHeld()) despierto.release(); } catch (Exception ignored) {}
            if (oir && corriendo) mano.postDelayed(reanudarSolo, 30000);   // se cayó sola (micrófono ocupado): reintenta
        }
    }

    // Pasa audio al reconocedor; true si se oyó la frase (y ya se lanzó el despertar).
    private boolean oyo(Recognizer rec, short[] buf, int n) {
        boolean fin = rec.acceptWaveForm(buf, n);
        return revisar(fin ? rec.getResult() : rec.getPartialResult(), fin);
    }

    // ¿Está "oye atlas" en este resultado, con las dos palabras pegadas?
    private static boolean hayFrase(String json, boolean fin) {
        try {
            JSONObject r = new JSONObject(json);
            if (!FRASE.matcher(norm(r.optString(fin ? "text" : "partial"))).find()) return false;
            JSONArray p = r.optJSONArray(fin ? "result" : "partial_result");
            if (p == null || p.length() == 0) return true;      // sin tiempos por palabra: vale el texto
            for (int i = 1; i < p.length(); i++) {
                JSONObject a = p.optJSONObject(i - 1), b = p.optJSONObject(i);
                if (a == null || b == null || !"atlas".equals(norm(b.optString("word")))) continue;
                String antes = norm(a.optString("word"));
                if (!antes.equals("oye") && !antes.equals("oiga") && !antes.equals("hola")) continue;
                double hueco = b.optDouble("start", 0) - a.optDouble("end", 0), dur = b.optDouble("end", 0) - b.optDouble("start", 0);
                if (hueco <= HUECO_MAX && dur >= DUR_MIN && dur <= DUR_MAX) return true;
            }
            return false;
        } catch (Exception e) { return false; }
    }

    // La frase debe aguantar SEGUIDOS trozos, o llegar en un resultado final. true si se lanzó el despertar.
    private boolean revisar(String json, boolean fin) {
        if (!hayFrase(json, fin)) { seguidos = 0; return false; }
        seguidos++;
        if (!fin && seguidos < SEGUIDOS) return false;
        seguidos = 0;
        long ahora = System.currentTimeMillis();
        if (ahora - ultimaVez < 4000) return false;
        ultimaVez = ahora;
        oir = false;
        mano.post(this::despertar);
        return true;
    }

    private void despertar() {
        pausar(45 * 1000L);   // la app, al abrir la conversación, alarga la pausa; si no llegó a abrirse, vuelve a escuchar
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "capataz:despertar");
            wl.acquire(10000);
        } catch (Exception ignored) {}
        Intent i = new Intent(this, MainActivity.class).setAction(Dispositivo.ACCION_HABLAR)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        boolean directo = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || Settings.canDrawOverlays(this) || MainActivity.visible;
        if (directo) { try { startActivity(i); return; } catch (Exception ignored) {} }
        // Sin permiso para abrirse sola: aviso a pantalla completa (se abre directo si la pantalla estaba apagada).
        PendingIntent pi = PendingIntent.getActivity(this, 4, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CANAL_DESPERTAR)
            .setSmallIcon(R.drawable.widget_mic)
            .setContentTitle("Atlas te escuchó")
            .setContentText("Toca para hablar.")
            .setPriority(NotificationCompat.PRIORITY_MAX).setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true).setTimeoutAfter(20000)
            .setContentIntent(pi).setFullScreenIntent(pi, true)
            .build();
        try { getSystemService(NotificationManager.class).notify(ID_DESPERTAR, n); } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        corriendo = false;
        pausar(0);
        estado = "detenido";
        mano.removeCallbacksAndMessages(null);
        try { if (modelo != null) modelo.close(); } catch (Exception ignored) {}
        modelo = null;
        super.onDestroy();
    }
}
