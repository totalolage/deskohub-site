"use server";

import { Schema } from "effect";
import { loadWorkspaceAvailability } from "@/features/reservation/backend/workspace-availability.server";
import {
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityQueryEffectSchema,
} from "@/features/reservation/workspace-availability";

const parseWorkspaceAvailabilityQuery = Schema.decodeUnknownSync(
  workspaceAvailabilityQueryEffectSchema
);

export async function getWorkspaceAvailability(
  input: WorkspaceAvailabilityQuery
) {
  return loadWorkspaceAvailability(parseWorkspaceAvailabilityQuery(input));
}
