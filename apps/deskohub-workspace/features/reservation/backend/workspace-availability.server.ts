import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import type { WorkspaceAvailabilityQuery } from "../schemas/workspace-availability";
import {
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLiveWithDependencies,
} from "./workspace-availability.service";

export const loadWorkspaceAvailability = (query: WorkspaceAvailabilityQuery) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceAvailabilityService;
    return yield* service.getAvailability(query);
  }).pipe(
    Effect.provide(WorkspaceAvailabilityServiceLiveWithDependencies),
    runWorkspaceEffect
  );
