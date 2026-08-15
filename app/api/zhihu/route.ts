import { NextResponse } from "next/server";
import { getZhihuHotTitles } from "@/lib/zhihu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const titles = await getZhihuHotTitles();
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
