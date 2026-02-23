import { Layer } from "effect";
import { EmailProviderLive } from "./provider-factory";
import { type EmailConfigTag, EmailServiceLive } from "./service";
import { EmailTemplateServiceLive } from "./template-service";

export const createStandaloneEmailServiceLayer = <E, R>(
  emailConfigLayer: Layer.Layer<EmailConfigTag, E, R>
) =>
  EmailServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        EmailTemplateServiceLive,
        EmailProviderLive,
        emailConfigLayer
      )
    )
  );
