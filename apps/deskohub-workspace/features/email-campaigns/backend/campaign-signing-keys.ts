import "server-only";

import { hkdfSync } from "node:crypto";
import { Array as Arr, Config, Effect, Match } from "effect";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import { CampaignSigningKeyInvalid } from "../errors";

/**
 * Derives one key per `BETTER_AUTH_SECRETS` entry for a campaign signing
 * purpose, the signing entry first. Keys for different purposes never
 * coincide, so a confirmation-code hash can't double as an unsubscribe
 * signature.
 */
export const loadCampaignSigningKeys = (
  purpose: "confirmation-code" | "unsubscribe-token"
) =>
  Config.string("BETTER_AUTH_SECRETS").pipe(
    Effect.map(parseBetterAuthSecrets),
    Effect.flatMap((secrets) =>
      Match.value(secrets).pipe(
        Match.discriminatorsExhaustive("kind")({
          valid: ({ secrets: entries }) =>
            Effect.succeed(
              Arr.map(entries, ({ value }) =>
                Buffer.from(
                  hkdfSync(
                    "sha256",
                    value,
                    Buffer.alloc(0),
                    `deskohub-workspace/email-campaign-${purpose}`,
                    32
                  )
                )
              )
            ),
          invalid: ({ message }) =>
            Effect.fail(new CampaignSigningKeyInvalid({ message })),
        })
      )
    )
  );
