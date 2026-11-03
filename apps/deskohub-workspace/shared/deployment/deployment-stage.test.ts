import { describe, expect, test } from "bun:test";
import { byStage, type DeploymentEnvironment } from "./deployment-stage";

const choices = { production: "production", otherwise: "otherwise" } as const;

describe("byStage", () => {
  test("selects the production value only on a production deployment", () => {
    expect(byStage("production", choices)).toBe("production");
    expect(byStage("preview", choices)).toBe("otherwise");
    expect(byStage("development", choices)).toBe("otherwise");
  });

  test("selects the otherwise value when the stage is missing", () => {
    expect(
      byStage(undefined as unknown as DeploymentEnvironment, choices)
    ).toBe("otherwise");
  });
});
