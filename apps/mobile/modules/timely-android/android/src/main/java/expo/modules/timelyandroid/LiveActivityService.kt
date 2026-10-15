package expo.modules.timelyandroid

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.lang.ref.WeakReference

/**
 * The live notification for the Activity island. A foreground service owns the
 * notification so Android keeps the app alive while something runs, and it
 * starts the `TimelyLiveActivity` headless JS task: React Native pauses JS
 * timers in the background unless such a task runs, and the task is what polls
 * the server and calls back with fresh text. No wake lock is held; updates wait
 * while the phone sleeps and resume when it wakes.
 */
class LiveActivityService : Service(), HeadlessJsTaskEventListener {
  companion object {
    const val ACTION_UPDATE = "expo.modules.timelyandroid.live.UPDATE"
    const val ACTION_STOP = "expo.modules.timelyandroid.live.STOP"
    const val ACTION_BUTTON = "expo.modules.timelyandroid.live.BUTTON"
    const val TASK = "TimelyLiveActivity"

    @Volatile
    var running = false
      private set

    private var current: WeakReference<LiveActivityService>? = null
    private val main = Handler(Looper.getMainLooper())

    /** Shows or refreshes the notification; false when Android refused to start the service. */
    fun update(context: Context, json: String): Boolean {
      val service = current?.get()
      if (running && service != null) {
        // Already in the foreground: refresh in place rather than another
        // startForegroundService, which Android would expect a new startForeground for.
        main.post { service.show(json) }
        return true
      }
      val intent = Intent(context, LiveActivityService::class.java).setAction(ACTION_UPDATE).putExtra("payload", json)
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Exception) {
        // Android 12+ refuses to start a foreground service from the
        // background (ForegroundServiceStartNotAllowedException); the next
        // refresh with the app open starts it.
        false
      }
    }

    fun stop(context: Context) {
      if (!running) return
      val service = current?.get()
      if (service != null) {
        main.post { service.finish() }
        return
      }
      try {
        context.startService(Intent(context, LiveActivityService::class.java).setAction(ACTION_STOP))
      } catch (_: Exception) {
        // Nothing running to stop.
      }
    }
  }

  private var taskId: Int? = null
  private var taskContext: HeadlessJsTaskContext? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    current = WeakReference(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE -> {
        val json = intent.getStringExtra("payload")
        if (json == null) {
          if (!running) stopSelf()
          return START_NOT_STICKY
        }
        val notification = LiveNotification.build(this, LivePayload.parse(json))
        val type =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, LiveNotification.ID, notification, type)
        running = true
        ensureTask()
      }
      ACTION_BUTTON -> {
        val id = intent.getStringExtra("id") ?: return START_NOT_STICKY
        val data = intent.getStringExtra("data")
        if (!TimelyAndroidModule.emitLiveAction(id, data)) {
          // JS isn't listening (it always is while the task runs): open the app instead.
          startActivity(
            (packageManager.getLaunchIntentForPackage(packageName) ?: return START_NOT_STICKY)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        }
      }
      ACTION_STOP -> finish()
      else -> if (!running) stopSelf()
    }
    return START_NOT_STICKY
  }

  internal fun show(json: String) {
    if (!running) return
    try {
      NotificationManagerCompat.from(this).notify(LiveNotification.ID, LiveNotification.build(this, LivePayload.parse(json)))
    } catch (_: SecurityException) {
      // Notifications turned off; the service still keeps the task alive.
    }
    ensureTask()
  }

  private fun ensureTask() {
    if (taskId?.let { taskContext?.isTaskRunning(it) } == true) return
    val reactContext = (application as? ReactApplication)?.reactHost?.currentReactContext ?: return
    val context = HeadlessJsTaskContext.getInstance(reactContext)
    context.addTaskEventListener(this)
    taskContext = context
    taskId =
      try {
        context.startTask(HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true))
      } catch (_: Throwable) {
        null
      }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId == this.taskId) this.taskId = null
  }

  internal fun finish() {
    running = false
    taskContext?.removeTaskEventListener(this)
    taskId?.let { id -> taskContext?.takeIf { it.isTaskRunning(id) }?.finishTask(id) }
    taskId = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    if (current?.get() === this) current = null
    taskContext?.removeTaskEventListener(this)
    super.onDestroy()
  }
}
