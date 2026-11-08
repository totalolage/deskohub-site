import { describe, expect, test } from "bun:test";
import {
  CustomerOrderStatus,
  type CustomerOrderStatus as OrderStatus,
} from "@deskohub/workspace-customer-api";
import { Duration } from "effect";
import {
  nextPaymentReturnPoll,
  paymentReturnPollingStatuses,
} from "../../booking/payment-return-polling";
import {
  AutomaticRefresh,
  nextAutomaticRefresh,
  type StatusVisit,
  statusVisitOf,
} from "./status-refresh-rules";

const enoughBudget = 20;

const delaysUntilStop = (visit: StatusVisit, status: OrderStatus) => {
  const delays: Array<number> = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = nextAutomaticRefresh({
      visit,
      attempt,
      remainingBudget: enoughBudget,
      status,
    });
    if (AutomaticRefresh.$is("Stopped")(next)) {
      return { delays, reason: next.reason };
    }
    delays.push(Duration.toSeconds(next.delay));
  }
  throw new Error("the schedule never stopped");
};

describe("statusVisitOf", () => {
  test("only after=payment marks a visit straight from payment", () => {
    expect(statusVisitOf("payment")).toBe("after-payment");
    expect(statusVisitOf(undefined)).toBe("normal");
    expect(statusVisitOf("")).toBe("normal");
    expect(statusVisitOf("Payment")).toBe("normal");
    expect(statusVisitOf(["payment", "payment"])).toBe("normal");
  });
});

describe("nextAutomaticRefresh", () => {
  test("a normal visit refreshes after 10, 20 and 40 seconds, then stops", () => {
    expect(delaysUntilStop("normal", "pending")).toEqual({
      delays: [10, 20, 40],
      reason: "exhausted",
    });
  });

  test("a visit after payment follows the payment-return schedule", () => {
    const status = "paid_waiting_fulfillment";
    const expected: Array<number> = [];
    for (let attempt = 0; ; attempt++) {
      const next = nextPaymentReturnPoll(attempt, enoughBudget, status);
      if (next._tag === "None") break;
      expected.push(Duration.toSeconds(next.value));
    }

    expect(delaysUntilStop("after-payment", status)).toEqual({
      delays: expected,
      reason: "exhausted",
    });
  });

  test.each(
    CustomerOrderStatus.literals.filter(
      (status) => !paymentReturnPollingStatuses.has(status)
    )
  )("stops at once on %s, which the site doesn't refresh", (status) => {
    for (const visit of ["normal", "after-payment"] as const) {
      expect(
        nextAutomaticRefresh({
          visit,
          attempt: 0,
          remainingBudget: enoughBudget,
          status,
        })
      ).toEqual(AutomaticRefresh.Stopped({ reason: "settled" }));
    }
  });

  test.each(["normal", "after-payment"] as const)(
    "a %s visit stops when fewer than 8 reads are left",
    (visit) => {
      const at = (remainingBudget: number) =>
        nextAutomaticRefresh({
          visit,
          attempt: 0,
          remainingBudget,
          status: "pending",
        });

      expect(at(8)._tag).toBe("After");
      expect(at(7)).toEqual(AutomaticRefresh.Stopped({ reason: "budget" }));
      expect(at(0)).toEqual(AutomaticRefresh.Stopped({ reason: "budget" }));
    }
  );
});
