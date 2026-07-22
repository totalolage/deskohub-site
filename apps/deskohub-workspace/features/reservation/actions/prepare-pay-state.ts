"use server";

import {
  PreparePayStateLive,
  preparePayStateSchema,
  prepareWorkspacePayState,
} from "@/features/reservation/actions/prepare-pay-state-workflow";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const preparePayStateAction = WorkspaceEffect.action(
  {
    operation: "checkout.prepare-pay-state",
    schema: preparePayStateSchema,
    layer: PreparePayStateLive,
  },
  ({ parsedInput }) => prepareWorkspacePayState(parsedInput)
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => {
  return await preparePayStateAction(...args);
};
