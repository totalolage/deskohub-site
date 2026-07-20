import { Layer } from "effect";
import { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";

export const WorkspaceFeatureFlagServiceMock = Layer.mock(
  WorkspaceFeatureFlagService
);
