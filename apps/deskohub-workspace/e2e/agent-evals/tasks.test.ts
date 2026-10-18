import { describe, expect, test } from "bun:test";
import { locales } from "@/features/i18n";
import { makeAgentEvalPrompt } from "./tasks";

const startUrl =
  "https://deskohub-workspace-site-abc123def-team.vercel.app/en-US";
const parameters = [
  { taskId: "facts" },
  { date: "2027-02-18", taskId: "open-space-to-pay" },
  {
    date: "2027-02-18",
    expectedStartTime: "11:00",
    taskId: "meeting-room-to-pay",
  },
  { startDate: "2026-10-21", taskId: "office-to-pay" },
  { date: "2027-02-18", taskId: "open-space-payment" },
] as const;

describe("makeAgentEvalPrompt", () => {
  test.each(
    locales.flatMap((locale) =>
      parameters.map((task) => [locale, task] as const)
    )
  )("gives the %s %o task with only the start URL", (locale, task) => {
    const prompt = makeAgentEvalPrompt(task, locale, startUrl);
    const urls = prompt.match(/https?:\/\/\S+/g) ?? [];
    expect(urls.map((url) => url.replace(/[).,]+$/, ""))).toEqual([startUrl]);
    expect(prompt).not.toMatch(/checkout\/|#|data-|\[/);
  });

  test("states dates in the prompt's language", () => {
    expect(makeAgentEvalPrompt(parameters[1], "en-US", startUrl)).toContain(
      "Thursday, February 18, 2027"
    );
    expect(makeAgentEvalPrompt(parameters[1], "cs-CZ", startUrl)).toContain(
      "čtvrtek 18. února 2027"
    );
  });

  test("hands only the payment task the sandbox card and never the hidden expected start", () => {
    expect(makeAgentEvalPrompt(parameters[4], "en-US", startUrl)).toMatch(
      /card number \d{4} \d{4} \d{4} \d{4}, expiry \d{2}\/\d{2}/
    );
    expect(makeAgentEvalPrompt(parameters[1], "en-US", startUrl)).not.toMatch(
      /card/
    );
    expect(makeAgentEvalPrompt(parameters[2], "en-US", startUrl)).not.toContain(
      "11:00"
    );
  });
});
