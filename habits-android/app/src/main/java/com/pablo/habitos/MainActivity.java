package com.pablo.habitos;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.Activity;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Native shell for the Hábitos web app.
 *
 * The page is served from a synthetic https origin rather than a file:// URL.
 * That matters: local storage on file:// is treated as an opaque origin by some
 * WebView versions and can be dropped, and service workers refuse to register
 * outside a secure context. Requests to that origin never touch the network —
 * they are answered from the APK's assets.
 */
public class MainActivity extends Activity {

  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private static final String ASSET_ROOT = "www";
  private static final String START_URL = ORIGIN + "/index.html";

  private WebView webView;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    webView = new WebView(this);
    setContentView(webView);

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);          // the app's entire database
    settings.setDatabaseEnabled(true);
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setAllowFileAccess(false);           // nothing is loaded over file://
    settings.setAllowContentAccess(false);
    settings.setCacheMode(WebSettings.LOAD_DEFAULT);

    CookieManager.getInstance().setAcceptCookie(false);

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return serve(request.getUrl());
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (isOurs(uri)) return false;
        // Anything outside the bundled app belongs in the browser.
        startActivity(new Intent(Intent.ACTION_VIEW, uri));
        return true;
      }
    });

    // The page registers a service worker; its fetches bypass WebViewClient and
    // need their own interceptor, otherwise registration fails against the
    // network that this app never uses.
    ServiceWorkerController controller = ServiceWorkerController.getInstance();
    controller.setServiceWorkerClient(new ServiceWorkerClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
        return serve(request.getUrl());
      }
    });

    if (savedInstanceState != null) {
      webView.restoreState(savedInstanceState);
    } else {
      webView.loadUrl(START_URL);
    }
  }

  private boolean isOurs(Uri uri) {
    return uri != null && ORIGIN.equals(uri.getScheme() + "://" + uri.getAuthority());
  }

  /** Answers a request from the APK's assets, or null to let it proceed normally. */
  private WebResourceResponse serve(Uri uri) {
    if (!isOurs(uri)) return null;

    String path = uri.getPath();
    if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
    if (path.contains("..")) return notFound();

    try {
      InputStream stream = getAssets().open(ASSET_ROOT + path);
      Map<String, String> headers = new HashMap<>();
      headers.put("Cache-Control", "no-cache");
      return new WebResourceResponse(mimeOf(path), "utf-8", 200, "OK", headers, stream);
    } catch (IOException missing) {
      return notFound();
    }
  }

  private WebResourceResponse notFound() {
    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
        new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
  }

  private static String mimeOf(String path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".js")) return "text/javascript";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".webmanifest")) return "application/manifest+json";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".svg")) return "image/svg+xml";
    return "application/octet-stream";
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    webView.saveState(outState);
  }

  @Override
  public void onBackPressed() {
    // Back returns to the Today tab first, and only then leaves the app.
    webView.evaluateJavascript(
        "(location.hash && location.hash !== '#today') ? (location.hash = '#today', 'handled') : 'exit'",
        value -> {
          if (value == null || value.contains("exit")) finish();
        });
  }

  @Override
  protected void onDestroy() {
    if (webView != null) webView.destroy();
    super.onDestroy();
  }
}
