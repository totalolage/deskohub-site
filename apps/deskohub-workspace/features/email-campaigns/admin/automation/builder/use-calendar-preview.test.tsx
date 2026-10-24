import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const preview = (maxFiresPerHour: number) => ({
  data: {
    _tag: "Success",
    output: {
      description: "synthetic",
      nextStarts: [],
      frequency: {
        maxFiresPerHour,
        firesMoreThanHourly: maxFiresPerHour > 1,
      },
    },
  },
});

const portFailure = (code: string) => ({
  data: {
    _tag: "Failure",
    category: "InvalidInput",
    code,
    message: "synthetic",
  },
});

type PreviewResult = ReturnType<typeof preview | typeof portFailure>;

type Settle = {
  readonly resolve: (result: PreviewResult) => void;
  readonly reject: (error: TypeError) => void;
};

const pendingCalls: Settle[] = [];
const runCampaignOperation = mock(
  () =>
    new Promise<PreviewResult>((resolve, reject) => {
      pendingCalls.push({ resolve, reject });
    })
);

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation,
}));

const call = (index: number) => {
  const settle = pendingCalls[index];
  if (!settle) throw new Error(`No preview call ${index}`);
  return settle;
};

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  pendingCalls.length = 0;
  runCampaignOperation.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const renderPreview = async () => {
  const { useCalendarPreview } = await import("./use-calendar-preview");
  const view = renderHook(() => useCalendarPreview(undefined, "schedule"), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <RouteLocaleProvider locale="en-US">{children}</RouteLocaleProvider>
    ),
  });
  return view;
};

test("keeps the newer preview when an older request fails later", async () => {
  const view = await renderPreview();

  await act(async () => {
    view.result.current.refresh({ hours: [9] });
    view.result.current.refresh({ hours: [10] });
  });
  await act(async () => {
    call(1).resolve(preview(1));
  });
  await act(async () => {
    call(0).reject(new TypeError("Failed to fetch"));
  });

  expect(view.result.current.preview).toMatchObject({
    _tag: "Ready",
    frequency: { maxFiresPerHour: 1 },
  });
});

test("keeps the newer preview when an older request's port refusal lands later", async () => {
  const view = await renderPreview();

  await act(async () => {
    view.result.current.refresh({ hours: [9], minutes: [5] });
    view.result.current.refresh({ hours: [9], minutes: [0, 15, 30, 45] });
  });
  await act(async () => {
    call(1).resolve(preview(4));
  });
  await act(async () => {
    call(0).resolve(portFailure("schedule-minutes-not-allowed"));
  });

  expect(view.result.current.preview).toMatchObject({
    _tag: "Ready",
    frequency: { maxFiresPerHour: 4 },
  });
});

test("shows the latest request's failure with the port's code", async () => {
  const view = await renderPreview();

  await act(async () => {
    view.result.current.refresh({ hours: [9] });
    view.result.current.refresh({ hours: [9], minutes: [5] });
  });
  await act(async () => {
    call(0).resolve(preview(1));
  });
  await act(async () => {
    call(1).resolve(portFailure("schedule-minutes-not-allowed"));
  });

  expect(view.result.current.preview).toMatchObject({
    _tag: "Failed",
    code: "schedule-minutes-not-allowed",
  });
  expect(view.result.current.pending).toBe(false);
});
