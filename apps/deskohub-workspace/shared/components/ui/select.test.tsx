import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Select, SelectTrigger, SelectValue } from "./select";

function extractTrigger(markup: string): string {
  const trigger = markup.match(/<button\b[^>]*>/)?.[0];
  if (!trigger) throw new Error("Select trigger was not rendered");
  return trigger;
}

test("renders the placeholder state and tint on the SSR select trigger", () => {
  const markup = renderToStaticMarkup(
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Choose a language" />
      </SelectTrigger>
    </Select>
  );
  const trigger = extractTrigger(markup);

  expect(trigger).toContain('data-state="closed"');
  expect(trigger).toContain('data-placeholder=""');
  expect(trigger).toContain("data-[placeholder]:text-navy-blue/55");
  expect(markup).toContain("Choose a language");
});

test("does not mark an explicit selected value as a placeholder", () => {
  const markup = renderToStaticMarkup(
    <Select defaultValue="czech">
      <SelectTrigger>
        <SelectValue placeholder="Choose a language">Czech</SelectValue>
      </SelectTrigger>
    </Select>
  );
  const trigger = extractTrigger(markup);

  expect(trigger).not.toContain("data-placeholder");
  expect(markup).toContain("Czech");
  expect(markup).not.toContain("Choose a language");
});
