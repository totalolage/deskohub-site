import {
  type Editor,
  Extension,
  type Extensions,
  type JSONContent,
  Mark,
  mergeAttributes,
  Node,
} from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Option, Schema } from "effect";
import {
  emailInlineLinkMark,
  emailInlineValueNode,
  emailInlineValueReference,
  singleLineEmailInlineText,
} from "./email-inline-parts";
import { emailValueReferenceLabel } from "./email-value-options";

/** The inline content of a pasted or dropped slice, its blocks joined by spaces. */
const inlineSlice = (slice: Slice): Slice => {
  const nodes: ProseMirrorNode[] = [];
  const collect = (fragment: Fragment) =>
    fragment.forEach((node) => {
      if (node.isText)
        nodes.push(
          node.type.schema.text(
            singleLineEmailInlineText(node.text ?? ""),
            node.marks
          )
        );
      else if (node.isInline) nodes.push(node);
      else {
        if (node.isTextblock && nodes.length > 0)
          nodes.push(node.type.schema.text(" "));
        collect(node.content);
      }
    });
  collect(slice.content);
  return new Slice(Fragment.fromArray(nodes), 0, 0);
};

/**
 * Keeps the text on one line: Enter does nothing, and pasted or dropped
 * paragraphs and line breaks join with spaces.
 */
const EmailInlineSingleLine = Extension.create({
  name: "emailInlineSingleLine",
  // Ahead of the core keymap, which would try to split the paragraph.
  priority: 1000,
  addKeyboardShortcuts: () => ({
    Enter: () => true,
    "Shift-Enter": () => true,
    "Mod-Enter": () => true,
  }),
  addProseMirrorPlugins: () => [
    new Plugin({
      key: new PluginKey("emailInlineSingleLine"),
      props: {
        transformPastedText: singleLineEmailInlineText,
        transformPasted: inlineSlice,
      },
    }),
  ],
});

type EmailInlineValueCheck = {
  /** The defined value names; unknown until the field reports them. */
  readonly names: ReadonlySet<string> | undefined;
  readonly decorations: DecorationSet;
};

const emailInlineValueCheckKey = new PluginKey<EmailInlineValueCheck>(
  "emailInlineValueCheck"
);

const missingValueDecorations = (
  doc: ProseMirrorNode,
  names: ReadonlySet<string> | undefined,
  missingLabel: string
): DecorationSet => {
  if (!names) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== emailInlineValueNode) return;
    const { name } = emailInlineValueReference(node.attrs);
    if (name !== undefined && names.has(name)) return;
    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        "data-missing": "",
        title: missingLabel,
      })
    );
  });
  return DecorationSet.create(doc, decorations);
};

/**
 * Tells `editor` which value names the draft defines, so its value
 * references to anything else show as missing. It changes no content and
 * adds nothing to the undo history.
 */
export const setEmailInlineValueNames = (
  editor: Editor,
  names: ReadonlySet<string>
) => {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(emailInlineValueCheckKey, names)
      .setMeta("addToHistory", false)
  );
};

/**
 * Replaces the text of `editor` with `content` and starts its undo history
 * afresh, so Undo can't bring back what was replaced. It writes nothing
 * back: the editor reports no update.
 */
export const replaceEmailInlineContent = (
  editor: Editor,
  content: JSONContent
) => {
  if (editor.isDestroyed) return;
  const { plugins, schema } = editor.state;
  const names = emailInlineValueCheckKey.getState(editor.state)?.names;
  const doc = ProseMirrorNode.fromJSON(schema, content);
  editor.view.updateState(
    EditorState.create({ doc, plugins, selection: Selection.atEnd(doc) })
  );
  // The new state restarts every plugin, so the value check learns the
  // defined names again; the transaction also refreshes the toolbar.
  editor.view.dispatch(
    editor.state.tr
      .setMeta(emailInlineValueCheckKey, names)
      .setMeta("addToHistory", false)
  );
};

const decodeField = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String))
);

const valueLabel = (node: ProseMirrorNode): string => {
  const { name = "", field } = emailInlineValueReference(node.attrs);
  return emailValueReferenceLabel({ name, field });
};

/**
 * A value reference: an atom chip labelled with the reference. `name` and
 * `field` are `null` while unset. A reference to a name the draft doesn't
 * define shows as missing, with `missingLabel` as its hint.
 */
const EmailInlineValue = Node.create<{ readonly missingLabel: string }>({
  name: emailInlineValueNode,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ missingLabel: "" }),
  addAttributes: () => ({
    name: {
      default: null,
      parseHTML: (element) => element.getAttribute("data-name"),
      renderHTML: ({ name }) => ({ "data-name": name }),
    },
    field: {
      default: null,
      parseHTML: (element) =>
        Option.getOrNull(decodeField(element.getAttribute("data-field"))),
      renderHTML: ({ field }) => ({
        "data-field": Array.isArray(field) ? JSON.stringify(field) : null,
      }),
    },
  }),
  parseHTML: () => [{ tag: "span[data-email-value]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      "data-email-value": "",
      class:
        "mx-px inline-block rounded border border-navy-blue/25 bg-navy-blue/[0.06] px-1 font-mono text-[0.85em] text-navy-blue leading-snug data-[missing]:border-burned-orange data-[missing]:border-dashed data-[missing]:bg-burned-orange/10 data-[missing]:text-burned-orange-ink [&.ProseMirror-selectednode]:ring-2 [&.ProseMirror-selectednode]:ring-navy-blue/40",
    }),
    valueLabel(node) || "?",
  ],
  renderText: ({ node }) => `{${valueLabel(node)}}`,
  addProseMirrorPlugins() {
    const { missingLabel } = this.options;
    return [
      new Plugin<EmailInlineValueCheck>({
        key: emailInlineValueCheckKey,
        state: {
          init: () => ({ names: undefined, decorations: DecorationSet.empty }),
          apply: (transaction, check, _previous, state) => {
            const names: ReadonlySet<string> | undefined =
              transaction.getMeta(emailInlineValueCheckKey) ?? check.names;
            if (names === check.names && !transaction.docChanged) return check;
            return {
              names,
              decorations: missingValueDecorations(
                state.doc,
                names,
                missingLabel
              ),
            };
          },
        },
        props: {
          decorations: (state) =>
            emailInlineValueCheckKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

/**
 * Ties text to one of the owning block's links by its link key; the block
 * holds the destination. Typing at a link's end doesn't extend it.
 */
const EmailInlineLink = Mark.create({
  name: emailInlineLinkMark,
  inclusive: false,
  addAttributes: () => ({
    key: {
      default: null,
      parseHTML: (element) => element.getAttribute("data-email-link"),
      renderHTML: ({ key }) => ({ "data-email-link": key }),
    },
  }),
  parseHTML: () => [{ tag: "span[data-email-link]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      class: "text-burned-orange-ink underline underline-offset-2",
    }),
    0,
  ],
});

/**
 * The extensions of one translated text's editor: a single paragraph of text
 * and value references, with history. Rich texts add bold, italic and
 * links, in the order `email-inline-parts` writes marks; plain texts have no
 * marks at all, so pasted formatting is dropped.
 */
export const emailInlineTextExtensions = ({
  missingValueLabel,
  mode,
}: {
  readonly missingValueLabel: string;
  readonly mode: "rich" | "plain";
}): Extensions => [
  Document.extend({ content: "paragraph" }),
  Paragraph,
  Text,
  UndoRedo,
  EmailInlineSingleLine,
  EmailInlineValue.configure({ missingLabel: missingValueLabel }),
  ...(mode === "rich" ? [Bold, Italic, EmailInlineLink] : []),
];
