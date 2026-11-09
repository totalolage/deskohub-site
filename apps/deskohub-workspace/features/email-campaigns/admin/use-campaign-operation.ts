"use client";

import type {
  CampaignOperationName,
  CampaignOperations,
  OperationInput,
  OperationOutput,
} from "@deskohub/workspace-admin-api";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  type CampaignOperationFailureCopy,
  describeCampaignOperationFailure,
} from "./campaign-operation-failure";
import {
  type CampaignOperationRequestSchema,
  type CampaignOperationResult,
  type CampaignOperationValidationErrors,
  runCampaignOperation,
} from "./campaign-operations.actions";

/**
 * Runs one campaign operation from a client component. Every failure, the
 * port's or the action runtime's, reaches `onFailure` as admin copy in the
 * route locale.
 */
export function useCampaignOperation<Name extends CampaignOperationName>(
  operation: Name,
  {
    failureCopy,
    onSuccess,
    onFailure,
  }: {
    readonly failureCopy: CampaignOperationFailureCopy;
    readonly onSuccess?: (
      output: OperationOutput<CampaignOperations[Name]>,
      input: OperationInput<CampaignOperations[Name]>
    ) => void;
    /** `failure` carries the port's `code` when the port refused the call. */
    readonly onFailure: (
      message: string,
      failure?: { readonly code: string }
    ) => void;
  }
) {
  const locale = useRouteLocale();
  const action = useWorkspaceAction<
    string,
    CampaignOperationRequestSchema<Name>,
    CampaignOperationValidationErrors<Name>,
    CampaignOperationResult<Name>
  >(runCampaignOperation<Name>, {
    onSuccess: ({ data, input }) => {
      if (data?._tag === "Success") onSuccess?.(data.output, input.input);
      if (data?._tag === "Failure") {
        onFailure(
          describeCampaignOperationFailure(data, failureCopy, locale),
          data
        );
      }
    },
    onError: ({ error }) =>
      onFailure(error.serverError ?? failureCopy.fallback(locale)),
    onTransportError: () => onFailure(failureCopy.fallback(locale)),
  });

  return {
    execute: (input: OperationInput<CampaignOperations[Name]>) =>
      action.execute({ operation, input }),
    isExecuting: action.isExecuting,
  };
}
