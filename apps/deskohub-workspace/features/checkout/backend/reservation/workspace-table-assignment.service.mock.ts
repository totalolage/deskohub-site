import { Layer } from "effect";
import { WorkspaceTableAssignmentService } from "./workspace-table-assignment.service";

export const WorkspaceTableAssignmentServiceMock = Layer.mock(
  WorkspaceTableAssignmentService
);
