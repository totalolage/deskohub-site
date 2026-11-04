import type { EmailPreviewRenderer } from "./email-preview-panel";
import type { previewEmailDraft } from "./preview-actions";

const typecheck = false as boolean;

if (typecheck) {
  // The editor's preview prop takes the preview action as it is, so a host
  // page wires the two together without an adapter.
  const renderer: EmailPreviewRenderer =
    null as unknown as typeof previewEmailDraft;
  void renderer;
}
