package expo.modules.timelyandroid

import androidx.activity.ComponentActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class TimelyAndroidModule : Module() {
  companion object {
    private var instance: WeakReference<TimelyAndroidModule>? = null

    /** Sends a live notification button to JS; false when no JS is listening. */
    fun emitLiveAction(id: String, data: String?): Boolean {
      val module = instance?.get() ?: return false
      if (!module.hasLiveListener) return false
      module.sendEvent("onLiveAction", mapOf("id" to id, "data" to data))
      return true
    }
  }

  private var hasLiveListener = false

  override fun definition() = ModuleDefinition {
    Name("TimelyAndroid")

    Events("onBack", "onLiveAction")

    OnCreate {
      instance = WeakReference(this@TimelyAndroidModule)
      TimelyBack.emitter = { event -> sendEvent("onBack", event) }
    }

    OnDestroy {
      if (instance?.get() === this@TimelyAndroidModule) instance = null
      TimelyBack.emitter = null
    }

    OnStartObserving("onLiveAction") { hasLiveListener = true }
    OnStopObserving("onLiveAction") { hasLiveListener = false }

    OnActivityEntersForeground {
      (appContext.currentActivity as? ComponentActivity)?.let { TimelyBack.attach(it) }
    }

    Function("setAppHandlesBack") { handles: Boolean ->
      (appContext.currentActivity as? ComponentActivity)?.let { TimelyBack.attach(it) }
      TimelyBack.setAppHandlesBack(handles)
    }

    Function("updateLiveActivity") { payload: String ->
      val context = appContext.reactContext ?: return@Function false
      LiveActivityService.update(context, payload)
    }

    Function("stopLiveActivity") {
      appContext.reactContext?.let { LiveActivityService.stop(it) }
      Unit
    }

    Function("isLiveActivityRunning") { LiveActivityService.running }

    Function("scheduleWidgetRefresh") { atMs: Double ->
      appContext.reactContext?.let { WidgetRefresh.schedule(it, atMs.toLong()) }
      Unit
    }
  }
}
