import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");

describe("contact form independence from reservation message removal", () => {
  test("contact form keeps its own Textarea import and message field", () => {
    const source = readFileSync(
      join(root, "features/contact/components/contact-form.tsx"),
      "utf8"
    );
    expect(source).toContain(
      'import { Textarea } from "@/shared/components/ui/textarea"'
    );
    expect(source).toContain('name="message"');
  });

  test("reservation customer fields no longer import Textarea", () => {
    const source = readFileSync(
      join(
        root,
        "features/reservation/components/reservation-customer-fields.tsx"
      ),
      "utf8"
    );
    expect(source).not.toContain("Textarea");
    expect(source).not.toContain("messagePlaceholder");
    expect(source).not.toContain('name="message"');
  });
});
