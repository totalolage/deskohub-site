# Driving the browser in Workspace E2E

## Contents

- [What belongs in E2E](#what-belongs-in-e2e)
- [Hydration and interaction](#hydration-and-interaction)
- [Preparation before a state-creating action](#preparation-before-a-state-creating-action)
- [Streamed pages](#streamed-pages)
- [Review screenshots](#review-screenshots)

## What belongs in E2E

Assert in E2E only what needs the deployed stack: server rendering, auth gating, persistence, provider and webhook round trips, and streaming and navigation handoffs. Put CSS animation, layout geometry, focus, and markup facts in real-browser component tests (`*.browser-acceptance.test.ts` with `shared/testing/playwright-browser.ts`) or `@testing-library/react` tests, and keep only a readiness sentinel in E2E.

Run a check every paid case could repeat, such as post-fulfillment support or reserve-again, on one opted-in case instead of the shared checkout flow.

## Hydration and interaction

- Wait for the specific React handler the component uses before you interact (`e2e/react-handlers.ts`). React props alone don't prove Radix or another composed primitive has installed its handler. Never use network idle as readiness; analytics keeps it open.
- Use Playwright locators and native fill, keyboard, and click, so handlers receive trusted events. Select the control by accessibility role, not a wrapping label. Prefer a stable app-owned ID or form-scoped selector for critical activation.
- Never replace native form submission or link navigation with an evaluated DOM click. An evaluated click can navigate while leaving the driver blocked on the destroyed execution context.
- Detaching any CDP session from a page resets Chromium's virtual authenticator environment there, which removes the passkey authenticator and its credentials. On a page where `holdsVirtualAuthenticator` (`e2e/virtual-authenticator.ts`) is true, leave your own CDP session attached; it ends with the page.
- When a provider page needs an accessibility snapshot, take a fresh Playwright AI snapshot after hydration, resolve its `aria-ref` at once, and never reuse it after the DOM changes.
- Tooltips: wait for the trigger's focus handler, center it in the viewport instantly, let layout settle, and focus it with the browser's native focus command. Assert content through the trigger's `aria-describedby` target. Don't add a `Shift+Tab`/`Tab` round trip, and don't raise the overlay wait to hide a missing interaction.
- Locale switching uses ordinary document links, not Next.js client-router links, in the full, mobile, and minimal headers alike. Locale is server-owned; cross-locale RSC prefetches and client transitions can fail to commit it.
- Reservation pages render initial prices with the content, so an option change whose price is already loaded never goes back to pending. Wait for pending-then-ready only after a change that issues a new advertised-price request, such as a new date.
- For hosted payment, activate consent and Pay natively once. Arrival at the Nexi page means production has created the attempt and attached the provider session; non-provider outcomes never enter tab management. See [Nexi sandbox](nexi-sandbox.md) for the hosted page.
- After the Nexi redirect, database visibility can still lag. Converge only the retry-safe read for the exact active attempt within the browser-action timeout, and keep a fixed diagnostic for the last observed state. Reject malformed provider-session responses at the checked-in OpenAPI contract and never retry payment creation after a decode failure.

## Preparation before a state-creating action

Keep UI- or provider-backed preparation apart from the native activation that creates state:

1. Start side-effect-free preparation in a short Playwright evaluation that returns at once and keeps a bounded status in the page.
2. Poll that status under the existing semantic timeout. Keep preparation errors.
3. Focus the hydrated form-scoped submit control and activate it with a separate native keyboard command.
4. Poll the destination URL.

A preparation script may press the existing advertised-price retry control when that error is rendered. That retry is read-only and doesn't reset the preparation deadline.

The reservation-preparation UI action (`e2e/checkout/payment.ts`) may retry once after its recognized generic error, but only with the same `checkoutAttemptId` in the same `checkoutSessionId`; the backend attempt key is the idempotency boundary. Never extend that retry to payment creation, and don't raise timeouts to hide a browser transport limit.

## Streamed pages

- After a full load, `/account` streams its layout and content in separate Suspense boundaries, and React can delay revealing content by a few hundred milliseconds. Clicking a section before its content hydrates makes React render a second panel beside the hidden server copy, and strict locators such as `#account-profile-form` fail. Section selection waits for the target panel's always-rendered anchor to carry React props before the native click. Legal has no anchor because it renders only when active.
- Never wait on an element handle pinned before a streamed reveal. React's `$RC` swap can land after `load`, and the loading shell's disabled section buttons share the real buttons' accessible names. `waitForReactClickHandler` resolves its locator again when the observed node leaves the document.
- Profile navigation failures never attach the Playwright cause, which can hold private profile values. They keep the closed diagnostic code and name only the stage and failure kind (`timeout`, `strict-mode-violation`, `error`).

## Review screenshots

Review screenshots are PR-review artifacts, not test evidence. Capture them only when `WORKSPACE_E2E_REVIEW_SCREENSHOTS=true`, decoded once by `reviewScreenshotsEnabled` in `e2e/e2e-env.ts`. Inject the setting: account capture helpers take an `AccountReviewDestination`, and review-only viewports, mode switches, and section visits run only when it opts in. CI uploads `e2e-artifacts/account-review/*.png` as `workspace-account-review-<run>-<attempt>`.
