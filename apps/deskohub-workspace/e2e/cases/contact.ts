import { Effect } from "effect";
import {
  fillBrowserField,
  focusBrowserElement,
  openBrowserPage,
  pressBrowserKey,
  requireSnapshotRef,
  waitForBrowserReactHydration,
  waitForBrowserText,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import { makeUrl, setSearchParams } from "../urls";

export const assertContactForm = ({
  config,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const runId = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const data = {
      email: `workspace-e2e-contact-${runId}@example.com`,
      message: `Automated workspace contact e2e ${runId}`,
      name: `Workspace Contact E2E ${runId}`,
      phone: `+420736${runId.slice(8, 14)}`,
    };

    const url = yield* makeUrl(
      "build contact form URL",
      `${config.browserUrl}/en-US/contact`
    );
    yield* setSearchParams(url, { e2eAt: runId });

    yield* openBrowserPage(config, run, session, url.toString(), {
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* waitForBrowserReactHydration(
      run,
      session,
      '#contact-form button[type="submit"]',
      { timeoutMs: getCheckoutTimeoutMs() }
    );
    yield* fillBrowserField(run, session, "#contact-name", data.name);
    yield* fillBrowserField(run, session, "#contact-phone", data.phone);
    yield* fillBrowserField(run, session, "#contact-email", data.email);
    yield* fillBrowserField(run, session, "#contact-message", data.message);
    const submitRef = yield* requireSnapshotRef({
      description: "contact form submit button",
      labels: ["Send message"],
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* focusBrowserElement(run, session, submitRef, {
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* pressBrowserKey(run, session, "Enter", {
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* waitForBrowserText({
      description: "contact form success",
      matches: (text) => /Your message has been sent\./i.test(text),
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
    log("Contact form e2e passed");
  });
