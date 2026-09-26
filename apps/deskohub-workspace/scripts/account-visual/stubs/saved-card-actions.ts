import {
  recordUnavailableActionInvocation,
  unavailableActionMessage,
} from "./account-actions";

const unavailable = async () => ({
  serverError: unavailableActionMessage,
});

export const startSavedCardEnrollment = async () => {
  recordUnavailableActionInvocation();
  return unavailable();
};

export const removeSavedCard = async (_input: {
  readonly contractId: string;
}) => {
  recordUnavailableActionInvocation();
  return unavailable();
};
