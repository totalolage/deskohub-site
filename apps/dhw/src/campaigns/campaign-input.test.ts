import { expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { readAudienceFilter } from "./campaign-input";

test("reads and preserves completed coworking visit filters from inline JSON", async () => {
  const filter = {
    attribute: "reservationCount",
    _tag: "Condition",
    params: {
      dateBasis: "visitEnd",
      period: { _tag: "Past" },
      product: { family: "cowork", properties: [] },
    },
    operator: "eq",
    value: 1,
  };
  const result = await Effect.runPromise(
    readAudienceFilter({
      filter: Option.some(JSON.stringify(filter)),
      filterFile: Option.none(),
    }).pipe(Effect.provide(BunServices.layer))
  );
  expect(Option.getOrThrow(result)).toEqual(filter);
});
