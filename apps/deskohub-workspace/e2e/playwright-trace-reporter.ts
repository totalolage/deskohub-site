import { type Dirent, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  FullProject,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { env } from "../env";
import {
  type PlaywrightTraceSource,
  sanitizePlaywrightTraceFile,
} from "./playwright-trace-sanitizer";
import { addRedaction } from "./redaction";

/**
 * Sanitizes each test's Playwright trace as soon as the test ends, so only
 * `sanitized-trace.zip` reaches the uploaded artifacts. A trace that can't be
 * sanitized is deleted, and the run output says so. List it before the
 * reporters that print attachment paths.
 *
 * It runs in the runner process, so it knows the bypass secret and the
 * credentials the trace recorded, but not secrets a worker registered. Give it
 * those before turning on traces for a project that registers any.
 */
export default class PlaywrightTraceReporter implements Reporter {
  private outputDirs: readonly string[] = [];

  constructor(private readonly source: PlaywrightTraceSource) {
    addRedaction(env.VERCEL_AUTOMATION_BYPASS_SECRET);
  }

  onBegin(config: {
    readonly projects: readonly Pick<FullProject, "outputDir">[];
  }) {
    this.outputDirs = [
      ...new Set(config.projects.map((project) => project.outputDir)),
    ];
  }

  onTestEnd(
    test: Pick<TestCase, "titlePath">,
    result: Pick<TestResult, "attachments">
  ) {
    for (const attachment of [...result.attachments]) {
      if (attachment.name !== "trace" || !attachment.path) continue;
      const sanitization = sanitizePlaywrightTraceFile(
        attachment.path,
        this.source
      );
      if (sanitization.outcome === "sanitized") {
        attachment.path = sanitization.path;
        continue;
      }
      result.attachments.splice(result.attachments.indexOf(attachment), 1);
      process.stdout.write(
        `Deleted the Playwright trace of "${test.titlePath().join(" › ")}": ${sanitization.reason}.\n`
      );
    }
  }

  // A trace no test reported, such as one from an interrupted test, is never
  // sanitized: delete it. Playwright's own working folders are left to it.
  onEnd() {
    for (const directory of this.outputDirs) {
      for (const path of listFiles(directory)) {
        if (!/^trace.*\.zip$/.test(basename(path))) continue;
        rmSync(path, { force: true });
        process.stdout.write(
          `Deleted an unreported Playwright trace: ${path}\n`
        );
      }
    }
  }

  printsToStdio() {
    return false;
  }
}

const listFiles = (directory: string): string[] => {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name.startsWith(".playwright-artifacts-")
        ? []
        : listFiles(path);
    return entry.isFile() ? [path] : [];
  });
};
