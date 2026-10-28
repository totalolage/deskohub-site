import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Cause, Effect, Exit, Option } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { waitForBrowserReactFormSubmit, waitForReactFormSubmit } from "./browser";
import { E2EBrowserSession } from "./browser-session";
import { browserSessionFor, makePlaywrightBrowserRunner } from "./runtime";

// happy-dom reports client rects for display:none elements and an empty
// computed visibility, so the readiness check runs in real Chromium.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const formSelector = `[data-testid='contact "form"']`;
const readyAttribute = { name: "data-ready", value: `it's "ready"` } as const;
// Long enough for a ready form to pass at once, short enough that a form that
// never becomes ready ends the wait quickly.
const notReadyAfterMs = 300;

const contactForm = (fields: string, readyValue = readyAttribute.value) =>
  `<form data-testid='contact "form"' data-ready='${readyValue.replaceAll("'", "&#39;")}'>${fields}</form>`;

const wiredFields = `
  <input id="email" name="email" />
  <textarea id="message" name="message"></textarea>
  <input id="token" name="token" type="hidden" />
`;

/** Handler names to attach as fake React props, keyed by element selector. */
type ReactHandlers = Readonly<Record<string, readonly string[]>>;

type Readiness = {
  readonly fieldSelectors: readonly string[];
  readonly handlers: ReactHandlers;
  readonly html: string;
  readonly requiredReadyAttribute?: typeof readyAttribute;
};

const showForm = (session: E2EBrowserSession, { handlers, html }: Readiness) =>
  session.use("show the form", async (page) => {
    await page.setContent(
      `<!doctype html><html lang="en"><body>${html}</body></html>`
    );
    await page.evaluate((handlersBySelector) => {
      for (const [selector, names] of Object.entries(handlersBySelector)) {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(`Missing ${selector}`);
        Object.assign(element, {
          __reactProps$test: Object.fromEntries(
            names.map((name) => [name, () => undefined])
          ),
        });
      }
    }, handlers);
  });

/**
 * Whether each driver finds the form ready: the session helper, and the argv
 * wrapper the unmigrated callers still use, over the same in-page check.
 * A form that never becomes ready ends the wait with a timeout.
 */
const readinessThroughBothDrivers = async (readiness: Readiness) => {
  if (!browser) throw new Error("The readiness browser has not been launched.");
  const opened = browser;
  const options = {
    requiredReadyAttribute: readiness.requiredReadyAttribute,
    timeoutMs: notReadyAfterMs,
  };
  const classify = <E extends { readonly reason?: string }>(
    exit: Exit.Exit<void, E>
  ) => {
    if (Exit.isSuccess(exit)) return "ready";
    const failure = Cause.findErrorOption(exit.cause);
    return Option.isSome(failure) && failure.value.reason === "timeout"
      ? "not ready"
      : "failed";
  };

  const session = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* E2EBrowserSession.open({
          browser: opened,
          id: `react-form-${randomUUID()}`,
        });
        yield* showForm(session, readiness);
        return classify(
          yield* Effect.exit(
            waitForReactFormSubmit(
              session,
              formSelector,
              readiness.fieldSelectors,
              options
            )
          )
        );
      })
    )
  );

  const run = makePlaywrightBrowserRunner(opened, { recordHar: false });
  const id = `react-form-argv-${randomUUID()}`;
  const argv = await Effect.runPromise(
    Effect.gen(function* () {
      yield* showForm(yield* browserSessionFor(run, id), readiness);
      return classify(
        yield* Effect.exit(
          waitForBrowserReactFormSubmit(
            run,
            id,
            formSelector,
            readiness.fieldSelectors,
            options
          )
        )
      );
    })
  ).finally(() => run.close?.());

  return { argv, session };
};

const expectReadiness = async (
  readiness: Readiness,
  expected: "not ready" | "ready"
) =>
  expect(await readinessThroughBothDrivers(readiness)).toEqual({
    argv: expected,
    session: expected,
  });

const wiredHandlers: ReactHandlers = {
  [formSelector]: ["onSubmit"],
  "#email": ["onChange"],
  "#message": ["onChange"],
};
const wiredFieldSelectors = ["#email", "#message", "#token"];

test.skipIf(!chromiumAvailable)(
  "reports a hydrated form with visible handled fields as ready",
  async () => {
    await expectReadiness(
      {
        fieldSelectors: wiredFieldSelectors,
        handlers: wiredHandlers,
        html: contactForm(wiredFields),
        requiredReadyAttribute: readyAttribute,
      },
      "ready"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for the form's React submit handler",
  async () => {
    await expectReadiness(
      {
        fieldSelectors: wiredFieldSelectors,
        handlers: { ...wiredHandlers, [formSelector]: ["onChange"] },
        html: contactForm(wiredFields),
      },
      "not ready"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for the required ready attribute value",
  async () => {
    await expectReadiness(
      {
        fieldSelectors: wiredFieldSelectors,
        handlers: wiredHandlers,
        html: contactForm(wiredFields, "loading"),
        requiredReadyAttribute: readyAttribute,
      },
      "not ready"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for every field to exist inside the form",
  async () => {
    const fieldSelectors = [...wiredFieldSelectors, "#outside"];
    await expectReadiness(
      {
        fieldSelectors,
        handlers: { ...wiredHandlers, "#outside": ["onChange"] },
        html: `${contactForm(wiredFields)}<input id="outside" />`,
      },
      "not ready"
    );
    await expectReadiness(
      {
        fieldSelectors,
        handlers: wiredHandlers,
        html: contactForm(wiredFields),
      },
      "not ready"
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "waits for visible fields to render and receive change handlers",
  async () => {
    await expectReadiness(
      {
        fieldSelectors: ["#email"],
        handlers: { [formSelector]: ["onSubmit"] },
        html: contactForm('<input id="email" />'),
      },
      "not ready"
    );
    for (const style of ["display: none", "visibility: hidden"])
      await expectReadiness(
        {
          fieldSelectors: ["#email"],
          handlers: { [formSelector]: ["onSubmit"], "#email": ["onChange"] },
          html: contactForm(`<input id="email" style="${style}" />`),
        },
        "not ready"
      );
  }
);

test.skipIf(!chromiumAvailable)(
  "does not treat an empty field list as ready",
  async () => {
    await expectReadiness(
      {
        fieldSelectors: [],
        handlers: wiredHandlers,
        html: contactForm(wiredFields),
      },
      "not ready"
    );
  }
);
