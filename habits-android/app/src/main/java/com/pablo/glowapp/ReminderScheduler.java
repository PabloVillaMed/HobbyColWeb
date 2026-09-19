package com.pablo.glowapp;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Schedules one daily alarm per habit that has a reminder time.
 *
 * Deliberately uses inexact alarms: exact alarms need the SCHEDULE_EXACT_ALARM
 * special access on API 31+, which is far more than a habit nudge warrants. A
 * reminder arriving within a few minutes of the chosen time is fine.
 */
final class ReminderScheduler {

  static final String ACTION_FIRE = "com.pablo.glowapp.REMIND";
  static final String EXTRA_HABIT_ID = "habitId";
  static final String EXTRA_HABIT_NAME = "habitName";

  private ReminderScheduler() { }

  /** Cancels everything previously scheduled and re-arms from the snapshot. */
  static void rescheduleAll(Context context) {
    final JSONObject snapshot = GlowStore.readSnapshot(context);
    if (snapshot == null) return;
    final JSONArray reminders = snapshot.optJSONArray("reminders");
    if (reminders == null) return;

    final AlarmManager alarms =
        (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms == null) return;

    for (int i = 0; i < reminders.length(); i++) {
      final JSONObject reminder = reminders.optJSONObject(i);
      if (reminder == null) continue;
      final String id = reminder.optString("id");
      final String name = reminder.optString("name");
      final String time = reminder.optString("time");   // "HH:MM"
      if (id.isEmpty() || time.isEmpty() || !time.contains(":")) continue;

      final String[] parts = time.split(":");
      int hour;
      int minute;
      try {
        hour = Integer.parseInt(parts[0]);
        minute = Integer.parseInt(parts[1]);
      } catch (NumberFormatException malformed) {
        continue;
      }

      final Calendar when = Calendar.getInstance();
      when.set(Calendar.HOUR_OF_DAY, hour);
      when.set(Calendar.MINUTE, minute);
      when.set(Calendar.SECOND, 0);
      when.set(Calendar.MILLISECOND, 0);
      if (when.getTimeInMillis() <= System.currentTimeMillis()) {
        when.add(Calendar.DAY_OF_YEAR, 1);              // today's slot has passed
      }

      final Intent intent = new Intent(context, ReminderReceiver.class)
          .setAction(ACTION_FIRE)
          .putExtra(EXTRA_HABIT_ID, id)
          .putExtra(EXTRA_HABIT_NAME, name);

      final PendingIntent pending = PendingIntent.getBroadcast(
          context, id.hashCode(), intent, flags());

      // A daily repeat keeps the alarm alive without the receiver re-arming it.
      alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, when.getTimeInMillis(),
          AlarmManager.INTERVAL_DAY, pending);
    }
  }

  static int flags() {
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return flags;
  }
}
