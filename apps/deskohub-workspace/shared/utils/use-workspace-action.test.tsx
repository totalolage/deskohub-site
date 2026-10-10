import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { useWorkspaceAction } from "./use-workspace-action";

type ActionResult = {
  readonly data?: string;
  readonly serverError?: string;
  readonly validationErrors?: { readonly formErrors: readonly string[] };
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const renderWorkspaceAction = (
  action: (input: undefined) => Promise<ActionResult>,
  withTransportHandler = true
) => {
  const onError = mock();
  const onTransportError = mock();
  const { result } = renderHook(() =>
    useWorkspaceAction(action, {
      actionName: "test",
      onError,
      ...(withTransportHandler && { onTransportError }),
    })
  );
  return { onError, onTransportError, result };
};

describe("useWorkspaceAction", () => {
  test("reports a rejected action call only as a transport error", async () => {
    const transportFailure = new TypeError("Failed to fetch");
    const { onError, onTransportError, result } = renderWorkspaceAction(() =>
      Promise.reject(transportFailure)
    );

    await act(async () => {
      result.current.execute(undefined);
    });

    await waitFor(() => expect(result.current.hasErrored).toBe(true));
    expect(onTransportError).toHaveBeenCalledTimes(1);
    expect(onTransportError.mock.calls[0]?.[0]).toMatchObject({
      error: transportFailure,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  test("still reports server errors through onError", async () => {
    const { onError, onTransportError, result } = renderWorkspaceAction(() =>
      Promise.resolve({ serverError: "Not cancellable." })
    );

    await act(async () => {
      result.current.execute(undefined);
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      error: { serverError: "Not cancellable." },
    });
    expect(onTransportError).not.toHaveBeenCalled();
  });

  test("still reports validation errors through onError", async () => {
    const validationErrors = { formErrors: ["Invalid input."] };
    const { onError, onTransportError, result } = renderWorkspaceAction(() =>
      Promise.resolve({ validationErrors })
    );

    await act(async () => {
      result.current.execute(undefined);
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      error: { validationErrors },
    });
    expect(onTransportError).not.toHaveBeenCalled();
  });

  test("keeps thrown errors in onError without a transport handler", async () => {
    const transportFailure = new TypeError("Failed to fetch");
    const { onError, result } = renderWorkspaceAction(
      () => Promise.reject(transportFailure),
      false
    );

    await act(async () => {
      result.current.execute(undefined);
    });

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      error: { thrownError: transportFailure },
    });
  });
});
