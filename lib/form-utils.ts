// Helper function to extract FormData into a regular object
export function extractFormData(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    // Convert FormDataEntryValue to string (handling File objects)
    if (typeof value === "string") {
      result[key] = value;
    } else {
      // For File objects, we'll use the name (though this shouldn't happen in our form)
      result[key] = value.name || "";
    }
  }

  return result;
}
