package com.pablo.glowapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Posts a habit's reminder, with a Mark done action that records the tick
 * without opening the app. The tick is queued for the page to apply.
 */
public class ReminderReceiver extends BroadcastReceiver {

  static final String ACTION_MARK_DONE = "com.pablo.glowapp.MARK_DONE";
  private static final String CHANNEL_ID = "glow_reminders";

  @Override
  public void onReceive(Context context, Intent intent) {
    final String action = intent.getAction();
    final String habitId = intent.getStringExtra(ReminderScheduler.EXTRA_HABIT_ID);
    final String habitName = intent.getStringExtra(ReminderScheduler.EXTRA_HABIT_NAME);
    if (habitId == null) return;

    if (ACTION_MARK_DONE.equals(action)) {
      GlowStore.queueAction(context, habitId, GlowStore.todayDate(context), "toggle");
      GlowStore.completeInSnapshot(context, habitId);
      GlowWidgetProvider.refresh(context);
      manager(context).cancel(habitId.hashCode());
      return;
    }

    notifyReminder(context, habitId, habitName == null ? "" : habitName);
  }

  private void notifyReminder(Context context, String habitId, String habitName) {
    ensureChannel(context);

    final Intent open = new Intent(context, MainActivity.class)
        .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    final PendingIntent openApp = PendingIntent.getActivity(
        context, habitId.hashCode(), open, ReminderScheduler.flags());

    final Intent done = new Intent(context, ReminderReceiver.class)
        .setAction(ACTION_MARK_DONE)
        .putExtra(ReminderScheduler.EXTRA_HABIT_ID, habitId);
    final PendingIntent markDone = PendingIntent.getBroadcast(
        context, ("done" + habitId).hashCode(), done, ReminderScheduler.flags());

    final String title = context.getString(R.string.reminder_title, habitName);

    final Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(context, CHANNEL_ID)
        : new Notification.Builder(context);

    builder.setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(title)
        .setContentText(context.getString(R.string.reminder_body))
        .setAutoCancel(true)
        .setContentIntent(openApp)
        .addAction(buildAction(context, markDone));

    try {
      manager(context).notify(habitId.hashCode(), builder.build());
    } catch (SecurityException denied) {
      // Notification permission was revoked; nothing else to do here.
    }
  }

  private Notification.Action buildAction(Context context, PendingIntent intent) {
    final String label = context.getString(R.string.mark_done);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return new Notification.Action.Builder(
          android.graphics.drawable.Icon.createWithResource(context, R.drawable.ic_notification),
          label, intent).build();
    }
    return new Notification.Action.Builder(R.drawable.ic_notification, label, intent).build();
  }

  private static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    final NotificationChannel channel = new NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.reminder_channel),
        NotificationManager.IMPORTANCE_DEFAULT);
    channel.setDescription(context.getString(R.string.reminder_channel_desc));
    manager(context).createNotificationChannel(channel);
  }

  private static NotificationManager manager(Context context) {
    return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
  }
}
