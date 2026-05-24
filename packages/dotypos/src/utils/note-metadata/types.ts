export interface NoteData {
  readonly datetime: Date;
  readonly duration: number;
  readonly guestCount: number;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly needsLargerTable: boolean;
  readonly needsPrivateSpace: boolean;
  readonly specialRequests?: string;
  readonly gdprConsent: boolean;
  readonly locale: string;
  readonly timestamp: Date;
  readonly source: "website";
}
