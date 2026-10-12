package com.duberli.misgastos;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Muestra la app web de Mis Gastos (assets/www) dentro de un WebView.
 * Los archivos se sirven desde https://appassets.androidplatform.net para que
 * la página tenga un origen https normal (localStorage, fetch a Cloudflare).
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int REQ_FILE = 10;
    private static final int REQ_PERMS = 11;

    private static WeakReference<MainActivity> current = new WeakReference<>(null);
    private final Handler ui = new Handler(Looper.getMainLooper());

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    /** Llamado por NotificationReader: si la app está abierta, anota el pago al instante. */
    static void notifyNewPending() {
        final MainActivity a = current.get();
        if (a == null) return;
        a.ui.post(new Runnable() {
            @Override public void run() { a.dispatchResume(); }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidGastos");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new Chrome());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(urlFor(getIntent()));

        askNotificationPermission();
    }

    private String urlFor(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            String all = ((subject != null ? subject + ". " : "") + (text != null ? text : "")).trim();
            if (all.length() > 0) {
                try {
                    return HOME + "?text=" + URLEncoder.encode(all, "UTF-8");
                } catch (IOException ignored) {
                    // UTF-8 siempre existe
                }
            }
        }
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (Intent.ACTION_SEND.equals(intent.getAction())) web.loadUrl(urlFor(intent));
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = new WeakReference<>(this);
        web.onResume();
        dispatchResume();
    }

    @Override
    protected void onPause() {
        current = new WeakReference<>(null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private void dispatchResume() {
        web.evaluateJavascript("window.dispatchEvent(new Event('gastosresume'))", null);
    }

    @Override
    public void onBackPressed() {
        // Primero cierra el diálogo abierto (agregar pago, opciones...); si no hay, sale.
        web.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return true}return false})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String closed) {
                        if (!"true".equals(closed)) moveTaskToBack(true);
                    }
                });
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMS);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private boolean notificationAccessEnabled() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName() + "/");
    }

    private boolean saveToDownloads(String name, String content, String mime) {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime.split(";")[0]);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return false;
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) return false;
                out.write(bytes);
                return true;
            } catch (IOException e) {
                return false;
            }
        }
        // Android 7 a 9: se comparte el archivo como texto (correo, Drive, WhatsApp...).
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, name)
                .putExtra(Intent.EXTRA_TEXT, content);
        startActivity(Intent.createChooser(send, name));
        return true;
    }

    /** Lo que la página puede pedirle a Android (window.AndroidGastos). */
    private final class Bridge {
        @JavascriptInterface
        public String takePending() {
            return PendingStore.take(MainActivity.this);
        }

        @JavascriptInterface
        public boolean isNotificationAccessEnabled() {
            return notificationAccessEnabled();
        }

        @JavascriptInterface
        public void openNotificationAccessSettings() {
            ui.post(new Runnable() {
                @Override public void run() {
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                }
            });
        }

        @JavascriptInterface
        public boolean saveFile(String name, String content, String mime) {
            return saveToDownloads(name, content, mime == null ? "text/plain" : mime);
        }
    }

    /** Sirve assets/www en https://appassets.androidplatform.net y abre los demás enlaces fuera. */
    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return notFound();
            try {
                InputStream in = getAssets().open("www" + path);
                return new WebResourceResponse(mimeFor(path), "utf-8", in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {
                // no hay app para abrirlo
            }
            return true;
        }

        private WebResourceResponse notFound() {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }

        private String mimeFor(String path) {
            if (path.endsWith(".html")) return "text/html";
            if (path.endsWith(".js")) return "text/javascript";
            if (path.endsWith(".css")) return "text/css";
            if (path.endsWith(".json")) return "application/json";
            if (path.endsWith(".png")) return "image/png";
            if (path.endsWith(".svg")) return "image/svg+xml";
            return "application/octet-stream";
        }
    }

    /** Diálogos de JavaScript (confirm) y el selector de archivo para "Restaurar copia". */
    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(pick, "Elegir copia de seguridad"), REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
        }
    }
}
