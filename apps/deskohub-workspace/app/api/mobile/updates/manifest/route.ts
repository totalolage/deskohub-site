import { Effect } from "effect";
import { respondToManifestRequest } from "@/features/mobile-updates/backend/manifest-response";
import { MobileUpdatePublications } from "@/features/mobile-updates/backend/mobile-update-publications.service";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";

export const GET = defineWorkspaceRoute(
  {
    operation: "mobileUpdateManifest",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) =>
    respondToManifestRequest(request).pipe(
      Effect.provide(MobileUpdatePublications.Live)
    )
);
