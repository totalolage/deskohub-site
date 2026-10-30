import { Effect } from "effect";
import type { CanonicalPromotionCode } from "@/features/discounts/persistence-contracts";
import { waitForPageTextContent, waitForReactFormSubmit } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EConfig } from "../config";
import { addRedaction } from "../runtime";

/** The checkout's discount-code box in the session's active page. */
type DiscountCodeBox = {
  readonly config: WorkspaceE2EConfig;
  readonly session: E2EBrowserSession;
};

export const applyDiscountCode = ({
  appliedMessage,
  code,
  ...box
}: DiscountCodeBox & {
  readonly appliedMessage: string;
  readonly code: string;
}) =>
  submitDiscountCodeIn(box.session, code, box.config).pipe(
    Effect.andThen(
      waitForPageTextContent(box.session, appliedMessage, {
        timeoutMs: box.config.timeouts.uiTransition,
      })
    )
  );

export const applyUnavailableDiscountCode = ({
  code,
  ...box
}: DiscountCodeBox & { readonly code: string }) =>
  submitDiscountCodeIn(box.session, code, box.config).pipe(
    Effect.andThen(
      waitForPageTextContent(
        box.session,
        "That discount, voucher, or referral code isn’t available. Check it and try again, or continue with the current price.",
        { timeoutMs: box.config.timeouts.uiTransition }
      )
    )
  );

export const submitDiscountCode = ({
  code,
  ...box
}: DiscountCodeBox & { readonly code: string }) =>
  submitDiscountCodeIn(box.session, code, box.config);

const submitDiscountCodeIn = Effect.fnUntraced(function* (
  session: E2EBrowserSession,
  code: string,
  config: WorkspaceE2EConfig
) {
  addRedaction(code, true);
  const timeout = config.timeouts.browserAction;
  yield* waitForReactFormSubmit(
    session,
    "#checkout-discount-code-form",
    ["#checkout-discount-code"],
    { timeoutMs: config.timeouts.uiTransition }
  );
  yield* session.use("fill browser field", (page) =>
    page
      .locator("#checkout-discount-code")
      .filter({ visible: true })
      .fill(code, { timeout })
  );
  yield* session.use("focus browser element", (page) =>
    page
      .locator('#checkout-discount-code-form button[type="submit"]')
      .filter({ visible: true })
      .focus({ timeout })
  );
  yield* session.use("press browser key", (page) =>
    page.keyboard.press("Enter")
  );
});

/** The code box holds a requested code without having applied it. */
export const assertRequestedOnlyDiscountCode = ({
  code,
  ...box
}: DiscountCodeBox & { readonly code: CanonicalPromotionCode }) =>
  box.session
    .use("wait for requested-only discount code input", (page) =>
      page.waitForFunction(
        (requested) => {
          const form = document.querySelector("#checkout-discount-code-form");
          if (!(form instanceof HTMLFormElement)) return false;
          if (form.querySelector("output")) return false;
          const input = form.querySelector("#checkout-discount-code");
          return input instanceof HTMLInputElement && input.value === requested;
        },
        code,
        { timeout: box.config.timeouts.uiTransition }
      )
    )
    .pipe(Effect.asVoid);
