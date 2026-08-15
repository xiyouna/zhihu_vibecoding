import { NextRequest, NextResponse } from "next/server";
import {
  createRoom,
  completeSettlement,
  addTestBot,
  getRoom,
  joinRoom,
  removeTestBots,
  reserveCard,
  cancelCard,
  requestHint,
  runBotTurn,
  startGame,
  stealTurn,
  submitTurn,
  toggleReady,
  playCard,
  voteToEnd,
} from "@/lib/game-store";
import type { GameMode } from "@/lib/game-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.toUpperCase() ?? "";
  const room = getRoom(code);
  if (!room) return NextResponse.json({ ok: false, error: "没有找到这个房间" }, { status: 404 });
  return NextResponse.json({ ok: true, room });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const playerId = String(body.playerId ?? "");
    const roomCode = String(body.roomCode ?? "").toUpperCase();
    let room;

    if (!playerId) throw new Error("缺少临时玩家身份");
    switch (action) {
      case "create":
        room = createRoom({
          playerId,
          nickname: String(body.nickname ?? "访客").trim().slice(0, 12),
          mode: body.mode === "story" ? "story" : "question" as GameMode,
          topic: String(body.topic ?? ""),
          turnDuration: Number(body.turnDuration ?? 120),
        });
        break;
      case "join":
        room = joinRoom(roomCode, playerId, String(body.nickname ?? "访客"));
        break;
      case "ready":
        room = toggleReady(roomCode, playerId);
        break;
      case "add_bot":
        room = addTestBot(roomCode, playerId);
        break;
      case "remove_bots":
        room = removeTestBots(roomCode, playerId);
        break;
      case "start":
        room = startGame(roomCode, playerId);
        break;
      case "steal":
        room = stealTurn(roomCode, playerId);
        break;
      case "submit":
        room = await submitTurn(roomCode, playerId, String(body.text ?? ""));
        break;
      case "bot_turn":
        room = await runBotTurn(roomCode, playerId);
        break;
      case "card":
        room = playCard(roomCode, playerId, String(body.cardId ?? ""), String(body.targetValue ?? ""), String(body.prompt ?? ""));
        break;
      case "reserve_card":
        room = reserveCard(roomCode, playerId, String(body.cardId ?? ""));
        break;
      case "cancel_card":
        room = cancelCard(roomCode, playerId);
        break;
      case "hint": {
        const result = await requestHint(roomCode, playerId, String(body.cardId ?? ""), String(body.question ?? ""));
        return NextResponse.json({ ok: true, room: result.room, hint: result.hint });
      }
      case "vote":
        room = voteToEnd(roomCode, playerId);
        break;
      case "settle":
        room = await completeSettlement(roomCode);
        break;
      default:
        throw new Error("未知操作");
    }
    return NextResponse.json({ ok: true, room });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
