/**
 * BotID is an application-level production control. Preview and development
 * deployments rely on their own access controls and must not initialize BotID.
 *
 * @param {unknown} vercelEnvironment
 */
export const isWorkspaceBotIdEnforced = (vercelEnvironment) =>
  vercelEnvironment === "production";

/**
 * @param {unknown} vercelEnvironment
 * @param {() => void} initialize
 */
export const initializeWorkspaceBotId = (vercelEnvironment, initialize) => {
  if (isWorkspaceBotIdEnforced(vercelEnvironment)) initialize();
};

/**
 * @param {import("next").NextConfig} config
 * @param {unknown} vercelEnvironment
 * @param {(config: import("next").NextConfig) => import("next").NextConfig} configure
 */
export const configureWorkspaceBotId = (
  config,
  vercelEnvironment,
  configure
) => (isWorkspaceBotIdEnforced(vercelEnvironment) ? configure(config) : config);
