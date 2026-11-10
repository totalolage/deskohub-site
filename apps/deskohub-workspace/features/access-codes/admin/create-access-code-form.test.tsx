import "./dom-env";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS } from "@deskohub/workspace-admin-api";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { shiftStandaloneAccessCodeLocalEnd } from "./create-access-code";

// React DOM detects input events when it loads, so it is imported once
// ./dom-env has registered the DOM.
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const writeText = mock(() => Promise.resolve());
const execute = mock();

interface CreateStandaloneAccessCodeActionInput {
  readonly attemptId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly providerCredentialRemovedAttemptId?: string;
}

type ActionOptions = {
  readonly execute: (input: CreateStandaloneAccessCodeActionInput) => void;
  readonly isExecuting: boolean;
  readonly onSuccess: (args: { readonly data?: unknown }) => void;
  readonly onError: (args: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

let actionOptions: ActionOptions | undefined;

mock.module("@/features/access-codes/admin/actions", () => ({
  createStandaloneAccessCode: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

beforeEach(() => {
  execute.mockClear();
  writeText.mockClear();
  actionOptions = undefined;
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation(() => ({
    execute,
    isExecuting: false,
    result: {},
  }));
});

const withActionOptions = () => {
  workspaceUseAction.mockImplementation((_action, options) => {
    actionOptions = options as ActionOptions | undefined;
    return { execute, isExecuting: false, result: {} };
  });
};

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unregisterWorkspaceComponentTestEnv();
});

const createdOutcome = {
  outcome: "created" as const,
  attemptId: "01980000-0000-7000-8000-000000000042",
  providerCredentialId: "fixture-pin-id",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T09:00:00.000Z",
  pin: "7654321",
};

const priorAttemptId = "01980000-0000-7000-8000-0000000000aa";

const staleTarget = {
  attemptId: priorAttemptId,
  name: "Stale Booth",
};

const ambiguousFailure = (cleanupTarget: {
  readonly attemptId: string;
  readonly name: string;
}) => ({
  status: "failed" as const,
  outcome: { outcome: "ambiguous" as const, cleanupTarget },
});

const cleanupRequiredFailure = (cleanupTarget: {
  readonly attemptId: string;
  readonly name: string;
}) => ({
  status: "failed" as const,
  outcome: { outcome: "cleanup-required" as const, cleanupTarget },
});

const standaloneAccessCodeCleanupConfirmationLabel =
  "I removed the named access code at the lock, or verified that it is absent.";

const cleanupTargetNotice = (name: string) =>
  "Before creating another code for this window, check the lock in the " +
  `Igloohome app over Bluetooth and remove “${name}” if it is there.`;

type WindowFieldLabels = {
  readonly date: string;
  readonly time: string;
};

const windowFieldLabels = async (locale: Locale = "en-US") => {
  const { m } = await import("@/features/administration/i18n");
  return {
    startsAt: {
      date: m.accessCodesStartsLabel({}, { locale }),
      time: m.accessCodesStartsTimeLabel({}, { locale }),
    },
    endsAt: {
      date: m.accessCodesEndsLabel({}, { locale }),
      time: m.accessCodesEndsTimeLabel({}, { locale }),
    },
  } satisfies Record<"startsAt" | "endsAt", WindowFieldLabels>;
};

const windowDateField = (
  view: ReturnType<typeof render>,
  labels: WindowFieldLabels
) => view.getByRole("combobox", { name: labels.date }) as HTMLInputElement;

const windowTimeField = (
  view: ReturnType<typeof render>,
  labels: WindowFieldLabels
) => view.getByLabelText(labels.time) as HTMLInputElement;

// A date field takes typed text when focus leaves it.
const typeWindowDate = (
  view: ReturnType<typeof render>,
  labels: WindowFieldLabels,
  date: string
) => {
  const field = windowDateField(view, labels);
  fireEvent.change(field, { target: { value: date } });
  fireEvent.focusOut(field);
};

const enterWindowTime = (
  view: ReturnType<typeof render>,
  labels: WindowFieldLabels,
  time: string
) => {
  fireEvent.input(windowTimeField(view, labels), { target: { value: time } });
};

/** Types a canonical local date-time into a window bound's two fields. */
const enterWindowBound = (
  view: ReturnType<typeof render>,
  labels: WindowFieldLabels,
  dateTime: string
) => {
  const [date = "", time = ""] = dateTime.split("T");
  typeWindowDate(view, labels, date);
  enterWindowTime(view, labels, time);
};

/** The window as the form would submit it. */
const submittedWindow = (view: ReturnType<typeof render>) => {
  const data = new FormData(
    view.getByRole("form", {
      name: "Create an access code",
    }) as HTMLFormElement
  );
  return { startsAt: data.get("startsAt"), endsAt: data.get("endsAt") };
};

const fillForm = async (view: ReturnType<typeof render>) => {
  const labels = await windowFieldLabels();
  fireEvent.input(view.getByLabelText("Name"), {
    target: { value: "Booth A" },
  });
  enterWindowBound(view, labels.startsAt, "2026-09-10T10:00");
  enterWindowBound(view, labels.endsAt, "2026-09-10T12:00");
};

const submitForm = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.submit(view.getByRole("form", { name: "Create an access code" }));
  });
};

const submitCleanupConfirmation = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.submit(
      view.getByRole("form", { name: "Confirm the lock is clean" })
    );
  });
};

// The root layout provides the locale of the current route.
const renderForm = async (locale: Locale = "en-US") => {
  const { CreateStandaloneAccessCodeForm } = await import(
    "./create-access-code-form"
  );
  return render(
    <RouteLocaleProvider locale={locale}>
      <CreateStandaloneAccessCodeForm />
    </RouteLocaleProvider>
  );
};

describe("CreateStandaloneAccessCodeForm", () => {
  test("derives the end bounds from the start across daylight saving time", async () => {
    const view = await renderForm();
    const labels = await windowFieldLabels();

    enterWindowBound(view, labels.startsAt, "2026-03-29T01:00");
    expect(submittedWindow(view).startsAt).toBe("2026-03-29T01:00");

    // 02:00 does not exist that night, so the earliest end is 03:00.
    enterWindowBound(view, labels.endsAt, "2026-03-29T02:00");
    expect(submittedWindow(view).endsAt).toBe("");
    enterWindowTime(view, labels.endsAt, "03:00");
    expect(submittedWindow(view).endsAt).toBe("2026-03-29T03:00");

    const latestEnd = shiftStandaloneAccessCodeLocalEnd({
      startsAt: "2026-03-29T01:00",
      hours: ADMINISTRATION_STANDALONE_ACCESS_CODE_MAXIMUM_DURATION_HOURS,
    });
    const [latestDate = "", latestTime = ""] = latestEnd.split("T");
    const dayAfterLatest = Temporal.PlainDate.from(latestDate)
      .add({ days: 1 })
      .toString();
    typeWindowDate(view, labels.endsAt, dayAfterLatest);
    expect(submittedWindow(view).endsAt).toBe("");
    expect(
      windowDateField(view, labels.endsAt).getAttribute("aria-invalid")
    ).toBe("true");

    enterWindowBound(view, labels.endsAt, latestEnd);
    expect(latestTime).not.toBe("");
    expect(submittedWindow(view).endsAt).toBe(latestEnd);
  });

  test("wires the window field errors to the date and time fields", async () => {
    const view = await renderForm();
    const labels = await windowFieldLabels();
    const { m } = await import("@/features/administration/i18n");

    await submitForm(view);

    for (const [field, message] of [
      ["startsAt", m.accessCodesStartRequired({}, { locale: "en-US" })],
      ["endsAt", m.accessCodesEndRequired({}, { locale: "en-US" })],
    ] as const) {
      const dateField = windowDateField(view, labels[field]);
      expect(dateField.getAttribute("aria-invalid")).toBe("true");
      const described = (dateField.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
      expect(described).toContain(message);
    }
  });

  for (const field of ["startsAt", "endsAt"] as const) {
    test(`keeps a ${field} date without a time from being submitted`, async () => {
      withActionOptions();
      const view = await renderForm();
      const labels = await windowFieldLabels();
      await fillForm(view);

      enterWindowTime(view, labels[field], "");
      expect(submittedWindow(view)[field]).toBe("");
      await submitForm(view);

      expect(execute).not.toHaveBeenCalled();
      const timeField = windowTimeField(view, labels[field]);
      expect(document.activeElement).toBe(timeField);
      expect(timeField.getAttribute("aria-invalid")).toBe("true");

      enterWindowTime(
        view,
        labels[field],
        field === "startsAt" ? "10:00" : "12:00"
      );
      await submitForm(view);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]![0]).toMatchObject({
        name: "Booth A",
        startsAt: "2026-09-10T10:00",
        endsAt: "2026-09-10T12:00",
      });
    });
  }

  test("clears a window bound", async () => {
    const view = await renderForm();
    const labels = await windowFieldLabels();
    await fillForm(view);

    typeWindowDate(view, labels.endsAt, "");
    expect(submittedWindow(view).endsAt).toBe("");
    expect(windowTimeField(view, labels.endsAt).value).toBe("");
    await submitForm(view);

    expect(execute).not.toHaveBeenCalled();
    const { m } = await import("@/features/administration/i18n");
    expect(
      view.queryByText(m.accessCodesEndRequired({}, { locale: "en-US" }))
    ).not.toBeNull();
  });

  test("reports field errors without calling the action", async () => {
    const view = await renderForm();

    await submitForm(view);

    expect(view.getByText("Enter a name for this access code.")).toBeDefined();
    expect(view.getByText("Choose a start time.")).toBeDefined();
    expect(view.getByText("Choose an end time.")).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });

  test("binds one stable attempt id to the unchanged form intent", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);

    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    await submitForm(view);
    const retryInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(firstInput.attemptId).toBe(retryInput.attemptId);
    expect(firstInput).toMatchObject({
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    });
  });

  test("never reuses an attempt id with changed input", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);

    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    fireEvent.input(view.getByLabelText("Name"), {
      target: { value: "Booth B" },
    });
    await submitForm(view);
    const secondInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(secondInput.attemptId).not.toBe(firstInput.attemptId);
    expect(secondInput.name).toBe("Booth B");
  });

  test("sends a fresh attempt id when an unchanged form is resubmitted after rejection", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);

    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    act(() => {
      actionOptions?.onSuccess({
        data: { status: "failed", outcome: { outcome: "rejected" } },
      });
    });
    await submitForm(view);
    const resubmittedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(resubmittedInput.attemptId).not.toBe(firstInput.attemptId);
    expect(resubmittedInput).toMatchObject({
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    });
  });

  test("keeps the attempt id for nonterminal provider failures", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);

    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    act(() => {
      actionOptions?.onSuccess({
        data: { status: "failed", outcome: { outcome: "unavailable" } },
      });
    });
    await submitForm(view);
    const retriedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(retriedInput.attemptId).toBe(firstInput.attemptId);
  });

  test("focuses each terminal result region after transition", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);
    act(() => {
      actionOptions?.onSuccess({
        data: { status: "succeeded", outcome: createdOutcome },
      });
    });
    expect(document.activeElement).toBe(
      view.container.querySelector(
        '[data-standalone-access-code-creation="created"]'
      )
    );
  });

  test("keeps an end the new start no longer allows from being submitted", async () => {
    withActionOptions();
    const view = await renderForm();
    const labels = await windowFieldLabels();
    await fillForm(view);

    enterWindowTime(view, labels.startsAt, "12:00");
    await submitForm(view);
    expect(execute).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(windowTimeField(view, labels.endsAt));

    enterWindowTime(view, labels.startsAt, "08:00");
    await submitForm(view);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      startsAt: "2026-09-10T08:00",
      endsAt: "2026-09-10T12:00",
    });
  });

  test("reveals the one-time pin with masking and a copy action", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { status: "succeeded", outcome: createdOutcome },
      });
    });

    const region = view.container.querySelector(
      '[data-standalone-access-code-creation="created"]'
    );
    expect(region).not.toBeNull();
    const digits = region!.querySelector("[data-ph-mask]");
    expect(digits).not.toBeNull();
    expect(digits!.getAttribute("data-ph-no-capture")).toBe("");
    expect(digits!.getAttribute("aria-label")).toBe("7 6 5 4 3 2 1");
    expect(view.queryByRole("form")).toBeNull();
    expect(
      view.getByText(/shown only once and cannot be retrieved later/)
    ).toBeDefined();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy code" }));
    });
    expect(writeText).toHaveBeenCalledWith("7654321");
    expect(view.getByRole("button", { name: "Copied" })).toBeDefined();
  });

  test("starts a new attempt after creating another access code", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);
    const firstAttemptId = (
      execute.mock.calls[0][0] as CreateStandaloneAccessCodeActionInput
    ).attemptId;
    act(() => {
      actionOptions?.onSuccess({
        data: { status: "succeeded", outcome: createdOutcome },
      });
    });

    fireEvent.click(
      view.getByRole("button", { name: "Create another access code" })
    );

    const form = view.getByRole("form", { name: "Create an access code" });
    expect(
      (form.querySelector("input[name='name']") as HTMLInputElement).value
    ).toBe("");
    expect(document.activeElement).toBe(
      form.querySelector("input[name='name']")
    );
    await fillForm(view);
    await submitForm(view);
    const nextInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(nextInput.attemptId).not.toBe(firstAttemptId);
  });

  test("never repeats the pin for an already-created attempt", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: {
          status: "succeeded",
          outcome: { ...createdOutcome, outcome: "already-created" },
        },
      });
    });

    expect(
      view.container.querySelector(
        '[data-standalone-access-code-creation="already-created"]'
      )
    ).not.toBeNull();
    expect(view.container.textContent).not.toContain("7654321");
    expect(view.container.querySelector("[data-ph-mask]")).toBeNull();
    expect(view.getByText(/cannot be displayed again/)).toBeDefined();
  });

  test("keeps the form editable after a provider rejection", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { status: "failed", outcome: { outcome: "rejected" } },
      });
    });

    expect(
      view.getByRole("form", { name: "Create an access code" })
    ).toBeDefined();
    expect(
      view.getByText(
        "The provider rejected this access code. Adjust the details and try again."
      )
    ).toBeDefined();
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Booth A"
    );
  });

  test("closes the attempt as ambiguous without automatic retry", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({ attemptId: priorAttemptId, name: "Booth A" }),
      });
    });

    expect(
      view.container.querySelector(
        '[data-standalone-access-code-creation="ambiguous"]'
      )
    ).not.toBeNull();
    expect(view.getByText(/will not be retried automatically/)).toBeDefined();
    expect(view.getByText(cleanupTargetNotice("Booth A"))).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Start over" }));

    expect(
      view.getByRole("form", { name: "Create an access code" })
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("renders the form, duration, notices and cleanup in Czech on a cs-CZ route", async () => {
    withActionOptions();
    const view = await renderForm("cs-CZ");
    const labels = await windowFieldLabels("cs-CZ");
    fireEvent.input(view.getByLabelText("Název"), {
      target: { value: "Booth A" },
    });
    enterWindowBound(view, labels.startsAt, "2026-09-10T10:00");
    enterWindowBound(view, labels.endsAt, "2026-09-10T12:00");
    expect(
      view.getByText("Časové okno přístupu (Europe/Prague)")
    ).toBeDefined();
    await waitFor(() =>
      expect(view.getByText("Trvání: 2 hodiny")).toBeDefined()
    );

    const form = view.getByRole("form", {
      name: "Vytvoření přístupového kódu",
    });
    expect(
      view.getByRole("button", { name: "Vytvořit přístupový kód" })
    ).toBeDefined();
    await act(async () => {
      fireEvent.submit(form);
    });
    act(() => {
      actionOptions?.onSuccess({
        data: { status: "failed", outcome: { outcome: "rejected" } },
      });
    });
    expect(
      view.getByText(
        "Poskytovatel tento přístupový kód odmítl. Upravte údaje a zkuste to znovu."
      )
    ).toBeDefined();

    await act(async () => {
      fireEvent.submit(form);
    });
    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({ attemptId: priorAttemptId, name: "Booth A" }),
      });
    });
    expect(
      view.getByText(
        "Než pro toto časové okno vytvoříte další kód, zkontrolujte zámek v aplikaci Igloohome přes Bluetooth, a pokud na něm je „Booth A“, odstraňte ho."
      )
    ).toBeDefined();
    expect(
      view
        .getByRole("button", { name: "Vytvořit další přístupový kód" })
        .hasAttribute("disabled")
    ).toBe(true);
    await act(async () => {
      fireEvent.submit(
        view.getByRole("form", { name: "Potvrzení kontroly zámku" })
      );
    });

    expect(
      view.getByText("Před pokračováním potvrďte kontrolu zámku.")
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test("shows the server's localized failure as sent", async () => {
    withActionOptions();
    const view = await renderForm("cs-CZ");

    act(() => {
      actionOptions?.onError({
        error: { serverError: "Server neodpověděl včas. Zkuste to znovu." },
      });
    });

    expect(
      view.getByText("Server neodpověděl včas. Zkuste to znovu.")
    ).toBeDefined();
  });

  test("shows the one-time pin result in Czech on a cs-CZ route", async () => {
    withActionOptions();
    const view = await renderForm("cs-CZ");

    act(() => {
      actionOptions?.onSuccess({
        data: { status: "succeeded", outcome: createdOutcome },
      });
    });

    expect(view.getByText("Platí od")).toBeDefined();
    expect(view.getByText("10. 9. 2026 10:00")).toBeDefined();
    expect(view.getByText("2 hodiny")).toBeDefined();
    expect(view.getByRole("button", { name: "Zkopírovat kód" })).toBeDefined();
  });

  test("rejects an unchecked cleanup confirmation with a field error", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({
          attemptId: priorAttemptId,
          name: "Booth A",
        }),
      });
    });

    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(true);
    await submitCleanupConfirmation(view);

    expect(
      view.getByText("Confirm the lock check before you continue.")
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("requires explicit confirmation before recreating an ambiguous window", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({ attemptId: priorAttemptId, name: "Booth A" }),
      });
    });

    const checkbox = view.getByRole("checkbox", {
      name: standaloneAccessCodeCleanupConfirmationLabel,
    });
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(false);

    await submitCleanupConfirmation(view);
    await waitFor(() =>
      expect(
        view.getByRole("form", { name: "Create an access code" })
      ).toBeDefined()
    );
    expect(execute).toHaveBeenCalledTimes(1);
    await fillForm(view);
    await submitForm(view);

    const confirmedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(confirmedInput.providerCredentialRemovedAttemptId).toBe(
      priorAttemptId
    );
    expect(confirmedInput.providerCredentialRemovedAttemptId).not.toBe(
      confirmedInput.attemptId
    );
    expect(confirmedInput.attemptId).not.toBe(firstInput.attemptId);

    await submitForm(view);
    const followUpInput = execute.mock
      .calls[2][0] as CreateStandaloneAccessCodeActionInput;
    expect("providerCredentialRemovedAttemptId" in followUpInput).toBe(false);
  });

  test("keeps the attempted form values when returning from the confirmation panel", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({ attemptId: priorAttemptId, name: "Booth A" }),
      });
    });
    fireEvent.click(
      view.getByRole("checkbox", {
        name: standaloneAccessCodeCleanupConfirmationLabel,
      })
    );
    await submitCleanupConfirmation(view);
    await waitFor(() =>
      expect(
        view.getByRole("form", { name: "Create an access code" })
      ).toBeDefined()
    );

    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Booth A"
    );
    expect(submittedWindow(view)).toEqual({
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    });
  });

  test("requires the confirmation again after a server-reported cleanup-required outcome", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({ data: cleanupRequiredFailure(staleTarget) });
    });

    expect(
      view.container.querySelector(
        '[data-standalone-access-code-creation="cleanup-required"]'
      )
    ).not.toBeNull();
    expect(view.getByText(/still ambiguous/)).toBeDefined();
    expect(view.getByText(cleanupTargetNotice("Stale Booth"))).toBeDefined();
    expect(
      view.getByRole("checkbox", {
        name: standaloneAccessCodeCleanupConfirmationLabel,
      })
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("requires a fresh confirmation when the server reports a new cleanup target", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({
          attemptId: priorAttemptId,
          name: "Stale Booth",
        }),
      });
    });
    fireEvent.click(
      view.getByRole("checkbox", {
        name: standaloneAccessCodeCleanupConfirmationLabel,
      })
    );
    await submitCleanupConfirmation(view);
    await waitFor(() =>
      expect(
        view.getByRole("form", { name: "Create an access code" })
      ).toBeDefined()
    );
    await fillForm(view);
    await submitForm(view);

    const nextAttemptId = "01980000-0000-7000-8000-0000000000bb";
    act(() => {
      actionOptions?.onSuccess({
        data: cleanupRequiredFailure({
          attemptId: nextAttemptId,
          name: "Fresh Booth",
        }),
      });
    });

    expect(view.getByText(cleanupTargetNotice("Fresh Booth"))).toBeDefined();
    expect(view.queryByText(cleanupTargetNotice("Stale Booth"))).toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);

    const freshCheckbox = view.getByRole("checkbox", {
      name: standaloneAccessCodeCleanupConfirmationLabel,
    });
    expect(freshCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.click(freshCheckbox);
    await submitCleanupConfirmation(view);
    await waitFor(() =>
      expect(
        view.getByRole("form", { name: "Create an access code" })
      ).toBeDefined()
    );
    await fillForm(view);
    await submitForm(view);

    const reconfirmedInput = execute.mock
      .calls[2][0] as CreateStandaloneAccessCodeActionInput;
    expect(reconfirmedInput.providerCredentialRemovedAttemptId).toBe(
      nextAttemptId
    );
    expect(reconfirmedInput.providerCredentialRemovedAttemptId).not.toBe(
      priorAttemptId
    );
  });

  test("does not resend the cleanup confirmation for a changed window", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: ambiguousFailure({ attemptId: priorAttemptId, name: "Booth A" }),
      });
    });
    fireEvent.click(
      view.getByRole("checkbox", {
        name: standaloneAccessCodeCleanupConfirmationLabel,
      })
    );
    await submitCleanupConfirmation(view);
    await waitFor(() =>
      expect(
        view.getByRole("form", { name: "Create an access code" })
      ).toBeDefined()
    );

    await fillForm(view);
    fireEvent.input(view.getByLabelText("Name"), {
      target: { value: "Booth B" },
    });
    await submitForm(view);
    const changedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(changedInput.name).toBe("Booth B");
    expect("providerCredentialRemovedAttemptId" in changedInput).toBe(false);
  });

  test("keeps the same attempt id when the transport fails", async () => {
    withActionOptions();
    const view = await renderForm();
    await fillForm(view);
    await submitForm(view);

    act(() => {
      actionOptions?.onTransportError();
    });

    expect(
      view.getByText(
        "The server could not be reached. This attempt is kept, so you can safely try again."
      )
    ).toBeDefined();

    await submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;
    const retryInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(retryInput.attemptId).toBe(firstInput.attemptId);
  });
});
