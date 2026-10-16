#!/usr/bin/env node

const [operation, ...args] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function readJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Expected valid JSON input");
  }
}

function json(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function text(value) {
  if (typeof value === "string") process.stdout.write(value);
}

function boolean(value, name) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected ${name} to be true or false`);
}

function jsonNumber(value, name) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Expected ${name} to be a JSON number`);
}

function object(value, name) {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error(`Expected ${name} to be a JSON object`);
  return value;
}

async function main() {
  switch (operation) {
    case "response-is-indeterminate": {
      const response = object(await readJson(), "response");
      if (response.outcome !== "indeterminate") process.exitCode = 1;
      return;
    }
    case "dry-run": {
      if (args.length !== 10) throw new Error("Invalid dry-run arguments");
      const [file, issueId, companyId, title, summary, contentType, status, chatComment, createWorkProduct, isPrimary] = args;
      json({ file, issueId, companyId, title, summary, contentType, status, chatComment: chatComment || null, createWorkProduct: boolean(createWorkProduct, "createWorkProduct"), isPrimary: boolean(isPrimary, "isPrimary") });
      return;
    }
    case "find-attachment": {
      if (args.length !== 4) throw new Error("Invalid attachment lookup arguments");
      const [runId, sha256, originalFilename, contentType] = args;
      const attachments = await readJson();
      if (!Array.isArray(attachments)) throw new Error("Expected attachments response to be a JSON array");
      const match = attachments.find((entry) => {
        if (entry === null || Array.isArray(entry) || typeof entry !== "object") return false;
        return entry.originatingRunId === runId
          && (typeof entry.sha256 === "string" ? entry.sha256 : "").toLowerCase() === sha256.toLowerCase()
          && (typeof entry.originalFilename === "string" ? entry.originalFilename : "") === originalFilename
          && (typeof entry.contentType === "string" ? entry.contentType : "").toLowerCase() === contentType.toLowerCase();
      });
      if (match !== undefined) json(match);
      return;
    }
    case "attachment-value": {
      if (args.length !== 1) throw new Error("Invalid attachment field");
      const input = await readJson();
      // The shell helper intentionally represents a skipped work product as
      // JSON null. jq's `.id // empty` treats that as an empty value.
      if (input === null) return;
      const attachment = object(input, "attachment");
      switch (args[0]) {
        case "id": text(attachment.id); return;
        case "content-path": text(attachment.contentPath); return;
        case "download-path": text(typeof attachment.downloadPath === "string" ? attachment.downloadPath : typeof attachment.contentPath === "string" && attachment.contentPath ? `${attachment.contentPath}?download=1` : ""); return;
        case "byte-size": process.stdout.write(String(attachment.byteSize ?? 0)); return;
        case "open-path": text(typeof attachment.openPath === "string" ? attachment.openPath : attachment.contentPath); return;
        case "original-filename": text(attachment.originalFilename); return;
        default: throw new Error(`Unsupported attachment JSON field: ${args[0]}`);
      }
    }
    case "work-product": {
      if (args.length !== 12) throw new Error("Invalid work product arguments");
      const [title, summary, status, runId, attachmentId, contentType, byteSize, contentPath, openPath, downloadPath, originalFilename, isPrimary] = args;
      json({
        type: "artifact", provider: "paperclip", title, status, reviewState: "none", isPrimary: boolean(isPrimary, "isPrimary"), healthStatus: "unknown",
        summary: summary || null, createdByRunId: runId,
        metadata: { attachmentId, contentType, byteSize: jsonNumber(byteSize, "byteSize"), contentPath, openPath, downloadPath, originalFilename: originalFilename || null },
      });
      return;
    }
    case "chat-comment": {
      if (args.length !== 2) throw new Error("Invalid chat comment arguments");
      json({ body: args[0], attachmentIds: [args[1]] });
      return;
    }
    case "output-receipt": {
      if (args.length !== 3) throw new Error("Invalid output receipt arguments");
      const { readFile } = await import("node:fs/promises");
      const values = await Promise.all(args.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
      json({ attachment: values[0], workProduct: values[1], chatComment: values[2] });
      return;
    }
    default: throw new Error(`Unsupported JSON helper operation: ${operation ?? ""}`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : "JSON helper failed"));
