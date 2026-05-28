import "server-only";

import { notFound } from "next/navigation";
import { env } from "@/env";

export function requireWorkspaceTestingOnlyAccess() {
  if (env.VERCEL_ENV !== "production") {
    return;
  }

  notFound();
}
