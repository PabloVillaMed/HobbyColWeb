package com.pablo.glowapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarms do not survive a reboot, so re-arm them from the stored snapshot. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    ReminderScheduler.rescheduleAll(context);
  }
}
