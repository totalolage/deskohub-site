import { Effect } from "effect";
import {
  fillBrowserField,
  focusBrowserElement,
  pressBrowserKey,
  waitForBrowserReactFormAction,
  waitForBrowserTextContent,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { addRedaction } from "../runtime";

export const applyDiscountCode = ({
  appliedMessage,
  code,
  config,
  run,
  session,
}: {
  readonly appliedMessage: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  submitDiscountCode({ code, config, run, session }).pipe(
    Effect.andThen(
      waitForBrowserTextContent(run, session, appliedMessage, {
        timeoutMs: config.timeouts.uiTransition,
      })
    )
  );

export const applyUnavailableDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  submitDiscountCode({ code, config, run, session }).pipe(
    Effect.andThen(
      waitForBrowserTextContent(
        run,
        session,
        "That discount code isn’t available. Check it and try again, or continue with the current price.",
        { timeoutMs: config.timeouts.uiTransition }
      )
    )
  );

const submitDiscountCode = ({
  code,
  config,
  run,
  session,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.gen(function* () {
    addRedaction(code, true);
    yield* waitForBrowserReactFormAction(
      run,
      session,
      "#checkout-discount-code-form",
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* fillBrowserField(run, session, "#checkout-discount-code", code, {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* focusBrowserElement(
      run,
      session,
      '#checkout-discount-code-form button[type="submit"]',
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* pressBrowserKey(run, session, "Enter", {
      timeoutMs: config.timeouts.browserAction,
    });
  });
