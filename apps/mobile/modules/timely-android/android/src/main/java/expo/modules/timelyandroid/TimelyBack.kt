package expo.modules.timelyandroid

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.facebook.react.ReactActivity
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.sign

/**
 * Predictive back for the React Native activity.
 *
 * While the app has somewhere to go back to, a callback of our own sits on top
 * of React Native's and streams the gesture (start, progress, cancel) to JS, so
 * the screen can slide away when Android's back arrow arms. At the root (Home
 * with no history) both callbacks step aside and Android plays its own
 * back-to-home animation.
 */
object TimelyBack {
  // Android's own back gesture rules (SystemUI BackPanelController and
  // res/values/dimens.xml, android15-release). The back arrow arms once the
  // finger is 16dp from where it touched down, disarms when the finger turns
  // back toward the edge (after the arrow has shown for 300ms), and re-arms
  // after going out 32dp again. Letting go armed goes back; disarmed cancels.
  // Android makes that call itself; we only mirror it so the screen moves
  // exactly when the arrow arms.
  private const val ARM_DP = 16f
  private const val DISARM_DP = 32f
  private const val REARM_DP = 32f
  private const val MIN_ARMED_MS = 300L
  private const val REARM_DELAY_MS = 160f
  private const val ARM_DELAY_FAST_MS = 10f
  private const val ARM_DELAY_SLOW_MS = 100f

  private val main = Handler(Looper.getMainLooper())
  private var activityRef: WeakReference<ComponentActivity>? = null
  private var callback: OnBackPressedCallback? = null
  private var reactCallback: OnBackPressedCallback? = null

  /** JS says whether Back has somewhere to go inside the app. */
  @Volatile
  private var appHandlesBack = true

  /** The running swipe, mirrored from Android's back arrow. */
  private class Swipe(val startX: Float, val startY: Float, val slop: Float, val density: Float, val startedAt: Long) {
    var armed = false
    var everArmed = false
    var x = 0f
    var time = startedAt
    var velocity = 0f
    var outward = 0f
    var sinceDisarm = 0f
    var pastAt = 0L
    var delay = 0f
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
            swipe = Swipe(backEvent.touchX, backEvent.touchY, slop, metrics.density, SystemClock.uptimeMillis())
            emit("started", backEvent)
          }

          override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            emit("progress", backEvent)
          }

          override fun handleOnBackCancelled() {
            swipe = null
            emitter?.invoke(mapOf("type" to "cancelled", "progress" to 0.0))
          }

          override fun handleOnBackPressed() {
            swipe = null
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

  /**
   * Whether Android's back arrow is armed: letting go now goes back. The same
   * steps as BackPanelController's move handling, in pixels.
   */
  private fun armed(event: BackEventCompat): Boolean {
    val s = swipe ?: return false
    val now = SystemClock.uptimeMillis()
    val px = { dp: Float -> dp * s.density }
    // Android measures from the touch down; the first event comes a touch slop later.
    val fromEdge = if (event.swipeEdge == BackEventCompat.EDGE_RIGHT) s.startX - event.touchX else event.touchX - s.startX
    val x = maxOf(0f, fromEdge + s.slop)
    val y = abs(event.touchY - s.startY)
    val dx = x - s.x
    if (now > s.time) s.velocity = abs(dx) / (now - s.time)
    s.x = x
    s.time = now
    if (dx != 0f) {
      // Distance travelled since the finger last changed direction.
      val sameWay = sign(dx) == sign(s.outward)
      val inBand = s.outward in px(REARM_DP)..px(DISARM_DP)
      s.outward = if (sameWay || inBand) s.outward + dx else dx
      s.sinceDisarm = maxOf(-s.slop, s.sinceDisarm + dx)
    }
    val level = x * 2 >= y
    val pastArm = x > px(ARM_DP)
    if (s.armed) {
      if ((!level || s.outward <= px(DISARM_DP)) && now - s.startedAt > MIN_ARMED_MS) {
        s.armed = false
        s.sinceDisarm = px(DISARM_DP)
      }
    } else if (!s.everArmed) {
      // Quicker swipes arm sooner (10-100ms past the threshold).
      val fast = smoothStep(0.5f, 1f, s.velocity)
      if (pastFor(s, now, pastArm, ARM_DELAY_FAST_MS + (ARM_DELAY_SLOW_MS - ARM_DELAY_FAST_MS) * (1 - fast))) arm(s)
    } else if (pastFor(s, now, pastArm && s.sinceDisarm >= px(REARM_DP) && level, REARM_DELAY_MS)) {
      arm(s)
    }
    return s.armed
  }

  private fun arm(s: Swipe) {
    s.armed = true
    s.everArmed = true
  }

  /** True once `past` has held for `delay` ms (BackPanelController.isPastThresholdToActive). */
  private fun pastFor(s: Swipe, now: Long, past: Boolean, delay: Float): Boolean {
    if (!past) {
      s.pastAt = 0L
      return false
    }
    if (s.pastAt == 0L) {
      s.pastAt = now
      s.delay = delay
    }
    return now - s.pastAt > s.delay
  }

  private fun smoothStep(from: Float, to: Float, value: Float): Float {
    val t = ((value - from) / (to - from)).coerceIn(0f, 1f)
    return t * t * (3 - 2 * t)
  }

  private fun emit(type: String, event: BackEventCompat) {
    emitter?.invoke(
      mapOf(
        "type" to type,
        "progress" to event.progress.toDouble(),
        "armed" to armed(event),
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
