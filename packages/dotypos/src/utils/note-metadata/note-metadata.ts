import type { NoteTransformer } from "./transformers/shared";
import { noteTransformerV1 } from "./transformers/v1";
import { noteTransformerV2 } from "./transformers/v2";

const transformers = [noteTransformerV1, noteTransformerV2] as const satisfies [
  NoteTransformer,
  ...Array<NoteTransformer>,
];

const currentTransformer = transformers.at(-1)!;

export const createNoteData: (typeof currentTransformer)["encode"] = (
  ...args
) =>
  [
    currentTransformer.header,
    currentTransformer.encode(...args),
    currentTransformer.footer,
  ].join("\n");

export const parseNoteData = (note: string | null | undefined) => {
  if (!note) return null;

  const formDataText: string[] = [];

  let transformer: NoteTransformer | undefined;
  let inFormData = false;
  for (const line of note.split("\n")) {
    const noTransitionTriggered = transformers.every((candidateTransformer) => {
      if (!inFormData && line === candidateTransformer.header) {
        transformer = candidateTransformer;
        inFormData = true;
        return false;
      }

      if (
        inFormData &&
        transformer === candidateTransformer &&
        line === candidateTransformer.footer
      ) {
        inFormData = false;
        return false;
      }

      return true;
    });

    if (inFormData && noTransitionTriggered) {
      formDataText.push(line);
    }
  }

  if (!transformer) return null;

  return transformer.decode(formDataText.join("\n"));
};
