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

const productionService = () =>
  IgloohomeService.Live.pipe(
    Layer.provide(
      Layer.succeed(
        IgloohomeRuntimeConfig,
        IgloohomeRuntimeConfig.of({
          apiUrl: env.IGLOOHOME_API_URL,
          authUrl: env.IGLOOHOME_AUTH_URL,
          clientId: Schema.decodeUnknownSync(Schema.NonEmptyString)(
            env.IGLOOHOME_CLIENT_ID
          ),
          clientSecret: Schema.decodeUnknownSync(Schema.NonEmptyString)(
            env.IGLOOHOME_CLIENT_SECRET
          ),
          apiTimeout: env.IGLOOHOME_API_TIMEOUT,
        })
      )
    )
  );

export const WorkspaceIgloohomeLayer =
  env.VERCEL_ENV === "production" ? productionService() : fixtureService;
