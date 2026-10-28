import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { openPage, waitForPageText, waitForReactFormSubmit } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EConfig } from "../config";
import { failWorkspaceE2E, type WorkspaceE2EError } from "../errors";
import { browserSessionFor, log, type Runner } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import { makeUrl, setSearchParams } from "../urls";

export const assertContactForm = ({
  config,
  run,
  runStep,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const runId = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const data = {
      email: testEmailAddress(`delivered+workspace-e2e-contact-${runId}`),
      message: `Automated workspace contact e2e ${runId}`,
      name: `Workspace Contact E2E ${runId}`,
      phone: `+420736${runId.slice(8, 14)}`,
    };

    const url = yield* makeUrl(
      "build contact form URL",
      `${config.baseUrl}/en-US/contact`
    );
    yield* setSearchParams(url, { e2eAt: runId });

    // Each step reaches the session itself, so a browser that fails to open
    // fails the step that needed it.
    const browser = browserSessionFor(run, session);
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        openPage(opened, config, url.toString(), {
          timeoutMs: config.timeouts.browserNavigation,
        })
      ),
      id: "open-contact-form",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        waitForReactFormSubmit(
          opened,
          "#contact-form form",
          [
            "#contact-name",
            "#contact-phone",
            "#contact-email",
            "#contact-message",
          ],
          {
            requiredReadyAttribute: {
              name: "data-rhf-ready",
              value: "true",
            },
            timeoutMs: config.timeouts.uiTransition,
          }
        )
      ),
      id: "wait-for-contact-form-hydration",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        fillContactForm(opened, data, config.timeouts)
      ),
      id: "fill-contact-form",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.flatMap(browser, (opened) =>
        submitContactForm(opened, config.timeouts)
      ),
      id: "submit-contact-form",
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Contact form e2e passed");
  });

const fillContactForm = (
  session: E2EBrowserSession,
  data: { email: string; message: string; name: string; phone: string },
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.forEach(
    [
      ["#contact-name", data.name],
      ["#contact-phone", data.phone],
      ["#contact-email", data.email],
      ["#contact-message", data.message],
    ] as const,
    ([selector, value]) =>
      session.use("fill browser field", (page) =>
        page
          .locator(selector)
          .filter({ visible: true })
          .fill(value, { timeout: timeouts.browserAction })
      ),
    { discard: true }
  );

const submitContactForm = Effect.fnUntraced(function* (
  session: E2EBrowserSession,
  timeouts: WorkspaceE2ETimeouts
) {
  const timeoutMs = timeouts.uiTransition;
  yield* session.use("focus browser element", (page) =>
    page
      .locator('#contact-form button[type="submit"]')
      .filter({ visible: true })
      .focus({ timeout: timeoutMs })
  );
  yield* session.use("press browser key", (page) =>
    page.keyboard.press("Enter")
  );
  const result = yield* waitForPageText({
    description: "contact form result",
    matches: (text) =>
      text.includes("Your message has been sent.") ||
      text.includes("Failed to send your message. Please try again later."),
    session,
    timeoutMs,
  });

  if (result.includes("Failed to send your message. Please try again later."))
    return yield* failWorkspaceE2E("Contact form submission failed");
});
