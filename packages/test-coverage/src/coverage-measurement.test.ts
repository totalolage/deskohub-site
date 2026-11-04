import { expect, test } from "bun:test";
import { turboTestScope } from "./coverage-measurement";

test.each<[ReadonlyArray<string>, "complete" | "partial"]>([
  [[], "complete"],
  [["--env-mode=loose"], "complete"],
  [["--concurrency", "2"], "complete"],
  [["--filter=@deskohub/dotypos"], "partial"],
  [["--filter", "@deskohub/dotypos"], "partial"],
  [["-F", "dhw"], "partial"],
  [["--affected"], "partial"],
])("turbo test arguments %p cover a %p test scope", (args, kind) => {
  expect(turboTestScope(args).kind).toBe(kind);
});
