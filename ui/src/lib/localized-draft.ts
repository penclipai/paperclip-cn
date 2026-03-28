export function syncLocalizedDefaultDraft(
  currentValue: string,
  previousDefaultValue: string,
  nextDefaultValue: string,
) {
  return currentValue === previousDefaultValue
    ? nextDefaultValue
    : currentValue;
}

export function createLocalizedDefaultDraftUpdater(
  previousDefaultValue: string,
  nextDefaultValue: string,
) {
  return (currentValue: string) =>
    syncLocalizedDefaultDraft(
      currentValue,
      previousDefaultValue,
      nextDefaultValue,
    );
}
