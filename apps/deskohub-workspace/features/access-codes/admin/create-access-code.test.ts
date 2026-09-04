import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  AdministrationInstant,
  AdministrationProviderCredentialId,
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeCreationOutcome,
  AdministrationStandaloneAccessCodeName,
  AdministrationStandaloneAccessCodePin,
} from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import {
  type CreateStandaloneAccessCodeFormInput,
  type CreateStandaloneAccessCodeResult,
  createStandaloneAccessCodeAttemptId,
  createStandaloneAccessCodeFormDefaults,
  createStandaloneAccessCodeFormSchema,
  createStandaloneAccessCodeInputSchema,
  decodeCreateStandaloneAccessCodeResult,
  encodeCreateStandaloneAccessCodeResult,
  formatStandaloneAccessCodeDuration,
  formatStandaloneAccessCodeLocalDateTime,
  isSameStandaloneAccessCodeWindow,
  isStandaloneAccessCodeLocalDateTime,
  isStandaloneAccessCodeWindowValid,
  shiftStandaloneAccessCodeLocalEnd,
  standaloneAccessCodeEarliestLocalEnd,
  standaloneAccessCodeElapsedHours,
  toStandaloneAccessCodeCreationFailure,
} from "./create-access-code";

const validWindow = {
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
};

const createdOutcome: AdministrationStandaloneAccessCodeCreationOutcome = {
  outcome: "created",
  attemptId: Schema.decodeSync(AdministrationStandaloneAccessCodeAttemptId)(
    "01980000-0000-7000-8000-000000000042"
  ),
  providerCredentialId: Schema.decodeSync(AdministrationProviderCredentialId)(
    "fixture-pin-id"
  ),
  name: Schema.decodeSync(AdministrationStandaloneAccessCodeName)("Booth A"),
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: AdministrationInstant.make("2026-09-10T09:00:00.000Z"),
  pin: Schema.decodeSync(AdministrationStandaloneAccessCodePin)("7654321"),
};

const cleanupTarget = {
  attemptId: Schema.decodeSync(AdministrationStandaloneAccessCodeAttemptId)(
    "01980000-0000-7000-8000-0000000000aa"
  ),
  name: Schema.decodeSync(AdministrationStandaloneAccessCodeName)(
    "Stale Booth"
  ),
};

describe("standalone access-code creation contract", () => {
  test("accepts the shared contract fields plus the attempt identifier", async () => {
    const result = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
    });

    expect(result.issues).toBeUndefined();
  });

  test("rejects excess properties and malformed attempt identifiers", async () => {
    const excess = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      deviceId: "extra",
    });
    expect(excess.issues).toBeDefined();

    const attemptId = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "not-a-uuid",
      ...validWindow,
    });
    expect(attemptId.issues?.[0]?.path?.map(String)).toEqual(["attemptId"]);
  });

  test("rejects an access window outside the shared contract bounds", async () => {
    const rejected = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      endsAt: "2026-09-10T09:00",
    });
    expect(rejected.issues).toBeDefined();
    expect(rejected.issues?.[0]?.path?.map(String)).toEqual(["endsAt"]);
    expect(rejected.issues?.[0]?.message).toBe(
      "The end must be 1 to 672 hours after the start."
    );
  });

  test("accepts the shared contract upper bound", async () => {
    const accepted = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      endsAt: "2026-10-08T10:00",
    });
    expect(accepted.issues).toBeUndefined();
  });

  test("counts the repeated fall-back hour through the shared contract check", async () => {
    const sixHundredSeventyTwoHours =
      await createStandaloneAccessCodeInputSchema["~standard"].validate({
        attemptId: "01980000-0000-7000-8000-000000000042",
        name: "Booth A",
        startsAt: "2026-10-24T01:00",
        endsAt: "2026-11-21T00:00",
      });
    expect(sixHundredSeventyTwoHours.issues).toBeUndefined();

    const sixHundredSeventyThreeHours =
      await createStandaloneAccessCodeInputSchema["~standard"].validate({
        attemptId: "01980000-0000-7000-8000-000000000042",
        name: "Booth A",
        startsAt: "2026-10-24T00:00",
        endsAt: "2026-11-21T00:00",
      });
    expect(sixHundredSeventyThreeHours.issues?.[0]?.path?.map(String)).toEqual([
      "endsAt",
    ]);
    expect(sixHundredSeventyThreeHours.issues?.[0]?.message).toBe(
      "The end must be 1 to 672 hours after the start."
    );
  });

  test("accepts the confirmed cleanup attempt id beside the contract fields", async () => {
    const result = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      providerCredentialRemovedAttemptId:
        "01980000-0000-7000-8000-0000000000aa",
    });

    expect(result.issues).toBeUndefined();
  });

  test("rejects the removed boolean confirmation and malformed cleanup attempt ids", async () => {
    const legacy = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      providerCredentialRemoved: true,
    });
    expect(legacy.issues).toBeDefined();

    const malformed = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      providerCredentialRemovedAttemptId: "not-a-uuid",
    });
    expect(malformed.issues?.[0]?.path?.map(String)).toEqual([
      "providerCredentialRemovedAttemptId",
    ]);
  });

  test("generates attempt identifiers that satisfy the contract schema", () => {
    const attemptId = createStandaloneAccessCodeAttemptId();

    expect(
      Schema.is(AdministrationStandaloneAccessCodeAttemptId)(attemptId)
    ).toBe(true);
  });
});

describe("standalone access-code local date-times", () => {
  test("accepts whole-hour site-local wall-clock values", () => {
    expect(isStandaloneAccessCodeLocalDateTime("2026-09-10T10:00")).toBe(true);
    expect(isStandaloneAccessCodeLocalDateTime("2026-09-10T10:30")).toBe(false);
    expect(isStandaloneAccessCodeLocalDateTime("2026-09-10")).toBe(false);
    expect(isStandaloneAccessCodeLocalDateTime("next week")).toBe(false);
  });

  test("rejects nonexistent spring-forward wall-clock times", () => {
    expect(isStandaloneAccessCodeLocalDateTime("2026-03-29T02:00")).toBe(false);
    expect(isStandaloneAccessCodeLocalDateTime("2026-03-29T01:00")).toBe(true);
    expect(isStandaloneAccessCodeLocalDateTime("2026-03-29T03:00")).toBe(true);
  });
});

describe("standalone access-code window arithmetic", () => {
  test("shifts the end across the spring-forward gap in elapsed hours", () => {
    expect(
      shiftStandaloneAccessCodeLocalEnd({
        startsAt: "2026-03-29T01:00",
        hours: 1,
      })
    ).toBe("2026-03-29T03:00");
    expect(
      standaloneAccessCodeElapsedHours({
        startsAt: "2026-03-29T01:00",
        endsAt: "2026-03-29T03:00",
      })
    ).toBe(1);
  });

  test("bounds the HTML end after the fall-back repeated hour", () => {
    expect(standaloneAccessCodeEarliestLocalEnd("2026-10-25T02:00")).toBe(
      "2026-10-25T03:00"
    );
    expect(standaloneAccessCodeEarliestLocalEnd("2026-09-10T10:00")).toBe(
      "2026-09-10T11:00"
    );
    expect(standaloneAccessCodeEarliestLocalEnd("2026-03-29T01:00")).toBe(
      "2026-03-29T03:00"
    );
    expect(
      isStandaloneAccessCodeWindowValid({
        startsAt: "2026-10-25T02:00",
        endsAt: "2026-10-25T02:00",
      })
    ).toBe(false);
    expect(
      isStandaloneAccessCodeWindowValid({
        startsAt: "2026-10-25T02:00",
        endsAt: "2026-10-25T03:00",
      })
    ).toBe(true);
  });

  test("counts the repeated fall-back hour in elapsed hours", () => {
    expect(
      standaloneAccessCodeElapsedHours({
        startsAt: "2026-10-25T01:00",
        endsAt: "2026-10-25T03:00",
      })
    ).toBe(3);
  });

  test("bounds the window between one and 672 elapsed hours", () => {
    const start = "2026-09-10T10:00";
    expect(
      isStandaloneAccessCodeWindowValid({
        startsAt: start,
        endsAt: shiftStandaloneAccessCodeLocalEnd({
          startsAt: start,
          hours: 1,
        }),
      })
    ).toBe(true);
    expect(
      isStandaloneAccessCodeWindowValid({
        startsAt: start,
        endsAt: shiftStandaloneAccessCodeLocalEnd({
          startsAt: start,
          hours: 672,
        }),
      })
    ).toBe(true);
    expect(
      isStandaloneAccessCodeWindowValid({
        startsAt: start,
        endsAt: shiftStandaloneAccessCodeLocalEnd({
          startsAt: start,
          hours: 673,
        }),
      })
    ).toBe(false);
    expect(
      isStandaloneAccessCodeWindowValid({ startsAt: start, endsAt: start })
    ).toBe(false);
  });

  test("returns no elapsed hours for non-whole-hour inputs", () => {
    expect(
      standaloneAccessCodeElapsedHours({
        startsAt: "2026-09-10T10:00",
        endsAt: "2026-09-10T11:30",
      })
    ).toBeNull();
  });
});

describe("standalone access-code action transport", () => {
  const alreadyCreatedOutcome: AdministrationStandaloneAccessCodeCreationOutcome =
    { ...createdOutcome, outcome: "already-created" as const };

  test("a raw Effect result does not survive plain-data transport", () => {
    const raw: CreateStandaloneAccessCodeResult =
      Result.succeed(createdOutcome);

    // JSON keeps the Result's `_tag` via toJSON, so the client guard passes,
    // but the payload moves to `value` and `.success` is gone.
    const viaJson = JSON.parse(
      JSON.stringify(raw)
    ) as CreateStandaloneAccessCodeResult;
    expect(Result.isSuccess(viaJson)).toBe(true);
    expect(viaJson.success).toBeUndefined();

    // Structured clone keeps `.success` but drops `_tag`, so the client
    // guard reports neither success nor failure.
    const viaClone = structuredClone(raw) as CreateStandaloneAccessCodeResult;
    expect(Result.isSuccess(viaClone)).toBe(false);
    expect(Result.isFailure(viaClone)).toBe(false);
  });

  test("round-trips a created outcome through JSON transport", () => {
    const transport = encodeCreateStandaloneAccessCodeResult(
      Result.succeed(createdOutcome)
    );
    const decoded = decodeCreateStandaloneAccessCodeResult(
      JSON.parse(JSON.stringify(transport))
    );

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(createdOutcome);
    }
  });

  test("round-trips an already-created outcome through structured clone", () => {
    const transport = encodeCreateStandaloneAccessCodeResult(
      Result.succeed(alreadyCreatedOutcome)
    );
    const decoded = decodeCreateStandaloneAccessCodeResult(
      structuredClone(transport)
    );

    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(alreadyCreatedOutcome);
    }
  });

  test("round-trips a failure outcome through JSON transport", () => {
    const transport = encodeCreateStandaloneAccessCodeResult(
      Result.fail({ outcome: "rejected" })
    );
    const decoded = decodeCreateStandaloneAccessCodeResult(
      JSON.parse(JSON.stringify(transport))
    );

    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure).toEqual({ outcome: "rejected" });
    }
  });

  test("round-trips a target-bearing failure through JSON transport", () => {
    const transport = encodeCreateStandaloneAccessCodeResult(
      Result.fail({ outcome: "cleanup-required", cleanupTarget })
    );
    const decoded = decodeCreateStandaloneAccessCodeResult(
      JSON.parse(JSON.stringify(transport))
    );

    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure).toEqual({
        outcome: "cleanup-required",
        cleanupTarget,
      });
    }
  });

  test("round-trips an ambiguous target through structured clone", () => {
    const transport = encodeCreateStandaloneAccessCodeResult(
      Result.fail({ outcome: "ambiguous", cleanupTarget })
    );
    const decoded = decodeCreateStandaloneAccessCodeResult(
      structuredClone(transport)
    );

    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.cleanupTarget).toEqual(cleanupTarget);
    }
  });

  test("encodes both branches as plain own-property data", () => {
    const succeeded = encodeCreateStandaloneAccessCodeResult(
      Result.succeed(createdOutcome)
    );
    expect(Object.keys(succeeded)).toEqual(["status", "outcome"]);
    expect(succeeded).toEqual({
      status: "succeeded",
      outcome: createdOutcome,
    });
    expect(JSON.parse(JSON.stringify(succeeded))).toEqual(succeeded);

    const failed = encodeCreateStandaloneAccessCodeResult(
      Result.fail({ outcome: "cleanup-required", cleanupTarget })
    );
    expect(Object.keys(failed)).toEqual(["status", "outcome"]);
    expect(failed).toEqual({
      status: "failed",
      outcome: { outcome: "cleanup-required", cleanupTarget },
    });
    expect(JSON.parse(JSON.stringify(failed))).toEqual(failed);
  });
});

describe("standalone access-code failure mapping", () => {
  test("keeps the reported cleanup target for target-bearing outcomes", () => {
    expect(
      toStandaloneAccessCodeCreationFailure({
        outcome: "cleanup-required",
        cleanupTarget,
      })
    ).toEqual({ outcome: "cleanup-required", cleanupTarget });
    expect(
      toStandaloneAccessCodeCreationFailure({
        outcome: "ambiguous",
        cleanupTarget,
      })
    ).toEqual({ outcome: "ambiguous", cleanupTarget });
  });

  test("reports a defect for target-bearing outcomes without a target", () => {
    expect(
      toStandaloneAccessCodeCreationFailure({ outcome: "ambiguous" })
    ).toBeNull();
    expect(
      toStandaloneAccessCodeCreationFailure({ outcome: "cleanup-required" })
    ).toBeNull();
  });

  test("keeps unrelated failures target-free", () => {
    expect(
      toStandaloneAccessCodeCreationFailure({
        outcome: "rejected",
        cleanupTarget,
      })
    ).toEqual({ outcome: "rejected" });
    expect(
      toStandaloneAccessCodeCreationFailure({ outcome: "in-progress" })
    ).toEqual({ outcome: "in-progress" });
    expect(
      toStandaloneAccessCodeCreationFailure({ outcome: "unavailable" })
    ).toEqual({ outcome: "unavailable" });
    expect(
      toStandaloneAccessCodeCreationFailure({ outcome: "reconciled" })
    ).toEqual({ outcome: "reconciled" });
  });
});

describe("standalone access-code form schema", () => {
  const validateForm = async (values: CreateStandaloneAccessCodeFormInput) => {
    const result =
      await createStandaloneAccessCodeFormSchema["~standard"].validate(values);
    return result.issues
      ? Object.groupBy(
          result.issues.map((issue) => ({
            path: issue.path?.map(String).join(".") ?? "",
            message: issue.message,
          })),
          (issue) => issue.path
        )
      : result.value;
  };

  test("defaults to blank form fields", () => {
    expect(createStandaloneAccessCodeFormDefaults).toEqual({
      name: "",
      startsAt: "",
      endsAt: "",
    });
  });

  test("reports concise field errors for missing values", async () => {
    const issues = await validateForm(createStandaloneAccessCodeFormDefaults);

    expect(issues.name?.map(({ message }) => message)).toEqual([
      "Enter a name for this access code.",
    ]);
    expect(issues.startsAt?.map(({ message }) => message)).toEqual([
      "Choose a start time.",
    ]);
    expect(issues.endsAt?.map(({ message }) => message)).toEqual([
      "Choose an end time.",
    ]);
  });

  test("reports the contract name bound without server help", async () => {
    const issues = await validateForm({
      ...validWindow,
      name: "x".repeat(61),
    });
    expect(issues.name?.map(({ message }) => message)).toEqual([
      "Use at most 60 characters.",
    ]);
  });

  test("rejects out-of-window ends on the end field only", async () => {
    const issues = await validateForm({
      name: validWindow.name,
      startsAt: "2026-09-10T12:00",
      endsAt: "2026-09-10T10:00",
    });

    expect(issues).toEqual({
      endsAt: [
        {
          path: "endsAt",
          message: "The end must be 1 to 672 hours after the start.",
        },
      ],
    });
  });

  test("keeps window errors off fields that are individually invalid", async () => {
    const issues = await validateForm({
      name: validWindow.name,
      startsAt: "2026-03-29T02:00",
      endsAt: "2026-03-29T01:00",
    });

    expect(issues.endsAt).toBeUndefined();
    expect(issues.startsAt?.map(({ message }) => message)).toEqual([
      "Choose a valid start time on the whole hour.",
    ]);
  });

  test("accepts trimmed names and valid windows", async () => {
    const values = await validateForm({
      name: "  Booth A  ",
      startsAt: validWindow.startsAt,
      endsAt: validWindow.endsAt,
    });

    expect(values).toEqual({
      name: "Booth A",
      startsAt: validWindow.startsAt,
      endsAt: validWindow.endsAt,
    });
  });
});

describe("standalone access-code presentation helpers", () => {
  test("formats local date-times and durations for operators", () => {
    expect(formatStandaloneAccessCodeLocalDateTime("2026-09-10T10:00")).toBe(
      "10 Sept 2026, 10:00"
    );
    expect(formatStandaloneAccessCodeDuration(1)).toBe("1 hour");
    expect(formatStandaloneAccessCodeDuration(24)).toBe("24 hours");
  });

  test("compares window values for attempt binding", () => {
    expect(
      isSameStandaloneAccessCodeWindow(validWindow, { ...validWindow })
    ).toBe(true);
    expect(
      isSameStandaloneAccessCodeWindow(validWindow, {
        ...validWindow,
        name: "Booth B",
      })
    ).toBe(false);
  });
});
