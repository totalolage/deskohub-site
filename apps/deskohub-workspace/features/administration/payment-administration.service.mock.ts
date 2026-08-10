import { Layer } from "effect";
import { PaymentAdministrationService } from "./payment-administration.service";

export const PaymentAdministrationServiceMock = Layer.mock(
  PaymentAdministrationService
);
