package expo.modules.timelyandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/** What the JS side wants the live notification to say (see modules/timely-android/index.ts). */
data class LivePayload(
  val title: String,
  val text: String,
  val bigText: String?,
  val subText: String?,
  val chip: String?,
  val chronometerBase: Long?,
  val countDown: Boolean,
  val progressMax: Int,
  val progressValue: Int,
  val progressIndeterminate: Boolean,
  val hasProgress: Boolean,
  val uri: String?,
  val accent: Int?,
  val actions: List<LiveAction>,
) {
  companion object {
    fun parse(json: String): LivePayload {
      val o = JSONObject(json)
      val chronometer = o.optJSONObject("chronometer")
      val progress = o.optJSONObject("progress")
      val actions = o.optJSONArray("actions")
      return LivePayload(
        title = o.optString("title", "Timely"),
        text = o.optString("text", ""),
        bigText = o.optString("bigText").ifBlank { null },
        subText = o.optString("subText").ifBlank { null },
        chip = o.optString("chip").ifBlank { null },
        chronometerBase = chronometer?.optLong("base")?.takeIf { it > 0 },
        countDown = chronometer?.optBoolean("countDown", false) ?: false,
        progressMax = progress?.optInt("max", 0) ?: 0,
        progressValue = progress?.optInt("value", 0) ?: 0,
        progressIndeterminate = progress?.optBoolean("indeterminate", false) ?: false,
        hasProgress = progress != null,
        uri = o.optString("uri").ifBlank { null },
        accent =
          o.optString("accent").ifBlank { null }?.let {
            try {
              Color.parseColor(it)
            } catch (_: IllegalArgumentException) {
              null
            }
          },
        actions =
          (0 until (actions?.length() ?: 0)).mapNotNull { index ->
            val a = actions?.optJSONObject(index) ?: return@mapNotNull null
            LiveAction(
              id = a.optString("id"),
              label = a.optString("label"),
              uri = a.optString("uri").ifBlank { null },
              data = a.optJSONObject("data")?.toString(),
            )
          },
      )
    }
  }
}

data class LiveAction(val id: String, val label: String, val uri: String?, val data: String?)

object LiveNotification {
  const val CHANNEL = "live_activity"
  const val ID = 7301

  // Android 16 Live Updates; set through extras so older SDKs compile and ignore them.
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
  private const val EXTRA_SHORT_CRITICAL_TEXT = "android.shortCriticalText"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val channel =
      NotificationChannel(CHANNEL, "Live activity", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "What's running right now: assistant runs, task focus and timers."
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
      }
    manager.createNotificationChannel(channel)
  }

  fun build(context: Context, payload: LivePayload): Notification {
    ensureChannel(context)
    val builder =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(smallIcon(context))
        .setContentTitle(payload.title)
        .setContentText(payload.text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(openIntent(context, payload.uri, 0))
    payload.accent?.let { builder.setColor(it) }
    payload.subText?.let { builder.setSubText(it) }
    payload.bigText?.let { builder.setStyle(NotificationCompat.BigTextStyle().bigText(it)) }
    if (payload.chronometerBase != null) {
      builder
        .setUsesChronometer(true)
        .setChronometerCountDown(payload.countDown)
        .setWhen(payload.chronometerBase)
        .setShowWhen(true)
    } else {
      builder.setShowWhen(false)
    }
    if (payload.hasProgress) {
      builder.setProgress(payload.progressMax, payload.progressValue, payload.progressIndeterminate)
    }
    payload.actions.take(3).forEachIndexed { index, action ->
      builder.addAction(0, action.label, actionIntent(context, action, index + 1))
    }
    val extras = Bundle()
    extras.putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
    payload.chip?.let { extras.putCharSequence(EXTRA_SHORT_CRITICAL_TEXT, it) }
    builder.addExtras(extras)
    return builder.build()
  }

  private fun smallIcon(context: Context): Int {
    val res = context.resources
    val id = res.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
  }

  fun openIntent(context: Context, uri: String?, requestCode: Int): PendingIntent {
    val intent =
      if (uri != null) {
        Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
      } else {
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun actionIntent(context: Context, action: LiveAction, requestCode: Int): PendingIntent {
    if (action.uri != null) return openIntent(context, action.uri, requestCode)
    val intent =
      Intent(context, LiveActivityService::class.java)
        .setAction(LiveActivityService.ACTION_BUTTON)
        .putExtra("id", action.id)
        .putExtra("data", action.data)
    return PendingIntent.getService(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
