package com.alexbrazier.labelsmith;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowInsets;
import android.webkit.MimeTypeMap;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;

/**
 * Hosts the bundled web app in a WebView. Files are served from the APK's
 * assets over https://appassets.androidplatform.net so ES modules, fetch() and
 * storage behave as on a web server. The printer bridge is exposed to the page
 * as window.LabelsmithAndroid.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_SAVE_FILE = 2;
    private static final int BACKGROUND = Color.rgb(0x11, 0x18, 0x27);

    private WebView webView;
    private PrinterBridge bridge;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(BACKGROUND);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        // Keep the page clear of the status bar, navigation bar and keyboard
        // (Android 15 draws apps edge to edge).
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        root.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // chrome://inspect on a computer can debug the page.
            WebView.setWebContentsDebuggingEnabled(true);
        }
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        bridge = new PrinterBridge(this, webView);
        webView.addJavascriptInterface(bridge, "LabelsmithAndroid");
        AssetClient assets = new AssetClient();
        webView.setWebViewClient(assets);
        // The offline service worker's own fetches bypass the WebViewClient.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return assets.shouldInterceptRequest(webView, request);
            }
        });
        webView.setWebChromeClient(new ChromeClient());

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Close the page's open dialog or selection first; leave the app only when there's nothing to close.
        webView.evaluateJavascript("!!(window.__labelsmithBack && window.__labelsmithBack())", (handled) -> {
            if (!"true".equals(handled)) super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        bridge.close();
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        bridge.onPermissionResult(requestCode, grantResults);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else if (requestCode == REQ_SAVE_FILE && pendingSave != null) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) writeFile(data.getData(), bytes);
        }
    }

    private void writeFile(Uri uri, byte[] bytes) {
        try (OutputStream out = getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new IOException("No output stream");
            out.write(bytes);
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
        } catch (IOException e) {
            Toast.makeText(this, "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** Downloads from the page (saved labels, PNG exports, print files), via the bridge. */
    void saveFile(String name, String mime, String base64) {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        runOnUiThread(() -> {
            pendingSave = bytes;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime)
                    .putExtra(Intent.EXTRA_TITLE, name);
            try {
                startActivityForResult(intent, REQ_SAVE_FILE);
            } catch (ActivityNotFoundException e) {
                pendingSave = null;
                Toast.makeText(this, "No app available to save files.", Toast.LENGTH_LONG).show();
            }
        });
    }

    /** Serves the bundled web app; opens other links in the browser. */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null;
            String path = url.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream in = getAssets().open("web" + path);
                String ext = MimeTypeMap.getFileExtensionFromUrl(path);
                String mime = mimeFor(ext);
                return new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") ? "utf-8" : null, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<>(), null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (HOST.equals(url.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException ignored) {
                // No browser: stay on the page.
            }
            return true;
        }
    }

    private static String mimeFor(String ext) {
        switch (ext == null ? "" : ext.toLowerCase()) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "webmanifest": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "woff2": return "font/woff2";
            case "woff": return "font/woff";
            case "ttf": return "font/ttf";
            case "txt": return "text/plain";
            default:
                String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
                return m != null ? m : "application/octet-stream";
        }
    }

    /** File pickers for Open, image, font and CSV imports. */
    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = params.createIntent();
            // Accept lists like ".labelsmith,.json" aren't MIME types; let the user pick any file.
            intent.setType("*/*");
            try {
                startActivityForResult(intent, REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }
}
