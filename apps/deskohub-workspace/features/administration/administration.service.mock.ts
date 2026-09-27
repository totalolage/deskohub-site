import { Layer } from "effect";
import { AdministrationService } from "./administration.service";

export const AdministrationServiceMock = Layer.mock(AdministrationService);
