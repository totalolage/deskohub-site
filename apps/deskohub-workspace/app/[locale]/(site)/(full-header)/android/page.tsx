import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { loadAndroidDownload } from "@/features/mobile-distribution/backend/android-download.server";
import { AndroidDownloadPage } from "@/features/mobile-distribution/components/android-download-page";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

export const instant = false;

export const generateMetadata = publicPageMetadata("/android");

export default async function LocalizedAndroidPage() {
  const download = await runWorkspaceEffect(
    "mobile-distribution.android-page.load"
  )(loadAndroidDownload);

  return runWithRequestLocale((locale) => (
    <AndroidDownloadPage download={download} locale={locale} />
  ));
}
