import { NexiRuntimeConfig, NexiService } from "@deskohub/nexi";
import { Layer } from "effect";
import { env } from "@/env";

export const WorkspaceNexiRuntimeConfigLayer = Layer.succeed(
  NexiRuntimeConfig,
  {
    baseUrl: env.NEXI_API_ORIGIN,
    apiKey: env.NEXI_API_KEY,
    apiTimeout: 5_000,
  }
);

export const WorkspaceNexiLayer = NexiService.Live.pipe(
  Layer.provide(WorkspaceNexiRuntimeConfigLayer)
);
