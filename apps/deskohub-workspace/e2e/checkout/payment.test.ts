import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { browserDiagnosticsScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import type { CheckoutData } from "../types";
import {
  completeNexiHostedPayment,
  startCheckoutPaymentAttempt,
} from "./payment";

const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
const checkoutUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/checkout/order";

test("retries a transient reservation preparation failure with the same intent", async () => {
  let reservationSubmitAttempts = 0;
  let hostedPaymentStarted = false;
  const activatedRefs: string[] = [];
  const clickedRefs: string[] = [];
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
        "wait",
      ].includes(arg)
    );
    const commandArgs = browserArgs.slice(commandIndex);

    if (commandArgs[0] === "open") return success();
    if (commandArgs[0] === "wait") return success();

    if (
      commandArgs[0] === "eval" &&
      options.input === submitReservationScript
    ) {
      reservationSubmitAttempts += 1;
      return success();
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      if (hostedPaymentStarted)
        return success("https://xpay.nexigroup.com/hpp/nexi/test");
      if (reservationSubmitAttempts > 1)
        return success(
          `${checkoutUrl.replace("/order", "/pay")}?orderId=${orderId}`
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
          '- button "ORDER AND PAY" [ref=e3]',
        ].join("\n")
      );
    }

    if (commandArgs[0] === "click") {
      clickedRefs.push(commandArgs[1] ?? "");
      activatedRefs.push(commandArgs[1] ?? "");
      if (commandArgs[1] === "@e3") hostedPaymentStarted = true;
      return success();
    }

    if (commandArgs[0] === "focus") {
      focusedRef = commandArgs[1];
      return success();
    }

    if (commandArgs[0] === "press") {
      activatedRefs.push(focusedRef ?? "");
      if (focusedRef === "@e3") hostedPaymentStarted = true;
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
  expect(activatedRefs).toEqual(["@e2", "@e3"]);
});

test("retries a hosted payment field when its first fill does not stick", async () => {
  const values = new Map<string, string>();
  let cardFillAttempts = 0;
  let focusedRef: string | undefined;
  let phase: "continue" | "pay" | "status" | "three-d-secure" = "continue";
  const run = mock(async (_command, args) => {
    const commandArgs = args.slice(2);

    if (commandArgs[0] === "snapshot") {
      if (phase === "continue") {
        return success(
          [
            '- textbox "Card number" [ref=e1]',
            '- textbox "Expiration date" [ref=e2]',
            '- textbox "CVV" [ref=e3]',
            '- textbox "First Name" [ref=e4]',
            '- textbox "Email" [ref=e5]',
            '- button "CONTINUE" [ref=e6]',
          ].join("\n")
        );
      }
      if (phase === "pay") return success('- button "PAY" [ref=e7]');
      if (phase === "three-d-secure")
        return success('- button "Authentication successful" [ref=e8]');
      return success();
    }

    if (commandArgs[0] === "fill") {
      const ref = commandArgs[1] ?? "";
      const value = commandArgs[2] ?? "";
      if (ref === "@e1") {
        cardFillAttempts += 1;
        if (cardFillAttempts === 1) return success();
      }
      values.set(ref, value);
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
      } else if (focusedRef === "@e8") {
        phase = "status";
      }
      return success();
    }

    if (commandArgs[0] === "get" && commandArgs[1] === "url") {
      return success(
        phase === "status"
          ? "https://workspace.example/en-US/checkout/status/order-id"
          : "https://xpay.nexigroup.com/hpp/nexi/test"
      );
    }

    if (commandArgs[0] === "frame") return success();
    throw new Error(`Unexpected browser command: ${commandArgs.join(" ")}`);
  }) as unknown as Runner;

  await Effect.runPromise(
    completeNexiHostedPayment({
      data: makeCheckoutData(),
      run,
      session: "hosted-payment-test",
    })
  );

  expect(cardFillAttempts).toBe(2);
});

test("activates freshly discovered hosted-payment targets with the keyboard", async () => {
  const calls: string[][] = [];
  const values = new Map<string, string>();
  const buttons = [
    'button "CONTINUE" [ref=e6]',
    'button "PAY" [ref=e7]',
    'button "Authentication successful" [ref=e8]',
    'link "BACK TO THE SHOP" [ref=e9]',
  ];
  let buttonIndex = 0;
  const run: Runner = async (_command, args) => {
    const commandArgs = args.slice(2);
    calls.push(commandArgs);

    if (commandArgs[0] === "snapshot") {
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
      return success(
        buttonIndex > 3
          ? `${checkoutUrl.replace("/order", "/status/")}${orderId}`
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
      run,
      session: "test-session",
    })
  );

  expect(calls.filter(([command]) => command === "click")).toEqual([]);
  expect(calls.filter(([command]) => command === "focus")).toEqual([
    ["focus", "@e6"],
    ["focus", "@e7"],
    ["focus", "@e8"],
    ["focus", "@e9"],
  ]);
  expect(calls.filter(([command]) => command === "press")).toEqual([
    ["press", "Enter"],
    ["press", "Enter"],
    ["press", "Enter"],
    ["press", "Enter"],
  ]);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
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
