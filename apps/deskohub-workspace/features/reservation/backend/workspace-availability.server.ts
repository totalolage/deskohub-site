import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import type { WorkspaceAvailabilityQuery } from "../workspace-availability";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";

export const loadWorkspaceAvailability = (query: WorkspaceAvailabilityQuery) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceAvailabilityService;
    return yield* service.getAvailability(query);
  }).pipe(
    Effect.provide(WorkspaceAvailabilityService.LiveWithDependencies),
    runWorkspaceEffect
  );
