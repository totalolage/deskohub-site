import { mock } from "bun:test";
import type { Editor } from "@tiptap/core";
import type { CampaignBodyNode } from "../../body/campaign-body-document";

/**
 * Loads the campaign body editor for a component test, with image uploads
 * never authorized. Call it after `registerWorkspaceComponentTestEnv`: it
 * loads React DOM, which must see happy-dom to handle input events.
 */
export const loadCampaignBodyEditorHarness = async () => {
  mock.module("@/features/emails/admin/editor/image-upload-actions", () => ({
    authorizeEmailImageUpload: async () => ({}),
  }));
  const testing = await import("@testing-library/react");
  const { CampaignBodyEditor } = await import("./campaign-body-editor");

  /** Renders the editor on `value` once it has started; `changes` collects each emitted body. */
  const renderEditor = async (value: CampaignBodyNode) => {
    const changes: CampaignBodyNode[] = [];
    const view = testing.render(
      <CampaignBodyEditor
        contentLocale="cs-CZ"
        label="Body"
        onChange={(doc) => changes.push(doc)}
        value={value}
      />
    );
    const editor = await testing.waitFor(() => {
      const element = view.container.querySelector<
        HTMLElement & { editor?: Editor }
      >(".ProseMirror");
      if (!element?.editor) throw new Error("The editor has not started");
      return element.editor;
    });
    return { view, editor, changes };
  };

  return { ...testing, renderEditor };
};

/** A body of one paragraph holding `text`, then whatever `blocks` follow. */
export const campaignBodyOf = (
  text: string,
  ...blocks: CampaignBodyNode[]
): CampaignBodyNode => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
    ...blocks,
  ],
});
