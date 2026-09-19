package com.pablo.glowapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Home-screen widget listing today's habits, each tappable to complete.
 *
 * A tick here updates the stored snapshot straight away so the widget redraws,
 * and queues the real change for the page to apply when GlowApp next opens.
 */
public class GlowWidgetProvider extends AppWidgetProvider {

  static final String ACTION_TOGGLE = "com.pablo.glowapp.WIDGET_TOGGLE";
  static final String EXTRA_HABIT_ID = "habitId";

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
    for (int widgetId : widgetIds) {
      manager.updateAppWidget(widgetId, buildViews(context, widgetId));
    }
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    if (ACTION_TOGGLE.equals(intent.getAction())) {
      final String habitId = intent.getStringExtra(EXTRA_HABIT_ID);
      if (habitId != null) {
        GlowStore.queueAction(context, habitId, GlowStore.todayDate(context), "toggle");
        GlowStore.toggleInSnapshot(context, habitId);
        refresh(context);
      }
      return;
    }
    super.onReceive(context, intent);
  }

  /** Redraws every placed widget; called after any change to the snapshot. */
  static void refresh(Context context) {
    final AppWidgetManager manager = AppWidgetManager.getInstance(context);
    final ComponentName provider = new ComponentName(context, GlowWidgetProvider.class);
    final int[] ids = manager.getAppWidgetIds(provider);
    if (ids == null || ids.length == 0) return;
    manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    for (int id : ids) {
      manager.updateAppWidget(id, buildViews(context, id));
    }
  }

  static RemoteViews buildViews(Context context, int widgetId) {
    final RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_today);

    final JSONObject snapshot = GlowStore.readSnapshot(context);
    final int done = snapshot == null ? 0 : snapshot.optInt("done");
    final int due = snapshot == null ? 0 : snapshot.optInt("due");
    final int percent = due > 0 ? Math.round((done * 100f) / due) : 0;

    views.setTextViewText(R.id.widget_title, context.getString(R.string.app_name));
    views.setTextViewText(R.id.widget_progress,
        due > 0 ? percent + "%  ·  " + done + "/" + due : "");

    // Each row is filled in by the factory below.
    final Intent service = new Intent(context, GlowWidgetService.class);
    service.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
    service.setData(Uri.parse(service.toUri(Intent.URI_INTENT_SCHEME)));
    views.setRemoteAdapter(R.id.widget_list, service);
    views.setEmptyView(R.id.widget_list, R.id.widget_empty);

    // One template intent; each row supplies its own habit id as a fill-in.
    final Intent toggle = new Intent(context, GlowWidgetProvider.class)
        .setAction(ACTION_TOGGLE);
    views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getBroadcast(
        context, 0, toggle,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));

    // Tapping the header opens the app.
    views.setOnClickPendingIntent(R.id.widget_header, PendingIntent.getActivity(
        context, 0, new Intent(context, MainActivity.class), ReminderScheduler.flags()));

    return views;
  }
}
