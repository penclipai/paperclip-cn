import { createHash } from "node:crypto";


export function discordLifecycleFilesDigest(raw: unknown): string {
  const attachments =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).attachments
      : undefined;
  // Match the pinned Gateway adapter's flattened, ordered file projection.
  // Rotating CDN URLs are transport authority, never source revision identity.
  const projection = Array.isArray(attachments)
    ? attachments.map((attachment) => {
        const row =
          attachment &&
          typeof attachment === "object" &&
          !Array.isArray(attachment)
            ? (attachment as Record<string, unknown>)
            : {};
        return [
          ...["id", "filename", "content_type"].map((key) =>
            typeof row[key] === "string" ? row[key] : null,
          ),
          typeof row.size === "number" && Number.isFinite(row.size)
            ? row.size
            : null,
        ];
      })
    : [];
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}
