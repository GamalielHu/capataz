package bo.capataz.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static volatile boolean visible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Dispositivo.class);
        registerPlugin(ConfigSegura.class);
        registerPlugin(Escucha.class);
        sobreBloqueo(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        sobreBloqueo(intent);
        super.onNewIntent(intent);
    }

    // Al despertar con "Oye Atlas" (o el widget): encender la pantalla y mostrarse sobre el bloqueo, como una llamada.
    private void sobreBloqueo(Intent intent) {
        boolean hablar = intent != null && Dispositivo.ACCION_HABLAR.equals(intent.getAction());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            if (hablar) { setShowWhenLocked(true); setTurnScreenOn(true); }
        } else if (hablar) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        if (hablar) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onStart() { super.onStart(); visible = true; }

    @Override
    public void onStop() {
        visible = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(false); setTurnScreenOn(false); }
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onStop();
    }
}
