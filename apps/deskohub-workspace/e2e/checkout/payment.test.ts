import { expect, mock, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { browserDiagnosticsScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";
import {
  startCheckoutPaymentAttempt,
  submitCheckoutPayment,
  submitPaymentAndWaitForHostedPage,
  submitReservationForPayPage,
} from "./payment";

const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
const checkoutUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/reservation/cowork";

test("submits a non-provider checkout without waiting for a hosted-payment link", async () => {
  let focusedRef: string | undefined;
  let snapshotReads = 0;
  const activatedRefs: string[] = [];
  const run = mock<Runner>(async (_command, args) => {
    const browserArgs = args.slice(2);
    const commandIndex = browserArgs.findIndex((arg) =>
      ["focus", "press", "snapshot", "tab", "wait"].includes(arg)
    );
    const commandArgs = browserArgs.slice(commandIndex);

    if (commandArgs[0] === "tab") {
      return success(
        JSON.stringify({
          data: { tabs: [{ active: true, tabId: "checkout" }] },
          success: true,
        })
      );
    }
    if (commandArgs[0] === "wait") return success();
    if (commandArgs[0] === "snapshot") {
      snapshotReads += 1;
      if (snapshotReads > 2) {
        throw new Error("non-provider checkout requested a provider link");
      }
      return success(
        [
          '- checkbox "I agree to the terms" [checked=false, ref=e2]',
          '- button "ORDER AND PAY" [ref=e5]',
        ].join("\n")
      );
    }
    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }
    if (commandArgs[0] === "press") {
      activatedRefs.push(focusedRef ?? "");
      return success();
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  });

  expect(
    await Effect.runPromise(submitCheckoutPayment(run, "non-provider"))
  ).toBe("checkout");
  expect(activatedRefs).toEqual(["@e2", "@e5"]);
});

test("supports hosted payment in the checkout tab when the popup is blocked", async () => {
  let focusedRef: string | undefined;
  let hostedPaymentStarted = false;
  const run = mock<Runner>(async (_command, args) => {
    const browserArgs = args.slice(2);
    const commandIndex = browserArgs.findIndex((arg) =>
      ["eval", "focus", "get", "press", "snapshot", "tab", "wait"].includes(arg)
    );
    const commandArgs = browserArgs.slice(commandIndex);

    if (commandArgs[0] === "eval") return success("true");
    if (commandArgs[0] === "wait") return success();
    if (commandArgs[0] === "tab" && commandArgs[1] === "list") {
      return success(
        JSON.stringify({
          data: { tabs: [{ active: true, tabId: "checkout" }] },
          success: true,
        })
      );
    }
    if (commandArgs[0] === "tab") {
      throw new Error("single-tab payment must not switch tabs");
    }
    if (commandArgs[0] === "snapshot") {
      return success(
        [
          '- checkbox "I agree to the terms" [checked=false, ref=e2]',
          '- button "ORDER AND PAY" [ref=e5]',
        ].join("\n")
      );
    }
    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }
    if (commandArgs[0] === "press") {
      if (focusedRef === "@e5") hostedPaymentStarted = true;
      return success();
    }
    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      return success(
        hostedPaymentStarted
          ? "https://xpay.nexigroup.com/hpp/nexi/test"
          : "https://workspace.example/en-US/checkout/pay"
      );
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  });

  expect(
    await Effect.runPromise(
      submitPaymentAndWaitForHostedPage({
        run,
        session: "single-tab",
        timeouts: workspaceE2ETimeouts,
      })
    )
  ).toEqual({
    checkoutPageUrl: "https://workspace.example/en-US/checkout/pay",
    checkoutTabId: "checkout",
    hostedPaymentTabId: "checkout",
    url: "https://xpay.nexigroup.com/hpp/nexi/test",
  });
});

test("retries a transient reservation preparation failure without requiring non-applicable consent", async () => {
  let reservationSubmitAttempts = 0;
  let hostedPaymentStarted = false;
  let activeTabId = "t1";
  const activatedRefs: string[] = [];
  const clickedRefs: string[] = [];
  const switchedTabs: string[] = [];
  let focusedRef: string | undefined;
  const submitReservationScript = "submit-reservation";
  const run = mock<Runner>(async (_command, args, options = {}) => {
    const browserArgs = args.slice(2);
    const commandIndex = browserArgs.findIndex((arg) =>
      [
        "click",
        "eval",
        "focus",
        "get",
        "open",
        "press",
        "snapshot",
        "tab",
        "wait",
      ].includes(arg)
    );
    const commandArgs = browserArgs.slice(commandIndex);

    if (commandArgs[0] === "open") return success();
    if (commandArgs[0] === "wait") return success();

    if (commandArgs[0] === "tab" && commandArgs[1] === "list") {
      return success(
        JSON.stringify({
          data: {
            tabs: [
              { active: activeTabId === "t1", tabId: "t1" },
              ...(hostedPaymentStarted
                ? [{ active: activeTabId === "t2", tabId: "t2" }]
                : []),
            ],
          },
          success: true,
        })
      );
    }

    if (commandArgs[0] === "tab") {
      activeTabId = commandArgs[1] ?? activeTabId;
      switchedTabs.push(activeTabId);
      return success();
    }

    if (
      commandArgs[0] === "eval" &&
      options.input?.includes(submitReservationScript)
    ) {
      reservationSubmitAttempts += 1;
      return success();
    }

    if (
      commandArgs[0] === "eval" &&
      options.input?.includes("__deskohubWorkspaceE2EPreparation")
    ) {
      return success(JSON.stringify({ status: "ready" }));
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      if (hostedPaymentStarted && activeTabId === "t2")
        return success("https://xpay.nexigroup.com/hpp/nexi/test");
      if (hostedPaymentStarted)
        return success(
          `https://workspace.example/en-US/reservation/status/${orderId}`
        );
      if (reservationSubmitAttempts > 1)
        return success(
          `${checkoutUrl.replace("/reservation/cowork", "/checkout/pay")}?orderId=${orderId}`
        );
      return success(checkoutUrl);
    }

    if (
      commandArgs[0] === "eval" &&
      options.input === browserDiagnosticsScript
    ) {
      return success(
        JSON.stringify({
          body: "Checkout could not be started. Please check your details and try again.",
          submitDisabled: false,
          submitText: "Continue",
          title: "Workspace reservation | Deskohub Workspace",
          url: checkoutUrl,
        })
      );
    }

    if (commandArgs[0] === "snapshot") {
      return success(
        [
          '- LabelText "I agree to the terms" [ref=e1] clickable [cursor:pointer]',
          '  - checkbox "I agree to the terms" [checked=false, ref=e2]',
          '- button "ORDER AND PAY" [ref=e5]',
        ].join("\n")
      );
    }

    if (commandArgs[0] === "click") {
      clickedRefs.push(commandArgs[1] ?? "");
      activatedRefs.push(commandArgs[1] ?? "");
      if (commandArgs[1] === "@e5") {
        hostedPaymentStarted = true;
        activeTabId = "t2";
      }
      return success();
    }

    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }

    if (commandArgs[0] === "press") {
      activatedRefs.push(focusedRef ?? "");
      if (focusedRef === "@e5") {
        hostedPaymentStarted = true;
        activeTabId = "t2";
      }
      return success();
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  });

  const result = await Effect.runPromise(
    startCheckoutPaymentAttempt({
      config: makeConfig(),
      data: makeCheckoutData(),
      run,
      session: "test-session",
      submitReservationScript,
    })
  );

  expect(result).toBe(orderId);
  expect(reservationSubmitAttempts).toBe(2);
  expect(clickedRefs).toEqual([]);
  expect(activatedRefs).toEqual([
    "#reservation-submit",
    "#reservation-submit",
    "@e2",
    "@e5",
  ]);
  expect(switchedTabs).toEqual(["t1", "t2"]);
});

test("detaches long reservation preparation from one Playwright evaluation", async () => {
  const submitReservationScript = "new Promise(() => undefined)";
  let focusedRef: string | undefined;
  let preparationKickoffs = 0;
  let preparationStateReads = 0;
  let reservationSubmitActivations = 0;
  let reservationSubmitted = false;
  const hydrationOrder: string[] = [];
  const run = mock<Runner>(async (_command, args, options = {}) => {
    const commandArgs = args.slice(2);

    if (commandArgs[0] === "eval") {
      if (options.input === submitReservationScript) {
        throw new Error("Playwright evaluation timed out");
      }
      if (options.input?.includes(submitReservationScript)) {
        preparationKickoffs += 1;
        hydrationOrder.push("prepare");
        return success();
      }
      if (options.input?.includes("__deskohubWorkspaceE2EPreparation")) {
        preparationStateReads += 1;
        return success(
          serializeBrowserStateResult(options.input, { status: "ready" })
        );
      }
    }

    if (commandArgs[0] === "wait") {
      if (commandArgs.join(" ").includes("__reactProps$")) {
        hydrationOrder.push("hydration");
      }
      return success();
    }
    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }
    if (commandArgs[0] === "press") {
      if (focusedRef === "#reservation-submit") {
        reservationSubmitActivations += 1;
        reservationSubmitted = true;
      }
      return success();
    }
    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      return success(
        reservationSubmitted
          ? `${checkoutUrl.replace("/reservation/cowork", "/checkout/pay")}?orderId=${orderId}`
          : checkoutUrl
      );
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  });

  const result = await Effect.runPromise(
    submitReservationForPayPage({
      run,
      session: "detached-preparation",
      submitReservationScript,
      timeouts: workspaceE2ETimeouts,
    })
  );

  expect(result).toBe(orderId);
  expect(preparationKickoffs).toBe(1);
  expect(preparationStateReads).toBe(1);
  expect(reservationSubmitActivations).toBe(1);
  expect(hydrationOrder.slice(0, 2)).toEqual(["hydration", "prepare"]);
});

test("preserves a detached reservation preparation failure without submitting", async () => {
  const submitReservationScript =
    "Promise.reject(new Error('advertised price failed'))";
  let reservationSubmitActivations = 0;
  const run = mock<Runner>(async (_command, args, options = {}) => {
    const commandArgs = args.slice(2);

    if (
      commandArgs[0] === "eval" &&
      options.input?.includes(submitReservationScript)
    ) {
      return success();
    }
    if (
      commandArgs[0] === "eval" &&
      options.input?.includes("__deskohubWorkspaceE2EPreparation")
    ) {
      return success(
        JSON.stringify({ error: "advertised price failed", status: "failed" })
      );
    }
    if (commandArgs[0] === "wait") return success();
    if (commandArgs[0] === "focus") {
      reservationSubmitActivations += 1;
      return success();
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  });

  const exit = await Effect.runPromiseExit(
    submitReservationForPayPage({
      run,
      session: "failed-detached-preparation",
      submitReservationScript,
      timeouts: workspaceE2ETimeouts,
    })
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(String(Cause.squash(exit.cause))).toContain(
      "advertised price failed"
    );
  }
  expect(reservationSubmitActivations).toBe(0);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const serializeBrowserStateResult = (
  script: string | undefined,
  state: unknown
) =>
  JSON.stringify(
    script?.includes("JSON.stringify(") ? JSON.stringify(state) : state
  );

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});

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
