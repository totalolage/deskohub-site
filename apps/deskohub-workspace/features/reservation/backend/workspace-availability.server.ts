import "server-only";

import { Effect } from "effect";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { WorkspaceAvailabilityQuery } from "../workspace-availability";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";

export const loadWorkspaceAvailability = (query: WorkspaceAvailabilityQuery) =>
  WorkspaceEffect.run(
    {
      operation: "workspace.availability.load",
      layer: WorkspaceAvailabilityService.LiveWithDependencies,
    },
    Effect.gen(function* () {
      const service = yield* WorkspaceAvailabilityService;
      return yield* service.getAvailability(query);
    })
  );
