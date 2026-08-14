import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const CLI = "/Users/Admin1/Library/Application Support/zhihu-cli/current/zhihu-cli";

function collectTitles(value: unknown, output: string[] = []): string[] {
  if (output.length >= 10) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectTitles(item, output);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = record.Title ?? record.title ?? record.Question ?? record.question;
    if (typeof title === "string" && title.trim().length > 4 && !output.includes(title.trim())) output.push(title.trim());
    for (const child of Object.values(record)) collectTitles(child, output);
  }
  return output;
}

export async function GET() {
  try {
    const { stdout } = await execFileAsync(CLI, ["hot", "--limit", "10"], {
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const titles = collectTitles(JSON.parse(stdout));
    return NextResponse.json({ ok: true, titles });
  } catch {
    return NextResponse.json({
      ok: true,
      titles: [
        "AI 会取代程序员吗？",
        "工作除了赚钱，还为人提供了什么？",
        "我们应该如何面对无法预测的未来？",
      ],
      fallback: true,
    });
  }
}
