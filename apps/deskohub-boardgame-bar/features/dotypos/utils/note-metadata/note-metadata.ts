import type { NoteTransformer } from "./transformers/shared";
import { noteTransformerV1 } from "./transformers/v1";
import { noteTransformerV2 } from "./transformers/v2";

const transformers = [noteTransformerV1, noteTransformerV2] as const satisfies [
  NoteTransformer,
  ...Array<NoteTransformer>,
];

// There is always at least one transformer, so it is safe to assert non-null
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
  for (const line of note.split("\n"))
    if (
      // Check that no transformer causes a transition on this line (if so, do nothing else)
      transformers.every((t) => {
        if (!inFormData) {
          if (line === t.header) {
            transformer = t;
            inFormData = true;
            return false;
          }
        } else if (transformer === t && line === t.footer) {
          inFormData = false;
          return false;
        }
        return true;
      })
    ) {
      if (inFormData) formDataText.push(line);
    }

  if (!transformer) return null;

  const formData = transformer.decode(formDataText.join("\n"));
  return formData;
};
