import { NexiRuntimeConfig } from "@deskohub/nexi/config";
import { Layer } from "effect";
import { env } from "@/env";

export const NexiRuntimeConfigLive = Layer.succeed(NexiRuntimeConfig, {
  baseUrl: env.NEXI_API_ORIGIN,
  apiKey: env.NEXI_API_KEY,
  apiTimeout: 30_000,
});
