package com.pablo.habitos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

  /** Reports the page's own background colour so the bars behind the insets match it. */
  private static final String THEME_WATCHER =
      "(function () {"
    + "  function report() {"
    + "    try { NativeShell.setBackgroundColor(getComputedStyle(document.body).backgroundColor); }"
    + "    catch (e) {}"
    + "  }"
    + "  report();"
    + "  new MutationObserver(report).observe(document.documentElement,"
    + "    { attributes: true, attributeFilter: ['data-theme'] });"
    + "})();";

  private static final Pattern RGB =
      Pattern.compile("rgba?[(]([0-9]+),[ ]*([0-9]+),[ ]*([0-9]+)");

  private FrameLayout root;
  private WebView webView;

  @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    webView = new WebView(this);
    root = new FrameLayout(this);
    root.addView(webView, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    setContentView(root);

    applyWindowInsets();

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

    // Only reachable from the bundled page, which is the app's own code.
    webView.addJavascriptInterface(new ShellBridge(), "NativeShell");

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

      @Override
      public void onPageFinished(WebView view, String url) {
        view.evaluateJavascript(THEME_WATCHER, null);
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

  /**
   * From targetSdk 35 the system no longer insets the window, so the app draws
   * behind the status and navigation bars. Padding the root keeps the page
   * clear of them while the bars themselves show the page's own colour.
   */
  private void applyWindowInsets() {
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      int left, top, right, bottom;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Insets bars = insets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        left = bars.left;
        top = bars.top;
        right = bars.right;
        bottom = bars.bottom;   // the keyboard is handled by adjustResize
      } else {
        left = insets.getSystemWindowInsetLeft();
        top = insets.getSystemWindowInsetTop();
        right = insets.getSystemWindowInsetRight();
        bottom = insets.getSystemWindowInsetBottom();
      }
      view.setPadding(left, top, right, bottom);
      return insets;
    });
  }

  /** Lets the page keep the letterboxed bar areas in sync with its own theme. */
  private class ShellBridge {
    @JavascriptInterface
    public void setBackgroundColor(final String css) {
      if (css == null) return;
      final Matcher match = RGB.matcher(css);
      if (!match.find()) return;
      final int color = 0xFF000000
          | (Integer.parseInt(match.group(1)) << 16)
          | (Integer.parseInt(match.group(2)) << 8)
          | Integer.parseInt(match.group(3));
      runOnUiThread(() -> {
        root.setBackgroundColor(color);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(color));
      });
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
