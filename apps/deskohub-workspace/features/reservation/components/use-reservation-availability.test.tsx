import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  MeetingRoomWorkspaceAvailabilityQuery,
  PreloadedWorkspaceAvailability,
  WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { useReservationAvailability } from "./use-reservation-availability";

const availabilityResponse = {
  from: "2099-07-30",
  to: "2099-07-30",
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
} satisfies WorkspaceAvailability;

const jsonResponse = (body: WorkspaceAvailability) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const queryStartingAt = (
  hour: number
): MeetingRoomWorkspaceAvailabilityQuery => ({
  kind: "meeting-room",
  from: "2099-07-30",
  to: "2099-07-30",
  startsAt: `2099-07-30T${String(hour).padStart(2, "0")}:00:00Z`,
  endsAt: `2099-07-30T${String(hour + 1).padStart(2, "0")}:00:00Z`,
});

type AvailabilityFetch = (url: string) => Promise<Response>;

const mockAvailabilityFetch = (respond: AvailabilityFetch) => {
  const fetch = mock((request: RequestInfo | URL) => respond(String(request)));
  globalThis.fetch = fetch as typeof globalThis.fetch;
  return fetch;
};

const renderAvailability = (
  query: MeetingRoomWorkspaceAvailabilityQuery,
  options: Parameters<typeof useReservationAvailability>[1] = {}
) => {
  // Zero retry delay keeps the hook's retry count without real backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const view = renderHook(
    ({ query }) => useReservationAvailability(query, options),
    {
      initialProps: { query },
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    }
  );
  const refetch = () =>
    queryClient.refetchQueries({
      predicate: ({ queryKey }) => queryKey[0] === "workspace-availability",
    });
  return Object.assign(view, { refetch });
};

describe("useReservationAvailability", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("retries a failed request three times, then reports no availability", async () => {
    const fetch = mockAvailabilityFetch(() =>
      Promise.reject(new Error("Availability failed"))
    );

    const { result } = renderAvailability(queryStartingAt(8));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(result.current.availability).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  test("is not pending during a background refetch of settled availability", async () => {
    let respondToRefetch: ((response: Response) => void) | undefined;
    let isRefetching = false;
    mockAvailabilityFetch(() =>
      isRefetching
        ? new Promise((resolve) => {
            respondToRefetch = resolve;
          })
        : Promise.resolve(jsonResponse(availabilityResponse))
    );
    const view = renderAvailability(queryStartingAt(8));
    await waitFor(() =>
      expect(view.result.current.availability).not.toBeNull()
    );

    isRefetching = true;
    let refetch: Promise<void> | undefined;
    act(() => {
      refetch = view.refetch();
    });
    await waitFor(() => expect(respondToRefetch).toBeDefined());

    expect(view.result.current.isPending).toBe(false);
    expect(view.result.current.isError).toBe(false);
    expect(view.result.current.availability).toEqual(availabilityResponse);

    await act(async () => {
      respondToRefetch?.(jsonResponse(availabilityResponse));
      await refetch;
    });
  });

  test("stays pending while retrying after a failed refresh of settled availability", async () => {
    let mode: "available" | "failing" | "retrying" = "available";
    let respondToRetry: ((response: Response) => void) | undefined;
    mockAvailabilityFetch(() => {
      if (mode === "failing") {
        return Promise.reject(new Error("Availability refresh failed"));
      }
      if (mode === "retrying") {
        return new Promise((resolve) => {
          respondToRetry = resolve;
        });
      }
      return Promise.resolve(jsonResponse(availabilityResponse));
    });
    const view = renderAvailability(queryStartingAt(8));
    await waitFor(() =>
      expect(view.result.current.availability).not.toBeNull()
    );

    mode = "failing";
    await act(async () => {
      await view.refetch();
    });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(view.result.current.isPending).toBe(false);
    expect(view.result.current.availability).toBeNull();

    mode = "retrying";
    let retry: Promise<void> | undefined;
    act(() => {
      retry = view.refetch();
    });
    await waitFor(() => expect(respondToRetry).toBeDefined());
    // TanStack keeps the error status while the retry is in flight; the hook
    // reports it as pending, not failed.
    expect(view.result.current.isError).toBe(false);
    expect(view.result.current.isPending).toBe(true);
    expect(view.result.current.availability).toBeNull();

    await act(async () => {
      respondToRetry?.(jsonResponse(availabilityResponse));
      await retry;
    });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(view.result.current.availability).toEqual(availabilityResponse);
  });

  test("debounces rapid query changes into one request for the latest query", async () => {
    const fetch = mockAvailabilityFetch(() =>
      Promise.resolve(jsonResponse(availabilityResponse))
    );
    const view = renderAvailability(queryStartingAt(8), { debounceMs: 250 });
    await waitFor(() =>
      expect(view.result.current.availability).not.toBeNull()
    );
    expect(fetch).toHaveBeenCalledTimes(1);

    jest.useFakeTimers();
    view.rerender({ query: queryStartingAt(9) });
    act(() => jest.advanceTimersByTime(100));
    view.rerender({ query: queryStartingAt(10) });
    act(() => jest.advanceTimersByTime(200));

    expect(view.result.current.isPending).toBe(true);
    expect(view.result.current.availability).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(50));
    jest.useRealTimers();

    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toContain(
      `startsAt=${encodeURIComponent(queryStartingAt(10).startsAt)}`
    );
  });

  describe("with page-loaded availability", () => {
    const preloaded = (
      query: MeetingRoomWorkspaceAvailabilityQuery,
      loadedAt = Date.now()
    ): PreloadedWorkspaceAvailability => ({
      query,
      availability: availabilityResponse,
      loadedAt,
    });
    const renderPreloaded = (
      query: MeetingRoomWorkspaceAvailabilityQuery,
      initialAvailability: ReadonlyArray<PreloadedWorkspaceAvailability>
    ) =>
      renderAvailability(query, {
        initialAvailability,
        replacementToken: "sealed-replacement",
      });

    test("renders preloaded availability for a matching query without fetching", () => {
      const fetch = mockAvailabilityFetch(() => new Promise(() => undefined));
      const query = queryStartingAt(8);

      const { result } = renderPreloaded(query, [
        // Key order differs from the query; the query key hash ignores it.
        preloaded({
          endsAt: query.endsAt,
          startsAt: query.startsAt,
          to: query.to,
          from: query.from,
          kind: query.kind,
        }),
      ]);

      expect(result.current.isPending).toBe(false);
      expect(result.current.availability).toEqual(availabilityResponse);
      expect(fetch).not.toHaveBeenCalled();
    });

    test("keeps a fresh page-loaded seed through the initial mount", async () => {
      const fetch = mockAvailabilityFetch(() => new Promise(() => undefined));
      const query = queryStartingAt(8);

      const { result } = renderPreloaded(query, [preloaded(query)]);

      // Mount effects and any scheduled fetch run before this settles.
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(result.current.isPending).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    test("fetches a query the page did not preload", async () => {
      const fetch = mockAvailabilityFetch(() => new Promise(() => undefined));
      const query = queryStartingAt(8);

      const { result } = renderPreloaded(query, [
        preloaded(queryStartingAt(9)),
      ]);

      expect(result.current.availability).toBeNull();
      expect(result.current.isPending).toBe(true);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(fetch.mock.calls[0]?.[0]).toContain(
        `startsAt=${encodeURIComponent(query.startsAt)}`
      );
    });

    test("refreshes stale preloaded availability while still rendering it", async () => {
      const fetch = mockAvailabilityFetch(() => new Promise(() => undefined));
      const query = queryStartingAt(8);

      const { result } = renderPreloaded(query, [
        preloaded(query, Date.now() - 60_000),
      ]);

      expect(result.current.availability).toEqual(availabilityResponse);
      expect(result.current.isPending).toBe(false);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    });
  });
});
