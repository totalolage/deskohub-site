import { Predicate, SchemaIssue } from "effect";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * The dotted path of the first invalid field a schema issue names, such as
 * `seats` or `reservation.billing.address.postalCode`; undefined when the
 * issue names no field.
 */
export const getFirstInvalidFieldPath = (issue: SchemaIssue.Issue) =>
  formatIssues(issue)
    .issues[0]?.path?.map((segment) =>
      String(Predicate.hasProperty(segment, "key") ? segment.key : segment)
    )
    .join(".") || undefined;
