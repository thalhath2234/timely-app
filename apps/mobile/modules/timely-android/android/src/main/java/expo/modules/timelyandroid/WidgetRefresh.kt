package expo.modules.timelyandroid

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Redraws Timely's home screen widgets at a set time, so a timer widget
 * moves on when its countdown ends even with the app closed. The alarm sends
 * each widget provider the system's own APPWIDGET_UPDATE, which runs the JS
 * widget handler as if Android asked for a refresh.
 */
object WidgetRefresh {
  private const val REQUEST_CODE = 7301

  fun schedule(context: Context, atMs: Long) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val intent = pendingIntent(context)
    if (atMs <= 0) {
      alarms.cancel(intent)
      return
    }
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    if (exact) {
      alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
    } else {
      // Without the exact alarm permission Android may run it a little late.
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, intent)
    }
  }

  fun redrawAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val providers = manager.installedProviders.filter { it.provider.packageName == context.packageName }
    for (info in providers) {
      val ids = manager.getAppWidgetIds(info.provider)
      if (ids.isEmpty()) continue
      val update = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
        component = ComponentName(context, info.provider.className)
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
      }
      context.sendBroadcast(update)
    }
  }

  private fun pendingIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REQUEST_CODE,
      Intent(context, WidgetRefreshReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    WidgetRefresh.redrawAll(context)
  }
}
