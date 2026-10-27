package bo.capataz.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.app.SearchManager;
import android.provider.AlarmClock;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.text.Normalizer;
import java.util.List;

// Acciones del asistente sobre el celular: alarmas, temporizador, música, llamadas, apps, mapas, linterna.
// También avisa a la web cuando la app se abre desde el widget "Hablar".
@CapacitorPlugin(name = "Dispositivo")
public class Dispositivo extends Plugin {
    public static final String ACCION_HABLAR = "bo.capataz.app.HABLAR";

    private boolean lanzar(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); return true; } catch (ActivityNotFoundException | SecurityException e) { return false; }
    }
    private void responder(PluginCall call, boolean ok, String detalle) {
        JSObject r = new JSObject(); r.put("ok", ok); r.put("detalle", detalle); call.resolve(r);
    }

    @PluginMethod
    public void alarma(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, call.getInt("hora", 7))
            .putExtra(AlarmClock.EXTRA_MINUTES, call.getInt("minuto", 0))
            .putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("mensaje", "Capataz"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        responder(call, lanzar(i), "reloj");
    }

    @PluginMethod
    public void temporizador(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, call.getInt("segundos", 60))
            .putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("mensaje", "Capataz"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        responder(call, lanzar(i), "reloj");
    }

    @PluginMethod
    public void verAlarmas(PluginCall call) { responder(call, lanzar(new Intent(AlarmClock.ACTION_SHOW_ALARMS)), "reloj"); }

    private boolean instalada(String paquete) {
        try { getContext().getPackageManager().getPackageInfo(paquete, 0); return true; } catch (PackageManager.NameNotFoundException e) { return false; }
    }

    // Reproduce una canción, artista o lista. app: "spotify", "youtube" o vacío (la que haya).
    @PluginMethod
    public void musica(PluginCall call) {
        String q = call.getString("consulta", "");
        String app = call.getString("app", "").toLowerCase();
        boolean hayS = instalada("com.spotify.music");
        if (!app.contains("youtube") && hayS) {
            Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
                .setPackage("com.spotify.music")
                .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
                .putExtra(SearchManager.QUERY, q);
            if (lanzar(i)) { responder(call, true, "spotify"); return; }
            if (lanzar(new Intent(Intent.ACTION_VIEW, Uri.parse("spotify:search:" + Uri.encode(q))))) { responder(call, true, "spotify"); return; }
        }
        if (app.contains("youtube") || !hayS) {
            String paq = instalada("com.google.android.apps.youtube.music") && !app.equals("youtube") ? "com.google.android.apps.youtube.music" : "com.google.android.youtube";
            Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(paq).putExtra(SearchManager.QUERY, q);
            if (instalada(paq) && lanzar(i)) { responder(call, true, paq.contains("music") ? "youtube music" : "youtube"); return; }
            Intent s = new Intent(Intent.ACTION_SEARCH).setPackage("com.google.android.youtube").putExtra(SearchManager.QUERY, q);
            if (lanzar(s)) { responder(call, true, "youtube"); return; }
        }
        boolean ok = lanzar(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))));
        responder(call, ok, "navegador");
    }

    private static String norm(String s) {
        return Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase().trim();
    }

    // Abre una app instalada por su nombre visible ("WhatsApp", "cámara", "calculadora"…).
    @PluginMethod
    public void abrirApp(PluginCall call) {
        String buscado = norm(call.getString("nombre", ""));
        PackageManager pm = getContext().getPackageManager();
        List<ResolveInfo> apps = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
        ResolveInfo mejor = null; int puntos = 0;
        for (ResolveInfo ri : apps) {
            String nombre = norm(String.valueOf(ri.loadLabel(pm)));
            int p = nombre.equals(buscado) ? 3 : nombre.startsWith(buscado) ? 2 : (nombre.contains(buscado) || (!nombre.isEmpty() && buscado.contains(nombre))) ? 1 : 0;
            if (p > puntos) { puntos = p; mejor = ri; }
        }
        if (mejor == null) { responder(call, false, "no encontré esa app"); return; }
        Intent i = pm.getLaunchIntentForPackage(mejor.activityInfo.packageName);
        responder(call, i != null && lanzar(i), String.valueOf(mejor.loadLabel(pm)));
    }

    @PluginMethod
    public void llamar(PluginCall call) {
        responder(call, lanzar(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(call.getString("numero", ""))))), "marcador");
    }

    @PluginMethod
    public void abrirUrl(PluginCall call) {
        responder(call, lanzar(new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "")))), "ok");
    }

    @PluginMethod
    public void linterna(PluginCall call) {
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(flash)) { cm.setTorchMode(id, call.getBoolean("encender", true)); responder(call, true, "ok"); return; }
            }
            responder(call, false, "sin linterna");
        } catch (Exception e) { responder(call, false, "sin linterna"); }
    }

    // ¿Se abrió desde el widget o el atajo "Hablar"? (consume la marca)
    @PluginMethod
    public void accionInicial(PluginCall call) {
        Intent i = getActivity().getIntent();
        boolean hablar = i != null && ACCION_HABLAR.equals(i.getAction());
        if (hablar) i.setAction(Intent.ACTION_MAIN);
        JSObject r = new JSObject(); r.put("hablar", hablar); call.resolve(r);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && ACCION_HABLAR.equals(intent.getAction())) {
            intent.setAction(Intent.ACTION_MAIN);
            notifyListeners("hablar", new JSObject(), true);
        }
    }
}
