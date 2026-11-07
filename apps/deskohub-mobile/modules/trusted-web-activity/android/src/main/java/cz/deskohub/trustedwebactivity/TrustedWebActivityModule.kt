package cz.deskohub.trustedwebactivity

import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.google.androidbrowserhelper.trusted.TwaLauncher
import com.google.androidbrowserhelper.trusted.TwaProviderPicker
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class LaunchColors : Record {
  @Field val toolbar: String = ""
  @Field val navigationBar: String = ""
}

/**
 * Opens a page as a Trusted Web Activity through Android Browser Helper.
 * When the browser can't verify the page's origin against the app, it shows
 * the page as a Custom Tab with its toolbar instead.
 */
class TrustedWebActivityModule : Module() {
  // The connection to the browser of the last launch. Browser Helper keeps
  // it bound until destroyed.
  private var launcher: TwaLauncher? = null

  // The launch waiting for the browser. Browser Helper never reports a
  // launch that its dropped connection cancelled, so releasing rejects it.
  private var pendingLaunch: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("TrustedWebActivity")

    // The browser Browser Helper would launch, preferring one that supports
    // Trusted Web Activities.
    Function("getProvider") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val action = TwaProviderPicker.pickProvider(context.packageManager)
      val packageName = action.provider ?: return@Function null
      mapOf(
        "packageName" to packageName,
        "launchMode" to when (action.launchMode) {
          TwaProviderPicker.LaunchMode.TRUSTED_WEB_ACTIVITY -> "trusted-web-activity"
          TwaProviderPicker.LaunchMode.CUSTOM_TAB -> "custom-tab"
          else -> "browser"
        }
      )
    }

    // Resolves once the browser has been asked to show the page. Launching
    // from the current activity keeps the page in the app's task, so the
    // app's return link closes it.
    AsyncFunction("launch") { url: String, packageName: String, colors: LaunchColors, promise: Promise ->
      val activity = appContext.throwingActivity
      release()
      val colorScheme = CustomTabColorSchemeParams.Builder()
        .setToolbarColor(Color.parseColor(colors.toolbar))
        .setNavigationBarColor(Color.parseColor(colors.navigationBar))
        .build()
      val builder = TrustedWebActivityIntentBuilder(Uri.parse(url))
        .setDefaultColorSchemeParams(colorScheme)
      val twaLauncher = TwaLauncher(activity, packageName)
      launcher = twaLauncher
      pendingLaunch = promise
      try {
        twaLauncher.launch(builder, null, null, {
          if (pendingLaunch === promise) {
            pendingLaunch = null
            promise.resolve(null)
          }
        })
      } catch (error: Throwable) {
        // Expo rejects the promise with what the launch threw.
        if (pendingLaunch === promise) pendingLaunch = null
        throw error
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("release") {
      release()
    }.runOnQueue(Queues.MAIN)

    OnActivityDestroys {
      release()
    }
  }

  private fun release() {
    pendingLaunch?.reject(
      "ERR_TRUSTED_WEB_ACTIVITY_RELEASED",
      "The browser connection closed before the page opened",
      null
    )
    pendingLaunch = null
    launcher?.destroy()
    launcher = null
  }
}
