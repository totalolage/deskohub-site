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

  test("drops a superseded call's transport error", async () => {
    const transportFailure = new TypeError("Failed to fetch");
    let rejectFirst: (error: TypeError) => void = () => undefined;
    const calls = [
      () =>
        new Promise<ActionResult>((_, reject) => {
          rejectFirst = reject;
        }),
      () => Promise.resolve({ data: "newer" }),
    ];
    const onSuccess = mock();
    const onTransportError = mock();
    const { result } = renderHook(() =>
      useWorkspaceAction(
        async (_input: undefined) => {
          const call = calls.shift();
          if (!call) throw new Error("Unexpected call");
          return call();
        },
        { onSuccess, onTransportError }
      )
    );

    let superseded: Promise<unknown> = Promise.resolve();
    await act(async () => {
      superseded = result.current.executeAsync(undefined);
      result.current.execute(undefined);
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectFirst(transportFailure);
      await superseded.catch(() => undefined);
    });

    expect(
      await superseded.then(
        () => "resolved",
        (error) => error
      )
    ).toBe(transportFailure);
    expect(onTransportError).not.toHaveBeenCalled();
    expect(onSuccess.mock.calls[0]?.[0]).toMatchObject({ data: "newer" });
    expect(result.current.hasSucceeded).toBe(true);
  });

  test("drops a transport error that settles after a reset", async () => {
    let rejectCall: (error: TypeError) => void = () => undefined;
    const onTransportError = mock();
    const { result } = renderHook(() =>
      useWorkspaceAction(
        (_input: undefined) =>
          new Promise<ActionResult>((_, reject) => {
            rejectCall = reject;
          }),
        { onTransportError }
      )
    );

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current.executeAsync(undefined);
    });
    await act(async () => {
      result.current.reset();
      rejectCall(new TypeError("Failed to fetch"));
      await pending.catch(() => undefined);
    });

    expect(onTransportError).not.toHaveBeenCalled();
    expect(result.current.isIdle).toBe(true);
  });
});
