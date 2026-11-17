package bo.capataz.app;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Controla desde la web el servicio que escucha "Oye Atlas" (EscuchaService).
@CapacitorPlugin(name = "Escucha", permissions = { @Permission(alias = "microfono", strings = { Manifest.permission.RECORD_AUDIO }) })
public class Escucha extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences(EscuchaService.PREFS, Context.MODE_PRIVATE); }

    private JSObject estadoActual() {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("activo", prefs().getBoolean(EscuchaService.ACTIVO, false));
        r.put("corriendo", EscuchaService.corriendo);
        r.put("estado", EscuchaService.estado);
        r.put("superponer", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("bateria", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        boolean completa = true;
        if (Build.VERSION.SDK_INT >= 34) completa = c.getSystemService(NotificationManager.class).canUseFullScreenIntent();
        r.put("pantallaCompleta", completa);
        return r;
    }

    private void mandar(String accion) {
        Context c = getContext();
        Intent i = new Intent(c, EscuchaService.class);
        if (accion != null) i.setAction(accion);
        try { ContextCompat.startForegroundService(c, i); } catch (Exception ignored) {}
    }

    @PluginMethod
    public void estado(PluginCall call) { call.resolve(estadoActual()); }

    @PluginMethod
    public void activar(PluginCall call) {
        if (getPermissionState("microfono") != PermissionState.GRANTED) { requestPermissionForAlias("microfono", call, "trasPermiso"); return; }
        encender(call);
    }

    @PermissionCallback
    private void trasPermiso(PluginCall call) {
        if (getPermissionState("microfono") == PermissionState.GRANTED) encender(call);
        else { JSObject r = estadoActual(); r.put("falta", "microfono"); call.resolve(r); }
    }

    private void encender(PluginCall call) {
        prefs().edit().putBoolean(EscuchaService.ACTIVO, true).apply();
        mandar(null);
        JSObject r = estadoActual(); r.put("activo", true); call.resolve(r);
    }

    @PluginMethod
    public void desactivar(PluginCall call) {
        prefs().edit().putBoolean(EscuchaService.ACTIVO, false).apply();
        try { getContext().stopService(new Intent(getContext(), EscuchaService.class)); } catch (Exception ignored) {}
        call.resolve(estadoActual());
    }

    // La app va a usar el micrófono (conversación o dictado): el servicio lo suelta.
    @PluginMethod
    public void pausar(PluginCall call) { if (EscuchaService.corriendo) mandar(EscuchaService.ACCION_PAUSAR); call.resolve(); }

    @PluginMethod
    public void reanudar(PluginCall call) { if (EscuchaService.corriendo) mandar(EscuchaService.ACCION_REANUDAR); call.resolve(); }

    // Tras una conversación abierta por voz: deja que la pantalla se apague sola y, si estaba bloqueado, vuelve al bloqueo.
    @PluginMethod
    public void dormir(PluginCall call) {
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(() -> {
            try {
                a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                KeyguardManager km = (KeyguardManager) a.getSystemService(Context.KEYGUARD_SERVICE);
                boolean bloqueado = km != null && km.isKeyguardLocked();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { a.setShowWhenLocked(false); a.setTurnScreenOn(false); }
                else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
                if (bloqueado) a.moveTaskToBack(true);
            } catch (Exception ignored) {}
        });
        call.resolve();
    }

    private void abrirAjuste(PluginCall call, Intent i) {
        try { getActivity().startActivity(i); } catch (Exception e) {
            try { getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()))); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    // "Mostrar sobre otras apps": deja que la app se abra sola al oír la frase.
    @PluginMethod
    public void pedirSuperponer(PluginCall call) {
        abrirAjuste(call, new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())));
    }

    // Sin ahorro de batería: evita que el sistema apague la escucha.
    @PluginMethod
    public void pedirBateria(PluginCall call) {
        abrirAjuste(call, new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName())));
    }
}
