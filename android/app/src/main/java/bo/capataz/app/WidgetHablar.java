package bo.capataz.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

// Widget de inicio: un toque abre Capataz directo en la conversación por voz.
public class WidgetHablar extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        Intent i = new Intent(ctx, MainActivity.class).setAction(Dispositivo.ACCION_HABLAR)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_hablar);
            v.setOnClickPendingIntent(R.id.widget_raiz, pi);
            mgr.updateAppWidget(id, v);
        }
    }
}
