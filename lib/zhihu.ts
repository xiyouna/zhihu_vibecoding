import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI = "/Users/Admin1/Library/Application Support/zhihu-cli/current/zhihu-cli";

function collectStrings(value: unknown, keys: string[], output: string[], limit: number) {
  if (output.length >= limit) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, keys, output, limit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 4) {
      const clean = candidate.trim().replace(/\s+/g, " ");
      if (!output.includes(clean)) output.push(clean);
      if (output.length >= limit) return;
    }
  }
  for (const child of Object.values(record)) collectStrings(child, keys, output, limit);
}

export async function getZhihuHotTitles() {
  const { stdout } = await execFileAsync(CLI, ["hot", "--limit", "10"], {
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const titles: string[] = [];
  collectStrings(JSON.parse(stdout), ["Title", "title", "Question", "question"], titles, 10);
  return titles;
}

export async function searchZhihuContext(query: string) {
  try {
    const { stdout } = await execFileAsync(CLI, ["search", "zhihu", "--query", query.slice(0, 120), "--count", "6"], {
      timeout: 25_000,
      maxBuffer: 3 * 1024 * 1024,
    });
    const snippets: string[] = [];
    collectStrings(JSON.parse(stdout), ["Title", "title", "ContentText", "content_text", "Summary", "summary"], snippets, 12);
    return snippets.map((item) => item.slice(0, 420)).join("\n").slice(0, 4_000);
  } catch {
    return "";
  }
}
