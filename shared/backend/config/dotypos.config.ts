import { Config } from "effect";

// Dotypos API configuration
export interface DotyposConfig {
  apiKey: string;
  cloudId: string;
  baseUrl: string;
  branchId?: number;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// Create config from environment variables
export const DotyposConfigLive = Config.all({
  apiKey: Config.string("DOTYPOS_API_KEY").pipe(
    Config.withDefault("") // Will be obtained dynamically
  ),
  cloudId: Config.string("DOTYPOS_CLOUD_ID"),
  baseUrl: Config.string("DOTYPOS_API_URL").pipe(
    Config.withDefault("https://api.dotykacka.cz/v2")
  ),
  branchId: Config.number("DOTYPOS_BRANCH_ID").pipe(
    Config.withDefault(1),
    Config.map((n) => n as number | undefined)
  ),
  clientId: Config.string("DOTYPOS_CLIENT_ID"),
  clientSecret: Config.string("DOTYPOS_CLIENT_SECRET"),
  refreshToken: Config.string("DOTYPOS_REFRESH_TOKEN"),
}).pipe(
  Config.map(
    (config): DotyposConfig => ({
      apiKey: config.apiKey,
      cloudId: config.cloudId,
      baseUrl: config.baseUrl,
      branchId: config.branchId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    })
  )
);
