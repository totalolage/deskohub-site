import { Layer } from "effect";
import { AccountFeatureFlagService } from "./account-feature-flag.service";

export const AccountFeatureFlagServiceMock = Layer.mock(
  AccountFeatureFlagService
);
