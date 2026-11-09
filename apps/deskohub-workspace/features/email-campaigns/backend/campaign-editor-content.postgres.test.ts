import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  CliMutationRequestId,
  type OperationInput,
  type OperationOutput,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { richCampaignBodies } from "../body/campaign-body-document.test-utils";
import { markdownCampaignBody } from "../body/campaign-content-codec.test-utils";

const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "campaign_editor_content"
);
afterAll(() => testDatabase?.close());

if (testDatabase) {
  mock.module("@/db/database-provider.server", () => ({
    workspaceDatabaseLayer: testDatabase.layer,
  }));
}

type Registry = CampaignOperationRegistry;

let administrator: AdministratorAccountActor;

/** Runs one operation through the port as the seeded administrator. */
const invoke = async <Name extends CampaignOperationName>(
  name: Name,
  input: OperationInput<Registry[Name]>
): Promise<OperationOutput<Registry[Name]>> => {
  const { CampaignOperations } = await import("./campaign-operations.service");
  const { OperationRequestLedger } = await import(
    "./operation-request-ledger.service"
  );
  const { CurrentAdministrator } = await import(
    "@/features/administrators/backend/current-administrator"
  );
  return CampaignOperations.pipe(
    Effect.flatMap((operations) => operations.invoke(name, input)),
    Effect.provideService(CurrentAdministrator, administrator),
    Effect.provide(OperationRequestLedger.unscoped),
    Effect.provide(CampaignOperations.Live),
    Effect.runPromise
  );
};

/** The port's refusal code for an operation that should fail. */
const refusal = async <Name extends CampaignOperationName>(
  name: Name,
  input: OperationInput<Registry[Name]>
) =>
  invoke(name, input).then(
    () => undefined,
    (error: { readonly code?: string }) => error.code
  );

const czech = {
  subject: "Podzimní novinky",
  preheader: "Co je nového",
  bodyDocument: richCampaignBodies["cs-CZ"],
};
const english = {
  subject: "Autumn news",
  preheader: "What's new",
  bodyDocument: richCampaignBodies["en-US"],
};

const createDraft = () =>
  invoke("createCampaign", {
    requestId: CliMutationRequestId.make(crypto.randomUUID()),
    campaign: {
      title: "Autumn news",
      purpose: "marketing",
      templateKey: "workspace",
      audienceId: null,
      content: { "cs-CZ": czech, "en-US": english },
    },
  });

describe.skipIf(!testDatabase)("campaign editor content", () => {
  beforeAll(async () => {
    if (!testDatabase) return;
    administrator = await Effect.runPromise(
      workspaceFixtures(testDatabase.db).account("editor", {
        roles: ["administrator"],
      })
    );
  });

  test("reads back the documents a new campaign was created with", async () => {
    const { id } = await createDraft();
    const saved = await invoke("getCampaignEditorContent", { campaignId: id });
    expect(saved.content).toEqual({ "cs-CZ": czech, "en-US": english });
    expect([...saved.locales].sort()).toEqual(["cs-CZ", "en-US"]);
  });

  test("keeps every node Markdown would re-read differently", async () => {
    const { id } = await createDraft();
    const { content } = await invoke("getCampaign", { campaignId: id });
    const markdown = content["cs-CZ"]?.bodyMarkdown ?? "";
    const reread = await markdownCampaignBody(markdown);
    expect(reread).not.toEqual(richCampaignBodies["cs-CZ"]);
    const saved = await invoke("getCampaignEditorContent", { campaignId: id });
    expect(saved.content["cs-CZ"]?.bodyDocument).toEqual(
      richCampaignBodies["cs-CZ"]
    );
  });

  test("writes an edited document as given and leaves the other locale alone", async () => {
    const { id } = await createDraft();
    const edited = {
      ...richCampaignBodies["en-US"],
      doc: {
        ...richCampaignBodies["en-US"].doc,
        content: [...(richCampaignBodies["en-US"].doc.content ?? []).slice(1)],
      },
    };
    await invoke("updateCampaign", {
      campaignId: id,
      content: { "en-US": { bodyDocument: edited } },
    });
    const saved = await invoke("getCampaignEditorContent", { campaignId: id });
    expect(saved.content).toEqual({
      "cs-CZ": czech,
      "en-US": { ...english, bodyDocument: edited },
    });
  });

  test("keeps a chosen image width through save and editor readback", async () => {
    const { id } = await createDraft();
    const bodyDocument = {
      formatVersion: 1 as const,
      doc: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "https://res.cloudinary.com/cloud/image/upload/v1/email-campaigns/preview/synthetic.png",
              width: 180,
              height: null,
              align: "center",
              alt: "Synthetic QR",
            },
          },
        ],
      },
    };
    await invoke("updateCampaign", {
      campaignId: id,
      content: { "en-US": { bodyDocument } },
    });
    const saved = await invoke("getCampaignEditorContent", { campaignId: id });
    expect(saved.content["en-US"]?.bodyDocument).toEqual(bodyDocument);
    expect(saved.content["cs-CZ"]).toEqual(czech);
  });

  test("still takes a Markdown body next to document ones", async () => {
    const { id } = await createDraft();
    await invoke("updateCampaign", {
      campaignId: id,
      content: { "en-US": { bodyMarkdown: "Plain **news**" } },
    });
    const saved = await invoke("getCampaignEditorContent", { campaignId: id });
    expect(saved.content["cs-CZ"]).toEqual(czech);
    expect(saved.content["en-US"]?.bodyDocument).toEqual(
      await markdownCampaignBody("Plain **news**")
    );
  });

  test("refuses a body given both as Markdown and as a document", async () => {
    const { id } = await createDraft();
    expect(
      await refusal("updateCampaign", {
        campaignId: id,
        content: {
          "en-US": { bodyMarkdown: "Hi", bodyDocument: english.bodyDocument },
        },
      })
    ).toBe("input-invalid");
  });

  test("refuses a document with an unknown format version", async () => {
    const { id } = await createDraft();
    expect(
      await refusal("updateCampaign", {
        campaignId: id,
        content: {
          "en-US": {
            bodyDocument: { ...english.bodyDocument, formatVersion: 2 as 1 },
          },
        },
      })
    ).toBe("input-invalid");
  });

  test("refuses a document the content rules reject", async () => {
    const { id } = await createDraft();
    expect(
      await refusal("updateCampaign", {
        campaignId: id,
        content: {
          "en-US": {
            bodyDocument: {
              formatVersion: 1,
              doc: {
                type: "doc",
                content: [
                  { type: "ctaButton", attrs: { label: "", href: "" } },
                ],
              },
            },
          },
        },
      })
    ).toBe("content-document-invalid");
  });

  test("previews an unfinished document body without saving it", async () => {
    const preview = await invoke("previewCampaignTemplate", {
      templateKey: "workspace",
      preview: {
        _tag: "UnfinishedContent",
        purpose: "marketing",
        locale: "en-US",
        content: {
          subject: "Draft",
          preheader: "",
          bodyDocument: {
            formatVersion: 1,
            doc: {
              type: "doc",
              content: [{ type: "ctaButton", attrs: { label: "", href: "" } }],
            },
          },
        },
      },
    });
    expect(preview.subject).toBe("Draft");
  });
});
