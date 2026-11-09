import { Effect } from "effect";
import { AuthCleanupService } from "@/features/account/backend/auth/auth-cleanup.service";
import { defineWorkspaceCron } from "@/shared/backend/service-route";

export const GET = defineWorkspaceCron({
  operation: "authCleanupCron",
  failureMessage: "Customer account cleanup failed",
  input: () => ({ now: new Date() }),
  run: (input) =>
    Effect.flatMap(AuthCleanupService, (cleanup) =>
      cleanup.deleteExpiredRows(input)
    ).pipe(Effect.provide(AuthCleanupService.Live)),
});
