import { NexiRuntimeConfig, NexiService } from "@deskohub/nexi";
import { Layer } from "effect";
import { env } from "@/env";

export const NexiRuntimeConfigLive = Layer.succeed(NexiRuntimeConfig, {
  baseUrl: env.NEXI_API_ORIGIN,
  apiKey: env.NEXI_API_KEY,
  apiTimeout: 5_000,
});

export const NexiServiceLive = NexiService.Default.pipe(
  Layer.provide(NexiRuntimeConfigLive)
);
