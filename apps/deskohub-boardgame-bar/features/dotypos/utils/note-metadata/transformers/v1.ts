import SuperJSON from "superjson";
import type { NoteTransformer } from "./shared";

export const noteTransformerV1: NoteTransformer = {
  encode: (noteData) => SuperJSON.stringify(noteData),
  decode: (noteDataStr) => SuperJSON.parse(noteDataStr),
  header: "---------- FORM DATA START ----------",
  footer: "----------- FORM DATA END -----------",
};
