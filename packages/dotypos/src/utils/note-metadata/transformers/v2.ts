import is from "invisible-strings";
import SuperJSON from "superjson";
import type { NoteTransformer } from "./shared";

export const noteTransformerV2: NoteTransformer = {
  encode: (noteData) => is.toInvisible(SuperJSON.stringify(noteData)),
  decode: (noteDataStr) => SuperJSON.parse(is.fromInvisible(noteDataStr)),
  header: is.toInvisible("EF76840A-D8BA-4809-B303-F54678AB96E9"),
  footer: is.toInvisible("10B35C1C-9B20-4E15-AA54-80BEEBA13C5F"),
};
