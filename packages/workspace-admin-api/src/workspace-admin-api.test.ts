import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Schema } from "effect";
import {
  AdminCliAdministrationApi,
  AdministrationActorEmail,
  AdministrationCustomerProfile,
  AdministrationCustomerQuery,
  AdministrationCustomerReservationsQuery,
  AdministrationCustomerSearchQuery,
  AdministrationDiscountCode,
  AdministrationDiscountCodeClaim,
  AdministrationDiscountDashboard,
  AdministrationDiscountMutation,
  AdministrationDiscountMutationResult,
  AdministrationDotyposCustomerId,
  AdministrationDotyposDiscountGroupId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceListItem,
  AdministrationPaymentAttempt,
  AdministrationReservationAccessGrant,
  AdministrationReservationAccessMutation,
  AdministrationReservationLookupQuery,
  AdministrationReservationProductDetailsBackfillBatch,
  AdministrationReservationProductDetailsBackfillInput,
  AdministrationReservationQuery,
  AdministrationReservationSummary,
  AdministrationStandaloneAccessCodeCreateInput,
  AdministrationStandaloneAccessCodeCreateRequest,
  AdministrationStandaloneAccessCodeCreationOutcome,
  AdministrationStandaloneAccessCodePin,
  AdministrationStandaloneAccessCodeResult,
  AdministrationVoucher,
  AdministrationWorkspaceSiteLocalWholeHourDateTime,
  CliBuildTarget,
  CliClientName,
  CliSession,
  CliSessionId,
  isStandaloneAccessCodeWindowWithinContractDuration,
  toAdministrationActorName,
} from "./workspace-admin-api";

const syntheticAddress = testEmailAddress("synthetic");

describe("standalone access-code contract", () => {
  const attemptId = "01980000-0000-7000-8000-000000000042";
  const validInput = {
    name: "  Booth A  ",
    startsAt: "2026-09-10T10:00",
    endsAt: "2026-09-10T12:00",
  };
  const decodeCreateInput = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeCreateInput
  );
  const decodeSiteLocal = Schema.decodeUnknownSync(
    AdministrationWorkspaceSiteLocalWholeHourDateTime
  );

  test("decodes trimmed names and offset-free site-local times", () => {
    expect(decodeCreateInput(validInput)).toMatchObject({
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    });
    expect(String(decodeSiteLocal("2026-03-29T03:00"))).toBe(
      "2026-03-29T03:00"
    );
    expect(String(decodeSiteLocal("2026-10-25T02:00"))).toBe(
      "2026-10-25T02:00"
    );
  });

  test("rejects excess creation properties", () => {
    expect(() =>
      decodeCreateInput({ ...validInput, deviceId: "EK1X" })
    ).toThrow();
    expect(() =>
      decodeCreateInput({ ...validInput, description: "Back booth" })
    ).toThrow();
  });

  test("rejects malformed, non-canonical, and non-whole-hour local times", () => {
    for (const value of [
      "not-a-date",
      "2026-13-01T10:00",
      "2026-02-30T10:00",
      "2026-09-10",
      "2026-09-10T10:30",
      "2026-09-10T10:00:00",
    ]) {
      expect(() => decodeSiteLocal(value)).toThrow();
    }
  });

  test("rejects nonexistent spring-forward local times", () => {
    expect(() => decodeSiteLocal("2026-03-29T02:00")).toThrow();
  });

  test("accepts windows that span Prague DST transitions on instants", () => {
    expect(() =>
      decodeCreateInput({
        ...validInput,
        startsAt: "2026-03-29T01:00",
        endsAt: "2026-03-29T04:00",
      })
    ).not.toThrow();
    expect(() =>
      decodeCreateInput({
        ...validInput,
        startsAt: "2026-10-25T00:00",
        endsAt: "2026-10-25T04:00",
      })
    ).not.toThrow();
  });

  test("discloses the PIN only through the created outcome", () => {
    const decodeOutcome = Schema.decodeUnknownSync(
      AdministrationStandaloneAccessCodeCreationOutcome
    );
    const metadata = {
      attemptId,
      providerCredentialId: "provider-credential-id",
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
      issuedAt: "2026-09-10T08:00:00Z",
    };

    const created = decodeOutcome({
      ...metadata,
      outcome: "created",
      pin: "1234567",
    });
    if (created.outcome === "created") {
      expect(
        Schema.encodeSync(AdministrationStandaloneAccessCodePin)(created.pin)
      ).toBe("1234567");
    }

    expect(() => decodeOutcome({ ...metadata, outcome: "created" })).toThrow();

    const alreadyCreated = decodeOutcome({
      ...metadata,
      outcome: "already-created",
    });
    expect(alreadyCreated).toMatchObject({
      outcome: "already-created",
      attemptId,
      providerCredentialId: "provider-credential-id",
      name: "Booth A",
      issuedAt: "2026-09-10T08:00:00Z",
    });
    expect("pin" in alreadyCreated).toBe(false);
    expect(
      Schema.decodeUnknownSync(AdministrationStandaloneAccessCodeResult)(
        metadata
      )
    ).toMatchObject(metadata);
    expect(() =>
      decodeOutcome({
        ...metadata,
        outcome: "already-created",
        pin: "1234567",
      })
    ).toThrow();

    expect(() =>
      decodeOutcome({
        ...metadata,
        attemptId: "not-a-uuid",
        outcome: "created",
        pin: "1234567",
      })
    ).toThrow();
    expect(() =>
      decodeOutcome({ ...metadata, outcome: "created", pin: "1234567890" })
    ).toThrow();
    expect(() =>
      decodeOutcome({ ...metadata, outcome: "created", pin: "123456" })
    ).toThrow();
    expect(() => decodeOutcome({ ...metadata, outcome: "expired" })).toThrow();
  });
});

describe("standalone access-code duration contract", () => {
  const decodeSiteLocal = Schema.decodeUnknownSync(
    AdministrationWorkspaceSiteLocalWholeHourDateTime
  );
  const contractWindow = (startsAt: string, endsAt: string) => ({
    startsAt: decodeSiteLocal(startsAt),
    endsAt: decodeSiteLocal(endsAt),
  });

  test("accepts the bounds and counts the repeated fall-back hour on instants", () => {
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-09-10T10:00", "2026-09-10T11:00")
      )
    ).toBe(true);
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-09-10T10:00", "2026-10-08T10:00")
      )
    ).toBe(true);
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-10-24T01:00", "2026-11-21T00:00")
      )
    ).toBe(true);
  });

  test("rejects empty, reversed, and overshooting windows", () => {
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-09-10T10:00", "2026-09-10T10:00")
      )
    ).toBe(false);
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-09-10T11:00", "2026-09-10T10:00")
      )
    ).toBe(false);
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-09-10T10:00", "2026-10-08T11:00")
      )
    ).toBe(false);
    expect(
      isStandaloneAccessCodeWindowWithinContractDuration(
        contractWindow("2026-10-24T00:00", "2026-11-21T00:00")
      )
    ).toBe(false);
  });
});

describe("standalone access-code CLI endpoint contract", () => {
  const attemptId = "01980000-0000-7000-8000-000000000042";
  const decodeRequest = Schema.decodeUnknownSync(
    AdministrationStandaloneAccessCodeCreateRequest
  );

  test("rejects excess properties and invalid windows before any handler runs", () => {
    const validInput = {
      name: "Booth A",
      startsAt: "2026-09-10T10:00",
      endsAt: "2026-09-10T12:00",
    };
    expect(() =>
      decodeRequest({ attemptId, input: validInput, source: "dhw-cli" })
    ).toThrow();
    expect(() =>
      decodeRequest({ attemptId: "not-a-uuid", input: validInput })
    ).toThrow();
    expect(() =>
      decodeRequest({
        attemptId,
        input: { ...validInput, endsAt: "2026-09-10T09:00" },
      })
    ).toThrow();
    expect(() =>
      decodeRequest({
        attemptId,
        input: {
          name: "Booth A",
          startsAt: "2026-09-10T10:00",
          endsAt: "2026-09-10T10:30",
        },
      })
    ).toThrow();
  });
});

describe("administration contract", () => {
  test("strictly decodes manual invoice input without restricting signed prices", () => {
    const input = {
      invoiceId: "01980000-0000-7000-8000-000000000009",
      customer: {
        kind: "new",
        details: {
          kind: "person",
          email: syntheticAddress,
          firstName: "Synthetic",
          lastName: "Customer",
          address: {
            line1: "Test street 1",
            city: "Prague",
            postalCode: "100 00",
            country: "CZ",
          },
        },
      },
      locale: "cs-CZ",
      serviceDate: "2026-08-10",
      payment: { status: "due", date: "2026-08-24" },
      currency: "CZK",
      variableSymbol: "1234567890",
      lines: [{ description: "Space rental", price: "-12.34" }],
    };
    const decode = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput);

    expect(decode(input)).toMatchObject(input);
    expect(
      decode({
        ...input,
        payment: { status: "paid", date: "2026-08-10" },
      })
    ).toHaveProperty("payment.status", "paid");
    expect(() => decode({ ...input, typo: true })).toThrow();
    expect(() =>
      decode({ ...input, payment: { ...input.payment, typo: true } })
    ).toThrow();
    expect(() => decode({ ...input, variableSymbol: "12345678901" })).toThrow();
    expect(() =>
      decode({
        ...input,
        customer: {
          ...input.customer,
          details: { ...input.customer.details, typo: true },
        },
      })
    ).toThrow();
  });

  test("decodes pre-voucher administration responses", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationDiscountMutationResult)({
        kind: "delete-code",
        createdDiscountId: null,
        createdCodeId: null,
      })
    ).toMatchObject({ createdVoucherId: null });

    expect(
      Schema.decodeUnknownSync(AdministrationDiscountDashboard)({
        discounts: [],
        codes: [],
        calendar: {
          events: [],
          unavailable: false,
          calendarUrl: "https://calendar.example.test",
          from: "2026-08-01",
          to: "2026-08-31",
        },
      })
    ).toMatchObject({ vouchers: [] });

    expect(
      Schema.decodeUnknownSync(AdministrationCustomerProfile)({
        customer: {
          id: "customer-id",
          displayName: "Synthetic Customer",
          email: null,
          phone: null,
          discountGroupId: null,
        },
        discountGroups: [],
        codes: [],
        claims: [],
      })
    ).toMatchObject({ vouchers: [], voucherClaims: [] });

    expect(
      Schema.decodeUnknownSync(AdministrationDiscountCodeClaim)({
        id: "claim-id",
        codeId: "01980000-0000-7000-8000-000000000001",
        dotyposCustomerId: "customer-id",
        state: "redeemed",
        paymentAttemptId: "payment-attempt-id",
        workspaceReservationId: "reservation-id",
        reservationExpiresAt: "2026-08-10T11:00:00Z",
        reservedAt: "2026-08-10T10:00:00Z",
        redeemedAt: "2026-08-10T10:01:00Z",
        releasedAt: null,
        releaseReason: null,
      }).appliedAmount
    ).toBeNull();
  });

  test("keeps discount codes and vouchers as separate read models", () => {
    const decodeCode = Schema.decodeUnknownSync(AdministrationDiscountCode);
    const decodeVoucher = Schema.decodeUnknownSync(AdministrationVoucher);
    const common = {
      id: "01980000-0000-7000-8000-000000000001",
      code: "GIFT100",
      enabled: true,
      validFrom: null,
      validUntil: null,
      audienceSize: 0,
      reservedUses: 0,
      redeemedUses: 0,
      releasedUses: 0,
      createdAt: "2026-08-10T10:00:00Z",
      updatedAt: "2026-08-10T10:00:00Z",
    };

    expect(
      decodeCode({
        ...common,
        discountId: "01980000-0000-7000-8000-000000000002",
        maxUses: null,
        maxUsesPerCustomer: null,
        remainingUses: null,
      })
    ).toMatchObject({ code: "GIFT100", maxUses: null });
    expect(
      decodeVoucher({
        ...common,
        issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
        remainingCredit: {
          value: 6500,
          exponent: 2,
          currency: "CZK",
        },
      })
    ).toMatchObject({ code: "GIFT100", remainingCredit: { value: 6500 } });
    expect(() =>
      decodeVoucher({
        ...common,
        issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
        remainingCredit: {
          value: 11_000,
          exponent: 2,
          currency: "CZK",
        },
      })
    ).toThrow();
  });

  test("exposes refund work without changing successful payment state", () => {
    const attempt = Schema.decodeUnknownSync(AdministrationPaymentAttempt)({
      id: "payment-attempt-id",
      state: "paid",
      refundState: "required",
      providerOrderId: "order-id",
      providerLabel: "Online payment",
      stateLabel: "Paid",
      amount: { value: 1000, exponent: 2, currency: "CZK" },
      createdAt: "2026-08-13T12:00:00Z",
      providerOrderCreatedAt: "2026-08-13T12:00:01Z",
      updatedAt: "2026-08-13T12:01:00Z",
    });

    expect(attempt).toMatchObject({
      state: "paid",
      refundState: "required",
      refundedAmount: null,
      refundedAt: null,
    });
  });

  test("exposes access operations without exposing the PIN", () => {
    const grant = Schema.decodeUnknownSync(
      AdministrationReservationAccessGrant
    )({
      id: "grant-id",
      state: "issued",
      provider: "igloohome",
      credentialType: "algopin_hourly",
      deviceId: "EK1",
      providerCredentialId: "pin-id",
      accessName: "Deskohub reservation-id",
      scheduledStartsAt: "2099-07-01T08:00:00Z",
      startsAt: "2099-07-01T08:00:00Z",
      endsAt: "2099-07-01T16:00:00Z",
      provisioningStartedAt: null,
      issuedAt: "2099-06-01T08:00:00Z",
      failedAt: null,
      failureCode: null,
      createdAt: "2099-06-01T08:00:00Z",
      updatedAt: "2099-06-01T08:00:00Z",
      accessCode: null,
    });
    expect("accessCode" in grant).toBe(false);
    expect(
      Schema.decodeUnknownSync(AdministrationReservationAccessMutation)({
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
      })
    ).toEqual({
      kind: "confirm-provider-credential-removed",
      providerCredentialRemoved: true,
    });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationAccessMutation)({
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: false,
      })
    ).toThrow();
  });

  test("exposes office reservation and invoice relationships", () => {
    const reservationInput = {
      id: "reservation-id",
      customerId: "customer-id",
      customer: null,
      liveDetailsAvailable: false,
      startsAt: "2026-08-10T00:00:00+02:00[Europe/Prague]",
      endsAt: "2026-08-11T00:00:00+02:00[Europe/Prague]",
      date: "2026-08-10",
      type: "office",
      typeLabel: "Office",
      status: { group: "in_progress", label: "In progress" },
      statusNote: null,
      createdAt: "2026-08-01T12:00:00Z",
      latestPayment: null,
      updatedAt: "2026-08-01T12:00:00Z",
    } as const;
    const reservation = Schema.decodeUnknownSync(
      AdministrationReservationSummary
    )({ ...reservationInput, purpose: "business" });
    expect(
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        type: "office",
      })
    ).toEqual({ type: "office" });
    const invoice = Schema.decodeUnknownSync(AdministrationInvoiceListItem)({
      id: "01980000-0000-7000-8000-000000000009",
      invoiceNumber: "WS-FV-2026-000001",
      issuedAt: "2026-08-12T12:00:00Z",
      customerId: "customer-id",
      customerName: "Synthetic Business",
      reservationId: "reservation-id",
      total: "1000",
      currency: "CZK",
      paymentStatus: "paid",
      source: "reservation-request",
      actor: null,
      delivery: { customer: "accepted", internal: "accepted" },
      needsAttention: false,
    });
    expect(reservation).toMatchObject({ purpose: "business", type: "office" });
    expect(invoice).toMatchObject({
      customerId: "customer-id",
      reservationId: "reservation-id",
    });
    expect(
      Schema.decodeUnknownSync(AdministrationReservationSummary)(
        reservationInput
      ).purpose
    ).toBeNull();
    const {
      customerId: _customerId,
      reservationId: _reservationId,
      ...rest
    } = invoice;
    expect(
      Schema.decodeUnknownSync(AdministrationInvoiceListItem)(rest)
    ).toMatchObject({ customerId: null, reservationId: null });
  });

  test("validates discount mutations at the shared HTTP boundary", () => {
    const discountId = "01980000-0000-7000-8000-000000000001";
    const decode = Schema.decodeUnknownSync(AdministrationDiscountMutation);

    expect(
      decode({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: { kind: "percentage", basisPoints: 1500 },
          products: [{ kind: "cowork" }],
        },
      })
    ).toEqual({
      kind: "create-discount",
      discount: {
        labels: { "cs-CZ": "Léto", "en-US": "Summer" },
        adjustment: { kind: "percentage", basisPoints: 1500 },
        products: [{ kind: "cowork" }],
      },
    });

    expect(() =>
      decode({
        kind: "update-discount",
        discount: {
          id: discountId,
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: {
            kind: "fixed",
            amount: { value: 1000, exponent: 2, currency: "CZK" },
          },
          products: [{ kind: "cowork" }, { kind: "cowork" }],
        },
      })
    ).toThrow();

    const discountGroupMutation = decode({
      kind: "set-customer-discount-group",
      customerId: "customer-id",
      discountGroupId: "discount-group-id",
    });
    expect(discountGroupMutation.kind).toBe("set-customer-discount-group");
    if (discountGroupMutation.kind === "set-customer-discount-group") {
      expect(
        Schema.encodeSync(AdministrationDotyposCustomerId)(
          discountGroupMutation.customerId
        )
      ).toBe("customer-id");
      if (discountGroupMutation.discountGroupId) {
        expect(
          Schema.encodeSync(AdministrationDotyposDiscountGroupId)(
            discountGroupMutation.discountGroupId
          )
        ).toBe("discount-group-id");
      }
    }

    expect(() =>
      decode({
        kind: "create-discount",
        discount: {
          labels: {
            "cs-CZ": "Léto",
            "en-US": "Summer",
            "de-DE": "Sommer",
          },
          adjustment: { kind: "percentage", basisPoints: 1500 },
          products: [{ kind: "cowork" }],
        },
      })
    ).toThrow();

    expect(() =>
      decode({
        kind: "create-code",
        code: {
          code: "SUMMER10",
          enabled: true,
          validFrom: "2026-08-11T00:00:00Z",
          validUntil: "2026-08-10T00:00:00Z",
          maxUses: null,
        },
        discount: { kind: "existing", discountId },
      })
    ).toThrow();

    expect(
      decode({
        kind: "create-voucher",
        voucher: {
          code: "VOUCHER100",
          enabled: true,
          validFrom: null,
          validUntil: null,
          credit: { value: 10_000, exponent: 2, currency: "CZK" },
        },
      })
    ).toMatchObject({
      kind: "create-voucher",
      voucher: { credit: { value: 10_000 } },
    });
  });
  test("accepts cowork tier targets but not mixed or repeated cowork targets", () => {
    const decodeProducts = (products: unknown) =>
      Schema.decodeUnknownSync(AdministrationDiscountMutation)({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: { kind: "percentage", basisPoints: 1500 },
          products,
        },
      });

    for (const products of [
      [{ kind: "cowork", tier: "open-space" }],
      [
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "reserved-desk" },
        { kind: "office" },
      ],
      [{ kind: "cowork" }, { kind: "meeting-room" }],
    ]) {
      expect(decodeProducts(products)).toMatchObject({
        discount: { products },
      });
    }

    for (const products of [
      [{ kind: "cowork" }, { kind: "cowork", tier: "reserved-desk" }],
      [
        { kind: "cowork", tier: "open-space" },
        { kind: "cowork", tier: "open-space" },
      ],
      [{ kind: "cowork", tier: "basic" }],
      [{ kind: "office", tier: "open-space" }],
    ]) {
      expect(() => decodeProducts(products)).toThrow();
    }
  });

  test("serves the reservation product-details backfill as one strict batch", () => {
    const endpoint =
      AdminCliAdministrationApi.endpoints.backfillReservationProductDetails;
    expect(endpoint?.method).toBe("POST");
    expect(endpoint?.path).toBe(
      "/api/v1/cli/reservations/product-details-backfill"
    );

    const decodeInput = Schema.decodeUnknownSync(
      AdministrationReservationProductDetailsBackfillInput
    );
    expect(decodeInput({ dryRun: true, after: null })).toEqual({
      dryRun: true,
      after: null,
    });
    expect(() => decodeInput({ dryRun: true })).toThrow();
    expect(() =>
      decodeInput({ dryRun: false, after: null, limit: 10 })
    ).toThrow();

    const decodeBatch = Schema.decodeUnknownSync(
      AdministrationReservationProductDetailsBackfillBatch
    );
    const batch = {
      updated: 1,
      alreadyComplete: 2,
      unresolved: [
        {
          reservationId: "reservation-a",
          family: "meeting-room",
          reason: "interval_not_in_catalog",
        },
      ],
      nextCursor: "reservation-b",
    };
    expect<unknown>(decodeBatch(batch)).toEqual(batch);
    for (const unresolved of [
      {
        reservationId: "reservation-a",
        family: "cowork",
        reason: "dotypos_seats_invalid",
      },
      {
        reservationId: "reservation-a",
        family: "office",
        reason: "note_unparsed",
      },
    ]) {
      expect(() =>
        decodeBatch({ ...batch, unresolved: [unresolved] })
      ).toThrow();
    }
  });

  test("rejects invalid reservation filters before service execution", () => {
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({ page: 0 })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        date: "10-08-2026",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        date: "2026-13-01",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationLookupQuery)({
        identifier: "   ",
      })
    ).toThrow();
  });

  test("validates customer list and search queries", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCustomerQuery)({ page: 3 })
    ).toEqual({ page: 3 });
    expect(
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "  Ada  ",
      })
    ).toEqual({ query: "Ada" });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerQuery)({ page: 0 })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "A",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "Ada;drop",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerReservationsQuery)({
        page: 0,
      })
    ).toThrow();
  });
});

describe("CLI session contract", () => {
  // `CliSession` as released dhw-v1.17.0 binaries decode it; they read a null
  // approver as a legacy session that can't issue invoices or access codes.
  const ReleasedCliSession = Schema.Struct({
    id: CliSessionId,
    approvedBy: Schema.NullOr(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(80))
    ).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
    clientName: CliClientName,
    cliVersion: Schema.String,
    buildTarget: CliBuildTarget,
    createdAt: Schema.String,
    lastUsedAt: Schema.String,
    expiresAt: Schema.NullOr(Schema.String).pipe(
      Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
    ),
  });
  const shortEmail = AdministrationActorEmail.make(syntheticAddress);
  const longEmail = AdministrationActorEmail.make(
    testEmailAddress("a".repeat(120))
  );
  const sessionFor = (email: AdministrationActorEmail) =>
    Schema.encodeSync(CliSession)({
      id: CliSessionId.make("123e4567-e89b-42d3-a456-426614174000"),
      approvedBy: toAdministrationActorName(email),
      approvedByEmail: email,
      clientName: "synthetic compatibility client",
      cliVersion: "1.17.0",
      buildTarget: "linux-x64-baseline",
      createdAt: "2026-10-16T00:00:00.000Z",
      lastUsedAt: "2026-10-16T00:00:00.000Z",
      expiresAt: null,
    });

  test.each([shortEmail, longEmail])(
    "keeps a session approved by %s readable by released dhw",
    (email) => {
      const released = Schema.decodeUnknownSync(ReleasedCliSession)(
        sessionFor(email)
      );

      expect(released.approvedBy).not.toBeNull();
      expect(released.approvedBy!.length).toBeLessThanOrEqual(80);
    }
  );

  test("gives current dhw the full approver email", () => {
    expect(
      Schema.decodeUnknownSync(CliSession)(sessionFor(longEmail))
    ).toMatchObject({
      approvedBy: `${longEmail.slice(0, 79)}…`,
      approvedByEmail: longEmail,
    });
  });

  test("reads a session from a server without the approver email", () => {
    const { approvedByEmail: _, ...released } = sessionFor(shortEmail);

    expect(Schema.decodeUnknownSync(CliSession)(released)).toMatchObject({
      approvedBy: shortEmail,
      approvedByEmail: null,
    });
  });

  test("shortens an approver email without splitting a character", () => {
    const email = AdministrationActorEmail.make(
      testEmailAddress(`${"a".repeat(78)}😀`)
    );

    expect<string>(toAdministrationActorName(email)).toBe(`${"a".repeat(78)}…`);
    expect<string>(toAdministrationActorName(shortEmail)).toBe(shortEmail);
  });
});
