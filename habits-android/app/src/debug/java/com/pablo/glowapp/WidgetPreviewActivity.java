package com.pablo.glowapp;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.RemoteViews;

/**
 * Debug-only screen that inflates the real widget views.
 *
 * Binding a widget to a launcher needs the signature-level BIND_APPWIDGET
 * permission, so a home screen cannot be scripted in a test. This renders the
 * same RemoteViews the launcher would, through the same provider and factory,
 * which is what makes the widget's layout verifiable at all.
 */
public class WidgetPreviewActivity extends Activity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    final LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(24, 24, 24, 24);

    // The widget frame, exactly as the provider builds it.
    final RemoteViews frame = GlowWidgetProvider.buildViews(this, 1);
    final View frameView = frame.apply(this, root);
    root.addView(frameView, new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, 600));

    // The list rows, straight from the real factory.
    final GlowWidgetService.HabitRowFactory factory =
        new GlowWidgetService.HabitRowFactory(getApplicationContext());
    factory.onDataSetChanged();
    for (int i = 0; i < factory.getCount(); i++) {
      root.addView(factory.getViewAt(i).apply(this, root));
    }

    setContentView(root);
  }
}
