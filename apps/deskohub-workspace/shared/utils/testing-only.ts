import "server-only";

import { notFound } from "next/navigation";
import { env } from "@/env";

export function requireWorkspaceTestingOnlyAccess() {
  if (env.NEXT_PUBLIC_WORKSPACE_ENV !== "production") {
    return;
  }

  notFound();
}
