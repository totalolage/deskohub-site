import {
  AlgoPinSchema,
  IgloohomePinIdSchema,
  IgloohomeRuntimeConfig,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Effect, Layer, Schema } from "effect";
import { env } from "@/env";

const decodeFixturePin = Schema.decodeUnknownSync(AlgoPinSchema);
const decodeFixturePinId = Schema.decodeUnknownSync(IgloohomePinIdSchema);

const fixtureService = Layer.succeed(
  IgloohomeService,
  IgloohomeService.of({
    issueHourlyAlgoPin: ({ accessName }) =>
      Effect.succeed({
        pin: decodeFixturePin("1111111"),
        pinId: decodeFixturePinId(`fixture-${accessName}`),
      }),
  })
);

const liveConfig = Layer.succeed(
  IgloohomeRuntimeConfig,
  IgloohomeRuntimeConfig.of({
    apiUrl: env.IGLOOHOME_API_URL,
    authUrl: env.IGLOOHOME_AUTH_URL,
    clientId: env.IGLOOHOME_CLIENT_ID,
    clientSecret: env.IGLOOHOME_CLIENT_SECRET,
    apiTimeout: env.IGLOOHOME_API_TIMEOUT,
  })
);

export const IgloohomeServiceLive =
  env.VERCEL_ENV === "production"
    ? IgloohomeService.Default.pipe(Layer.provide(liveConfig))
    : fixtureService;
