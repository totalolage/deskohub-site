package cz.deskohub.workspace.updater

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class DeskohubAppUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DeskohubAppUpdater")

    AsyncFunction("installApk") { apkUri: String, expectedApplicationId: String, expectedVersionCode: Long ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android context is unavailable")
      val apkFile = localFile(apkUri)

      if (!apkFile.exists() || !apkFile.isFile) {
        throw IllegalArgumentException("The downloaded APK does not exist")
      }
      if (expectedApplicationId != context.packageName) {
        throw IllegalArgumentException("The expected application ID does not match the installed app")
      }

      val archive = readArchivePackageInfo(context.packageManager, apkFile)
        ?: throw IllegalArgumentException("The downloaded file is not a readable Android package")
      if (archive.packageName != expectedApplicationId) {
        throw IllegalArgumentException("The downloaded APK belongs to a different application")
      }
      val archiveVersionCode = PackageInfoCompat.getLongVersionCode(archive)
      val installed = readInstalledPackageInfo(context.packageManager, context.packageName)
      val installedVersionCode = PackageInfoCompat.getLongVersionCode(installed)
      if (archiveVersionCode != expectedVersionCode || archiveVersionCode <= installedVersionCode) {
        throw IllegalArgumentException("The downloaded APK is not a newer expected version")
      }

      val installedCertificates = signingCertificateDigests(installed)
      val archiveCertificates = signingCertificateDigests(archive)
      if (installedCertificates.isEmpty() || archiveCertificates != installedCertificates) {
        throw SecurityException("The downloaded APK signing certificate does not match the installed app")
      }

      val contentUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.deskohub_updates",
        apkFile,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(contentUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      context.startActivity(intent)
    }

    AsyncFunction("sha256") { fileUri: String ->
      val file = localFile(fileUri)
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          digest.update(buffer, 0, count)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }

  private fun localFile(value: String): File {
    val parsedUri = Uri.parse(value)
    return when (parsedUri.scheme) {
      "file" -> File(requireNotNull(parsedUri.path))
      null -> File(value)
      else -> throw IllegalArgumentException("Only local files may be used")
    }
  }

  @Suppress("DEPRECATION")
  private fun readArchivePackageInfo(packageManager: PackageManager, apkFile: File): PackageInfo? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageArchiveInfo(
        apkFile.absolutePath,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
      )
    } else {
      val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PackageManager.GET_SIGNING_CERTIFICATES
      } else {
        PackageManager.GET_SIGNATURES
      }
      packageManager.getPackageArchiveInfo(apkFile.absolutePath, flags)
    }

  @Suppress("DEPRECATION")
  private fun readInstalledPackageInfo(
    packageManager: PackageManager,
    applicationId: String,
  ): PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    packageManager.getPackageInfo(
      applicationId,
      PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
    )
  } else {
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }
    packageManager.getPackageInfo(applicationId, flags)
  }

  @Suppress("DEPRECATION")
  private fun signingCertificateDigests(packageInfo: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      packageInfo.signingInfo?.apkContentsSigners ?: emptyArray()
    } else {
      packageInfo.signatures ?: emptyArray()
    }
    return signatures.map { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString("") { "%02x".format(it) }
    }.toSet()
  }
}
