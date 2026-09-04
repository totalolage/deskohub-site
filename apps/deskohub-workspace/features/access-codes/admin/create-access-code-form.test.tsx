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
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  shiftStandaloneAccessCodeLocalEnd,
  standaloneAccessCodeMaximumDurationHours,
} from "./create-access-code";

const writeText = mock(() => Promise.resolve());
const execute = mock();

interface CreateStandaloneAccessCodeActionInput {
  readonly attemptId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
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
  unregisterWorkspaceComponentTestEnv();
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

const fillForm = (view: ReturnType<typeof render>) => {
  fireEvent.change(view.getByLabelText("Name"), {
    target: { value: "Booth A" },
  });
  fireEvent.change(view.getByLabelText("Starts"), {
    target: { value: "2026-09-10T10:00" },
  });
  fireEvent.change(view.getByLabelText("Ends"), {
    target: { value: "2026-09-10T12:00" },
  });
};

const submitForm = (view: ReturnType<typeof render>) => {
  fireEvent.submit(view.getByRole("form", { name: "Create an access code" }));
};

const renderForm = async () => {
  const { CreateStandaloneAccessCodeForm } = await import(
    "./create-access-code-form"
  );
  return render(<CreateStandaloneAccessCodeForm />);
};

describe("CreateStandaloneAccessCodeForm", () => {
  test("collects only the name and the whole-hour window", async () => {
    const view = await renderForm();

    const name = view.getByLabelText("Name") as HTMLInputElement;
    expect(name.maxLength).toBe(60);
    const startsAt = view.getByLabelText("Starts") as HTMLInputElement;
    expect(startsAt.type).toBe("datetime-local");
    expect(startsAt.step).toBe("3600");
    const endsAt = view.getByLabelText("Ends") as HTMLInputElement;
    expect(endsAt.type).toBe("datetime-local");
    expect(endsAt.step).toBe("3600");
    expect(view.getByText("Access window (Europe/Prague)")).toBeDefined();
    expect(view.queryByText(/Duration:/)).toBeNull();
  });

  test("derives the end bounds from the start across daylight saving time", async () => {
    const view = await renderForm();

    const endsAt = view.getByLabelText("Ends") as HTMLInputElement;
    expect(endsAt.min).toBe("");
    expect(endsAt.max).toBe("");

    fireEvent.change(view.getByLabelText("Starts"), {
      target: { value: "2026-03-29T01:00" },
    });

    await waitFor(() => expect(endsAt.min).toBe("2026-03-29T03:00"));
    expect(endsAt.max).toBe(
      shiftStandaloneAccessCodeLocalEnd({
        startsAt: "2026-03-29T01:00",
        hours: standaloneAccessCodeMaximumDurationHours,
      })
    );
  });

  test("shows a concise duration for a valid window", async () => {
    const view = await renderForm();
    fillForm(view);

    await waitFor(() =>
      expect(view.getByText("Duration: 2 hours")).toBeDefined()
    );
  });

  test("reports field errors without calling the action", async () => {
    const view = await renderForm();

    submitForm(view);

    expect(view.getByText("Enter a name for this access code.")).toBeDefined();
    expect(view.getByText("Choose a start time.")).toBeDefined();
    expect(view.getByText("Choose an end time.")).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });

  test("binds one stable attempt id to the unchanged form intent", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);

    submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    submitForm(view);
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
    fillForm(view);

    submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Booth B" },
    });
    submitForm(view);
    const secondInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(secondInput.attemptId).not.toBe(firstInput.attemptId);
    expect(secondInput.name).toBe("Booth B");
  });

  test("sends a fresh attempt id when an unchanged form is resubmitted after rejection", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);

    submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "rejected" },
      });
    });
    submitForm(view);
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
    fillForm(view);

    submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "unavailable" },
      });
    });
    submitForm(view);
    const retriedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(retriedInput.attemptId).toBe(firstInput.attemptId);
  });

  test("focuses the first invalid field after failed validation", async () => {
    const view = await renderForm();

    submitForm(view);
    expect(document.activeElement).toBe(view.getByLabelText("Name"));

    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Booth A" },
    });
    submitForm(view);
    expect(document.activeElement).toBe(view.getByLabelText("Starts"));
  });

  test("focuses each terminal result region after transition", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);
    act(() => {
      actionOptions?.onSuccess({ data: createdOutcome });
    });
    expect(document.activeElement).toBe(
      view.container.querySelector(
        '[data-standalone-access-code-creation="created"]'
      )
    );
  });

  test("focuses the already-created region without a pin", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);
    act(() => {
      actionOptions?.onSuccess({
        data: { ...createdOutcome, outcome: "already-created" },
      });
    });
    expect(document.activeElement).toBe(
      view.container.querySelector(
        '[data-standalone-access-code-creation="already-created"]'
      )
    );
  });

  test("focuses the ambiguous region after a closed attempt", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);
    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "ambiguous" },
      });
    });
    expect(document.activeElement).toBe(
      view.container.querySelector(
        '[data-standalone-access-code-creation="ambiguous"]'
      )
    );
  });

  test("clears the end range error when the start changes", async () => {
    const view = await renderForm();
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Booth A" },
    });
    fireEvent.change(view.getByLabelText("Starts"), {
      target: { value: "2026-09-10T12:00" },
    });
    fireEvent.change(view.getByLabelText("Ends"), {
      target: { value: "2026-09-10T10:00" },
    });
    submitForm(view);
    expect(
      view.getByText("The end must be 1 to 672 hours after the start.")
    ).toBeDefined();

    fireEvent.change(view.getByLabelText("Starts"), {
      target: { value: "2026-09-10T08:00" },
    });
    await waitFor(() =>
      expect(
        view.queryByText("The end must be 1 to 672 hours after the start.")
      ).toBeNull()
    );
  });

  test("reveals the one-time pin with masking and a copy action", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({ data: createdOutcome });
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
    fillForm(view);
    submitForm(view);
    const firstAttemptId = (
      execute.mock.calls[0][0] as CreateStandaloneAccessCodeActionInput
    ).attemptId;
    act(() => {
      actionOptions?.onSuccess({ data: createdOutcome });
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
    fillForm(view);
    submitForm(view);
    const nextInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(nextInput.attemptId).not.toBe(firstAttemptId);
  });

  test("never repeats the pin for an already-created attempt", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { ...createdOutcome, outcome: "already-created" },
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
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "rejected" },
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
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "ambiguous" },
      });
    });

    expect(
      view.container.querySelector(
        '[data-standalone-access-code-creation="ambiguous"]'
      )
    ).not.toBeNull();
    expect(view.getByText(/will not be retried automatically/)).toBeDefined();
    expect(view.getByText(/remove “Booth A”/)).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Start over" }));

    expect(
      view.getByRole("form", { name: "Create an access code" })
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("requires explicit confirmation before recreating an ambiguous window", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "ambiguous" },
      });
    });

    const checkbox = view.getByLabelText(
      "I removed the named access code at the lock, or verified that it is absent."
    ) as HTMLInputElement;
    expect(checkbox.type).toBe("checkbox");
    expect(checkbox.checked).toBe(false);
    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(true);

    fireEvent.click(checkbox);
    expect(
      view
        .getByRole("button", { name: "Create another access code" })
        .hasAttribute("disabled")
    ).toBe(false);

    fireEvent.submit(
      view.getByRole("form", { name: "Confirm the lock is clean" })
    );
    fillForm(view);
    submitForm(view);

    const confirmedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(confirmedInput.providerCredentialRemoved).toBe(true);

    submitForm(view);
    const followUpInput = execute.mock
      .calls[2][0] as CreateStandaloneAccessCodeActionInput;
    expect("providerCredentialRemoved" in followUpInput).toBe(false);
  });

  test("requires the confirmation again after a server-reported cleanup-required outcome", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "cleanup-required" },
      });
    });

    expect(
      view.container.querySelector(
        '[data-standalone-access-code-creation="cleanup-required"]'
      )
    ).not.toBeNull();
    expect(view.getByText(/still ambiguous/)).toBeDefined();
    expect(
      view.getByLabelText(
        "I removed the named access code at the lock, or verified that it is absent."
      )
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("does not resend the cleanup confirmation for a changed window", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onSuccess({
        data: { outcome: "failed", kind: "ambiguous" },
      });
    });
    fireEvent.click(
      view.getByLabelText(
        "I removed the named access code at the lock, or verified that it is absent."
      )
    );
    fireEvent.submit(
      view.getByRole("form", { name: "Confirm the lock is clean" })
    );

    fillForm(view);
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Booth B" },
    });
    submitForm(view);
    const changedInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;

    expect(changedInput.name).toBe("Booth B");
    expect("providerCredentialRemoved" in changedInput).toBe(false);
  });

  test("keeps the same attempt id when the transport fails", async () => {
    withActionOptions();
    const view = await renderForm();
    fillForm(view);
    submitForm(view);

    act(() => {
      actionOptions?.onTransportError();
    });

    expect(
      view.getByText(
        "The server could not be reached. This attempt is kept, so you can safely try again."
      )
    ).toBeDefined();

    submitForm(view);
    const firstInput = execute.mock
      .calls[0][0] as CreateStandaloneAccessCodeActionInput;
    const retryInput = execute.mock
      .calls[1][0] as CreateStandaloneAccessCodeActionInput;
    expect(retryInput.attemptId).toBe(firstInput.attemptId);
  });

  test("shows server errors inline and disables submission while executing", async () => {
    workspaceUseAction.mockImplementation(() => ({
      execute,
      isExecuting: true,
      result: {},
    }));
    const executingView = await renderForm();

    const submit = executingView.getByRole("button", { name: "Creating…" });
    expect(submit).toHaveProperty("disabled", true);
    cleanup();

    withActionOptions();
    const view = await renderForm();
    act(() => {
      actionOptions?.onError({
        error: { serverError: "Administrator authentication is required." },
      });
    });
    expect(
      view.getByText("Administrator authentication is required.")
    ).toBeDefined();
  });
});
