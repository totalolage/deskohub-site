import type { NoteData } from "../types";

export interface NoteTransformer {
  encode: (noteData: NoteData) => string;
  decode: (noteDataStr: string) => NoteData;
  header: string;
  footer: string;
}
