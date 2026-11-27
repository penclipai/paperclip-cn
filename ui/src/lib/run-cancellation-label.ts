import { translateInstant } from "@/i18n";

export function runCancellationLabel(input: { grokWork?: boolean; isFailed: boolean; isPending: boolean }): string {
  if (input.grokWork) return input.isPending ? translateInstant("Stopping Paperclip work…") : translateInstant("Stop Paperclip work");
  if (input.isFailed) return input.isPending ? translateInstant("Stopping…") : translateInstant("Stop");
  return input.isPending ? translateInstant("Cancelling…") : translateInstant("Cancel");
}
