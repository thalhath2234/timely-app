package expo.modules.timelyandroid

import android.os.Handler
import android.os.Looper
import android.util.Log
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
 * the screen can slide away once the finger crosses the back threshold. At the
 * root (Home with no history) both callbacks step aside and Android plays its
 * own back-to-home animation.
 */
object TimelyBack {
  private const val TAG = "TimelyBack"

  // The page leaves once the finger is 32dp from where it touched down (twice
  // Android's 16dp, which went off on the smallest swipe) and comes back only
  // when the finger returns inside it. The page coming back in starts a little
  // inside the line, so a finger resting on it doesn't flicker the page.
  // Whether letting go goes back follows the same line, so what the screen
  // shows is what happens, even where Android's own back arrow has armed sooner.
  private const val ARM_DP = 32f
  private const val DISARM_DP = 24f

  private val main = Handler(Looper.getMainLooper())
  private var activityRef: WeakReference<ComponentActivity>? = null
  private var callback: OnBackPressedCallback? = null
  private var reactCallback: OnBackPressedCallback? = null

  /** JS says whether Back has somewhere to go inside the app. */
  @Volatile
  private var appHandlesBack = true

  /** The running swipe. `right` is the screen edge it started from. */
  private class Swipe(val startX: Float, val right: Boolean, val slop: Float, val density: Float) {
    var armed = false
    var x = 0f
  }

  private var swipe: Swipe? = null

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
            val metrics = activity.resources.displayMetrics
            val slop = android.view.ViewConfiguration.get(activity).scaledTouchSlop.toFloat()
            val right = startsOnRight(activity, backEvent)
            Log.d(TAG, "started edge=${backEvent.swipeEdge} x=${backEvent.touchX} width=${screenWidth(activity)} right=$right")
            swipe = Swipe(backEvent.touchX, right, slop, metrics.density)
            emit("started", backEvent)
          }

          override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            emit("progress", backEvent)
          }

          override fun handleOnBackCancelled() {
            // Android let go of the gesture; past the line still goes back.
            val s = swipe
            swipe = null
            Log.d(TAG, "cancelled armed=${s?.armed}")
            if (s?.armed == true) goBack(activity, this) else emitter?.invoke(mapOf("type" to "cancelled", "progress" to 0.0))
          }

          override fun handleOnBackPressed() {
            // A swipe let go back inside the line stays, even if Android went back.
            val s = swipe
            swipe = null
            Log.d(TAG, "invoked armed=${s?.armed}")
            if (s != null && !s.armed) emitter?.invoke(mapOf("type" to "cancelled", "progress" to 0.0)) else goBack(activity, this)
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

  private fun goBack(activity: ComponentActivity, cb: OnBackPressedCallback) {
    emitter?.invoke(mapOf("type" to "invoked", "progress" to 1.0))
    val react = activity as? ReactActivity
    if (react != null) {
      // Straight to React Native, so JS (expo-router, BackHandler) decides.
      react.onBackPressed()
    } else {
      cb.isEnabled = false
      activity.onBackPressedDispatcher.onBackPressed()
      apply()
    }
  }

  /**
   * Which edge the swipe came from. Not every phone reports the edge right, so
   * where it touched down counts too: no left edge swipe starts past the
   * middle of the screen.
   */
  private fun startsOnRight(activity: ComponentActivity, event: BackEventCompat): Boolean =
    event.swipeEdge == BackEventCompat.EDGE_RIGHT || event.touchX > screenWidth(activity) / 2f

  private fun screenWidth(activity: ComponentActivity): Float =
    if (android.os.Build.VERSION.SDK_INT >= 30) {
      activity.windowManager.currentWindowMetrics.bounds.width().toFloat()
    } else {
      activity.resources.displayMetrics.widthPixels.toFloat()
    }

  /** Whether the finger is past the line: letting go now goes back. */
  private fun armed(event: BackEventCompat): Boolean {
    val s = swipe ?: return false
    val px = { dp: Float -> dp * s.density }
    // Measured from the touch down; the first event comes a touch slop later.
    val fromEdge = if (s.right) s.startX - event.touchX else event.touchX - s.startX
    s.x = maxOf(0f, fromEdge + s.slop)
    val was = s.armed
    s.armed = if (s.armed) s.x >= px(DISARM_DP) else s.x >= px(ARM_DP)
    if (s.armed != was) Log.d(TAG, "armed=${s.armed} x=${event.touchX}")
    return s.armed
  }

  private fun emit(type: String, event: BackEventCompat) {
    emitter?.invoke(
      mapOf(
        "type" to type,
        "progress" to event.progress.toDouble(),
        "armed" to armed(event),
        "edge" to if (swipe?.right == true) "right" else "left",
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
