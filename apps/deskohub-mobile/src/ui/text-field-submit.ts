/**
 * The submit handler a text field passes on. A field that isn't editable
 * submits nothing: on the web, react-native-web renders it read-only but
 * still calls `onSubmitEditing` when Enter is pressed in it.
 */
export const textFieldSubmit = <Event>(
  editable: boolean | undefined,
  onSubmitEditing: ((event: Event) => void) | undefined
): ((event: Event) => void) | undefined =>
  editable === false ? undefined : onSubmitEditing;
