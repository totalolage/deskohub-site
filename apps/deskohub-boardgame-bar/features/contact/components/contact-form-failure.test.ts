import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";
import { describeContactFormFailure } from "./contact-form-failure";

describe("describeContactFormFailure", () => {
  test("reports and shows the server's error", () => {
    expect(describeContactFormFailure("Mail provider unavailable")).toEqual({
      trackedError: "Mail provider unavailable",
      message: "Mail provider unavailable",
    });
  });

  test("reports an unknown error and shows the generic message without one", () => {
    const generic = {
      trackedError: "Unknown error",
      message: m["errors.submissionError"](),
    };

    expect(describeContactFormFailure(undefined)).toEqual(generic);
    expect(describeContactFormFailure("")).toEqual(generic);
  });
});
