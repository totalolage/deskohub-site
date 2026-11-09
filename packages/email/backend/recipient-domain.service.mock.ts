import { Layer } from "effect";
import { EmailRecipientDomainService } from "./recipient-domain.service";

export const EmailRecipientDomainServiceMock = Layer.mock(
  EmailRecipientDomainService
);
