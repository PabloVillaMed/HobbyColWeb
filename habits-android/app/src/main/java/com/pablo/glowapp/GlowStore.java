package com.pablo.glowapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The bridge between the web app's storage and native Android.
 *
 * Habit data lives in the WebView's local storage, which neither the widget nor
 * the alarm receiver can read. The page therefore pushes a compact snapshot of
 * today here after every save, and anything ticked natively is queued back for
 * the page to apply through its own write path the next time it runs.
 */
final class GlowStore {

  private static final String PREFS = "glow_shell";
  private static final String KEY_SNAPSHOT = "snapshot";
  private static final String KEY_PENDING = "pending";

  private GlowStore() { }

  private static SharedPreferences prefs(Context context) {
    return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /* ── Snapshot of today, written by the page ── */

  static void writeSnapshot(Context context, String json) {
    prefs(context).edit().putString(KEY_SNAPSHOT, json).apply();
  }

  static JSONObject readSnapshot(Context context) {
    final String raw = prefs(context).getString(KEY_SNAPSHOT, null);
    if (raw == null) return null;
    try {
      return new JSONObject(raw);
    } catch (JSONException malformed) {
      return null;
    }
  }

  /**
   * Flips a habit's done state in the stored snapshot so the widget can redraw
   * immediately. The real store is only updated when the app next opens, which
   * is why the queued action below is what actually counts.
   */
  static void toggleInSnapshot(Context context, String habitId) {
    final JSONObject snapshot = readSnapshot(context);
    if (snapshot == null) return;
    try {
      final JSONArray habits = snapshot.optJSONArray("habits");
      if (habits == null) return;
      int done = 0;
      for (int i = 0; i < habits.length(); i++) {
        final JSONObject habit = habits.getJSONObject(i);
        if (habitId.equals(habit.optString("id"))) {
          final boolean next = !habit.optBoolean("done");
          habit.put("done", next);
          habit.put("value", next ? habit.optInt("target", 1) : 0);
        }
        if (habits.getJSONObject(i).optBoolean("done")) done++;
      }
      snapshot.put("done", done);
      writeSnapshot(context, snapshot.toString());
    } catch (JSONException ignored) {
      // A malformed snapshot is replaced on the app's next sync.
    }
  }

  /* ── Actions taken natively, waiting for the page to apply them ── */

  static void queueAction(Context context, String habitId, String date, String action) {
    final SharedPreferences store = prefs(context);
    JSONArray queue;
    try {
      queue = new JSONArray(store.getString(KEY_PENDING, "[]"));
    } catch (JSONException malformed) {
      queue = new JSONArray();
    }
    try {
      final JSONObject entry = new JSONObject();
      entry.put("habitId", habitId);
      entry.put("date", date);
      entry.put("action", action);
      queue.put(entry);
    } catch (JSONException ignored) {
      return;
    }
    store.edit().putString(KEY_PENDING, queue.toString()).apply();
  }

  /** Returns the queued actions and clears them in the same step. */
  static String takePending(Context context) {
    final SharedPreferences store = prefs(context);
    final String queued = store.getString(KEY_PENDING, "[]");
    store.edit().remove(KEY_PENDING).apply();
    return queued;
  }

  static String todayDate(Context context) {
    final JSONObject snapshot = readSnapshot(context);
    return snapshot == null ? "" : snapshot.optString("date", "");
  }
}
