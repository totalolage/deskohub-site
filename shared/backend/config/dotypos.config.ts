import { Config } from "effect";

// Dotypos API configuration
export interface DotyposConfig {
  apiKey: string;
  cloudId: string;
  baseUrl: string;
}

// Create config from environment variables
export const DotyposConfigLive = Config.all({
  apiKey: Config.string("DOTYPOS_API_KEY"),
  cloudId: Config.string("DOTYPOS_CLOUD_ID"),
  baseUrl: Config.string("DOTYPOS_API_URL").pipe(
    Config.withDefault("https://api.dotypos.com/v2")
  ),
}).pipe(
  Config.map(
    (config): DotyposConfig => ({
      apiKey: config.apiKey,
      cloudId: config.cloudId,
      baseUrl: config.baseUrl,
    })
  )
);
