import { Layer } from "effect";
import { EmailProviderLive } from "./provider-factory";
import { EmailServiceLive } from "./service";
import { EmailTemplateServiceLive } from "./template-service";

export const StandaloneEmailServiceLayer = EmailServiceLive.pipe(
  Layer.provide(Layer.mergeAll(EmailTemplateServiceLive, EmailProviderLive))
);
