import { appendFile } from "node:fs/promises";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
} from "@playwright/test/reporter";

type GitHubSummaryReporterOptions = {
  readonly outputFile?: string;
  readonly title: string;
};

export const formatPlaywrightGitHubSummary = (
  title: string,
  suite: Suite,
  result: FullResult
) => {
  const counts = { expected: 0, flaky: 0, skipped: 0, unexpected: 0 };
  for (const test of suite.allTests()) counts[test.outcome()]++;

  return [
    `## ${title}`,
    "",
    `**Status:** ${result.status}`,
    "",
    `${counts.expected} passed · ${counts.unexpected} failed · ${counts.flaky} flaky · ${counts.skipped} skipped`,
    "",
    `**Duration:** ${(result.duration / 1000).toFixed(1)}s`,
    "",
  ].join("\n");
};

export default class GitHubSummaryReporter implements Reporter {
  private suite?: Suite;

  constructor(private readonly options: GitHubSummaryReporterOptions) {}

  onBegin(_config: FullConfig, suite: Suite) {
    this.suite = suite;
  }

  async onEnd(result: FullResult) {
    if (!this.options.outputFile || !this.suite) return;
    await appendFile(
      this.options.outputFile,
      formatPlaywrightGitHubSummary(this.options.title, this.suite, result)
    );
  }

  printsToStdio() {
    return false;
  }
}
