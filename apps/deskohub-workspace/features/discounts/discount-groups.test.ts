import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { listDiscountGroups } from "./discount-groups";

describe("listDiscountGroups", () => {
  test("trims names and drops deleted groups and groups without an id", async () => {
    const getDiscountGroups = () =>
      Effect.succeed([
        { id: "10", name: " Zulu ", deleted: false },
        { id: "2", name: "   ", deleted: false },
        { id: "3", name: null, deleted: false },
        { name: "No ID", deleted: false },
        { id: "4", name: "Deleted", deleted: true },
      ]);
    const dotypos = Layer.succeed(DotyposService, {
      getDiscountGroups,
    } as never);

    const result = await Effect.runPromise(
      listDiscountGroups.pipe(Effect.provide(dotypos))
    );

    expect(result).toEqual([
      { id: "10", name: "Zulu" },
      { id: "2", name: null },
      { id: "3", name: null },
    ]);
  });
});
