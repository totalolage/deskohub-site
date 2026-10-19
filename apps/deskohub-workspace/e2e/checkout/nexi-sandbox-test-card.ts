/**
 * The Nexi sandbox test card the hosted-page driver enters. Agent evals give
 * the same card to the agent in the payment task's text.
 */
export const nexiSandboxTestCard = {
  number: "4509034543615006",
  cvv: "298",
  /** `MMYY`, as the hosted page's expiry field takes it. */
  expiry: "1028",
} as const;
