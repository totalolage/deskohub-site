import { describe, expect, test } from "bun:test";
import { nextBuildRuns } from "./next-build";

describe("nextBuildRuns", () => {
  test("compiles and generates in separate runs by default", () => {
    expect(nextBuildRuns([])).toEqual([
      ["--experimental-build-mode=compile"],
      ["--experimental-build-mode=generate"],
    ]);
  });

  test("passes other arguments to both runs", () => {
    expect(nextBuildRuns(["--debug"])).toEqual([
      ["--experimental-build-mode=compile", "--debug"],
      ["--experimental-build-mode=generate", "--debug"],
    ]);
  });

  test("runs an explicit build mode once as given", () => {
    expect(nextBuildRuns(["--experimental-build-mode=compile"])).toEqual([
      ["--experimental-build-mode=compile"],
    ]);
    expect(nextBuildRuns(["--experimental-build-mode", "generate"])).toEqual([
      ["--experimental-build-mode", "generate"],
    ]);
  });
});
