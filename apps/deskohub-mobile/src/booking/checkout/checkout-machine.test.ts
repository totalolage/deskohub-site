import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  CustomerCheckout,
  CustomerLegalDocument,
  ReferralCode,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { RememberedReferralUpdate } from "../remembered-referral";
import { BookingProblem } from "./booking-problem";
import { canPay, startCheckout, step } from "./checkout-machine";
import {
  type CheckoutCommand,
  CheckoutEvent,
  type CheckoutState,
  type CheckoutStep,
  CodeStatus,
  LegalDocuments,
  type ReviewState,
} from "./checkout-state";

const referralCode = "FRIEND-42" as ReferralCode;

const startInput = {
  checkoutSessionId: "session-1",
  locale: "cs-CZ",
  selection: { family: "cowork", date: "2026-11-20", tier: "open-space" },
  advertisedPriceToken: "advertised-1",
  rememberedReferralCode: Option.some(referralCode),
} as const;

const details = {
  bookingFor: "self",
  contact: {
    name: "Synthetic Booker",
    email: testEmailAddress("booker"),
    phone: "+420700000000",
  },
  billing: { purpose: "personal", invoice: "none" },
} as const;

const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });

const summary = (total: number) => ({
  sections: [
    {
      key: "order" as const,
      items: [{ key: "product:open-space", amount: money(total) }],
      total: money(total),
    },
  ],
  total: money(total),
});

const checkout = (
  overrides: Partial<CustomerCheckout> = {}
): CustomerCheckout => ({
  status: "ready",
  orderId: "order-1",
  payStateToken: "token-1",
  expiresAt: "2026-11-20T09:10:00.000Z",
  summary: summary(35000),
  earlyPerformanceConsent: {
    required: false,
    requiredFrom: "2026-12-04T09:00:00.000Z",
  },
  ...overrides,
});

const priceReview = {
  priceReview: {
    changedKeys: { sectionKeys: ["order"], itemKeys: ["product:open-space"] },
  },
};

const expiresAtMillis = Date.parse("2026-11-20T09:10:00.000Z");

const documents: ReadonlyArray<CustomerLegalDocument> = [
  {
    key: "terms-and-conditions",
    path: "/cs/terms",
    hash: "terms-hash-1",
    hashAlgorithm: "sha256",
  },
  {
    key: "operating-rules",
    path: "/cs/rules",
    hash: "rules-hash-1",
    hashAlgorithm: "sha256",
  },
];

const changedDocuments: ReadonlyArray<CustomerLegalDocument> = [
  {
    key: "terms-and-conditions",
    path: "/cs/terms",
    hash: "terms-hash-2",
    hashAlgorithm: "sha256",
  },
  {
    key: "operating-rules",
    path: "/cs/rules",
    hash: "rules-hash-1",
    hashAlgorithm: "sha256",
  },
];

/** Steps through events, collecting every command the transitions sent. */
const run = (
  state: CheckoutState,
  ...events: ReadonlyArray<CheckoutEvent>
): CheckoutStep =>
  events.reduce<CheckoutStep>(
    (previous, event) => {
      const next = step(previous.state, event);
      return {
        state: next.state,
        commands: [...previous.commands, ...next.commands],
      };
    },
    { state, commands: [] }
  );

/** The operation id the latest command of `tag` carries. */
const lastOperation = (
  result: CheckoutStep,
  tag: CheckoutCommand["_tag"]
): number => {
  const command = result.commands.findLast((sent) => sent._tag === tag);
  if (command === undefined || !("operationId" in command)) {
    throw new Error(`no ${tag} command was sent`);
  }
  return command.operationId;
};

const commandOf = <Tag extends CheckoutCommand["_tag"]>(
  result: CheckoutStep,
  tag: Tag
): Extract<CheckoutCommand, { readonly _tag: Tag }> => {
  const command = result.commands.findLast((sent) => sent._tag === tag);
  if (command === undefined) throw new Error(`no ${tag} command was sent`);
  return command as Extract<CheckoutCommand, { readonly _tag: Tag }>;
};

const tags = (result: CheckoutStep) => result.commands.map(({ _tag }) => _tag);

const review = (result: CheckoutStep): ReviewState => {
  if (result.state._tag !== "Review") {
    throw new Error(`expected Review, got ${result.state._tag}`);
  }
  return result.state;
};

const failed = (operationId: number, problem: BookingProblem) =>
  CheckoutEvent.CommandFailed({ operationId, problem });

const continueEvent = CheckoutEvent.Continue({
  checkoutAttemptId: "attempt-1",
  details,
});

/** Creates the hold and answers it with `created`. */
const held = (created: CustomerCheckout = checkout()) => {
  const creating = run(startCheckout(startInput), continueEvent);
  return run(
    creating.state,
    CheckoutEvent.CheckoutCreated({
      operationId: lastOperation(creating, "CreateCheckout"),
      start: created,
    })
  );
};

/** A held checkout with its documents loaded and the checkbox ticked. */
const consented = (created: CustomerCheckout = checkout()) => {
  const entered = held(created);
  return run(
    entered.state,
    CheckoutEvent.LegalDocumentsLoaded({
      operationId: lastOperation(entered, "LoadLegalDocuments"),
      documents,
    }),
    CheckoutEvent.ToggleConsent({ accepted: true })
  );
};

const paid = (state: CheckoutState) => run(state, CheckoutEvent.Pay());

describe("details", () => {
  test("starts on the details form with nothing sent", () => {
    const state = startCheckout(startInput);
    expect(state._tag).toBe("Details");
    expect(run(state).commands).toEqual([]);
  });

  test("continue creates the hold with the quote, details, ids and referral code", () => {
    const result = run(startCheckout(startInput), continueEvent);
    expect(result.state._tag).toBe("Creating");
    const command = commandOf(result, "CreateCheckout");
    expect(command.request).toEqual({
      locale: "cs-CZ",
      checkoutSessionId: "session-1",
      checkoutAttemptId: "attempt-1",
      advertisedPriceToken: "advertised-1",
      selection: startInput.selection,
      ...details,
    });
    expect(command.referralCode).toEqual(Option.some(referralCode));
  });

  test("a meeting room's early setup goes with the hold", () => {
    const result = run(
      startCheckout({ ...startInput, earlySetup: true }),
      continueEvent
    );
    expect(commandOf(result, "CreateCheckout").request.earlySetup).toBe(true);
  });

  test("the hold's selection leaves out options spelled out as undefined", () => {
    const result = run(
      startCheckout({
        ...startInput,
        selection: { ...startInput.selection, monitorOption: undefined },
      }),
      continueEvent
    );
    expect(commandOf(result, "CreateCheckout").request.selection).toEqual(
      startInput.selection
    );
    expect(
      "monitorOption" in commandOf(result, "CreateCheckout").request.selection
    ).toBe(false);
  });

  test("creating ignores another continue, so one hold is created at a time", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const again = step(creating.state, continueEvent);
    expect(again.state).toEqual(creating.state);
    expect(again.commands).toEqual([]);
  });

  test("an invalid field returns to the form with the details kept", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const result = run(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.DetailsInvalid({ field: Option.some("contact.email") })
      )
    );
    expect(result.state).toMatchObject({
      _tag: "Details",
      details: Option.some(details),
      notice: Option.some({
        _tag: "DetailsInvalid",
        field: Option.some("contact.email"),
      }),
    });
  });

  test.each([
    "availability_changed",
    "checkout_conflict",
    "quote_expired",
    "selection_invalid",
    "date_out_of_range",
    "offering_unavailable",
  ] as const)("create answered %s restarts the booking", (reason) => {
    const creating = run(startCheckout(startInput), continueEvent);
    const result = step(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.Restart({ reason })
      )
    );
    expect(result.state).toEqual({ _tag: "Restart", reason } as CheckoutState);
  });

  test("an account that needs its customer link is blocked", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const result = step(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.Blocked({ reason: "profile-missing" })
      )
    );
    expect(result.state).toMatchObject({
      _tag: "Blocked",
      reason: "profile-missing",
    });
  });

  test("a review account's hold with payment switched off is blocked", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const result = step(
      creating.state,
      CheckoutEvent.CheckoutCreated({
        operationId: lastOperation(creating, "CreateCheckout"),
        start: { status: "payment_disabled", orderId: "order-1" },
      })
    );
    expect(result.state).toMatchObject({
      _tag: "Blocked",
      reason: "payment-disabled",
    });
    expect(result.commands).toEqual([]);
  });

  test("a retryable failure keeps the form and retry resends the same attempt", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const first = commandOf(creating, "CreateCheckout");
    const notice = run(
      creating.state,
      failed(
        first.operationId,
        BookingProblem.Retryable({ kind: "rate_limited" })
      )
    );
    expect(notice.state).toMatchObject({
      _tag: "Details",
      details: Option.some(details),
      notice: Option.some({ _tag: "Retryable", kind: "rate_limited" }),
    });
    const retried = run(notice.state, CheckoutEvent.Retry());
    expect(retried.state._tag).toBe("Creating");
    const resent = commandOf(retried, "CreateCheckout");
    expect(resent.request).toEqual(first.request);
    expect(resent.operationId).not.toBe(first.operationId);
  });

  test("retry without a retryable notice sends nothing", () => {
    const result = step(startCheckout(startInput), CheckoutEvent.Retry());
    expect(result.commands).toEqual([]);
  });

  test("an answer to another operation is dropped", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const stale = step(
      creating.state,
      CheckoutEvent.CheckoutCreated({ operationId: 999, start: checkout() })
    );
    expect(stale.state).toEqual(creating.state);
    expect(stale.commands).toEqual([]);
  });

  test("the hold clock does nothing before a hold exists", () => {
    const details = startCheckout(startInput);
    expect(
      step(
        details,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 })
      ).state
    ).toEqual(details);
    const creating = run(details, continueEvent).state;
    expect(
      step(
        creating,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 })
      ).state
    ).toEqual(creating);
  });
});

describe("unconfirmed create", () => {
  test("committed, response lost: retry resends the identical request and resumes", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const first = commandOf(creating, "CreateCheckout");
    const lost = run(
      creating.state,
      failed(first.operationId, BookingProblem.Unconfirmed())
    );
    expect(lost.state).toMatchObject({ _tag: "Uncertain", retrying: false });
    expect(lost.commands).toEqual([]);

    const retried = run(lost.state, CheckoutEvent.Retry());
    const resent = commandOf(retried, "CreateCheckout");
    expect(resent.request).toEqual(first.request);
    expect(resent.referralCode).toEqual(first.referralCode);
    expect(retried.state).toMatchObject({ _tag: "Uncertain", retrying: true });
    expect(step(retried.state, CheckoutEvent.Retry()).commands).toEqual([]);

    const resumed = run(
      retried.state,
      CheckoutEvent.CheckoutCreated({
        operationId: resent.operationId,
        start: checkout(),
      })
    );
    expect(review(resumed).checkout.orderId).toBe("order-1");
    expect(tags(resumed)).toContain("LoadLegalDocuments");
  });

  test("the lost answer to the first send is dropped once a retry runs", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const first = commandOf(creating, "CreateCheckout");
    const retried = run(
      creating.state,
      failed(first.operationId, BookingProblem.Unconfirmed()),
      CheckoutEvent.Retry()
    );
    const late = step(
      retried.state,
      CheckoutEvent.CheckoutCreated({
        operationId: first.operationId,
        start: checkout(),
      })
    );
    expect(late.state).toEqual(retried.state);
  });

  test("a resend that fails without settling anything stays uncertain", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const retried = run(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.Unconfirmed()
      ),
      CheckoutEvent.Retry()
    );
    const result = run(
      retried.state,
      failed(
        lastOperation(retried, "CreateCheckout"),
        BookingProblem.Retryable({ kind: "connection" })
      )
    );
    expect(result.state).toMatchObject({
      _tag: "Uncertain",
      retrying: false,
      notice: Option.some("connection"),
    });
  });

  test("a resend answered with a conflict restarts, since no payment can have started", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const retried = run(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.Unconfirmed()
      ),
      CheckoutEvent.Retry()
    );
    const result = step(
      retried.state,
      failed(
        lastOperation(retried, "CreateCheckout"),
        BookingProblem.Restart({ reason: "checkout_conflict" })
      )
    );
    expect(result.state).toMatchObject({
      _tag: "Restart",
      reason: "checkout_conflict",
    });
  });

  test("the hold clock does nothing while a create is unsettled", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const lost = run(
      creating.state,
      failed(
        lastOperation(creating, "CreateCheckout"),
        BookingProblem.Unconfirmed()
      )
    );
    expect(
      step(
        lost.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 })
      ).state
    ).toEqual(lost.state);
  });
});

describe("review", () => {
  test("a created hold loads the legal documents and can't be paid before consent", () => {
    const result = held();
    const state = review(result);
    expect(state.checkout).toMatchObject({
      orderId: "order-1",
      payStateToken: "token-1",
      expiresAt: "2026-11-20T09:10:00.000Z",
      priceReview: Option.none(),
    });
    expect(commandOf(result, "LoadLegalDocuments").locale).toBe("cs-CZ");
    expect(state.legal._tag).toBe("Loading");
    expect(canPay(state)).toBe(false);
    expect(step(state, CheckoutEvent.Pay()).commands).toEqual([]);
  });

  test("consent binds to the loaded documents' hashes and enables pay", () => {
    const state = review(consented());
    expect(state.consent).toEqual(
      Option.some([
        { key: "terms-and-conditions", hash: "terms-hash-1" },
        { key: "operating-rules", hash: "rules-hash-1" },
      ])
    );
    expect(canPay(state)).toBe(true);
    const unticked = review(
      run(state, CheckoutEvent.ToggleConsent({ accepted: false }))
    );
    expect(unticked.consent).toEqual(Option.none());
    expect(canPay(unticked)).toBe(false);
  });

  test("the checkbox can't be ticked before the documents load", () => {
    const state = review(held());
    expect(
      review(run(state, CheckoutEvent.ToggleConsent({ accepted: true })))
        .consent
    ).toEqual(Option.none());
  });

  test("a failed document load can be reloaded", () => {
    const entered = held();
    const failedLoad = run(
      entered.state,
      failed(
        lastOperation(entered, "LoadLegalDocuments"),
        BookingProblem.Retryable({ kind: "connection" })
      )
    );
    expect(review(failedLoad).legal).toEqual(LegalDocuments.Failed());
    const reloaded = run(
      failedLoad.state,
      CheckoutEvent.ReloadLegalDocuments()
    );
    expect(review(reloaded).legal._tag).toBe("Loading");
    expect(tags(reloaded)).toEqual(["LoadLegalDocuments"]);
    expect(
      step(review(held()), CheckoutEvent.ReloadLegalDocuments()).commands
    ).toEqual([]);
  });

  test("pay submits legal consent with the accepted document versions and the referral code", () => {
    const result = paid(consented().state);
    const command = commandOf(result, "SubmitCheckout");
    expect(command.request).toEqual({
      locale: "cs-CZ",
      payStateToken: "token-1",
      legalConsent: true,
      acceptedLegalDocuments: [
        { key: "terms-and-conditions", hash: "terms-hash-1" },
        { key: "operating-rules", hash: "rules-hash-1" },
      ],
    });
    expect(command.referralCode).toEqual(Option.some(referralCode));
    expect(canPay(review(result))).toBe(false);
    expect(step(result.state, CheckoutEvent.Pay()).commands).toEqual([]);
  });

  test("pay sends early-performance consent explicitly when the booking needs it", () => {
    const result = paid(
      consented(
        checkout({
          earlyPerformanceConsent: {
            required: true,
            requiredFrom: "2026-12-04T09:00:00.000Z",
          },
        })
      ).state
    );
    expect(
      commandOf(result, "SubmitCheckout").request.earlyPerformanceConsent
    ).toBe(true);
  });

  test("a payment to make opens the payment page and tracks the submission", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      CheckoutEvent.Submitted({
        operationId: lastOperation(paying, "SubmitCheckout"),
        submission: {
          status: "payment_required",
          orderId: "order-1",
          paymentUrl: "https://gateway.example.test/pay/1",
          statusUrl:
            "https://workspace.example.test/cs/reservation/status?order=order-1",
        },
      })
    );
    expect(result.state._tag).toBe("Paying");
    expect(tags(result).slice(-2)).toEqual([
      "OpenPayment",
      "TrackBookingSubmitted",
    ]);
    expect(commandOf(result, "OpenPayment")).toMatchObject({
      orderId: "order-1",
      paymentUrl: "https://gateway.example.test/pay/1",
      returnUrl: "deskohub://reservations/order-1?after=payment",
    });
    expect(commandOf(result, "TrackBookingSubmitted").family).toBe("cowork");
  });

  test("a status URL in the app's scheme is the payment page's return URL", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      CheckoutEvent.Submitted({
        operationId: lastOperation(paying, "SubmitCheckout"),
        submission: {
          status: "payment_required",
          orderId: "order-1",
          paymentUrl: "https://gateway.example.test/pay/1",
          statusUrl: "deskohub://reservations/order-1",
        },
      })
    );
    expect(commandOf(result, "OpenPayment").returnUrl).toBe(
      "deskohub://reservations/order-1"
    );
  });

  test.each(["returned", "dismissed"] as const)(
    "a payment page that %s shows the order's status",
    (outcome) => {
      const paying = paid(consented().state);
      const opened = run(
        paying.state,
        CheckoutEvent.Submitted({
          operationId: lastOperation(paying, "SubmitCheckout"),
          submission: {
            status: "payment_required",
            orderId: "order-1",
            paymentUrl: "https://gateway.example.test/pay/1",
            statusUrl: "deskohub://reservations/order-1",
          },
        })
      );
      const result = step(
        opened.state,
        CheckoutEvent.PaymentEnded({
          operationId: lastOperation(opened, "OpenPayment"),
          result: outcome,
        })
      );
      expect(result.state).toEqual({
        _tag: "Done",
        orderId: "order-1",
      } as CheckoutState);
    }
  );

  test("a payment page that can't open can be opened again", () => {
    const paying = paid(consented().state);
    const opened = run(
      paying.state,
      CheckoutEvent.Submitted({
        operationId: lastOperation(paying, "SubmitCheckout"),
        submission: {
          status: "payment_required",
          orderId: "order-1",
          paymentUrl: "https://gateway.example.test/pay/1",
          statusUrl: "deskohub://reservations/order-1",
        },
      })
    );
    const unavailable = run(
      opened.state,
      failed(
        lastOperation(opened, "OpenPayment"),
        BookingProblem.Retryable({ kind: "payment_browser" })
      )
    );
    expect(unavailable.state).toMatchObject({
      _tag: "Paying",
      notice: Option.some("payment_browser"),
    });
    const reopened = run(unavailable.state, CheckoutEvent.Retry());
    expect(tags(reopened)).toEqual(["OpenPayment"]);
    expect(lastOperation(reopened, "OpenPayment")).not.toBe(
      lastOperation(opened, "OpenPayment")
    );
    expect(step(reopened.state, CheckoutEvent.Retry()).commands).toEqual([]);
    expect(
      step(
        reopened.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 })
      ).state
    ).toEqual(reopened.state);
  });

  test("a zero total paid skips the payment page and forgets a used referral code", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      CheckoutEvent.Submitted({
        operationId: lastOperation(paying, "SubmitCheckout"),
        submission: {
          status: "paid",
          orderId: "order-1",
          statusUrl: "deskohub://reservations/order-1",
          rememberedReferralCodeUsed: true,
        },
      })
    );
    expect(result.state).toEqual({
      _tag: "Done",
      orderId: "order-1",
    } as CheckoutState);
    expect(result.commands.slice(-2)).toEqual([
      expect.objectContaining({
        _tag: "UpdateRememberedReferral",
        update: RememberedReferralUpdate.Forget(),
      }),
      expect.objectContaining({
        _tag: "TrackBookingSubmitted",
        family: "cowork",
      }),
    ]);
  });

  test("a price changed at submission needs acceptance before paying again", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      CheckoutEvent.Submitted({
        operationId: lastOperation(paying, "SubmitCheckout"),
        submission: checkout({
          status: "price_review",
          payStateToken: "token-2",
          summary: summary(40000),
          ...priceReview,
        }),
      })
    );
    const state = review(result);
    expect(state.checkout.payStateToken).toBe("token-2");
    expect(state.checkout.priceReview).toEqual(
      Option.some(priceReview.priceReview.changedKeys)
    );
    expect(state.pending).toEqual(Option.none());
    expect(Option.isSome(state.consent)).toBe(true);
    expect(canPay(state)).toBe(false);

    const accepting = run(state, CheckoutEvent.AcceptPrice());
    expect(commandOf(accepting, "AcceptPriceChange").request).toEqual({
      locale: "cs-CZ",
      payStateToken: "token-2",
    });
    expect(canPay(review(accepting))).toBe(false);
    const accepted = run(
      accepting.state,
      CheckoutEvent.PriceAccepted({
        operationId: lastOperation(accepting, "AcceptPriceChange"),
        checkout: checkout({
          payStateToken: "token-3",
          summary: summary(40000),
        }),
      })
    );
    expect(canPay(review(accepted))).toBe(true);
    expect(
      commandOf(paid(accepted.state), "SubmitCheckout").request.payStateToken
    ).toBe("token-3");
  });

  test("a price changed before the hold was created needs acceptance first", () => {
    const entered = held(checkout({ status: "price_review", ...priceReview }));
    const loaded = run(
      entered.state,
      CheckoutEvent.LegalDocumentsLoaded({
        operationId: lastOperation(entered, "LoadLegalDocuments"),
        documents,
      }),
      CheckoutEvent.ToggleConsent({ accepted: true })
    );
    expect(review(loaded).checkout.priceReview).toEqual(
      Option.some(priceReview.priceReview.changedKeys)
    );
    expect(canPay(review(loaded))).toBe(false);
    expect(step(loaded.state, CheckoutEvent.Pay()).commands).toEqual([]);
  });

  test("accept price does nothing without a price to review", () => {
    expect(
      step(consented().state, CheckoutEvent.AcceptPrice()).commands
    ).toEqual([]);
  });
});

describe("codes", () => {
  const applying = (input = " SAVE10 ") =>
    run(
      consented().state,
      CheckoutEvent.CodeChanged({ input }),
      CheckoutEvent.ApplyCode()
    );

  test("apply sends the trimmed code with the current token and blocks pay", () => {
    const result = applying();
    const command = commandOf(result, "ApplyDiscountCode");
    expect(command.request).toEqual({
      locale: "cs-CZ",
      payStateToken: "token-1",
      code: "SAVE10",
    });
    expect(command.referralCode).toEqual(Option.some(referralCode));
    const state = review(result);
    expect(state.code.status).toEqual(CodeStatus.Applying());
    expect(canPay(state)).toBe(false);
    expect(step(state, CheckoutEvent.Pay()).commands).toEqual([]);
    expect(step(state, CheckoutEvent.ApplyCode()).commands).toEqual([]);
  });

  test("an empty code isn't sent", () => {
    expect(
      applying("   ").commands.filter(
        ({ _tag }) => _tag === "ApplyDiscountCode"
      )
    ).toEqual([]);
  });

  test("an applied code replaces the token, summary and expiry together", () => {
    const sent = applying();
    const result = run(
      sent.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: {
          ...checkout({
            payStateToken: "token-2",
            expiresAt: "2026-11-20T09:12:00.000Z",
            summary: summary(30000),
            earlyPerformanceConsent: {
              required: true,
              requiredFrom: "2026-12-04T09:00:00.000Z",
            },
          }),
          discountCode: "applied",
        },
      })
    );
    const state = review(result);
    expect(state.code).toEqual({
      input: " SAVE10 ",
      status: CodeStatus.Applied({ outcome: "applied" }),
    });
    expect(state.checkout).toMatchObject({
      payStateToken: "token-2",
      expiresAt: "2026-11-20T09:12:00.000Z",
      summary: summary(30000),
      earlyPerformanceConsent: { required: true },
    });
    // The tick didn't ask to start early, which this booking now needs.
    expect(state.consent).toEqual(Option.none());
    expect(canPay(state)).toBe(false);
    const submit = commandOf(
      run(
        state,
        CheckoutEvent.ToggleConsent({ accepted: true }),
        CheckoutEvent.Pay()
      ),
      "SubmitCheckout"
    );
    expect(submit.request.payStateToken).toBe("token-2");
    expect(submit.request.earlyPerformanceConsent).toBe(true);
  });

  test("a code answered with a price review isn't applied until the customer re-applies", () => {
    const sent = applying();
    const result = run(
      sent.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: checkout({
          status: "price_review",
          payStateToken: "token-2",
          ...priceReview,
        }),
      })
    );
    const state = review(result);
    expect(state.code).toEqual({
      input: " SAVE10 ",
      status: CodeStatus.AwaitingPriceAcceptance(),
    });
    expect(canPay(state)).toBe(false);
    const accepting = run(state, CheckoutEvent.AcceptPrice());
    const accepted = run(
      accepting.state,
      CheckoutEvent.PriceAccepted({
        operationId: lastOperation(accepting, "AcceptPriceChange"),
        checkout: checkout({ payStateToken: "token-3" }),
      })
    );
    expect(review(accepted).code.status).toEqual(
      CodeStatus.AwaitingPriceAcceptance()
    );
    const reapplied = run(accepted.state, CheckoutEvent.ApplyCode());
    expect(commandOf(reapplied, "ApplyDiscountCode").request).toEqual({
      locale: "cs-CZ",
      payStateToken: "token-3",
      code: "SAVE10",
    });
  });

  test("an accepted referral code is remembered and sent with later steps", () => {
    const sent = applying("FRIEND-77");
    const result = run(
      sent.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: {
          ...checkout({
            payStateToken: "token-2",
            rememberReferralCode: "FRIEND-77" as ReferralCode,
          }),
          discountCode: "referral_accepted",
        },
      })
    );
    expect(commandOf(result, "UpdateRememberedReferral").update).toEqual(
      RememberedReferralUpdate.Remember({ code: "FRIEND-77" as ReferralCode })
    );
    expect(review(result).code.status).toEqual(
      CodeStatus.Applied({ outcome: "referral_accepted" })
    );
    expect(
      commandOf(paid(result.state), "SubmitCheckout").referralCode
    ).toEqual(Option.some("FRIEND-77" as ReferralCode));
  });

  test("a rejected code with a replacement token adopts the token and keeps the summary", () => {
    const sent = applying();
    const result = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.CodeRejected({
          reason: "ineligible",
          replacement: Option.some({
            payStateToken: "token-2",
            expiresAt: "2026-11-20T09:15:00.000Z",
          }),
        })
      )
    );
    const state = review(result);
    expect(state.code).toEqual({
      input: " SAVE10 ",
      status: CodeStatus.Rejected({ reason: "ineligible" }),
    });
    expect(state.checkout).toMatchObject({
      payStateToken: "token-2",
      expiresAt: "2026-11-20T09:15:00.000Z",
      summary: summary(35000),
    });
    expect(canPay(state)).toBe(true);
  });

  test("a rejected code without a replacement keeps the current token", () => {
    const sent = applying();
    const result = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.CodeRejected({
          reason: "already_attributed",
          replacement: Option.none(),
        })
      )
    );
    expect(review(result).checkout.payStateToken).toBe("token-1");
    expect(canPay(review(result))).toBe(true);
  });

  test("an unknown code stays retryable: the same input can be applied again", () => {
    const sent = applying();
    const rejected = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.CodeRejected({
          reason: "unavailable",
          replacement: Option.none(),
        })
      )
    );
    const again = run(rejected.state, CheckoutEvent.ApplyCode());
    expect(commandOf(again, "ApplyDiscountCode").request.code).toBe("SAVE10");
  });

  test("editing a rejected code clears its status", () => {
    const sent = applying();
    const rejected = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.CodeRejected({
          reason: "ineligible",
          replacement: Option.none(),
        })
      ),
      CheckoutEvent.CodeChanged({ input: "OTHER" })
    );
    expect(review(rejected).code).toEqual({
      input: "OTHER",
      status: CodeStatus.Idle(),
    });
  });

  test("a code that fails without an answer can be retried as sent", () => {
    const sent = applying();
    const first = commandOf(sent, "ApplyDiscountCode");
    const notice = run(
      sent.state,
      failed(
        first.operationId,
        BookingProblem.Retryable({ kind: "rate_limited" })
      )
    );
    const state = review(notice);
    expect(state.code.status).toEqual(CodeStatus.Idle());
    expect(state.notice).toMatchObject(
      Option.some({ _tag: "Retryable", kind: "rate_limited" })
    );
    expect(canPay(state)).toBe(true);
    const retried = run(notice.state, CheckoutEvent.Retry());
    expect(commandOf(retried, "ApplyDiscountCode").request).toEqual(
      first.request
    );
    expect(review(retried).code.status).toEqual(CodeStatus.Applying());
  });

  test("a code whose answer was lost resumes when the resend answers", () => {
    const sent = applying();
    const first = commandOf(sent, "ApplyDiscountCode");
    const retried = run(
      sent.state,
      failed(first.operationId, BookingProblem.Unconfirmed()),
      CheckoutEvent.Retry()
    );
    expect(commandOf(retried, "ApplyDiscountCode").request).toEqual(
      first.request
    );
    const result = run(
      retried.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(retried, "ApplyDiscountCode"),
        result: {
          ...checkout({ payStateToken: "token-2" }),
          discountCode: "applied",
        },
      })
    );
    expect(review(result).code.status).toEqual(
      CodeStatus.Applied({ outcome: "applied" })
    );
    expect(review(result).checkout.payStateToken).toBe("token-2");
  });

  test("a code whose answer was lost restarts when the hold runs out", () => {
    const sent = applying();
    const lost = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.Unconfirmed()
      )
    );
    expect(
      step(
        lost.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis - 1 })
      ).state
    ).toEqual(lost.state);
    expect(
      step(lost.state, CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis }))
        .state
    ).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });
});

describe("legal documents and consent", () => {
  test("changed documents reload, clear the checkbox and need consent again", () => {
    const paying = paid(consented().state);
    const changed = run(
      paying.state,
      failed(
        lastOperation(paying, "SubmitCheckout"),
        BookingProblem.LegalDocumentsChanged()
      )
    );
    const state = review(changed);
    expect(state.consent).toEqual(Option.none());
    expect(state.legal._tag).toBe("Loading");
    expect(state.notice).toEqual(
      Option.some({ _tag: "LegalDocumentsChanged" } as never)
    );
    expect(canPay(state)).toBe(false);

    const reloaded = run(
      changed.state,
      CheckoutEvent.LegalDocumentsLoaded({
        operationId: lastOperation(changed, "LoadLegalDocuments"),
        documents: changedDocuments,
      }),
      CheckoutEvent.ToggleConsent({ accepted: true }),
      CheckoutEvent.Pay()
    );
    expect(
      commandOf(reloaded, "SubmitCheckout").request.acceptedLegalDocuments
    ).toEqual([
      { key: "terms-and-conditions", hash: "terms-hash-2" },
      { key: "operating-rules", hash: "rules-hash-1" },
    ]);
  });

  test("an older document load's answer is dropped once a reload runs", () => {
    const entered = held();
    const firstLoad = lastOperation(entered, "LoadLegalDocuments");
    const failedLoad = run(
      entered.state,
      failed(firstLoad, BookingProblem.Retryable({ kind: "connection" }))
    );
    const reloading = run(
      failedLoad.state,
      CheckoutEvent.ReloadLegalDocuments()
    );
    const late = step(
      reloading.state,
      CheckoutEvent.LegalDocumentsLoaded({ operationId: firstLoad, documents })
    );
    expect(late.state).toEqual(reloading.state);
  });

  test("missing legal consent unticks the checkbox and says why", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      failed(
        lastOperation(paying, "SubmitCheckout"),
        BookingProblem.ConsentRequired({ consent: "legal" })
      )
    );
    const state = review(result);
    expect(state.consent).toEqual(Option.none());
    expect(state.notice).toMatchObject(
      Option.some({ _tag: "ConsentRequired", consent: "legal" })
    );
  });

  test("missing early-performance consent makes the next submit send it", () => {
    const paying = paid(consented().state);
    const result = run(
      paying.state,
      failed(
        lastOperation(paying, "SubmitCheckout"),
        BookingProblem.ConsentRequired({ consent: "early_performance" })
      ),
      CheckoutEvent.ToggleConsent({ accepted: true }),
      CheckoutEvent.Pay()
    );
    expect(
      commandOf(result, "SubmitCheckout").request.earlyPerformanceConsent
    ).toBe(true);
  });
});

describe("status and pending price review from every command", () => {
  const codeSent = () =>
    run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
  const acceptSent = () => {
    const entered = consented(
      checkout({ status: "price_review", ...priceReview })
    );
    return run(entered.state, CheckoutEvent.AcceptPrice());
  };
  const submitSent = () => paid(consented().state);

  test.each([
    ["code", codeSent, "ApplyDiscountCode"],
    ["price acceptance", acceptSent, "AcceptPriceChange"],
    ["submit", submitSent, "SubmitCheckout"],
  ] as const)(
    "a %s answered payment in progress or not payable shows the status",
    (_name, sent, tag) => {
      const result = sent();
      const next = step(
        result.state,
        failed(lastOperation(result, tag), BookingProblem.ShowStatus())
      );
      expect(next.state).toEqual({
        _tag: "Done",
        orderId: "order-1",
      } as CheckoutState);
    }
  );

  test.each([
    ["code", codeSent, "ApplyDiscountCode"],
    ["submit", submitSent, "SubmitCheckout"],
  ] as const)(
    "a %s answered price review pending asks to accept the price",
    (_name, sent, tag) => {
      const result = sent();
      const next = run(
        result.state,
        failed(lastOperation(result, tag), BookingProblem.PriceReviewPending())
      );
      const state = review(next);
      expect(Option.isSome(state.checkout.priceReview)).toBe(true);
      expect(canPay(state)).toBe(false);
      expect(tags(run(next.state, CheckoutEvent.AcceptPrice()))).toContain(
        "AcceptPriceChange"
      );
    }
  );

  test("a code answered price review pending waits for the price before re-applying", () => {
    const result = codeSent();
    const next = run(
      result.state,
      failed(
        lastOperation(result, "ApplyDiscountCode"),
        BookingProblem.PriceReviewPending()
      )
    );
    expect(review(next).code.status).toEqual(
      CodeStatus.AwaitingPriceAcceptance()
    );
  });

  test.each([
    ["code", codeSent, "ApplyDiscountCode"],
    ["price acceptance", acceptSent, "AcceptPriceChange"],
    ["submit", submitSent, "SubmitCheckout"],
  ] as const)("a %s answered hold expired restarts", (_name, sent, tag) => {
    const result = sent();
    const next = step(
      result.state,
      failed(
        lastOperation(result, tag),
        BookingProblem.Restart({ reason: "hold_expired" })
      )
    );
    expect(next.state).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });
});

describe("retry after a change", () => {
  test("unticking the checkbox drops a retry that would resend the consent", () => {
    const sent = paid(consented().state);
    const notice = run(
      sent.state,
      failed(
        lastOperation(sent, "SubmitCheckout"),
        BookingProblem.Retryable({ kind: "session_required" })
      ),
      CheckoutEvent.ToggleConsent({ accepted: false })
    );
    expect(review(notice).notice).toEqual(Option.none());
    expect(step(notice.state, CheckoutEvent.Retry()).commands).toEqual([]);
  });

  test("editing the code drops a retry of the code sent before", () => {
    const sent = run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const edited = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.Retryable({ kind: "connection" })
      ),
      CheckoutEvent.CodeChanged({ input: "SAVE20" })
    );
    expect(step(edited.state, CheckoutEvent.Retry()).commands).toEqual([]);
  });
});

describe("advisor regressions", () => {
  test("a create the service failed may have held the selection, so only an identical resend follows", () => {
    const creating = run(startCheckout(startInput), continueEvent);
    const first = commandOf(creating, "CreateCheckout");
    const failedCreate = run(
      creating.state,
      failed(
        first.operationId,
        BookingProblem.Retryable({ kind: "service_unavailable" })
      )
    );
    expect(failedCreate.state).toMatchObject({
      _tag: "Uncertain",
      notice: Option.some("service_unavailable"),
    });
    expect(step(failedCreate.state, continueEvent).commands).toEqual([]);
    expect(
      commandOf(
        run(failedCreate.state, CheckoutEvent.Retry()),
        "CreateCheckout"
      ).request
    ).toEqual(first.request);
  });

  test("a submit the service failed may have started the payment, so the hold clock shows the status", () => {
    const sent = paid(consented().state);
    const failedSubmit = run(
      sent.state,
      failed(
        lastOperation(sent, "SubmitCheckout"),
        BookingProblem.Retryable({ kind: "service_unavailable" })
      )
    );
    expect(failedSubmit.state._tag).toBe("Uncertain");
    expect(
      step(
        failedSubmit.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis })
      ).state
    ).toEqual({
      _tag: "Done",
      orderId: "order-1",
    } as CheckoutState);
  });

  test("a code or price acceptance the service failed stays retryable", () => {
    const sent = run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const failedCode = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.Retryable({ kind: "service_unavailable" })
      )
    );
    expect(review(failedCode).notice).toMatchObject(
      Option.some({ _tag: "Retryable", kind: "service_unavailable" })
    );
  });

  test.each([
    ["documents changed", BookingProblem.LegalDocumentsChanged()],
    ["consent required", BookingProblem.ConsentRequired({ consent: "legal" })],
    ["price review pending", BookingProblem.PriceReviewPending()],
  ] as const)(
    "a resent submit refused because %s shows the status: the first may have executed",
    (_name, problem) => {
      const sent = paid(consented().state);
      const retried = run(
        sent.state,
        failed(
          lastOperation(sent, "SubmitCheckout"),
          BookingProblem.Unconfirmed()
        ),
        CheckoutEvent.Retry()
      );
      expect(
        step(
          retried.state,
          failed(lastOperation(retried, "SubmitCheckout"), problem)
        ).state
      ).toEqual({
        _tag: "Done",
        orderId: "order-1",
      } as CheckoutState);
    }
  );

  test("an unsettled submit keeps its retry until the hold runs out", () => {
    const sent = paid(consented().state);
    const lost = run(
      sent.state,
      failed(
        lastOperation(sent, "SubmitCheckout"),
        BookingProblem.Unconfirmed()
      )
    );
    expect(
      step(
        lost.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis - 1 })
      ).state
    ).toEqual(lost.state);
  });

  test("the checkbox holds still while a submit runs, so a retry resends what the customer sees", () => {
    const sent = paid(consented().state);
    const toggled = run(
      sent.state,
      CheckoutEvent.ToggleConsent({ accepted: false })
    );
    expect(Option.isSome(review(toggled).consent)).toBe(true);
    const retried = run(
      toggled.state,
      failed(
        lastOperation(sent, "SubmitCheckout"),
        BookingProblem.Retryable({ kind: "rate_limited" })
      ),
      CheckoutEvent.Retry()
    );
    expect(commandOf(retried, "SubmitCheckout").request.legalConsent).toBe(
      true
    );
    expect(Option.isSome(review(retried).consent)).toBe(true);
  });

  test("the code field holds still while a code applies, so its answer belongs to the shown code", () => {
    const sent = run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const result = run(
      sent.state,
      CheckoutEvent.CodeChanged({ input: "OTHER" }),
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: {
          ...checkout({ payStateToken: "token-2" }),
          discountCode: "applied",
        },
      })
    );
    expect(review(result).code).toEqual({
      input: "SAVE10",
      status: CodeStatus.Applied({ outcome: "applied" }),
    });
  });

  test("a tick given after early performance was already required stays", () => {
    const required = {
      earlyPerformanceConsent: {
        required: true,
        requiredFrom: "2026-12-04T09:00:00.000Z",
      },
    };
    const sent = run(
      consented(checkout(required)).state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const result = run(
      sent.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: {
          ...checkout({ payStateToken: "token-2", ...required }),
          discountCode: "applied",
        },
      })
    );
    expect(canPay(review(result))).toBe(true);
  });
});

describe("review regressions", () => {
  test.each([
    ["the lost send", () => BookingProblem.Unconfirmed()],
    [
      "a rate-limited resend",
      () => BookingProblem.Retryable({ kind: "rate_limited" }),
    ],
  ] as const)(
    "a repeated failure of %s keeps the submit unsettled",
    (_name, problem) => {
      const sent = paid(consented().state);
      const first = commandOf(sent, "SubmitCheckout");
      const lost = run(
        sent.state,
        failed(first.operationId, BookingProblem.Unconfirmed())
      );
      const settledOperation = (() => {
        if (problem()._tag === "Unconfirmed")
          return { state: lost.state, operationId: first.operationId };
        const retried = run(lost.state, CheckoutEvent.Retry());
        const operationId = lastOperation(retried, "SubmitCheckout");
        return {
          state: run(retried.state, failed(operationId, problem())).state,
          operationId,
        };
      })();
      const late = run(
        settledOperation.state,
        failed(
          settledOperation.operationId,
          BookingProblem.Retryable({ kind: "connection" })
        )
      );
      expect(late.state).toEqual(settledOperation.state);
      expect(
        commandOf(run(late.state, CheckoutEvent.Retry()), "SubmitCheckout")
          .request
      ).toEqual(first.request);
      expect(
        step(
          late.state,
          CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis })
        ).state
      ).toEqual({
        _tag: "Done",
        orderId: "order-1",
      } as CheckoutState);
    }
  );

  test("a document load finishing while a write is unsettled still lands", () => {
    const entered = held();
    const sent = run(
      entered.state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const lost = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.Unconfirmed()
      )
    );
    const loaded = run(
      lost.state,
      CheckoutEvent.LegalDocumentsLoaded({
        operationId: lastOperation(entered, "LoadLegalDocuments"),
        documents,
      })
    );
    expect(loaded.state).toMatchObject({
      _tag: "Uncertain",
      resume: { legal: LegalDocuments.Loaded({ documents }) },
    });
  });
});

describe("unconfirmed submit", () => {
  const lostSubmit = () => {
    const sent = paid(consented().state);
    const first = commandOf(sent, "SubmitCheckout");
    return {
      first,
      lost: run(
        sent.state,
        failed(first.operationId, BookingProblem.Unconfirmed())
      ),
    };
  };

  test("never restarts when the hold runs out: the status screen reconciles", () => {
    const { lost } = lostSubmit();
    expect(lost.state._tag).toBe("Uncertain");
    expect(
      step(
        lost.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 60_000 })
      ).state
    ).toEqual({
      _tag: "Done",
      orderId: "order-1",
    } as CheckoutState);
  });

  test("committed, response lost: the identical resend opens the payment page", () => {
    const { first, lost } = lostSubmit();
    const retried = run(lost.state, CheckoutEvent.Retry());
    const resent = commandOf(retried, "SubmitCheckout");
    expect(resent.request).toEqual(first.request);
    expect(resent.referralCode).toEqual(first.referralCode);
    const result = run(
      retried.state,
      CheckoutEvent.Submitted({
        operationId: resent.operationId,
        submission: {
          status: "payment_required",
          orderId: "order-1",
          paymentUrl: "https://gateway.example.test/pay/1",
          statusUrl: "deskohub://reservations/order-1",
        },
      })
    );
    expect(result.state._tag).toBe("Paying");
  });

  test.each([
    ["payment in progress", BookingProblem.ShowStatus()],
    ["hold expired", BookingProblem.Restart({ reason: "hold_expired" })],
    ["conflict", BookingProblem.Restart({ reason: "checkout_conflict" })],
    [
      "checkout not found",
      BookingProblem.Restart({ reason: "checkout_not_found" }),
    ],
  ] as const)(
    "a resend answered %s shows the status instead of restarting",
    (_name, problem) => {
      const { lost } = lostSubmit();
      const retried = run(lost.state, CheckoutEvent.Retry());
      const next = step(
        retried.state,
        failed(lastOperation(retried, "SubmitCheckout"), problem)
      );
      expect(next.state).toEqual({
        _tag: "Done",
        orderId: "order-1",
      } as CheckoutState);
    }
  );

  test("a resend that fails without settling anything stays uncertain", () => {
    const { lost } = lostSubmit();
    const retried = run(lost.state, CheckoutEvent.Retry());
    const next = run(
      retried.state,
      failed(
        lastOperation(retried, "SubmitCheckout"),
        BookingProblem.Retryable({ kind: "service_unavailable" })
      )
    );
    expect(next.state).toMatchObject({
      _tag: "Uncertain",
      retrying: false,
      notice: Option.some("service_unavailable"),
    });
    const lostAgain = run(next.state, CheckoutEvent.Retry());
    const unconfirmed = run(
      lostAgain.state,
      failed(
        lastOperation(lostAgain, "SubmitCheckout"),
        BookingProblem.Unconfirmed()
      )
    );
    expect(unconfirmed.state).toMatchObject({
      _tag: "Uncertain",
      retrying: false,
      notice: Option.none(),
    });
  });

  test("ignores the customer's other intents", () => {
    const { lost } = lostSubmit();
    for (const event of [
      CheckoutEvent.Pay(),
      CheckoutEvent.ApplyCode(),
      CheckoutEvent.AcceptPrice(),
      CheckoutEvent.ToggleConsent({ accepted: false }),
      continueEvent,
    ]) {
      expect(step(lost.state, event)).toEqual({
        state: lost.state,
        commands: [],
      });
    }
  });
});

describe("hold expiry", () => {
  test("restarts a held checkout once its hold runs out", () => {
    const state = consented().state;
    expect(
      step(state, CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis - 1 }))
        .state
    ).toEqual(state);
    expect(
      step(state, CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis }))
        .state
    ).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });

  test.each([
    [
      "applying a code",
      (state: CheckoutState) =>
        run(
          state,
          CheckoutEvent.CodeChanged({ input: "SAVE10" }),
          CheckoutEvent.ApplyCode()
        ),
    ],
  ] as const)("restarts while %s", (_name, act) => {
    const result = act(consented().state);
    expect(
      step(
        result.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis })
      ).state
    ).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });

  test("restarts while accepting a price", () => {
    const result = run(
      consented(checkout({ status: "price_review", ...priceReview })).state,
      CheckoutEvent.AcceptPrice()
    );
    expect(
      step(
        result.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis })
      ).state
    ).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });

  test("waits for a running submit, which may have executed", () => {
    const sent = paid(consented().state);
    const tick = CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 });
    expect(step(sent.state, tick).state).toEqual(sent.state);
    const notApplied = run(
      sent.state,
      failed(
        lastOperation(sent, "SubmitCheckout"),
        BookingProblem.Retryable({ kind: "connection" })
      )
    );
    expect(step(notApplied.state, tick).state).toMatchObject({
      _tag: "Restart",
      reason: "hold_expired",
    });
  });

  test("follows the expiry of a replacement token", () => {
    const sent = run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const replaced = run(
      sent.state,
      failed(
        lastOperation(sent, "ApplyDiscountCode"),
        BookingProblem.CodeRejected({
          reason: "ineligible",
          replacement: Option.some({
            payStateToken: "token-2",
            expiresAt: "2026-11-20T09:15:00.000Z",
          }),
        })
      )
    );
    expect(
      step(
        replaced.state,
        CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis + 1 })
      ).state._tag
    ).toBe("Review");
  });
});

describe("terminal states and superseded answers", () => {
  test("late answers after a restart are dropped", () => {
    const sent = run(
      consented().state,
      CheckoutEvent.CodeChanged({ input: "SAVE10" }),
      CheckoutEvent.ApplyCode()
    );
    const restarted = step(
      sent.state,
      CheckoutEvent.HoldTimerElapsed({ now: expiresAtMillis })
    );
    const late = step(
      restarted.state,
      CheckoutEvent.CodeApplied({
        operationId: lastOperation(sent, "ApplyDiscountCode"),
        result: { ...checkout(), discountCode: "applied" },
      })
    );
    expect(late).toEqual({ state: restarted.state, commands: [] });
  });

  test("a held checkout drops answers to commands it isn't waiting for", () => {
    const state = consented().state;
    for (const event of [
      CheckoutEvent.CodeApplied({
        operationId: 999,
        result: { ...checkout(), discountCode: "applied" },
      }),
      CheckoutEvent.PriceAccepted({ operationId: 999, checkout: checkout() }),
      CheckoutEvent.Submitted({
        operationId: 999,
        submission: { status: "paid", orderId: "order-1", statusUrl: "x" },
      }),
      CheckoutEvent.LegalDocumentsLoaded({ operationId: 999, documents }),
      CheckoutEvent.CheckoutCreated({ operationId: 999, start: checkout() }),
      CheckoutEvent.PaymentEnded({ operationId: 999, result: "returned" }),
      failed(999, BookingProblem.Unconfirmed()),
      continueEvent,
    ]) {
      expect(step(state, event)).toEqual({ state, commands: [] });
    }
  });

  test.each([
    { _tag: "Done", orderId: "order-1" },
    { _tag: "Restart", reason: "hold_expired" },
    { _tag: "Blocked", reason: "payment-disabled" },
  ] as const)("$_tag ignores every event", (terminal) => {
    const state = terminal as CheckoutState;
    for (const event of [
      CheckoutEvent.Retry(),
      CheckoutEvent.Pay(),
      continueEvent,
      CheckoutEvent.HoldTimerElapsed({ now: 0 }),
    ]) {
      expect(step(state, event)).toEqual({ state, commands: [] });
    }
  });
});

describe("remembered referral code", () => {
  test("a used-up code is forgotten and no longer sent", () => {
    const used = checkout({ rememberedReferralCodeUsed: true });
    expect(commandOf(held(used), "UpdateRememberedReferral").update).toEqual(
      RememberedReferralUpdate.Forget()
    );
    expect(
      commandOf(paid(consented(used).state), "SubmitCheckout").referralCode
    ).toEqual(Option.none());
  });

  test("a checkout without referral news changes nothing", () => {
    expect(tags(held())).not.toContain("UpdateRememberedReferral");
  });
});
