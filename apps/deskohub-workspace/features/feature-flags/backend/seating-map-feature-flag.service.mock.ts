import { Layer } from "effect";
import { SeatingMapFeatureFlagService } from "./seating-map-feature-flag.service";

export const SeatingMapFeatureFlagServiceMock = Layer.mock(
  SeatingMapFeatureFlagService
);
