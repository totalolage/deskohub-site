import { describe, expect, test } from "bun:test";
import { byStage } from "./deployment-stage";

const choices = { production: "production", otherwise: "otherwise" } as const;

describe("byStage", () => {
  test("selects the production value only on a production deployment", () => {
    expect(byStage("production", choices)).toBe("production");
    expect(byStage("preview", choices)).toBe("otherwise");
    expect(byStage("development", choices)).toBe("otherwise");
  });

  test("selects the otherwise value when the stage is missing", () => {
    // @ts-expect-error Exercise a missing deployment stage at runtime.
    expect(byStage(undefined, choices)).toBe("otherwise");
  });
});
