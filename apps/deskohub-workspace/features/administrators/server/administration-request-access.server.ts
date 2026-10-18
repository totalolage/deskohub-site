import "server-only";

import { Effect } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import { currentAdministratorAccess } from "../backend/current-administrator";
import { administratorAccessLayer } from "./administrator-access-layer.server";

/**
 * The proxy's runtime edge for {@link currentAdministratorAccess}: who an
 * administration page request acts as, read from its own headers. Pages
 * stream behind a static shell, so the proxy has to refuse a signed-in
 * account without the grant before the shell is sent; the page guards still
 * check again.
 */
export const readAdministrationRequestAccess = (headers: Headers) =>
  currentAdministratorAccess.pipe(
    Effect.map((access) => access.kind),
    Effect.provide(administratorAccessLayer),
    withWorkspaceRequestContext(headers),
    runWorkspaceEffect("administrator.request-access", { boundary: "route" })
  );
