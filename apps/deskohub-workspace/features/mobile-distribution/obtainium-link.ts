import { nativeApp } from "@/features/account/backend/auth/native-app";
import { getWorkspacePageUrl } from "@/features/i18n";

/**
 * Obtainium's web page source settings: it picks the APK link on the download
 * page by file name and reads the version from that name, so an update shows
 * as a version rather than a file hash. Obtainium decodes them from a JSON
 * string.
 */
const obtainiumSourceSettings = {
  customLinkFilterRegex: "deskohub-[0-9.]+\\.apk$",
  versionExtractionRegEx: "deskohub-([0-9.]+)\\.apk",
  matchGroupToUse: "1",
};

const obtainiumAppLink = `obtainium://app/${encodeURIComponent(
  JSON.stringify({
    id: nativeApp.applicationId,
    url: getWorkspacePageUrl("/android"),
    author: "Deskohub",
    name: "Deskohub",
    additionalSettings: JSON.stringify(obtainiumSourceSettings),
  })
)}`;

/**
 * Adds the app to Obtainium. Obtainium's redirect page opens the app link and
 * offers to install Obtainium when nothing answers it; it reads the link from
 * the `r` query parameter.
 */
export const obtainiumImportUrl = (() => {
  const url = new URL("https://apps.obtainium.imranr.dev/redirect");
  url.searchParams.set("r", obtainiumAppLink);
  return url.href;
})();
