package com.pablo.glowapp;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/** Feeds today's habits into the widget list, straight from the snapshot. */
public class GlowWidgetService extends RemoteViewsService {

  @Override
  public RemoteViewsFactory onGetViewFactory(Intent intent) {
    return new HabitRowFactory(getApplicationContext());
  }

  static class HabitRowFactory implements RemoteViewsService.RemoteViewsFactory {

    private final Context context;
    private JSONArray habits = new JSONArray();

    HabitRowFactory(Context context) {
      this.context = context;
    }

    @Override
    public void onCreate() { }

    @Override
    public void onDataSetChanged() {
      final JSONObject snapshot = GlowStore.readSnapshot(context);
      final JSONArray list = snapshot == null ? null : snapshot.optJSONArray("habits");
      habits = list == null ? new JSONArray() : list;
    }

    @Override
    public void onDestroy() {
      habits = new JSONArray();
    }

    @Override
    public int getCount() {
      return habits.length();
    }

    @Override
    public RemoteViews getViewAt(int position) {
      final RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_row);
      final JSONObject habit = habits.optJSONObject(position);
      if (habit == null) return row;

      final boolean done = habit.optBoolean("done");
      final String unit = habit.optString("unit", "");
      final String progress = "quantity".equals(habit.optString("type"))
          ? habit.optInt("value") + "/" + habit.optInt("target", 1) + (unit.isEmpty() ? "" : " " + unit)
          : "";

      row.setTextViewText(R.id.row_emoji, habit.optString("emoji", "\u2705"));
      row.setTextViewText(R.id.row_name, habit.optString("name", ""));
      row.setTextViewText(R.id.row_progress, progress);
      row.setTextViewText(R.id.row_check, done ? "\u2713" : "\u25CB");
      row.setInt(R.id.row_check, "setTextColor",
          context.getColor(done ? R.color.widget_done : R.color.widget_muted));
      row.setInt(R.id.row_name, "setTextColor",
          context.getColor(done ? R.color.widget_muted : R.color.widget_ink));

      // The provider's template supplies the action; this supplies the target.
      final Intent fill = new Intent();
      fill.putExtra(GlowWidgetProvider.EXTRA_HABIT_ID, habit.optString("id"));
      row.setOnClickFillInIntent(R.id.row_root, fill);
      return row;
    }

    @Override
    public RemoteViews getLoadingView() {
      return null;
    }

    @Override
    public int getViewTypeCount() {
      return 1;
    }

    @Override
    public long getItemId(int position) {
      final JSONObject habit = habits.optJSONObject(position);
      return habit == null ? position : habit.optString("id", String.valueOf(position)).hashCode();
    }

    @Override
    public boolean hasStableIds() {
      return true;
    }
  }
}
