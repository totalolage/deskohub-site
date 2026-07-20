import { Effect } from "effect";
import {
  clickBrowserElement,
  fillBrowserField,
  openBrowserPage,
  requireSnapshotRef,
  waitForBrowserReactFormAction,
  waitForBrowserTextContent,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import { getWorkspaceE2ETimeoutMs } from "../timeouts";
import type { WorkspaceE2EStepRunner } from "../types";
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
      email: `workspace-e2e-contact-${runId}@example.com`,
      message: `Automated workspace contact e2e ${runId}`,
      name: `Workspace Contact E2E ${runId}`,
      phone: `+420736${runId.slice(8, 14)}`,
    };

    const url = yield* makeUrl(
      "build contact form URL",
      `${config.baseUrl}/en-US/contact`
    );
    yield* setSearchParams(url, { e2eAt: runId });

    yield* runStep({
      execute: openBrowserPage(config, run, session, url.toString(), {
        timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
      }).pipe(Effect.asVoid),
      id: "open-contact-form",
      timeoutMs: getWorkspaceE2ETimeoutMs("browserNavigation"),
    });
    yield* runStep({
      execute: waitForBrowserReactFormAction(
        run,
        session,
        "#contact-form form",
        { timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition") }
      ),
      id: "wait-for-contact-form-hydration",
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
    yield* runStep({
      execute: fillContactForm(run, session, data),
      id: "fill-contact-form",
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
    yield* runStep({
      execute: submitContactForm(run, session),
      id: "submit-contact-form",
      timeoutMs: getWorkspaceE2ETimeoutMs("uiTransition"),
    });
    log("Contact form e2e passed");
  });

const fillContactForm = (
  run: Runner,
  session: string,
  data: { email: string; message: string; name: string; phone: string }
) =>
  Effect.gen(function* () {
    const timeoutMs = getWorkspaceE2ETimeoutMs("browserAction");
    yield* fillBrowserField(run, session, "#contact-name", data.name, {
      timeoutMs,
    });
    yield* fillBrowserField(run, session, "#contact-phone", data.phone, {
      timeoutMs,
    });
    yield* fillBrowserField(run, session, "#contact-email", data.email, {
      timeoutMs,
    });
    yield* fillBrowserField(run, session, "#contact-message", data.message, {
      timeoutMs,
    });
  });

const submitContactForm = (run: Runner, session: string) =>
  Effect.gen(function* () {
    const timeoutMs = getWorkspaceE2ETimeoutMs("uiTransition");
    const submitRef = yield* requireSnapshotRef({
      description: "contact form submit button",
      labels: ["Send message"],
      run,
      session,
      timeoutMs,
    });
    yield* clickBrowserElement(run, session, submitRef, { timeoutMs });
    yield* waitForBrowserTextContent(
      run,
      session,
      "Your message has been sent.",
      { timeoutMs }
    );
  });
