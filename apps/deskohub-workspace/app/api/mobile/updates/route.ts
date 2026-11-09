import { Effect } from "effect";
import { MobileUpdatePublications } from "@/features/mobile-updates/backend/mobile-update-publications.service";
import { publishMobileUpdate } from "@/features/mobile-updates/backend/publish-mobile-update";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

export const POST = defineWorkspaceRoute(
  {
    operation: "publishMobileUpdate",
    cancellation: "continue-after-disconnect",
    caller: "service",
  },
  (request) =>
    publishMobileUpdate(request).pipe(
      Effect.provide(MobileUpdatePublications.Live)
    )
);
