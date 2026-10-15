package expo.modules.timelyandroid

import android.os.Handler
import android.os.Looper
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.facebook.react.ReactActivity
import java.lang.ref.WeakReference

/**
 * Predictive back for the React Native activity.
 *
 * While the app has somewhere to go back to, a callback of our own sits on top
 * of React Native's and streams the gesture (start, progress, cancel) to JS, so
 * the screen can shrink with the swipe before Back commits. At the root (Home
 * with no history) both callbacks step aside and Android plays its own
 * back-to-home animation.
 */
object TimelyBack {
  private val main = Handler(Looper.getMainLooper())
  private var activityRef: WeakReference<ComponentActivity>? = null
  private var callback: OnBackPressedCallback? = null
  private var reactCallback: OnBackPressedCallback? = null

  /** JS says whether Back has somewhere to go inside the app. */
  @Volatile
  private var appHandlesBack = true

  /** True while React Native runs its own default Back (moving the task to the background). */
  private var defaultBackRunning = false

  internal var emitter: ((Map<String, Any?>) -> Unit)? = null

  fun attach(activity: ComponentActivity) {
    main.post {
      if (activityRef?.get() === activity) return@post
      activityRef = WeakReference(activity)
      reactCallback = findReactCallback(activity)
      val cb =
        object : OnBackPressedCallback(appHandlesBack) {
          override fun handleOnBackStarted(backEvent: BackEventCompat) {
            emit("started", backEvent)
          }

          override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            emit("progress", backEvent)
          }

          override fun handleOnBackCancelled() {
            emitter?.invoke(mapOf("type" to "cancelled", "progress" to 0.0))
          }

          override fun handleOnBackPressed() {
            emitter?.invoke(mapOf("type" to "invoked", "progress" to 1.0))
            val react = activity as? ReactActivity
            if (react != null) {
              // Straight to React Native, so JS (expo-router, BackHandler) decides.
              react.onBackPressed()
            } else {
              isEnabled = false
              activity.onBackPressedDispatcher.onBackPressed()
              apply()
            }
          }
        }
      activity.onBackPressedDispatcher.addCallback(activity, cb)
      callback = cb
      apply()
    }
  }

  fun setAppHandlesBack(handles: Boolean) {
    appHandlesBack = handles
    main.post { apply() }
  }

  /** Called by MainActivity around React Native's default Back, so it doesn't land on our callback. */
  @JvmStatic
  fun beginDefaultBack() {
    defaultBackRunning = true
    callback?.isEnabled = false
  }

  @JvmStatic
  fun endDefaultBack() {
    defaultBackRunning = false
    apply()
  }

  private fun apply() {
    if (defaultBackRunning) return
    callback?.isEnabled = appHandlesBack
    // React Native keeps its callback on all the time; at the root it has to
    // step aside too or Android never shows the back-to-home preview.
    reactCallback?.isEnabled = appHandlesBack
  }

  private fun emit(type: String, event: BackEventCompat) {
    emitter?.invoke(
      mapOf(
        "type" to type,
        "progress" to event.progress.toDouble(),
        "edge" to if (event.swipeEdge == BackEventCompat.EDGE_RIGHT) "right" else "left",
        "touchY" to event.touchY.toDouble(),
      ),
    )
  }

  private fun findReactCallback(activity: ComponentActivity): OnBackPressedCallback? =
    try {
      val field = ReactActivity::class.java.getDeclaredField("mBackPressedCallback")
      field.isAccessible = true
      field.get(activity) as? OnBackPressedCallback
    } catch (_: Throwable) {
      // A React Native that renamed the field: Back still works, only the
      // back-to-home preview at the root is lost.
      null
    }
}
