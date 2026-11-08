import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OperationUnavailable } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import { stubCampaignPageQueries } from "../../campaign-operation-query.test-utils";
import { automationFlowFixture } from "../activation/automation-detail.test-utils";
import { triggerPreviewKey } from "./automation-flow-editing";
import {
  calendarPreviewFailureCopy,
  calendarPreviewView,
} from "./calendar-preview";

const port = stubCampaignPageQueries();
const lookups = { discountGroups: [] };
const loadAudienceValueLookups = mock(async () => lookups);
mock.module("../../audiences/audience-value-lookups.server", () => ({
  loadAudienceValueLookups,
}));

const { loadAutomationFlowBuilderData } = await import(
  "./automation-flow-page-data.server"
);

const locale = "en-US";
const inputsOf = (name: string) =>
  port.invoked.filter((call) => call.name === name).map(({ input }) => input);

const audiences = [
  { id: "regulars", title: "Regulars", archivedAt: null },
  { id: "retired", title: "Retired", archivedAt: "2026-09-01T08:00:00.000Z" },
  { id: "former", title: "Former", archivedAt: "2026-09-02T08:00:00.000Z" },
];
const preview = {
  description: "Synthetic calendar sentence",
  nextStarts: ["2026-11-06T07:00:00.000Z"],
  frequency: { maxFiresPerHour: 1, firesMoreThanHourly: false },
};
const triggerCalendar = { minutes: [0], hours: [9] };
const waitCalendar = { hours: [10] };

/**
 * A schedule flow whose nested condition checks the archived `retired`
 * audience beside a locale, with a calendar wait and a duration wait.
 */
const scheduleFlow = () =>
  automationFlowFixture({
    trigger: { _tag: "Schedule", calendar: triggerCalendar },
    steps: [
      {
        _tag: "Condition",
        id: "check",
        filter: {
          _tag: "Group",
          operator: "and",
          filters: [
            {
              _tag: "Condition",
              attribute: "locale",
              operator: "anyOf",
              value: ["en-US"],
            },
            {
              _tag: "Group",
              operator: "or",
              filters: [
                {
                  _tag: "InAudience",
                  audienceId: "retired",
                  operator: "in",
                },
              ],
            },
          ],
        },
      },
      {
        _tag: "Wait",
        id: "pause",
        wait: { _tag: "Duration", count: 2, unit: "day" },
      },
      {
        _tag: "Wait",
        id: "until",
        wait: { _tag: "Calendar", expression: waitCalendar },
      },
      { _tag: "Send", id: "send" },
    ],
  });

beforeEach(() => {
  port.access.set("administrator");
  port.invoked.length = 0;
  loadAudienceValueLookups.mockClear();
  port.responses = {
    listCampaignAudiences: Effect.succeed(audiences),
    previewCalendarExpression: Effect.succeed(preview),
  };
});

describe("loadAutomationFlowBuilderData", () => {
  test("offers only unarchived audiences and previews nothing without a flow", async () => {
    const data = await loadAutomationFlowBuilderData(null, locale);

    expect(data).toEqual({
      lookups,
      savedAudiences: [{ id: "regulars", name: "Regulars" }],
      calendarPreviews: {},
    });
    expect(inputsOf("previewCalendarExpression")).toEqual([]);
  });

  test("keeps archived audiences the flow's nested conditions check", async () => {
    const data = await loadAutomationFlowBuilderData(scheduleFlow(), locale);

    expect(data.savedAudiences).toEqual([
      { id: "regulars", name: "Regulars" },
      { id: "retired", name: "Retired" },
    ]);
  });

  test("previews the schedule and each calendar wait under its key and usage", async () => {
    const data = await loadAutomationFlowBuilderData(scheduleFlow(), locale);

    expect(inputsOf("previewCalendarExpression")).toEqual([
      { expression: triggerCalendar, usage: "trigger", locale },
      { expression: waitCalendar, usage: "wait", locale },
    ]);
    expect(data.calendarPreviews).toEqual({
      [triggerPreviewKey]: calendarPreviewView(preview, locale),
      until: calendarPreviewView(preview, locale),
    });
  });

  test("previews only calendar waits for an event trigger", async () => {
    const flow = automationFlowFixture({
      steps: [
        {
          _tag: "Wait",
          id: "until",
          wait: { _tag: "Calendar", expression: waitCalendar },
        },
        { _tag: "Send", id: "send" },
      ],
    });

    const data = await loadAutomationFlowBuilderData(flow, locale);

    expect(inputsOf("previewCalendarExpression")).toEqual([
      { expression: waitCalendar, usage: "wait", locale },
    ]);
    expect(Object.keys(data.calendarPreviews)).toEqual(["until"]);
  });

  test("shows a refused preview as failed, with the port's code", async () => {
    const failure = new OperationUnavailable({
      code: "calendar-never-occurs",
      message: "synthetic refusal",
    });
    port.responses.previewCalendarExpression = Effect.fail(failure);

    const data = await loadAutomationFlowBuilderData(scheduleFlow(), locale);

    const failed = {
      _tag: "Failed",
      message: describeCampaignOperationFailure(
        failure,
        calendarPreviewFailureCopy,
        locale
      ),
      code: "calendar-never-occurs",
    };
    expect(data.calendarPreviews).toEqual({
      [triggerPreviewKey]: failed,
      until: failed,
    });
  });
});
