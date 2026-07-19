import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { browserDiagnosticsScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import type { CheckoutData } from "../types";
import { startCheckoutPaymentAttempt } from "./payment";

const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
const checkoutUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/checkout/order";

test("retries a transient reservation preparation failure with the same intent", async () => {
  let reservationSubmitAttempts = 0;
  let hostedPaymentStarted = false;
  const activatedRefs: string[] = [];
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
  expect(activatedRefs).toEqual(["@e2", "@e3"]);
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
  expectedCoffee: false,
  expectedMonitorOption: null,
  expectedProductTier: "basic",
  locale: "en-US",
  message: "Workspace E2E",
  name: "Workspace E2E",
  orderIdHint: "workspace-e2e",
  phone: "+420700000000",
});
