// TCV-7109: HTTP input never reaches the filesystem. Decode/read within fixed caps.
import { open } from "node:fs/promises";
import path from "node:path";
import { getRequestContext } from "../../context.js";
import { MAX_ATTACHMENTS, MAX_BASE64_BYTES, MAX_FILE_BYTES, type AttachmentInput } from "./schemas.js";

export interface PreparedAttachment { name: string; content: Buffer; mimeType: string }
const MIME_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain", ".log": "text/plain", ".json": "application/json", ".pdf": "application/pdf" };

export async function prepareAttachments(inputs: AttachmentInput[] = []): Promise<PreparedAttachment[]> {
  if (inputs.length > MAX_ATTACHMENTS) throw new Error("A result can have at most 10 attachments");
  if (getRequestContext() && inputs.some(input => "file_path" in input)) {
    throw new Error("file_path attachments are only allowed in stdio mode; use file_name and content_base64 over HTTP");
  }
  const files: PreparedAttachment[] = [];
  for (const input of inputs) {
    let content: Buffer;
    let name: string;
    if ("file_path" in input) {
      name = path.basename(input.file_path);
      const file = await open(input.file_path, "r");
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error("Attachment must be a regular file");
        if (stat.size > MAX_FILE_BYTES) throw new Error("file_path attachment exceeds 10 MB");
        const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE_BYTES + 1));
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > stat.size) throw new Error("Attachment changed while being read; try again");
        content = buffer.subarray(0, length);
      } finally {
        await file.close();
      }
    } else {
      name = input.file_name;
      if (input.content_base64.length > 4 * Math.ceil(MAX_BASE64_BYTES / 3)) throw new Error("Base64 attachment exceeds 1 MB");
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.content_base64)) throw new Error("Invalid base64 attachment content");
      content = Buffer.from(input.content_base64, "base64");
      if (content.length > MAX_BASE64_BYTES) throw new Error("Base64 attachment exceeds 1 MB");
      if (content.toString("base64") !== input.content_base64) throw new Error("Invalid base64 attachment content");
    }
    files.push({ name, content, mimeType: input.mime_type || MIME_TYPES[path.extname(name).toLowerCase()] || "application/octet-stream" });
  }
  return files;
}
