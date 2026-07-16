"use server";

import { Schema } from "effect";
import { loadWorkspaceAvailability } from "@/features/reservation/backend/workspace-availability.server";
import {
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityQuerySchema,
} from "@/features/reservation/workspace-availability";

const parseWorkspaceAvailabilityQuery = Schema.decodeUnknownSync(
  workspaceAvailabilityQuerySchema
);

export async function getWorkspaceAvailability(
  input: WorkspaceAvailabilityQuery
) {
  return loadWorkspaceAvailability(parseWorkspaceAvailabilityQuery(input));
}
