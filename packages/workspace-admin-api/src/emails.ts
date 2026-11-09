import { Effect, Schema } from "effect";
import { AdministrationCampaignPurpose } from "./campaign-locale-and-purpose";
import { AdministrationCampaignTemplateKey } from "./email-campaigns";
import {
  EmailCustomerField,
  EmailCustomerSelection,
} from "./email-customer-selection";
import { EmailValueName } from "./email-identifiers";
import { AdministrationStoredDiscountId } from "./workspace-admin-api";

const key = Schema.NonEmptyString;
const path = Schema.Array(key).check(Schema.isMinLength(1));
const httpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/));
/**
 * Where a link, button, linked image or offer leads. Decoding accepts any web
 * or `mailto:` address so historical publications keep decoding; publication
 * requires `https:` or `mailto:`.
 */
const destination = Schema.String.check(
  Schema.isPattern(/^(?:https?:\/\/|mailto:)[^\s]+$/)
);
/** Shared destinations of one text-bearing component, named by link key. */
const links = Schema.optionalKey(Schema.Record(key, destination));
/** Formatting a rich text part carries; plain texts must not set it. */
const marks = {
  bold: Schema.optionalKey(Schema.Boolean),
  italic: Schema.optionalKey(Schema.Boolean),
  /** A link key of the component that owns this text. */
  link: Schema.optionalKey(key),
};
const draftMarks = {
  bold: Schema.optionalKey(Schema.Boolean),
  italic: Schema.optionalKey(Schema.Boolean),
  link: Schema.optionalKey(Schema.String),
};

export const EmailInlinePart = Schema.Union([
  Schema.TaggedStruct("Text", { text: Schema.String, ...marks }),
  Schema.TaggedStruct("Value", {
    name: EmailValueName,
    field: Schema.optionalKey(path),
    ...marks,
  }),
]);
export type EmailInlinePart = typeof EmailInlinePart.Type;
const inline = Schema.Array(EmailInlinePart);
const draftInline = Schema.Array(
  Schema.Union([
    Schema.TaggedStruct("Text", {
      text: Schema.optionalKey(Schema.String),
      ...draftMarks,
    }),
    Schema.TaggedStruct("Value", {
      name: Schema.optionalKey(Schema.String),
      field: Schema.optionalKey(Schema.Array(Schema.String)),
      ...draftMarks,
    }),
  ])
);

/** One text list item; a nested list follows its text. */
export interface EmailTextListItem {
  readonly textKey: string;
  readonly list?: EmailTextListLevel;
}
export interface EmailTextListLevel {
  readonly ordered: boolean;
  readonly start?: number;
  readonly items: readonly EmailTextListItem[];
}
const listStart = Schema.optionalKey(
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
);
const textListItems: Schema.Codec<readonly EmailTextListItem[]> = Schema.Array(
  Schema.Struct({
    textKey: key,
    list: Schema.optionalKey(Schema.suspend(() => EmailTextListLevel)),
  })
).check(Schema.isMinLength(1));
const EmailTextListLevel: Schema.Codec<EmailTextListLevel> = Schema.Struct({
  ordered: Schema.Boolean,
  start: listStart,
  items: textListItems,
});
interface DraftTextListLevel {
  readonly ordered?: boolean;
  readonly start?: number;
  readonly items?: readonly {
    readonly textKey?: string;
    readonly list?: DraftTextListLevel;
  }[];
}
const draftTextListItems: Schema.Codec<
  NonNullable<DraftTextListLevel["items"]>
> = Schema.Array(
  Schema.Struct({
    textKey: Schema.optionalKey(Schema.String),
    list: Schema.optionalKey(Schema.suspend(() => DraftTextListLevel)),
  })
);
const DraftTextListLevel: Schema.Codec<DraftTextListLevel> = Schema.Struct({
  ordered: Schema.optionalKey(Schema.Boolean),
  start: Schema.optionalKey(Schema.Int),
  items: Schema.optionalKey(draftTextListItems),
});

export const EmailDiscountSelection = Schema.Struct({
  kind: Schema.Literal("discount"),
  discountId: AdministrationStoredDiscountId,
  validDays: Schema.Int.check(Schema.isGreaterThan(0)),
  maxUses: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1))
  ),
  maxUsesPerCustomer: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1))
  ),
});
export type EmailDiscountSelection = typeof EmailDiscountSelection.Type;

/** Position in this array is generation order; unused definitions are not generated. */
export const EmailValueDefinition = Schema.Struct({
  name: EmailValueName,
  source: Schema.Union([EmailCustomerSelection, EmailDiscountSelection]),
  fallback: Schema.optionalKey(Schema.Record(key, Schema.String)),
  customerShape: Schema.optionalKey(EmailCustomerField),
  customerSortShape: Schema.optionalKey(EmailCustomerField),
});
export type EmailValueDefinition = typeof EmailValueDefinition.Type;

const componentField = Schema.Struct({ field: path, labelKey: key });
const fields = Schema.Array(componentField).check(Schema.isMinLength(1));
export const EmailBodyComponent = Schema.Union([
  Schema.TaggedStruct("Paragraph", { id: key, textKey: key, links }),
  Schema.TaggedStruct("Heading", {
    id: key,
    textKey: key,
    level: Schema.Literals([1, 2, 3]),
    links,
  }),
  /** A bulleted or numbered list of translated rich texts. */
  Schema.TaggedStruct("TextList", {
    id: key,
    ordered: Schema.Boolean,
    start: listStart,
    items: textListItems,
    links,
  }),
  Schema.TaggedStruct("Divider", { id: key }),
  /** An empty line, as a blank paragraph renders. */
  Schema.TaggedStruct("Spacer", { id: key }),
  Schema.TaggedStruct("Image", {
    id: key,
    src: httpUrl,
    altKey: key,
    href: Schema.optionalKey(destination),
    align: Schema.optionalKey(Schema.Literals(["left", "center", "right"])),
    /** Intrinsic width in whole pixels; unset fills the body column. */
    width: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
  Schema.TaggedStruct("Button", { id: key, labelKey: key, href: destination }),
  Schema.TaggedStruct("Record", { id: key, value: EmailValueName, fields }),
  Schema.TaggedStruct("List", {
    id: key,
    value: EmailValueName,
    fields: Schema.optionalKey(fields),
    sort: Schema.optionalKey(
      Schema.Struct({
        path: Schema.Array(key),
        direction: Schema.Literals(["asc", "desc"]),
      })
    ),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
  Schema.TaggedStruct("Offer", {
    id: key,
    value: EmailValueName,
    labelKey: key,
    href: destination,
  }),
]);
export type EmailBodyComponent = typeof EmailBodyComponent.Type;

const translationFields = Schema.Struct({
  subject: inline,
  preheader: inline,
  texts: Schema.Record(key, inline),
  operationalReason: Schema.optionalKey(inline),
});
export const EmailTranslation = translationFields;
export type EmailTranslation = typeof EmailTranslation.Type;

/** Partly configured controls remain serializable until explicit publication. */
const draftSource = Schema.Struct({
  kind: Schema.Literals(["customer", "discount"]),
  path: Schema.optionalKey(Schema.Array(Schema.String)),
  fields: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  sort: Schema.optionalKey(
    Schema.Struct({
      path: Schema.optionalKey(Schema.Array(Schema.String)),
      direction: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
    })
  ),
  limit: Schema.optionalKey(Schema.Int),
  discountId: Schema.optionalKey(Schema.String),
  validDays: Schema.optionalKey(Schema.Int),
  maxUses: Schema.optionalKey(Schema.Int),
  maxUsesPerCustomer: Schema.optionalKey(Schema.Int),
});
const draftComponent = Schema.Struct({
  _tag: Schema.Literals([
    "Paragraph",
    "Heading",
    "Image",
    "Button",
    "Record",
    "List",
    "Offer",
    "TextList",
    "Divider",
    "Spacer",
  ]),
  id: Schema.optionalKey(Schema.String),
  textKey: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.Literals([1, 2, 3])),
  links: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  ordered: Schema.optionalKey(Schema.Boolean),
  start: Schema.optionalKey(Schema.Int),
  items: Schema.optionalKey(draftTextListItems),
  src: Schema.optionalKey(Schema.String),
  altKey: Schema.optionalKey(Schema.String),
  href: Schema.optionalKey(Schema.String),
  align: Schema.optionalKey(Schema.Literals(["left", "center", "right"])),
  width: Schema.optionalKey(Schema.Int),
  labelKey: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(
    Schema.Struct({
      path: Schema.optionalKey(Schema.Array(Schema.String)),
      direction: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
    })
  ),
  limit: Schema.optionalKey(Schema.Int),
  fields: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.optionalKey(Schema.Array(Schema.String)),
        labelKey: Schema.optionalKey(Schema.String),
      })
    )
  ),
});
export const EmailDraft = Schema.Struct({
  purpose: Schema.optionalKey(AdministrationCampaignPurpose),
  templateKey: Schema.optionalKey(AdministrationCampaignTemplateKey),
  structure: Schema.optionalKey(Schema.Array(draftComponent)),
  translations: Schema.optionalKey(
    Schema.Record(
      key,
      Schema.Struct({
        subject: Schema.optionalKey(draftInline),
        preheader: Schema.optionalKey(draftInline),
        texts: Schema.optionalKey(Schema.Record(key, draftInline)),
        operationalReason: Schema.optionalKey(draftInline),
      })
    )
  ),
  values: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        source: Schema.optionalKey(draftSource),
        customerShape: Schema.optionalKey(EmailCustomerField),
        customerSortShape: Schema.optionalKey(EmailCustomerField),
        fallback: Schema.optionalKey(Schema.Record(key, Schema.String)),
      })
    )
  ),
}).annotate({
  identifier: "EmailDraft",
  parseOptions: { onExcessProperty: "error" },
});
export type EmailDraft = typeof EmailDraft.Type;

/** Historical decoding deliberately does not require today's Workspace languages or field catalogue. */
export const EmailDocument = Schema.Struct({
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  structure: Schema.Array(EmailBodyComponent),
  translations: Schema.Record(key, EmailTranslation),
  values: Schema.Array(EmailValueDefinition),
}).annotate({ identifier: "EmailDocument" });
export type EmailDocument = typeof EmailDocument.Type;
