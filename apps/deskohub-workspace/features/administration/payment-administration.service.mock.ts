import { Layer } from "effect";
import { NexiAdministrationService } from "./payment-administration.service";

export const NexiAdministrationServiceMock = Layer.mock(
  NexiAdministrationService
);
