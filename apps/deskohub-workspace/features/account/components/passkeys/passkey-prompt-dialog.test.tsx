import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { PasskeyCreationResult } from "@/features/account/passkeys";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { PasskeyPromptDialog } = await import("./passkey-prompt-dialog");

afterAll(unregisterWorkspaceComponentTestEnv);
afterEach(cleanup);

const locale = "en-US";

const renderPrompt = (createPasskey: () => Promise<PasskeyCreationResult>) => {
  const onCreated = mock(() => undefined);
  const onDismiss = mock(() => undefined);
  const view = render(
    <PasskeyPromptDialog
      createPasskey={createPasskey}
      locale={locale}
      onCreated={onCreated}
      onDismiss={onDismiss}
      open
    />
  );
  const createButton = () => {
    const element = view.baseElement.querySelector("#passkey-prompt-create");
    if (!(element instanceof HTMLButtonElement)) {
      throw new Error("Missing the create button");
    }
    return element;
  };
  const failureShown = () =>
    view.baseElement.textContent?.includes(
      m.accountPasskeyCreateFailed({}, { locale })
    ) ?? false;
  const create = async () => {
    await act(async () => {
      fireEvent.click(createButton());
    });
  };
  return { onCreated, onDismiss, createButton, failureShown, create };
};

describe("PasskeyPromptDialog", () => {
  test("a created passkey reports back without a failure", async () => {
    const prompt = renderPrompt(() => Promise.resolve("created"));

    await prompt.create();

    expect(prompt.onCreated).toHaveBeenCalledTimes(1);
    expect(prompt.failureShown()).toBe(false);
  });

  test("a cancelled browser prompt stays silent", async () => {
    const prompt = renderPrompt(() => Promise.resolve("cancelled"));

    await prompt.create();

    expect(prompt.onCreated).not.toHaveBeenCalled();
    expect(prompt.failureShown()).toBe(false);
  });

  test.each([
    "failed",
    "reauthentication-required",
  ] satisfies PasskeyCreationResult[])(
    "a %s creation shows the failure until the next attempt",
    async (result) => {
      const createPasskey = mock(() =>
        Promise.resolve<PasskeyCreationResult>(result)
      );
      const prompt = renderPrompt(createPasskey);

      await prompt.create();
      expect(prompt.onCreated).not.toHaveBeenCalled();
      expect(prompt.failureShown()).toBe(true);

      createPasskey.mockImplementation(() => Promise.resolve("cancelled"));
      await prompt.create();
      expect(prompt.failureShown()).toBe(false);
    }
  );

  test("Escape dismisses the prompt, except while a passkey is being created", async () => {
    const pending = Promise.withResolvers<PasskeyCreationResult>();
    const prompt = renderPrompt(() => pending.promise);

    await prompt.create();
    expect(prompt.createButton().disabled).toBe(true);
    fireEvent.keyDown(prompt.createButton(), { key: "Escape" });
    expect(prompt.onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve("cancelled");
      await pending.promise;
    });
    expect(prompt.createButton().disabled).toBe(false);
    fireEvent.keyDown(prompt.createButton(), { key: "Escape" });
    expect(prompt.onDismiss).toHaveBeenCalledTimes(1);
  });
});
