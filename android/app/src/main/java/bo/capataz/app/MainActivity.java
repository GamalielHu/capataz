package bo.capataz.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Dispositivo.class);
        registerPlugin(ConfigSegura.class);
        super.onCreate(savedInstanceState);
    }
}
