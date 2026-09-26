import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { InvoiceEmailDeliveryRepository } from "./invoice-email-delivery.repository";

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* InvoiceEmailDeliveryRepository;
    }).pipe(
      Effect.provide(
        InvoiceEmailDeliveryRepository.Default.pipe(
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

describe("invoice email delivery repository", () => {
  test("claims only failed or stale processing deliveries", async () => {
    const { recording, repository } = await makeRepository();

    const claimed = await Effect.runPromise(
      repository.claim({
        invoiceId: "invoice-1",
        audience: "customer",
        staleProcessingBefore: Temporal.Instant.from(
          "2026-01-01T00:00:00.000Z"
        ),
      })
    );

    expect(claimed).toBeNull();
    expect(recording.statements).toHaveLength(1);
    const { sql, params } = recording.statements[0];
    expect(sql).toContain("on conflict");
    expect(sql).toContain('"attempt_count" + 1');
    expect(params).toContain("failed");
    expect(params).toContain("processing");
    expect(params).not.toContain("accepted");
    expect(
      params.some((param) => String(param).startsWith("2026-01-01T00:00"))
    ).toBe(true);
  });

  test("explicit resend reclaims accepted customer delivery", async () => {
    const { recording, repository } = await makeRepository();

    const claimed = await Effect.runPromise(
      repository.claimResend({
        invoiceId: "invoice-1",
        staleProcessingBefore: Temporal.Instant.from(
          "2026-01-01T00:00:00.000Z"
        ),
      })
    );

    expect(claimed).toBeNull();
    expect(recording.statements).toHaveLength(1);
    const { sql, params } = recording.statements[0];
    expect(params).toContain("accepted");
    expect(params).toContain("failed");
    expect(params).toContain("processing");
    expect(sql).toContain("case when");
    expect(sql).toContain('"attempt_count" + 1');
  });

  test("uses the claimed attempt number for terminal updates", async () => {
    const { recording, repository } = await makeRepository();

    await Effect.runPromise(
      Effect.all([
        repository.markAccepted({
          invoiceId: "invoice-1",
          audience: "customer",
          attemptNumber: 3,
          providerDeliveryId: "reend-id-1" as never,
          acceptedAt: Temporal.Instant.from("2026-01-01T01:00:00.000Z"),
        }),
        repository.markFailed({
          invoiceId: "invoice-1",
          audience: "customer",
          attemptNumber: 4,
          failureCode: "provider_rejected" as never,
        }),
      ])
    );

    expect(recording.statements).toHaveLength(2);
    for (const { sql, params } of recording.statements) {
      expect(sql).toContain("update");
      expect(sql).toContain('"attempt_count" = $');
      expect(params).toContain("processing");
    }
    expect(recording.statements[0].params).toContain(3);
    expect(recording.statements[1].params).toContain(4);
  });
});
