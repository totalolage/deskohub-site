import { Config, Layer, Option } from "effect";
import type { EmailConfig, EmailRecipient } from "../types/email.types";
import { EmailConfigTag } from "./capabilities";

/** Shared delivery configuration for every app: the sender and Resend key. */
export const makeEmailConfigLayer = (
  defaultFrom: Config.Config<EmailRecipient>
) =>
  Layer.effect(
    EmailConfigTag,
    Config.all({
      defaultFrom,
      apiKey: Config.option(Config.string("EMAIL_API_KEY")),
    }).pipe(
      Config.map(
        ({ defaultFrom, apiKey }): EmailConfig => ({
          defaultFrom,
          apiKey: Option.getOrUndefined(apiKey),
        })
      )
    )
  );
