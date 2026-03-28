export function syncLocalizedDefaultDraft(
  currentValue: string,
  previousDefaultValue: string,
  nextDefaultValue: string,
) {
  return currentValue === previousDefaultValue
    ? nextDefaultValue
    : currentValue;
}
