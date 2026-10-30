import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { CampaignBodyNode } from "../../body/campaign-body-document";
import { CampaignBodyEditor } from "./campaign-body-editor";

const mountPoint = document.getElementById("editor-root");
if (!mountPoint) throw new Error("The editor harness root is missing.");
const locale = mountPoint.dataset.locale as Locale;

function ImageEditorHarness() {
  const [value, setValue] = useState<CampaignBodyNode>(() =>
    Schema.decodeUnknownSync(CampaignBodyNode)(
      JSON.parse(mountPoint!.dataset.document!)
    )
  );
  const [generation, setGeneration] = useState(0);
  return (
    <RouteLocaleProvider locale={locale}>
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl">
          {locale === "cs-CZ" ? "Ukázka e-mailu" : "Email example"}
        </h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            localStorage.setItem("campaign-body", JSON.stringify(value));
          }}
        >
          <CampaignBodyEditor
            contentLocale={locale}
            key={generation}
            label="Body"
            onChange={setValue}
            value={value}
          />
          <button type="submit">Save fixture</button>
          <button
            onClick={() => {
              setValue(
                Schema.decodeUnknownSync(CampaignBodyNode)(
                  JSON.parse(localStorage.getItem("campaign-body")!)
                )
              );
              setGeneration((current) => current + 1);
            }}
            type="button"
          >
            Reopen fixture
          </button>
          <output className="hidden" data-testid="document">
            {JSON.stringify(value)}
          </output>
        </form>
        <iframe
          className="mt-4 h-[600px] w-full border"
          title="Email preview"
        />
      </main>
    </RouteLocaleProvider>
  );
}

createRoot(mountPoint).render(<ImageEditorHarness />);

import { Schema } from "effect";
