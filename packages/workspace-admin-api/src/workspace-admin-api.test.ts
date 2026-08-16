import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AdminCliAdministrationApi,
  AdministrationBookingQuery,
  AdministrationCustomerProfile,
  AdministrationCustomerQuery,
  AdministrationCustomerReservationsQuery,
  AdministrationCustomerSearchQuery,
  AdministrationDiscountCode,
  AdministrationDiscountCodeClaim,
  AdministrationDiscountDashboard,
  AdministrationDiscountDefinitionInput,
  AdministrationDiscountMutation,
  AdministrationDiscountMutationResult,
  AdministrationDotyposCustomerId,
  AdministrationDotyposDiscountGroupId,
  AdministrationDotyposReservationId,
  AdministrationDotyposTableId,
  AdministrationNexiOperationId,
  AdministrationNexiOrderId,
  AdministrationOperationQuery,
  AdministrationOrderQuery,
  AdministrationPaymentAttempt,
  AdministrationPaymentAttemptId,
  AdministrationReservationAccessGrant,
  AdministrationReservationAccessMutation,
  AdministrationReservationCancellationInput,
  AdministrationReservationLookupQuery,
  AdministrationReservationQuery,
  AdministrationReservationSummary,
  AdministrationVoucher,
  AdministrationWorkspaceProductTarget,
  AdministrationWorkspaceReservationId,
  CliClientName,
  StartCliAuthentication,
} from "./workspace-admin-api";

describe("CliClientName", () => {
  test("trims a client label", () => {
    expect(Schema.decodeUnknownSync(CliClientName)("  Office Mac  ")).toBe(
      "Office Mac"
    );
  });

  test("rejects a client label longer than 80 characters", () => {
    expect(() =>
      Schema.decodeUnknownSync(CliClientName)("a".repeat(81))
    ).toThrow();
  });
});

describe("StartCliAuthentication", () => {
  test("rejects a whitespace-only client name", () => {
    expect(() =>
      Schema.decodeUnknownSync(StartCliAuthentication)({
        challenge: "a".repeat(43),
        clientName: "   ",
        cliVersion: "1.0.0",
        buildTarget: "development",
      })
    ).toThrow();
  });
});

describe("administration contract", () => {
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

  test("keeps branded identifiers distinct while encoding them as strings", () => {
    const reservationId = Schema.decodeUnknownSync(
      AdministrationWorkspaceReservationId
    )("reservation-id");
    const paymentAttemptId = Schema.decodeUnknownSync(
      AdministrationPaymentAttemptId
    )("payment-attempt-id");

    // @ts-expect-error Payment-attempt IDs must not be accepted as reservation IDs.
    const wrongReservationId: typeof reservationId = paymentAttemptId;
    void wrongReservationId;

    expect(
      Schema.encodeSync(AdministrationWorkspaceReservationId)(reservationId)
    ).toBe("reservation-id");

    for (const identifierSchema of [
      AdministrationWorkspaceReservationId,
      AdministrationPaymentAttemptId,
      AdministrationNexiOrderId,
      AdministrationNexiOperationId,
      AdministrationDotyposCustomerId,
      AdministrationDotyposReservationId,
      AdministrationDotyposTableId,
      AdministrationDotyposDiscountGroupId,
    ]) {
      expect(() => Schema.decodeUnknownSync(identifierSchema)("")).toThrow();
    }
  });

  test("keeps read operations safe and typed", () => {
    expect(AdminCliAdministrationApi.endpoints.getOverview?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listReservations?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getReservation?.method).toBe(
      "GET"
    );
    expect(
      AdminCliAdministrationApi.endpoints.mutateReservationAccess?.method
    ).toBe("POST");
    expect(AdminCliAdministrationApi.endpoints.findReservation?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listBookings?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getBooking?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listOrders?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.getOrder?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listOperations?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getOperation?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listCustomers?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.searchCustomers?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getCustomer?.method).toBe("GET");
    expect(
      AdminCliAdministrationApi.endpoints.listCustomerReservations?.method
    ).toBe("GET");
    expect(
      AdminCliAdministrationApi.endpoints.getDiscountDashboard?.method
    ).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.getDiscountCode?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listSessions?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.mutateDiscounts?.method).toBe(
      "POST"
    );
    expect(AdminCliAdministrationApi.endpoints.cancelReservation?.method).toBe(
      "POST"
    );
    expect(AdminCliAdministrationApi.endpoints.renameSession?.method).toBe(
      "PATCH"
    );
    expect(AdminCliAdministrationApi.endpoints.revokeSession?.method).toBe(
      "DELETE"
    );
    expect(
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        page: 2,
        status: "complete",
      })
    ).toEqual({ page: 2, status: "complete" });
    expect(
      Schema.decodeUnknownSync(AdministrationReservationCancellationInput)({
        accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
        providerCredentialRemoved: true,
        sendCancellationEmail: true,
      })
    ).toEqual({
      accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
      providerCredentialRemoved: true,
      sendCancellationEmail: true,
    });
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

    expect(attempt).toMatchObject({ state: "paid", refundState: "required" });
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

  test("accepts office reservations throughout the read contract", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        type: "office",
      })
    ).toEqual({ type: "office" });
    expect(
      Schema.decodeUnknownSync(AdministrationReservationSummary)({
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
      }).type
    ).toBe("office");
  });

  test("uses product targets instead of purchase identities", () => {
    for (const target of [
      { kind: "cowork" },
      { kind: "meeting-room" },
      { kind: "office" },
      { kind: "goods" },
      { kind: "goods", categoryId: "category-1" },
      { kind: "goods", productId: "product-1" },
    ] as const) {
      expect(
        Schema.decodeUnknownSync(AdministrationWorkspaceProductTarget)(
          target
        ) as unknown
      ).toEqual(target);
    }
    expect(() =>
      Schema.decodeUnknownSync(AdministrationWorkspaceProductTarget)(
        { kind: "cowork", tier: "basic" },
        { onExcessProperty: "error" }
      )
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationWorkspaceProductTarget)({
        kind: "goods",
        categoryId: "category-1",
        productId: "product-1",
      })
    ).toThrow();
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

  test("allows distinct goods targets and rejects exact duplicates", () => {
    const decode = Schema.decodeUnknownSync(
      AdministrationDiscountDefinitionInput
    );
    const definition = {
      labels: { "cs-CZ": "Zbozi", "en-US": "Goods" },
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      products: [
        { kind: "goods" as const, categoryId: "category-1" },
        { kind: "goods" as const, productId: "product-1" },
      ],
    };

    expect(decode(definition).products as readonly unknown[]).toEqual(
      definition.products
    );
    expect(() =>
      decode({
        ...definition,
        products: [definition.products[0], definition.products[0]],
      })
    ).toThrow();
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

  test("validates booking filters", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "2026-08-10",
        page: 2,
      })
    ).toEqual({ date: "2026-08-10", page: 2 });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "10-08-2026",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "2026-02-30",
      })
    ).toThrow();
  });

  test("validates payment date filters", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationOrderQuery)({
        from: "2024-02-29",
        to: "2026-08-10",
      })
    ).toEqual({ from: "2024-02-29", to: "2026-08-10" });
    expect(
      Schema.decodeUnknownSync(AdministrationOperationQuery)({
        channel: "ECOMMERCE",
        operationType: "CAPTURE",
      })
    ).toEqual({ channel: "ECOMMERCE", operationType: "CAPTURE" });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationOrderQuery)({ from: "tomorrow" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationOrderQuery)({
        from: "2026-02-29",
      })
    ).toThrow();
  });
});
