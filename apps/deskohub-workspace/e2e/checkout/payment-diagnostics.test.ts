import { expect, test } from "bun:test";
import { Effect } from "effect";
import { isWorkspaceE2EDiagnosticCode, WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";
import { completeNexiHostedPayment } from "./payment";

const checkoutUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/reservation/cowork";

const hostedPaymentInitialSnapshot = [
  '- textbox "Card number" [ref=e1]',
  '- textbox "Expiration date" [ref=e2]',
  '- textbox "CVV" [ref=e3]',
  '- textbox "First Name" [ref=e4]',
  '- textbox "Email" [ref=e5]',
  '- button "CONTINUE" [ref=e6]',
].join("\n");

const hostedPaymentPaySnapshot = [
  '- textbox "Card number" [ref=e1]',
  '- textbox "Expiration date" [ref=e2]',
  '- textbox "CVV" [ref=e3]',
  '- textbox "First Name" [ref=e4]',
  '- textbox "Email" [ref=e5]',
  '- button "PAY" [ref=e7]',
].join("\n");

const hostedPaymentChallengeSnapshot = [
  '- textbox "Card number" [ref=e1]',
  '- textbox "Expiration date" [ref=e2]',
  '- textbox "CVV" [ref=e3]',
  '- textbox "First Name" [ref=e4]',
  '- textbox "Email" [ref=e5]',
  '- button "Authentication successful" [ref=e8]',
].join("\n");

const hostedPaymentReturnSnapshot = [
  '- textbox "Card number" [ref=e1]',
  '- textbox "Expiration date" [ref=e2]',
  '- textbox "CVV" [ref=e3]',
  '- textbox "First Name" [ref=e4]',
  '- textbox "Email" [ref=e5]',
  '- button "Back to the shop" [ref=e9]',
].join("\n");

const runHostedPaymentFailure = async (options: {
  readonly afterContinueSnapshot: string;
  readonly failContextSnapshot?: boolean;
  readonly failContinueActivation?: boolean;
  readonly failureTarget?: "pay" | "challenge" | "return";
}) => {
  const values = new Map<string, string>();
  let focusedRef: string | undefined;
  let stage: "continue" | "pay" | "challenge" | "return" = "continue";
  let afterContinueSnapshotReads = 0;
  let continueTransitionPending = false;
  const run: Runner = async (_command, args) => {
    const commandArgs = args.slice(2);
    if (commandArgs[0] === "snapshot") {
      if (stage === "continue") return success(hostedPaymentInitialSnapshot);
      afterContinueSnapshotReads += 1;
      if (options.failContextSnapshot && afterContinueSnapshotReads > 2)
        throw new Error("synthetic snapshot read failure");
      if (stage === "pay") {
        if (continueTransitionPending) {
          continueTransitionPending = false;
          return success(hostedPaymentPaySnapshot);
        }
        return success(
          options.failureTarget === undefined || options.failureTarget === "pay"
            ? options.afterContinueSnapshot
            : hostedPaymentPaySnapshot
        );
      }
      if (stage === "challenge") return success(hostedPaymentChallengeSnapshot);
      return success(hostedPaymentReturnSnapshot);
    }
    if (commandArgs[0] === "fill") {
      values.set(commandArgs[1] ?? "", commandArgs[2] ?? "synthetic-value");
      return success();
    }
    if (commandArgs[0] === "get" && commandArgs[1] === "value")
      return success(values.get(commandArgs[2] ?? "") ?? "");
    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }
    if (commandArgs[0] === "press" && focusedRef === "@e6") {
      if (options.failContinueActivation)
        throw new Error("synthetic optional Continue activation failure");
      stage = "pay";
      continueTransitionPending = true;
    }
    if (commandArgs[0] === "press" && focusedRef === "@e7") stage = "challenge";
    if (
      commandArgs[0] === "click" &&
      commandArgs[1] === "@e8" &&
      options.failureTarget === "return"
    )
      stage = "return";
    return success();
  };

  const failure = await Effect.runPromise(
    completeNexiHostedPayment({
      data: makeCheckoutData(),
      run,
      session: "diagnostic-test",
      timeouts: { ...workspaceE2ETimeouts, providerTransition: 1 },
    })
  ).then(
    () => {
      throw new Error("expected hosted payment to fail at the Pay target");
    },
    (cause) => cause
  );

  return { afterContinueSnapshotReads, failure };
};

test.each([
  [
    "card entry incomplete",
    [
      '- textbox "Card number" [ref=e1]',
      '- textbox "Expiration date" [disabled] [ref=e2]',
      '- textbox "CVV" [disabled] [ref=e3]',
      '- textbox "First Name" [ref=e4]',
      '- textbox "Email" [ref=e5]',
      '- button "CONTINUE" [ref=e6]',
      '- textbox "Pay https://private.example.test/access?token=synthetic-secret" [ref=e10]',
    ].join("\n"),
    "nexi_hosted_pay_card_entry_incomplete",
  ],
  [
    "pay button enabled but not advancing",
    [
      '- textbox "Card number" [ref=e1]',
      '- textbox "Expiration date" [ref=e2]',
      '- textbox "CVV" [ref=e3]',
      '- textbox "First Name" [ref=e4]',
      '- textbox "Email" [ref=e5]',
      '- button "PAY" [ref=e8]',
    ].join("\n"),
    "nexi_hosted_pay_pay_enabled",
  ],
  [
    "pay button disabled",
    [
      '- textbox "Card number" [ref=e1]',
      '- textbox "Expiration date" [ref=e2]',
      '- textbox "CVV" [ref=e3]',
      '- button "PAY" [disabled] [ref=e8]',
    ].join("\n"),
    "nexi_hosted_pay_pay_disabled",
  ],
  [
    "arbitrary field values do not imply a known button",
    [
      '- textbox "Pay https://private.example.test/access?token=synthetic-secret" [ref=e10]',
      '- button "Payment page ready; pay later" [ref=e11]',
    ].join("\n"),
    "nexi_hosted_pay_unknown",
  ],
] as const)(
  "codes hosted payment failure state: %s",
  async (_name, snapshot, code) => {
    const { failure } = await runHostedPaymentFailure({
      afterContinueSnapshot: snapshot,
    });

    expect(failure).toBeInstanceOf(WorkspaceE2EError);
    if (!(failure instanceof WorkspaceE2EError))
      throw new Error("expected a Workspace E2E error");
    expect(failure.diagnosticCode).toBe(code);
    expect(isWorkspaceE2EDiagnosticCode(failure.diagnosticCode)).toBe(true);
    expect(failure.operation).toBe("click Nexi pay");
    expect(failure.diagnosticCode).not.toContain("private.example.test");
    expect(failure.diagnosticCode).not.toContain("synthetic-secret");
  }
);

test("keeps optional Continue activation failure nonfatal", async () => {
  const { failure } = await runHostedPaymentFailure({
    afterContinueSnapshot: hostedPaymentPaySnapshot,
    failContinueActivation: true,
  });

  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError))
    throw new Error("expected the required Pay step to fail");
  expect(failure.diagnosticCode).toBe("nexi_hosted_pay_card_entry_ready");
  expect(failure.operation).toBe("click Nexi pay");
});

test.each([
  ["challenge", "nexi_hosted_challenge_challenge_enabled"],
  ["return", "nexi_hosted_return_return_enabled"],
] as const)(
  "codes the hosted payment %s target failure",
  async (failureTarget, code) => {
    const { failure } = await runHostedPaymentFailure({
      afterContinueSnapshot: hostedPaymentPaySnapshot,
      failureTarget,
    });

    expect(failure).toBeInstanceOf(WorkspaceE2EError);
    if (!(failure instanceof WorkspaceE2EError))
      throw new Error("expected a Workspace E2E error");
    expect(failure.diagnosticCode).toBe(code);
    expect(isWorkspaceE2EDiagnosticCode(failure.diagnosticCode)).toBe(true);
  }
);

test("retains the Pay timeout when its existing context snapshot read fails", async () => {
  const { afterContinueSnapshotReads, failure } = await runHostedPaymentFailure(
    {
      afterContinueSnapshot: '- textbox "Card number" [ref=e1]',
      failContextSnapshot: true,
    }
  );

  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError))
    throw new Error("expected a Workspace E2E error");
  expect(failure.diagnosticCode).toBe("nexi_hosted_pay_snapshot_unavailable");
  expect(failure.operation).toBe("Nexi target PAY / Pay / PAGA");
  expect(failure.reason).toBe("timeout");
  expect(afterContinueSnapshotReads).toBe(3);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const makeCheckoutData = (): CheckoutData => ({
  checkoutUrl,
  date: "2099-08-04",
  email: "workspace-e2e@example.com",
  expectedReservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  message: "Workspace E2E",
  name: "Workspace E2E",
  orderIdHint: "workspace-e2e",
  phone: "+420700000000",
});
