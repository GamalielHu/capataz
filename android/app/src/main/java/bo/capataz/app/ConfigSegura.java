package bo.capataz.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

// Respaldo de la clave de IA que sobrevive a la desinstalación:
// 1) SharedPreferences "capataz_config" (entra en la copia de seguridad de Google, ver res/xml/backup_rules.xml).
// 2) Documentos/Capataz/config.enc (copia local cifrada).
@CapacitorPlugin(name = "ConfigSegura")
public class ConfigSegura extends Plugin {
    private static final String PREFS = "capataz_config", CLAVE = "api_key_ia";
    private static final String CARPETA = "Capataz", ARCHIVO = "config.enc";
    private static final char[] FRASE = "capataz-bo-respaldo-v1".toCharArray();

    static String cifrar(String texto) throws Exception {
        SecureRandom azar = new SecureRandom();
        byte[] sal = new byte[16], iv = new byte[12];
        azar.nextBytes(sal); azar.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, llave(sal), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal(texto.getBytes(StandardCharsets.UTF_8));
        byte[] todo = new byte[sal.length + iv.length + ct.length];
        System.arraycopy(sal, 0, todo, 0, 16); System.arraycopy(iv, 0, todo, 16, 12); System.arraycopy(ct, 0, todo, 28, ct.length);
        return "CPZ1:" + Base64.encodeToString(todo, Base64.NO_WRAP);
    }
    static String descifrar(String dato) throws Exception {
        dato = dato.trim();
        if (!dato.startsWith("CPZ1:")) throw new IllegalArgumentException("formato");
        byte[] todo = Base64.decode(dato.substring(5), Base64.NO_WRAP);
        byte[] sal = java.util.Arrays.copyOfRange(todo, 0, 16), iv = java.util.Arrays.copyOfRange(todo, 16, 28);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, llave(sal), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(todo, 28, todo.length - 28), StandardCharsets.UTF_8);
    }
    private static SecretKeySpec llave(byte[] sal) throws Exception {
        byte[] k = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(FRASE, sal, 10000, 256)).getEncoded();
        return new SecretKeySpec(k, "AES");
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /* ----- Documentos/Capataz/config.enc ----- */
    private Uri uriPropio(ContentResolver cr) {
        Uri col = MediaStore.Files.getContentUri("external");
        try (Cursor q = cr.query(col, new String[]{ MediaStore.MediaColumns._ID },
                MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?",
                new String[]{ Environment.DIRECTORY_DOCUMENTS + "/" + CARPETA + "/", ARCHIVO }, null)) {
            if (q != null && q.moveToFirst()) return ContentUris.withAppendedId(col, q.getLong(0));
        } catch (Exception ignored) {}
        return null;
    }
    private File archivoDirecto() {
        return new File(new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), CARPETA), ARCHIVO);
    }
    private boolean escribirArchivo(String dato) {
        byte[] b = dato.getBytes(StandardCharsets.UTF_8);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                Uri uri = uriPropio(cr);
                if (uri == null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, ARCHIVO);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS + "/" + CARPETA + "/");
                    uri = cr.insert(MediaStore.Files.getContentUri("external"), v);
                }
                if (uri == null) return false;
                try (OutputStream o = cr.openOutputStream(uri, "wt")) { o.write(b); }
                return true;
            }
            File f = archivoDirecto(); f.getParentFile().mkdirs();
            try (OutputStream o = new FileOutputStream(f)) { o.write(b); }
            return true;
        } catch (Exception e) { return false; }
    }
    private String leerArchivo() {
        try {
            InputStream in = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                Uri uri = uriPropio(cr);
                if (uri != null) in = cr.openInputStream(uri);
            }
            if (in == null && archivoDirecto().canRead()) in = new FileInputStream(archivoDirecto());
            if (in == null) return null;
            final InputStream fuente = in;
            try (InputStream i = fuente; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[4096]; int n;
                while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        } catch (Exception e) { return null; }
    }
    private void borrarArchivo() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                Uri uri = uriPropio(cr);
                if (uri != null) cr.delete(uri, null, null);
            } else archivoDirecto().delete();
        } catch (Exception ignored) {}
    }

    /* ----- API para la web ----- */
    @PluginMethod
    public void guardar(PluginCall call) {
        String clave = call.getString("clave", "").trim();
        JSObject r = new JSObject();
        if (clave.isEmpty()) {
            prefs().edit().remove(CLAVE).apply(); borrarArchivo();
            r.put("ok", true); call.resolve(r); return;
        }
        try {
            String dato = cifrar(clave);
            prefs().edit().putString(CLAVE, dato).commit();
            r.put("ok", true); r.put("archivo", escribirArchivo(dato));
            call.resolve(r);
        } catch (Exception e) { call.reject("no_guardado"); }
    }

    // Busca la clave en el respaldo (copia de Google restaurada o archivo en Documentos). {clave, origen} o {clave:null}.
    @PluginMethod
    public void leer(PluginCall call) {
        JSObject r = new JSObject();
        String dato = prefs().getString(CLAVE, null), origen = "copia";
        if (dato == null) { dato = leerArchivo(); origen = "archivo"; }
        try {
            if (dato != null) {
                r.put("clave", descifrar(dato)); r.put("origen", origen);
                if ("archivo".equals(origen)) prefs().edit().putString(CLAVE, dato).apply();
                call.resolve(r); return;
            }
        } catch (Exception ignored) {}
        r.put("clave", null); call.resolve(r);
    }

    // Contenido de un config.enc elegido por la persona (tras reinstalar, Android no deja leerlo solo).
    @PluginMethod
    public void importar(PluginCall call) {
        try {
            String dato = call.getString("texto", "").trim();
            String clave = descifrar(dato);
            prefs().edit().putString(CLAVE, dato).commit();
            escribirArchivo(dato);
            JSObject r = new JSObject(); r.put("clave", clave); call.resolve(r);
        } catch (Exception e) { call.reject("archivo_invalido"); }
    }
}
