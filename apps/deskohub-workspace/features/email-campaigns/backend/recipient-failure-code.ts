// seam: replaced at integration (phase B) — stands in for the recipients'
// `failure_code` column that S4's migration adds. Then return
// `{ failureCode: code ?? null }` from here, or set the column inline at the
// three callers and delete this module.

/** The recipient columns that record why its email wasn't sent, if it wasn't. */
export const recipientFailureCode = (_code: string | undefined) => ({});
