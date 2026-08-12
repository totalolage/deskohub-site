import { expect, mock, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { browserDiagnosticsScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";
import {
  completeNexiHostedPayment,
  startCheckoutPaymentAttempt,
  submitReservationForPayPage,
} from "./payment";

const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
const checkoutUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/reservation/cowork";

test("retries a transient reservation preparation failure without requiring non-applicable consent", async () => {
  let reservationSubmitAttempts = 0;
  let hostedPaymentStarted = false;
  let activeTabId = "t1";
  const activatedRefs: string[] = [];
  const clickedRefs: string[] = [];
  const switchedTabs: string[] = [];
  let focusedRef: string | undefined;
  const submitReservationScript = "submit-reservation";
  const run = mock(async (_command, args, options = {}) => {
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
  }) as unknown as Runner;

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
  const run = mock(async (_command, args, options = {}) => {
    const commandArgs = args.slice(2);

    if (commandArgs[0] === "eval") {
      if (options.input === submitReservationScript) {
        throw new Error("Playwright evaluation timed out");
      }
      if (options.input?.includes(submitReservationScript)) {
        preparationKickoffs += 1;
        return success();
      }
      if (options.input?.includes("__deskohubWorkspaceE2EPreparation")) {
        preparationStateReads += 1;
        return success(
          serializeBrowserStateResult(options.input, { status: "ready" })
        );
      }
    }

    if (commandArgs[0] === "wait") return success();
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
  }) as unknown as Runner;

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
});

test("preserves a detached reservation preparation failure without submitting", async () => {
  const submitReservationScript =
    "Promise.reject(new Error('advertised price failed'))";
  let reservationSubmitActivations = 0;
  const run = mock(async (_command, args, options = {}) => {
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
    if (commandArgs[0] === "focus") {
      reservationSubmitActivations += 1;
      return success();
    }

    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  }) as unknown as Runner;

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

test("types into a hosted payment field when fill does not stick", async () => {
  const values = new Map<string, string>();
  let cardFillAttempts = 0;
  let cardSnapshotReads = 0;
  let cardTypeAttempts = 0;
  let currentFrame = "main";
  let focusedRef: string | undefined;
  let phase: "continue" | "pay" | "status" | "three-d-secure" = "continue";
  const run = mock(async (_command, args) => {
    const commandArgs = args.slice(2);

    if (commandArgs[0] === "snapshot") {
      if (currentFrame === "card") {
        cardSnapshotReads += 1;
        return success(
          cardSnapshotReads === 1
            ? '- textbox "Card number" [disabled, ref=e0]'
            : '- textbox "Card number" [ref=e1]'
        );
      }
      if (phase === "continue") {
        return success(
          [
            "- iframe [ref=e0]",
            '  - textbox "Card number" [ref=f1e1]',
            '- textbox "Expiration date" [ref=e2]',
            '- textbox "CVV" [ref=e3]',
            '- textbox "First Name" [ref=e4]',
            '- textbox "Email" [ref=e5]',
            '- button "CONTINUE" [ref=e6]',
          ].join("\n")
        );
      }
      if (phase === "pay") return success('- button "PAY" [ref=e7]');
      if (phase === "three-d-secure") {
        return success(
          [
            "- paragraph [ref=e9]: NEXI XPAY DEV PORTAL TEST MERCHANT C2P",
            '- button "Authentication successful" [ref=e8]',
          ].join("\n")
        );
      }
      return success();
    }

    if (commandArgs[0] === "fill") {
      const ref = commandArgs[1] ?? "";
      const value = commandArgs[2] ?? "";
      if (ref === "input") {
        cardFillAttempts += 1;
        return success();
      }
      if (currentFrame === "main" && ref.startsWith("@f")) return success();
      if (ref === "@e1") return success();
      values.set(ref, value);
      return success();
    }

    if (commandArgs[0] === "type") {
      const ref = commandArgs[1] ?? "";
      const value = commandArgs[2] ?? "";
      if (ref === "input") {
        cardTypeAttempts += 1;
        values.set(ref, value);
      } else if (currentFrame === "main" && ref.startsWith("@f")) {
        return success();
      } else if (ref !== "@e1") {
        values.set(ref, value);
      }
      return success();
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "value") {
      return success(values.get(commandArgs[2] ?? "") ?? "");
    }

    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }

    if (commandArgs[0] === "press") {
      if (focusedRef === "@e6") {
        phase = "pay";
      } else if (focusedRef === "@e7") {
        phase = "three-d-secure";
      }
      return success();
    }

    if (commandArgs[0] === "click" && commandArgs[1] === "@e8") {
      phase = "status";
      return success();
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      return success(
        phase === "status"
          ? "https://workspace.example/en-US/reservation/status/order-id"
          : "https://xpay.nexigroup.com/hpp/nexi/test"
      );
    }

    if (commandArgs[0] === "frame") {
      currentFrame = commandArgs[1] === "main" ? "main" : "card";
      return success();
    }
    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  }) as unknown as Runner;

  await Effect.runPromise(
    completeNexiHostedPayment({
      data: makeCheckoutData(),
      run,
      session: "hosted-payment-test",
      timeouts: { ...workspaceE2ETimeouts, providerTransition: 2500 },
    })
  );

  expect(cardFillAttempts).toBe(1);
  expect(cardSnapshotReads).toBeGreaterThan(1);
  expect(cardTypeAttempts).toBe(1);
});

test.each([
  [
    "destroyed execution context",
    "locator.ariaSnapshot: Execution context was destroyed, most likely because of a navigation",
    "target-change",
  ],
  [
    "document without a body",
    'locator.ariaSnapshot: Selector "body" does not match any element',
    "target-change",
  ],
  [
    "document without a body before the back-to-shop target appears",
    'locator.ariaSnapshot: Selector "body" does not match any element',
    "target-search",
  ],
] as const)("returns through back to shop and restores the original status tab across %s", async (_name, transitionError, errorStage) => {
  const calls: string[][] = [];
  const values = new Map<string, string>();
  const buttons = [
    '- button "CONTINUE" [ref=e6]',
    '- button "PAY" [ref=e7]',
    '- button "Authentication successful" [ref=e8]',
    '- button "BACK TO THE SHOP" [ref=e9]',
  ];
  let buttonIndex = 0;
  let backToShopUrlRead = false;
  let tabListReads = 0;
  let transitionSnapshotPending = true;
  const run: Runner = async (_command, args) => {
    const commandArgs = args.slice(2);
    calls.push(commandArgs);

    if (
      commandArgs[0] === "--json" &&
      commandArgs[1] === "tab" &&
      commandArgs[2] === "list"
    ) {
      tabListReads += 1;
      return success(
        JSON.stringify({
          data: {
            tabs: [
              { active: tabListReads > 1, tabId: "t1" },
              ...(tabListReads === 1 ? [{ active: true, tabId: "t2" }] : []),
            ],
          },
          success: true,
        })
      );
    }

    if (commandArgs[0] === "tab") return success();

    if (commandArgs[0] === "snapshot") {
      const shouldFailSnapshot =
        buttonIndex === 3 &&
        transitionSnapshotPending &&
        (errorStage === "target-change"
          ? !backToShopUrlRead
          : backToShopUrlRead);
      if (shouldFailSnapshot) {
        transitionSnapshotPending = false;
        throw new Error(transitionError);
      }
      return success(
        [
          '- textbox "Card number" [ref=e1]',
          '- textbox "Expiration date" [ref=e2]',
          '- textbox "CVV" [ref=e3]',
          '- textbox "First Name" [ref=e4]',
          '- textbox "Email" [ref=e5]',
          buttons[buttonIndex],
        ]
          .filter(Boolean)
          .join("\n")
      );
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      if (buttonIndex === 3) backToShopUrlRead = true;
      return success(
        buttonIndex > 3
          ? `https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/reservation/status/${orderId}`
          : "https://xpay.nexigroup.com/hpp/nexi/test"
      );
    }

    if (commandArgs[0] === "fill") {
      values.set(commandArgs[1] ?? "", commandArgs[2] ?? "");
      return success();
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "value") {
      return success(values.get(commandArgs[2] ?? "") ?? "");
    }

    if (commandArgs[0] === "click" || commandArgs[0] === "press") {
      buttonIndex += 1;
    }

    return success();
  };

  await Effect.runPromise(
    completeNexiHostedPayment({
      data: makeCheckoutData(),
      hostedPaymentPage: {
        checkoutTabId: "t1",
        hostedPaymentTabId: "t2",
        url: "https://xpay.nexigroup.com/hpp/nexi/test",
      },
      run,
      session: "test-session",
      timeouts: workspaceE2ETimeouts,
    })
  );

  expect(calls.filter(([command]) => command === "click")).toEqual([
    ["click", "@e8"],
  ]);
  expect(calls.filter(([command]) => command === "focus")).toEqual([
    ["focus", "@e6"],
    ["focus", "@e7"],
    ["focus", "@e9"],
  ]);
  expect(calls.filter(([command]) => command === "press")).toEqual([
    ["press", "Enter"],
    ["press", "Enter"],
    ["press", "Enter"],
  ]);
  expect(tabListReads).toBe(2);
  expect(calls).toContainEqual(["tab", "t1"]);
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
