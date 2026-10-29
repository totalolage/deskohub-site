/// <reference path="./campaign-body-editor.server-action.d.ts" />

import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
// The reply encoder the browser uses to send a Server Action's arguments, as
// the app's Turbopack build bundles it; the webpack build needs webpack's
// runtime to load.
import {
  createTemporaryReferenceSet,
  encodeReply,
} from "next/dist/compiled/react-server-dom-turbopack/client.browser";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import { toCampaignPreviewInput } from "../composer/campaign-composer-fields";

registerWorkspaceComponentTestEnv();

mock.module("@/features/email-campaigns/admin/editor/actions", () => ({
  authorizeCampaignImageUpload: mock(async () => ({})),
}));

const { CampaignBodyEditor } = await import("./campaign-body-editor");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const body: CampaignBodyNode = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Podzim" }] },
    {
      type: "image",
      attrs: {
        src: "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg",
        alt: "Zasedačka",
        title: null,
        width: 480,
      },
    },
  ],
};

test("sends the edited body to the preview Server Action as plain data", async () => {
  const changes: CampaignBodyNode[] = [];
  const view = render(
    <CampaignBodyEditor
      contentLocale="cs-CZ"
      label="Body"
      onChange={(doc) => changes.push(doc)}
      value={body}
    />
  );
  const editor = await waitFor(() => {
    const element = view.container.querySelector<
      HTMLElement & { editor?: Editor }
    >(".ProseMirror");
    if (!element?.editor) throw new Error("The editor has not started");
    return element.editor;
  });

  act(() => {
    editor
      .chain()
      .setNodeSelection(8)
      .updateAttributes("image", { align: "left" })
      .run();
  });
  const edited = changes.at(-1);
  expect(edited?.content?.[1]?.attrs).toMatchObject({ align: "left" });

  // The composer's preview request, encoded the way the browser sends it.
  const request = toCampaignPreviewInput({
    templateKey: "workspace",
    purpose: "marketing",
    locale: "cs-CZ",
    fields: {
      subject: "Podzim",
      preheader: "",
      body: edited!,
      operationalReason: "",
    },
  });
  const payload = await encodeReply(
    [{ operation: "previewCampaignTemplate", input: request }],
    { temporaryReferences: createTemporaryReferenceSet() }
  );

  // A value the encoder can't serialize stays behind in the browser as a
  // temporary reference ("$T"), which the server can't read.
  expect(payload).toBeTypeOf("string");
  expect(payload).not.toContain('"$T"');
  expect(JSON.parse(payload as string)).toEqual([
    {
      operation: "previewCampaignTemplate",
      input: JSON.parse(JSON.stringify(request)),
    },
  ]);
});
