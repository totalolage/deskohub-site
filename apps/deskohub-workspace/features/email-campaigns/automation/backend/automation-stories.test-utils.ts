import type { AudienceFilter } from "../../audience-filter";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";

/**
 * Story 1 (design §2.4): a review request after a second visit within a
 * month, sent at the next 10:00 in Prague at least two hours after it.
 */
export const reviewRequestFlow = automationFlowFixture({
  trigger: { _tag: "ReservationFinished" },
  steps: [
    {
      _tag: "Condition",
      id: "second-visit-within-a-month",
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "reservationCount",
            _tag: "Condition",
            params: {
              dateBasis: "visit",
              period: {
                _tag: "TriggerWindow",
                side: "before",
                count: 1,
                unit: "month",
              },
            },
            operator: "eq",
            value: 2,
          },
          {
            attribute: "firstVisit",
            _tag: "Condition",
            operator: "in",
            value: {
              _tag: "TriggerWindow",
              side: "before",
              count: 1,
              unit: "month",
            },
          },
          {
            attribute: "campaignEmailCount",
            _tag: "Condition",
            params: {
              purpose: "any",
              period: { _tag: "AnyTime" },
              campaign: { _tag: "This" },
            },
            operator: "eq",
            value: 0,
          },
        ],
      },
    },
    {
      _tag: "Wait",
      id: "settle",
      wait: { _tag: "Duration", count: 2, unit: "hour" },
    },
    {
      _tag: "Wait",
      id: "ten-oclock",
      wait: { _tag: "Calendar", expression: { hours: [10] } },
    },
    { _tag: "Send", id: "send" },
  ],
});

/**
 * Story 2's saved audience (design §2.5), "Lapsed regulars": at least two
 * visits already started and none in the last month.
 */
export const lapsedRegularsFilter: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [
    {
      attribute: "reservationCount",
      _tag: "Condition",
      params: { dateBasis: "visit", period: { _tag: "Past" } },
      operator: "gte",
      value: 2,
    },
    {
      attribute: "reservationCount",
      _tag: "Condition",
      params: {
        dateBasis: "visit",
        period: { _tag: "Last", count: 1, unit: "month" },
      },
      operator: "eq",
      value: 0,
    },
  ],
};

/**
 * Story 2 (design §2.5): a come-back offer every Monday at 10:00 to
 * customers not offered it in the last three months.
 */
export const comeBackOfferFlow = automationFlowFixture({
  trigger: {
    _tag: "Schedule",
    calendar: { hours: [10], weekdays: ["monday"] },
  },
  steps: [
    {
      _tag: "Condition",
      id: "not-offered-recently",
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "campaignEmailCount",
            _tag: "Condition",
            params: {
              purpose: "any",
              period: { _tag: "Last", count: 3, unit: "month" },
              campaign: { _tag: "This" },
            },
            operator: "eq",
            value: 0,
          },
        ],
      },
    },
    { _tag: "Send", id: "send" },
  ],
});
