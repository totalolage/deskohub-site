import { expect, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import { makeSoakReceipt, writeSoakReceipt } from "./soak-evidence";

test("the public receipt allowlist discards private fields and preserves the observed nonzero count", async () => {
  const rawContact = testEmailAddress("delivered+private-owner");
  const native = {
    service: "deskohub-workspace-e2e",
    scope: "e2e.run",
    outcome: "passed",
    startedAt: "2027-01-01T00:00:00.000000001Z",
    completedAt: "2027-01-01T00:00:01.000000001Z",
    spanSha256: "a".repeat(64),
    rawContact,
  } as const;
  const cleanup = {
    ownedActiveCount: 3,
    intervalCount: 2,
    pageCount: 2,
    customerCount: 4,
    parametersSha256: "b".repeat(64),
    responseSha256: "c".repeat(64),
    rawContact,
    reservationId: "private-reservation",
  };
  const receipt = makeSoakReceipt({
    environment: makeTestE2EEnvironment({
      GITHUB_RUN_ID: "12345",
      GITHUB_RUN_ATTEMPT: "1",
      TARGET_SHA: "d".repeat(40),
    }),
    native,
    cleanup,
    sourceSha256: "e".repeat(64),
    capturedAt: "2027-01-01T00:00:02.000000001Z",
    journalCount: 2,
    intentCount: 3,
  });
  const serialized = JSON.stringify(receipt);
  expect(serialized).not.toContain(rawContact);
  expect(serialized).not.toContain("private-reservation");
  expect(serialized).not.toContain("rawContact");
  expect(receipt.cleanup.ownedActiveCount).toBe(3);
  expect(Object.keys(receipt)).toEqual([
    "schema",
    "runId",
    "attempt",
    "targetSha",
    "sourceSha256",
    "nativeRun",
    "cleanup",
  ]);
  const write = spyOn(process.stdout, "write").mockImplementation(
    (_chunk, callback) => {
      if (typeof callback === "function")
        callback(new Error("synthetic write failure"));
      return false;
    }
  );
  try {
    const exit = await Effect.runPromise(
      Effect.exit(writeSoakReceipt(receipt))
    );
    expect(exit._tag).toBe("Failure");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toBe(`C18_SOAK_EVIDENCE ${serialized}\n`);
  } finally {
    write.mockRestore();
  }
});
