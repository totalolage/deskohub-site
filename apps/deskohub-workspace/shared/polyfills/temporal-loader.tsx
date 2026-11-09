import { temporalLoaderScript } from "./generated/temporal-loader";

/**
 * Loads the Temporal polyfill before the app in browsers without a complete
 * Temporal. Render it first in the root layout's `<head>`.
 */
export function TemporalLoader() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: temporal-polyfill:build generates the script from source.
  return <script dangerouslySetInnerHTML={{ __html: temporalLoaderScript }} />;
}
