import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { runCommand } from "@/scripts/shared/command";
import { campaignLocaleContent } from "./campaign-content";

const localeContent = {
  subject: "Provozní doba",
  preheader: "Změna od listopadu",
  body: {
    formatVersion: 1,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Dobrý den" }] },
      ],
    },
  },
};

const decode = Schema.decodeUnknownOption(
  campaignLocaleContent(Option.some("cloud"))
);

describe("CampaignLocaleContent", () => {
  test("accepts content without an operational reason", () => {
    expect(Option.isSome(decode(localeContent))).toBe(true);
  });

  test("accepts a trimmed operational reason", () => {
    expect(
      decode({ ...localeContent, operationalReason: "Měníme provozní dobu." })
    ).toEqual(
      Option.some({
        ...localeContent,
        operationalReason: "Měníme provozní dobu.",
      })
    );
  });

  test.each(["", "   ", " Měníme provozní dobu."])(
    "rejects the operational reason %p",
    (operationalReason) => {
      expect(
        Option.isNone(decode({ ...localeContent, operationalReason }))
      ).toBe(true);
    }
  );
});

describe("campaign content without Cloudinary config", () => {
  test("imports, decodes, and converts an image-free body", async () => {
    // A fresh process without the test preload, as scripts and CLI contracts
    // import these modules.
    const script = `
      const { Effect, Option, Schema } = await import("effect");
      const { campaignLocalizedContent } = await import("./campaign-content.ts");
      const { readCampaignContent, writeCampaignContent } = await import("./campaign-content-codec.ts");
      const content = await Effect.runPromise(readCampaignContent({
        "cs-CZ": { subject: "S", preheader: "P", bodyMarkdown: "Dobrý den\\n\\n[[button: Rezervovat](https://deskohub.cz/book)]" },
      }));
      Schema.decodeUnknownSync(campaignLocalizedContent(Option.none()))(content);
      console.log(writeCampaignContent(content, "markdown")["cs-CZ"].bodyMarkdown);
    `;
    const { exitCode, stdout, stderr } = await runCommand(
      [process.execPath, "-e", script],
      {
        cwd: import.meta.dir,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      }
    );

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(stdout).toContain(
      "[[button: Rezervovat](https://deskohub.cz/book)]"
    );
  });
});
