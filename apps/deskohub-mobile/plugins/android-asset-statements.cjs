// @ts-check
// Declares the Android app's half of the Digital Asset Links association with
// each listed site: a `handle_all_urls` statement in the `asset_statements`
// string resource, referenced by `<meta-data android:name="asset_statements">`
// under `<application>`. Chrome reads it for `navigator.getInstalledRelatedApps()`
// and for Trusted Web Activity origin verification; the site's
// `/.well-known/assetlinks.json` holds the other half.
//
// CommonJS on purpose: the package is `"type": "module"`, and Expo loads config
// plugins with `require`.

const {
  AndroidConfig,
  withAndroidManifest,
  withStringsXml,
} = require("expo/config-plugins");

const resourceName = "asset_statements";

/**
 * @typedef {{ readonly sites: readonly string[] }} AndroidAssetStatementsOptions
 * @typedef {import("expo/config-plugins").AndroidManifest} AndroidManifest
 * @typedef {import("expo/config-plugins").AndroidConfig.Resources.ResourceXML} ResourceXML
 */

/**
 * @param {unknown} sites
 * @returns {readonly string[]}
 */
function parseSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new Error(
      "android-asset-statements: `sites` must be a non-empty array of site origins."
    );
  }
  return sites.map((site) => {
    const url = typeof site === "string" && URL.canParse(site) ? new URL(site) : undefined;
    if (url?.protocol !== "https:" || url.origin !== site) {
      throw new Error(
        `android-asset-statements: ${JSON.stringify(site)} is not an https origin such as "https://example.com".`
      );
    }
    return site;
  });
}

/**
 * The Digital Asset Links statement list the app publishes for its sites.
 * @param {readonly string[]} sites
 * @returns {string}
 */
function assetStatements(sites) {
  return JSON.stringify(
    parseSites(sites).map((site) => ({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "web", site },
    }))
  );
}

/**
 * Escapes text for an Android string resource. aapt2 drops unescaped double
 * quotes and rejects unescaped apostrophes, and a leading `@` or `?` would make
 * the value a resource reference.
 * @param {string} text
 * @returns {string}
 */
function androidStringResourceText(text) {
  return text
    .replace(/[\\"']/g, (character) => `\\${character}`)
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/^[@?]/, (character) => `\\${character}`);
}

/**
 * Upserts the `asset_statements` string into a parsed `strings.xml`.
 * @param {ResourceXML} strings
 * @param {readonly string[]} sites
 * @returns {ResourceXML}
 */
function setAssetStatementsString(strings, sites) {
  return AndroidConfig.Strings.setStringItem(
    [
      AndroidConfig.Resources.buildResourceItem({
        name: resourceName,
        value: androidStringResourceText(assetStatements(sites)),
        translatable: false,
      }),
    ],
    strings
  );
}

/**
 * Makes `<application>` hold exactly one `asset_statements` meta-data entry,
 * pointing at the string resource.
 * @param {AndroidManifest} manifest
 * @returns {AndroidManifest}
 */
function setAssetStatementsMetaData(manifest) {
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  AndroidConfig.Manifest.removeMetaDataItemFromMainApplication(
    application,
    resourceName
  );
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    application,
    resourceName,
    `@string/${resourceName}`,
    "resource"
  );
  return manifest;
}

/** @type {import("expo/config-plugins").ConfigPlugin<AndroidAssetStatementsOptions>} */
const withAndroidAssetStatements = (config, options) => {
  const sites = parseSites(options?.sites);
  const withString = withStringsXml(config, (stringsConfig) => {
    stringsConfig.modResults = setAssetStatementsString(
      stringsConfig.modResults,
      sites
    );
    return stringsConfig;
  });
  return withAndroidManifest(withString, (manifestConfig) => {
    manifestConfig.modResults = setAssetStatementsMetaData(
      manifestConfig.modResults
    );
    return manifestConfig;
  });
};

module.exports = Object.assign(withAndroidAssetStatements, {
  androidStringResourceText,
  assetStatements,
  setAssetStatementsMetaData,
  setAssetStatementsString,
});
