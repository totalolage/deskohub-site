/** The site's `DeploymentEnvironment` values, sent as `deployment.environment.name`. */
export type DeploymentEnvironment = "production" | "preview" | "development";

/** The production web origin's hostname; the app's web build is served under it. */
const productionHostname = "workspace.deskohub.cz";

/**
 * Which deployment this runtime belongs to. Native release builds are
 * production; on the web only the production hostname is.
 */
export const classifyDeploymentEnvironment = ({
  hostname,
  isDevelopmentBuild,
}: {
  /** The page's hostname on the web; `undefined` on native. */
  readonly hostname: string | undefined;
  readonly isDevelopmentBuild: boolean;
}): DeploymentEnvironment => {
  if (hostname === undefined) {
    return isDevelopmentBuild ? "development" : "production";
  }
  if (hostname === productionHostname) return "production";
  return isDevelopmentBuild ? "development" : "preview";
};

export interface AnalyticsSettings {
  readonly apiKey: string;
  readonly host: string;
  readonly environment: DeploymentEnvironment;
}

/**
 * Parses the PostHog host the way the site does: an absolute http(s) URL
 * without credentials whose hostname is not the app's own, so events never
 * go to the app origin. Returns the origin, or `null` when unusable.
 */
export const parsePostHogHost = (
  value: string | undefined,
  appHostname: string | undefined
): string | null => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "" || !URL.canParse(trimmed)) {
    return null;
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (appHostname !== undefined && url.hostname === appHostname) return null;
  return url.origin;
};

/**
 * The build's analytics settings, or `null` when the PostHog key or host is
 * missing or unusable, which leaves analytics off.
 */
export const resolveAnalyticsSettings = ({
  apiKey,
  host,
  appHostname,
  environment,
}: {
  readonly apiKey: string | undefined;
  readonly host: string | undefined;
  readonly appHostname: string | undefined;
  readonly environment: DeploymentEnvironment;
}): AnalyticsSettings | null => {
  const key = apiKey?.trim();
  if (key === undefined || key === "") return null;
  const origin = parsePostHogHost(host, appHostname);
  return origin === null ? null : { apiKey: key, host: origin, environment };
};
