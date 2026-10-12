import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useId, useState } from "react";
import {
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SlackAvatarProps {
  agentName: string;
  appName: string;
  avatarUrl: string;
}

/** Manual fallback shared by Slack onboarding and its Settings page. */
export function SlackAvatarContent({
  agentName,
  appName,
  avatarUrl,
  compact = false,
}: SlackAvatarProps & { compact?: boolean }) {
  useTranslation();
  const id = useId();
  const filename = `${appName.replace(/[^a-zA-Z0-9_-]+/g, "-") || "agent"}-avatar.png`;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(avatarUrl);
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("image/png")
      )
        throw new Error("Avatar unavailable");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className="space-y-8">
      <section
        aria-labelledby={`${id}-download`}
        className="flex flex-col items-start gap-6 sm:flex-row sm:items-center"
      >
        <img
          src={avatarUrl}
          width={512}
          height={512}
          alt={`${agentName}’s Cliptoon avatar`}
          className="size-40 shrink-0 rounded-lg bg-muted object-contain"
        />
        <div className="space-y-3">
          <div className="space-y-1">
            <h2 id={`${id}-download`} className="text-sm font-semibold">
              {compact
                ? "Download your agent’s avatar"
                : "1. Download your agent’s avatar"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {translateInstant("PNG · 512 × 512 · Ready for Slack")}</p>
          </div>
          <Button variant="outline" asChild>
            <a
              href={avatarUrl}
              download={filename}
              aria-disabled={downloading}
              onClick={(event) => {
                event.preventDefault();
                void download();
              }}
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {translateInstant("Download avatar")}</a>
          </Button>
          {downloadError && (
            <p role="alert" className="text-sm text-destructive">
              {translateInstant("Couldn’t download the avatar. Try downloading it again.")}</p>
          )}
        </div>
      </section>

      <details open={compact ? undefined : true} className="space-y-4">
        <summary
          className={
            compact
              ? "cursor-pointer text-sm underline underline-offset-4"
              : "hidden"
          }
        >
          {translateInstant("How to upload in Slack")}</summary>
        <section aria-labelledby={`${id}-upload`} className="space-y-4">
          <div className="space-y-1">
            <h2 id={`${id}-upload`} className="text-sm font-semibold">
              {compact ? "Upload it in Slack" : "2. Upload it in Slack"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translateInstant("You’ll upload the downloaded image directly in Slack’s app settings.")}</p>
          </div>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                {translateInstant("Open Slack app Settings")}{" "}
                <ExternalLink className="inline size-3" />
              </a>{" "}
              {translateInstant("and choose")}{" "}<strong>{appName}</strong>{translateInstant(".")}</li>
            <li>
              {translateInstant("issueFeedback.allowSharingPrefix")}{" "}<strong>{translateInstant("Basic Information")}</strong>{translateInstant(", then scroll to")}{" "}
              <strong>{translateInstant("Display Information")}</strong>{translateInstant(".")}</li>
            <li>
              {translateInstant("Under")}{" "}<strong>{translateInstant("App icon &amp; Preview")}</strong>{translateInstant(", click the app icon and upload")}{" "}
              <span className="break-all font-mono text-xs">{filename}</span>{translateInstant(".")}</li>
            <li>
              {translateInstant("Confirm the crop, then click")}{" "}<strong>{translateInstant("Save Changes")}</strong> {translateInstant("in Slack.")}</li>
          </ol>
        </section>
      </details>
    </div>
  );
}


export function SlackAvatarSettings(props: SlackAvatarProps) {
  useTranslation();
  return (
    <section className="space-y-4" aria-label={translateInstant("Slack avatar")}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{translateInstant("Agent avatar")}</h2>
        <p className="text-sm text-muted-foreground">
          {translateInstant("routineVariables.helpSummaryPrefix")}{" "}{props.agentName}{translateInstant("’s avatar so your team recognizes the agent")}</p>
      </div>
      <SlackAvatarContent {...props} compact />
    </section>
  );
}
