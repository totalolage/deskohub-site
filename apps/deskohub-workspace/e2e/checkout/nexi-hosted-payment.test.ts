import { expect, test } from "bun:test";
import { Cause, Effect, Exit, Fiber } from "effect";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";
import { completeNexiHostedPayment } from "./nexi-hosted-payment";

const hostedPageUrl = "https://xpaysandbox.nexigroup.com/hpp/nexi/session/card";
const statusUrl =
  "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/en-US/reservation/status/order-id";
const cardDataUrl = "https://xpaysandbox.nexigroup.com/fe/build/text/";

const fieldFrames = {
  "@e39": "Card number",
  "@e42": "Expiration date",
  "@e53": "CVV",
  "@e56": "First Name",
  "@e59": "Email",
} as const;
type FieldFrame = keyof typeof fieldFrames;

type Phase = "card" | "pay" | "challenge" | "result" | "status" | "error-page";

// A scripted Nexi hosted payment page behind the browser runner contract,
// including its allowFailure semantics.
const makeHostedPage = ({
  failedMainFrameRestores = 0,
  firstCardFillSticks = true,
  hangCardFill = false,
  initialResponses = [],
  onContinue = "advance",
  onReturnPress = "navigate",
  returnAfterChallenge = false,
  snapshotGaps = 0,
}: {
  // Leading `frame main` commands issued from an iframe that fail.
  readonly failedMainFrameRestores?: number;
  readonly firstCardFillSticks?: boolean;
  // The card-number fill never settles until its command is aborted.
  readonly hangCardFill?: boolean;
  readonly initialResponses?: readonly string[];
  readonly onContinue?: "advance" | "reject" | "error-page" | "stall";
  readonly onReturnPress?: "navigate" | "navigate-and-reject" | "reject";
  readonly returnAfterChallenge?: boolean;
  readonly snapshotGaps?: number;
} = {}) => {
  const values = new Map<string, string>();
  const responses = [...initialResponses];
  const calls: { readonly args: string[]; readonly frame: string }[] = [];
  let phase: Phase = "card";
  let frame = "main";
  let focused: string | undefined;
  let fieldsDisabled = false;
  let cardFills = 0;
  let remainingSnapshotGaps = snapshotGaps;
  let remainingFailedRestores = failedMainFrameRestores;
  let markCardFillStarted: () => void = () => undefined;
  const cardFillStarted = new Promise<void>((resolve) => {
    markCardFillStarted = resolve;
  });

  const snapshot = () => {
    switch (phase) {
      case "card":
        return [
          "- main [ref=e3]:",
          ...Object.entries(fieldFrames).flatMap(([ref, name], index) => [
            `  - iframe [ref=${ref.slice(1)}]:`,
            `    - textbox "${name}"${index > 0 && fieldsDisabled ? " [disabled]" : ""} [ref=f${index + 1}e6]:`,
          ]),
          '  - button "Continue" [ref=e77] [cursor=pointer]:',
          '  - generic "Abort payment" [ref=e62] [cursor=pointer]:',
        ].join("\n");
      case "pay":
        return '- button "Pay" [ref=e90]';
      case "challenge":
        return '- button "Authentication successful" [ref=e43]';
      case "result":
        return '- button "Back to the shop" [ref=e95]';
      case "error-page":
        return [
          '- heading "Payment error" [level=1] [ref=e86]',
          '- button "Back to the shop" [ref=e94]',
        ].join("\n");
      case "status":
        return "- main [ref=e1]";
    }
  };

  const execute = (args: string[]): string => {
    const [command, ...rest] = args;
    if (command === "frame") {
      if (
        rest[0] === "main" &&
        frame !== "main" &&
        remainingFailedRestores > 0
      ) {
        remainingFailedRestores -= 1;
        throw new Error("Playwright frame target unavailable");
      }
      frame = rest[0] === "main" ? "main" : (rest[0] ?? "main");
      return "";
    }
    if (command === "snapshot") {
      if (frame !== "main") throw new Error("snapshot taken inside an iframe");
      if (remainingSnapshotGaps > 0 && phase !== "card") {
        remainingSnapshotGaps -= 1;
        throw new Error(
          "locator.ariaSnapshot: Execution context was destroyed, most likely because of a navigation"
        );
      }
      return snapshot();
    }
    if (command === "get" && rest[0] === "url") {
      if (phase === "status") return statusUrl;
      if (phase === "error-page")
        return "https://xpaysandbox.nexigroup.com/hpp/nexi/error?operationId=x";
      return hostedPageUrl;
    }
    if (command === "network" && rest[0] === "requests")
      return responses.join("\n");
    if (command === "fill" || command === "type") {
      if (frame === "main" || rest[0] !== "input")
        throw new Error("hosted field filled outside its iframe");
      if (fieldsDisabled && frame !== "@e39")
        throw new Error("hosted field is disabled");
      if (command === "fill" && frame === "@e39") {
        cardFills += 1;
        if (cardFills === 1 && !firstCardFillSticks) return "";
      }
      values.set(frame, rest[1] ?? "");
      return "";
    }
    if (command === "get" && rest[0] === "value") {
      if (frame === "main") throw new Error("value read outside its iframe");
      return values.get(frame) ?? "";
    }
    if (command === "focus") {
      focused = rest[0];
      return "";
    }
    if (command === "press") {
      if (phase === "card" && focused === "@e77") {
        if (onContinue === "advance") {
          responses.push(`200 POST ${cardDataUrl}`);
          phase = "pay";
        } else if (onContinue === "reject") {
          responses.push(`POST ${cardDataUrl}`, `400 POST ${cardDataUrl}`);
          fieldsDisabled = true;
        } else if (onContinue === "error-page") {
          responses.push(`200 POST ${cardDataUrl}`);
          phase = "error-page";
        }
      } else if (phase === "pay" && focused === "@e90") {
        phase = "challenge";
      } else if (phase === "result" && focused === "@e95") {
        if (onReturnPress !== "reject") phase = "status";
        if (onReturnPress !== "navigate")
          throw new Error(
            "keyboard.press: Execution context was destroyed, most likely because of a navigation"
          );
      }
      return "";
    }
    if (command === "click") {
      if (phase === "challenge" && rest[0] === "@e43")
        phase = returnAfterChallenge ? "status" : "result";
      return "";
    }
    if (command === "--json" && rest[0] === "tab")
      return JSON.stringify({
        data: {
          tabs: [
            { active: phase !== "status", tabId: "t1" },
            ...(phase === "status" ? [] : [{ active: true, tabId: "t2" }]),
          ],
        },
        success: true,
      });
    if (command === "tab") return "";
    throw new Error(`Unexpected browser command: ${args.join(" ")}`);
  };

  const run: Runner = async (_command, args, options = {}) => {
    const browserArgs = args.slice(2);
    calls.push({ args: browserArgs, frame });
    if (hangCardFill && browserArgs[0] === "fill" && frame === "@e39") {
      markCardFillStarted();
      return new Promise((_, reject) =>
        options.signal?.addEventListener("abort", () =>
          reject(new Error("fill aborted"))
        )
      );
    }
    try {
      return { exitCode: 0, stderr: "", stdout: execute(browserArgs) };
    } catch (error) {
      if (!options.allowFailure) throw error;
      return { exitCode: 1, stderr: String(error), stdout: "" };
    }
  };

  return {
    calls,
    cardFillStarted,
    get frame() {
      return frame;
    },
    run,
    values,
  };
};

const checkoutData = {
  email: "workspace-e2e@example.com",
  name: "Workspace E2E",
} as CheckoutData;

const completePayment = (
  page: ReturnType<typeof makeHostedPage>,
  providerTransition = 60_000
) =>
  Effect.runPromiseExit(
    completeNexiHostedPayment({
      data: checkoutData,
      hostedPaymentPage: {
        checkoutTabId: "t1",
        hostedPaymentTabId: "t2",
        url: hostedPageUrl,
      },
      run: page.run,
      session: "nexi-test",
      timeouts: { ...workspaceE2ETimeouts, providerTransition },
    })
  );

const activations = (page: ReturnType<typeof makeHostedPage>) =>
  page.calls
    .map(({ args }) => args)
    .filter(([command]) => command === "focus" || command === "click");

const failureOf = (exit: Exit.Exit<void, WorkspaceE2EError>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("expected payment failure");
  return Cause.squash(exit.cause) as WorkspaceE2EError;
};

test("fills each card field inside its own iframe and completes the payment once", async () => {
  const page = makeHostedPage();

  const exit = await completePayment(page);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(page.values.get("@e39")).toBe("4509034543615006");
  expect(page.values.get("@e42")).toBe("1028");
  expect(page.values.get("@e53")).toBe("298");
  expect(page.values.get("@e56")).toBe("Workspace E2E");
  expect(page.values.get("@e59")).toBe("workspace-e2e@example.com");
  expect(
    page.calls
      .filter(({ args }) => args[0] === "frame" && args[1] !== "main")
      .map(({ args }) => args[1])
  ).toEqual(Object.keys(fieldFrames) as FieldFrame[]);
  expect(activations(page)).toEqual([
    ["focus", "@e77"],
    ["focus", "@e90"],
    ["click", "@e43"],
    ["focus", "@e95"],
  ]);
  expect(page.frame).toBe("main");
  expect(page.calls).toContainEqual({ args: ["tab", "t1"], frame: "main" });
});

test("types into a hosted field when fill does not stick", async () => {
  const page = makeHostedPage({ firstCardFillSticks: false });

  const exit = await completePayment(page);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(
    page.calls.filter(
      ({ args, frame }) => args[0] === "type" && frame === "@e39"
    )
  ).toHaveLength(1);
  expect(page.values.get("@e39")).toBe("4509034543615006");
});

test("fails fast with a provider diagnostic when Nexi rejects the card-data save", async () => {
  const page = makeHostedPage({ onContinue: "reject" });
  const startedAt = Date.now();

  const error = failureOf(await completePayment(page));

  expect(Date.now() - startedAt).toBeLessThan(10_000);
  expect(error.diagnosticCode).toBe(
    "nexi_hosted_continue_card_submission_rejected"
  );
  expect(error.reason).toBeUndefined();
  expect(error.message).toContain("card-data HTTP 400");
  expect(error.message).toContain(
    "Nexi rejected the card-data save and left the card form inert"
  );
  expect(activations(page)).toEqual([["focus", "@e77"]]);
});

test("ignores card-data rejections from before this hosted payment", async () => {
  const page = makeHostedPage({
    initialResponses: [`400 POST ${cardDataUrl}`],
  });

  expect(Exit.isSuccess(await completePayment(page))).toBe(true);
});

test("fails fast when Nexi renders its payment error page", async () => {
  const page = makeHostedPage({ onContinue: "error-page" });

  const error = failureOf(await completePayment(page));

  // Detected while waiting for the Continue transition, not after a 90s wait
  // for a Pay control that the error page never renders.
  expect(error.diagnosticCode).toBe("nexi_hosted_continue_provider_error_page");
  expect(error.message).toContain("Nexi rendered its payment error page");
  expect(activations(page)).toEqual([["focus", "@e77"]]);
});

test("classifies a stalled transition as a timeout with the page state", async () => {
  const page = makeHostedPage({ onContinue: "stall" });

  const error = failureOf(await completePayment(page, 2_500));

  expect(error.reason).toBe("timeout");
  expect(error.diagnosticCode).toBe("nexi_hosted_continue_card_entry_ready");
  expect(error.message).toContain("Nexi build API failures: none observed");
  expect(error.message).toContain('button "Continue"');
});

test("tolerates navigation snapshot gaps and a provider return without back-to-shop", async () => {
  const page = makeHostedPage({ returnAfterChallenge: true, snapshotGaps: 2 });

  const exit = await completePayment(page);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(activations(page)).toEqual([
    ["focus", "@e77"],
    ["focus", "@e90"],
    ["click", "@e43"],
  ]);
});

const pressesOf = (page: ReturnType<typeof makeHostedPage>, ref: string) => {
  let focused: string | undefined;
  let presses = 0;
  for (const { args } of page.calls) {
    if (args[0] === "focus") focused = args[1];
    if (args[0] === "press" && focused === ref) presses += 1;
  }
  return presses;
};

test("accepts a back-to-shop activation that navigates while its command rejects", async () => {
  const page = makeHostedPage({ onReturnPress: "navigate-and-reject" });

  const exit = await completePayment(page);

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(pressesOf(page, "@e95")).toBe(1);
  expect(page.calls).toContainEqual({ args: ["tab", "t1"], frame: "main" });
});

test("fails a rejected back-to-shop activation that never left Nexi without retrying it", async () => {
  const page = makeHostedPage({ onReturnPress: "reject" });

  const error = failureOf(await completePayment(page));

  expect(error.message).toContain("Execution context was destroyed");
  expect(pressesOf(page, "@e95")).toBe(1);
});

test("fails at the field when the main-frame restore after a fill fails", async () => {
  const page = makeHostedPage({ failedMainFrameRestores: 2 });

  const error = failureOf(await completePayment(page));

  expect(error.operation).toBe("switch to main frame");
  expect(error.reason).toBeUndefined();
  expect(page.values.get("@e39")).toBe("4509034543615006");
  // Nothing after the fill reads the page from inside the iframe.
  expect(
    page.calls.filter(
      ({ args, frame }) => args[0] === "snapshot" && frame !== "main"
    )
  ).toEqual([]);
  expect(page.values.has("@e42")).toBe(false);
});

test("restores the main frame when a hosted field fill is interrupted", async () => {
  const page = makeHostedPage({ hangCardFill: true });
  const fiber = Effect.runFork(
    completeNexiHostedPayment({
      data: checkoutData,
      run: page.run,
      session: "nexi-test",
      timeouts: workspaceE2ETimeouts,
    })
  );

  await page.cardFillStarted;
  expect(page.frame).toBe("@e39");
  await Effect.runPromise(Fiber.interrupt(fiber));
  const exit = await Effect.runPromise(Fiber.await(fiber));

  expect(Exit.hasInterrupts(exit)).toBe(true);
  expect(page.frame).toBe("main");
  expect(page.calls.at(-1)).toEqual({
    args: ["frame", "main"],
    frame: "@e39",
  });
});
