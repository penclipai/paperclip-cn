function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function injectPaperclipRuntimePromptLayersIntoContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const sessionHandoffNote = readNonEmptyString(context.paperclipSessionHandoffMarkdown);
  const localizationPromptNote = readNonEmptyString(context.paperclipLocalizationPromptMarkdown);

  if (!localizationPromptNote) {
    return context;
  }

  const nextContext: Record<string, unknown> = {
    ...context,
    paperclipSessionHandoffMarkdown: [sessionHandoffNote, localizationPromptNote]
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
  };

  delete nextContext.paperclipLocalizationPromptMarkdown;
  return nextContext;
}
