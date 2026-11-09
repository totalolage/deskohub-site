import { Layer } from "effect";
import { WorkspaceE2EAccountResourceService } from "./resources.service";

export const WorkspaceE2EAccountResourceServiceMock = Layer.mock(
  WorkspaceE2EAccountResourceService
);
