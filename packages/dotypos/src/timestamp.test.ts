import { describe, expect, test } from "bun:test";
import { DateTime, Result, Schema } from "effect";
import {
  DotyposTimestampFromString,
  DotyposTimestampSchema,
  dotyposTimestampFromDateTime,
  formatDotyposTimestamp,
} from "./timestamp";

const decode = Schema.decodeUnknownResult(DotyposTimestampFromString);

describe("DotyposTimestampFromString", () => {
  // Shapes the synthetic Dotypos cloud returned on 2026-10-16: up to six
  // fraction digits with trailing zeros trimmed.
  test.each([
    ["2026-05-28T18:51:02.838316Z", "1779994262838316"],
    ["2026-05-30T16:04:35.74702Z", "1780157075747020"],
    ["2026-05-28T16:26:25.956Z", "1779985585956000"],
    ["2026-05-28T16:26:25Z", "1779985585000000"],
    ["2026-05-28T18:26:25.000001+02:00", "1779985585000001"],
  ])("decodes %s to its exact microsecond", (value, micros) => {
    expect(decode(value)).toEqual(
      Result.succeed(DotyposTimestampSchema.make(BigInt(micros)))
    );
  });

  test.each([
    "2026-05-28T18:51:02.8383161Z",
    "2026-05-28T18:51:02.838316",
    "2026-05-28 18:51:02.838316Z",
    "1779994262838",
    "",
  ])("rejects %j", (value) => {
    expect(Result.isFailure(decode(value))).toBe(true);
  });

  test("encodes six fraction digits in UTC", () => {
    expect(
      Schema.encodeSync(DotyposTimestampFromString)(
        DotyposTimestampSchema.make(BigInt("1780157075747020"))
      )
    ).toBe("2026-05-30T16:04:35.747020Z");
  });

  test("formats instants before the epoch with a positive fraction", () => {
    expect(formatDotyposTimestamp(BigInt(-1))).toBe(
      "1969-12-31T23:59:59.999999Z"
    );
  });
});

describe("dotyposTimestampFromDateTime", () => {
  test("names the first microsecond of the millisecond", () => {
    expect(
      dotyposTimestampFromDateTime(
        DateTime.makeUnsafe("2026-05-28T18:51:02.838Z")
      )
    ).toBe(DotyposTimestampSchema.make(BigInt("1779994262838000")));
  });
});
