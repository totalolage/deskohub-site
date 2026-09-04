import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationStandaloneAccessCodeAttemptId } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import {
  type CreateStandaloneAccessCodeFormInput,
  createStandaloneAccessCodeAttemptId,
  createStandaloneAccessCodeFormDefaults,
  createStandaloneAccessCodeFormSchema,
  createStandaloneAccessCodeInputSchema,
  formatStandaloneAccessCodeDuration,
  formatStandaloneAccessCodeLocalDateTime,
  isSameStandaloneAccessCodeWindow,
  isStandaloneAccessCodeLocalDateTime,
  isStandaloneAccessCodeWindowValid,
  shiftStandaloneAccessCodeLocalEnd,
  standaloneAccessCodeEarliestLocalEnd,
  standaloneAccessCodeElapsedHours,
} from "./create-access-code";

const validWindow = {
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
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

  test("keeps the shared contract authoritative for the access window", async () => {
    const rejected = await createStandaloneAccessCodeInputSchema[
      "~standard"
    ].validate({
      attemptId: "01980000-0000-7000-8000-000000000042",
      ...validWindow,
      endsAt: "2026-09-10T09:00",
    });
    expect(rejected.issues).toBeUndefined();
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
