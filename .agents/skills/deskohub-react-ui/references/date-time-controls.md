# Date, time, and date-time controls

The Workspace has one implementation of each: `DateInput`, `TimeInput`, and `DateTimeInput` in `apps/deskohub-workspace/shared/components/date-time`. Features compose them; don't fork a picker per feature.

## Values

- Values are canonical strings: dates `YYYY-MM-DD`, times `HH:mm`, local date-times `YYYY-MM-DDTHH:mm`. An empty string is no value. `onChange` reports the canonical string, including `""` for a clear.
- A value that isn't canonical, such as a date-time passed to `DateInput` or a time with seconds, shows as empty. Convert at the feature boundary.
- The controls never pick a time zone or convert to an instant. The owning feature decides what a local date-time means, such as Prague time for discount redemption windows.

## Forms

- Pass `value` and `onChange` to control a field, or `defaultValue` to leave it uncontrolled. Once a parent passes `value`, it owns the value; an edit it doesn't pass back doesn't stick.
- With a `name`, the control submits exactly one canonical value through a hidden field, so plain `FormData` forms and GET filter forms read it like a native input. An uncontrolled control returns to its `defaultValue` on a native form reset.
- Inside a React Hook Form `FormItem`, use `FormDateInput`, `FormTimeInput`, or `FormDateTimeInput` (`form-fields.tsx`) in place of `FormControl`, and spread the field: `<FormDateInput label={...} {...field} />`. The item's label names the control, and a field error marks it invalid and describes it.
- An entry the control can't take never becomes the value and keeps the owning form from submitting, `noValidate` forms included: date text that is no date (or a date outside the bounds), a time editor showing an unfinished or rejected time, a time the bounds no longer allow, or a date-time with only a date or only a time. The control focuses the entry and explains it. The guard listens to the form's `submit` event, so code that calls React Hook Form's `handleSubmit` directly or reads `new FormData(form)` without submitting must check `onPartialDraftChange` itself. A disabled control, or one inside a disabled `fieldset`, never blocks.
- The controls report plain strings through `onChange`, so React Hook Form fields use `FormField`/`Controller`, not `register(...)` spreads.
- A partial date-time draft survives a React Hook Form `reset` that leaves the field's value unchanged. To discard it, remount the control with a new `key`.

## Layout

- A date field takes the width of its cell. Below 12rem it moves the calendar button to its own row under the text, so a narrow cell, such as half of a date pair on a phone, still shows a whole date and the format placeholder; wider cells keep the button inside the field. There is no prop for it.
- The field measures its own width (a CSS container), so it can't size to its content: give it a cell that stretches it, such as a grid track or a `FormItem`, never a shrink-to-fit parent.
- Keep the 16px field text: phones zoom into smaller text. When a pair of date fields must share a phone-width row, measure it with a real-browser test (`features/discounts/admin/creation-dialogs.browser-acceptance.test.tsx` checks placeholder and typed-date width).

## Labels and copy

- `label` (`dateLabel` and `timeLabel` on `DateTimeInput`) names each field, and the date field's calendar button and calendar. A visible label passed as `aria-labelledby` names the date field instead; the time field of a date-time keeps `timeLabel`. Pass complete localized strings: administration labels come from the area's administration catalog.
- The controls' own copy (format hint, typed-date errors, calendar button, Clear, incomplete date-time) is in the customer catalog under `dateInput*` and `dateTimeInput*`, worded without addressing the reader, so the same text serves customers and operators. Never import the administration catalog into these controls: it would ship administration copy to customer pages.
- `locale` defaults to the route locale.

## Policy

Feature policy stays in the caller or a thin adapter; the controls only take generic hooks:

- `minimum` and `maximum`: canonical bounds in the control's own format, or functions read again at every check so a bound that moves with the clock holds without a re-render. A date-time's bounds also bound its date field and, on the bound's own day, its time field.
- `isDateDisabled`: dates the calendar doesn't offer and typed text can't choose, such as unavailable reservation days.
- `stepMinutes`: the time step, counted from midnight (60 for whole hours). A minimum off the step rounds up to the next step.
- `defaultTime` (date-time): the time a date gets before any time is chosen, so a date alone completes the value. Picking a date moves an earlier time up to the minimum's time on the minimum's day.
- `displayValue` (date): the line under the field with the selected date; the long date by default, `false` for none in compact cells.

Reservation availability, minimum booking times, and whole-hour rules live in the reservation adapters in `features/reservation/components`, which pass them through these hooks: `ReservationFormDateInput` takes the space's unavailable dates, and `ReservationFormDateTimeInput` gives a start the workspace's default start time and, for a whole-day booking, takes only the date while the start keeps its time.

## Tests

Component tests run under `registerWorkspaceComponentTestEnv` and import the control after it. Assert values, `FormData`, roles, and accessible-name or description wiring; compare control copy against the catalog message (`m.dateInputInvalid(...)`), never literal text. The calendar loads lazily (`createPreloadableModule`); `date-input.pending-load.test.tsx` shows how to hold the load open.
