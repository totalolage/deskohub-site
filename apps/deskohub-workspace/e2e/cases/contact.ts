import { Effect } from "effect";
import { openBrowserPage } from "../browser";
import { getSubmitContactFormScript } from "../browser-scripts";
import type { WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import { effectifyPromise, type WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { addRedaction, log } from "../runtime";

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

    for (const value of Object.values(data)) addRedaction(value);

    yield* effectifyPromise("open contact form page", () =>
      openBrowserPage(
        config,
        run,
        session,
        `${config.browserUrl}/en-US/contact`,
        {
          timeoutMs: getCheckoutTimeoutMs(),
        }
      )
    );
    yield* effectifyPromise("submit contact form", () =>
      run("agent-browser", ["--session", session, "eval", "--stdin"], {
        input: getSubmitContactFormScript(data),
        logOutput: false,
        timeoutMs: getCheckoutTimeoutMs(),
      })
    );
    log("Contact form e2e passed");
  });
