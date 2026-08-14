import { generateBotContribution, scoreContribution, settleWork } from "./deepseek";
import {
  QUESTION_CARDS,
  STORY_CARDS,
  type CardDefinition,
  type GameMode,
  type Player,
  type Room,
} from "./game-types";

const COLORS = ["#1772f6", "#d89545", "#7957d5", "#1d9b76", "#d45d63", "#6f7782"];
const QUESTION_TOPICS = [
  "AI 会取代程序员吗？",
  "工作除了赚钱，还为人提供了什么？",
  "人为什么会对尚未发生的事感到焦虑？",
];
const STORY_TOPICS = [
  "凌晨三点，所有人的手机同时收到一条来自明天的消息。",
  "这座城市只有一把钥匙，却有一万扇门。",
  "她醒来后发现，昨天从所有人的记忆里消失了。",
];
const BOT_NAMES = ["纸鸢·AI", "墨点·AI", "山雀·AI", "折枝·AI", "砚台·AI"];

declare global {
  var __kanshanRooms: Map<string, Room> | undefined;
}

const rooms = globalThis.__kanshanRooms ?? new Map<string, Room>();
globalThis.__kanshanRooms = rooms;

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function player(id: string, nickname: string, index: number, isBot = false): Player {
  return { id, nickname, color: COLORS[index % COLORS.length], ready: isBot, totalScore: 0, availableScore: 0, joinedAt: Date.now(), online: true, isBot };
}

function touch(room: Room) {
  room.updatedAt = Date.now();
  return room;
}

export function getRoom(roomCode: string) {
  const room = rooms.get(roomCode.toUpperCase()) ?? null;
  if (room?.phase === "writing" && room.turnStartedAt && Date.now() - room.turnStartedAt >= room.turnDuration * 1000) {
    const missed = currentPlayer(room);
    if (missed) room.spokenThisRound.push(missed.id);
    room.dmMessage = `${missed?.nickname ?? "这一位"} 的时间到了，笔先传下去。`;
    advanceTurn(room);
  }
  return room;
}

export function createRoom(input: { playerId: string; nickname: string; mode: GameMode; topic?: string; turnDuration?: number }) {
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  const topic = input.topic?.trim() || (input.mode === "question" ? QUESTION_TOPICS[0] : STORY_TOPICS[0]);
  const room: Room = {
    code: roomCode,
    hostId: input.playerId,
    mode: input.mode,
    phase: "waiting",
    topic,
    subtitle: input.mode === "question" ? "一起把一个问题想得更完整" : "把这一段故事传到下一双手里",
    players: [player(input.playerId, input.nickname, 0)],
    entries: [],
    round: 0,
    maxRounds: 4,
    turnDuration: [60, 120, 180, 300].includes(input.turnDuration ?? 120) ? input.turnDuration ?? 120 : 120,
    turnOrder: [],
    turnIndex: 0,
    spokenThisRound: [],
    turnStartedAt: null,
    dmMessage: "人到了，就把笔放到桌上吧。",
    activeEffect: null,
    coveredPoints: [],
    openHooks: [],
    endVotes: [],
    settlement: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(roomCode, room);
  return room;
}

export function joinRoom(roomCode: string, playerId: string, nickname: string) {
  const room = getRoom(roomCode);
  if (!room) throw new Error("没有找到这个房间");
  const existing = room.players.find((item) => item.id === playerId);
  if (existing) {
    existing.online = true;
    existing.nickname = nickname.trim().slice(0, 12) || existing.nickname;
    return touch(room);
  }
  if (room.phase !== "waiting") throw new Error("这一局已经开始了");
  if (room.players.length >= 6) throw new Error("牌桌已经坐满了");
  if (room.players.some((item) => item.nickname === nickname.trim())) throw new Error("房间里已经有人使用这个昵称");
  room.players.push(player(playerId, nickname.trim().slice(0, 12), room.players.length));
  room.dmMessage = `${nickname.trim()} 入席。还差一句“准备好了”。`;
  return touch(room);
}

export function addTestBot(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.hostId !== playerId) throw new Error("只有房主可以加入测试 AI");
  if (room.phase !== "waiting") throw new Error("只能在开局前加入测试 AI");
  if (room.players.length >= 6) throw new Error("牌桌已经坐满了");
  const name = BOT_NAMES.find((candidate) => !room.players.some((item) => item.nickname === candidate));
  if (!name) throw new Error("测试 AI 已经全部入席");
  room.players.push(player(`bot-${crypto.randomUUID()}`, name, room.players.length, true));
  room.dmMessage = `${name} 抱着测试稿入席，已经准备好了。`;
  return touch(room);
}

export function removeTestBots(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.hostId !== playerId) throw new Error("只有房主可以移除测试 AI");
  if (room.phase !== "waiting") throw new Error("只能在开局前移除测试 AI");
  room.players = room.players.filter((item) => !item.isBot);
  room.dmMessage = "测试玩家先离席了。";
  return touch(room);
}

export function toggleReady(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  const current = requirePlayer(room, playerId);
  current.ready = !current.ready;
  room.dmMessage = current.ready ? `${current.nickname} 把笔放到了桌上。` : `${current.nickname} 还想再准备一下。`;
  return touch(room);
}

export function startGame(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.hostId !== playerId) throw new Error("只有房主可以开局");
  if (room.players.length < 2) throw new Error("至少需要两位玩家");
  if (room.players.some((item) => !item.ready)) throw new Error("还有玩家没有准备");
  room.phase = "writing";
  room.round = 1;
  room.turnOrder = shuffle(room.players.map((item) => item.id));
  room.turnIndex = 0;
  room.spokenThisRound = [];
  room.turnStartedAt = Date.now();
  room.dmMessage = `第一轮，${currentPlayer(room)?.nickname} 先执笔。`;
  return touch(room);
}

export function stealTurn(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "writing") throw new Error("现在不能抢笔");
  if (room.spokenThisRound.includes(playerId)) throw new Error("你这一轮已经落过笔了");
  const targetIndex = room.turnOrder.indexOf(playerId);
  if (targetIndex < room.turnIndex) throw new Error("你已经错过这一轮的抢笔机会");
  if (targetIndex === room.turnIndex) throw new Error("笔已经在你手里");
  const previous = currentPlayer(room);
  [room.turnOrder[room.turnIndex], room.turnOrder[targetIndex]] = [room.turnOrder[targetIndex], room.turnOrder[room.turnIndex]];
  room.turnStartedAt = Date.now();
  room.dmMessage = `${requirePlayer(room, playerId).nickname} 抢走了 ${previous?.nickname ?? "上一位"} 的这一笔。`;
  return touch(room);
}

export async function submitTurn(roomCode: string, playerId: string, text: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "writing") throw new Error("现在还不能落笔");
  if (currentPlayer(room)?.id !== playerId) throw new Error("现在还没轮到你");
  const clean = text.trim();
  if (!clean) throw new Error("这一笔还没有写内容");
  if ([...clean].length > 140) throw new Error("每一笔最多 140 字");
  room.phase = "scoring";
  room.dmMessage = "让我看看，这一笔把作品带去了哪里……";
  touch(room);
  const score = await scoreContribution(room, clean);
  const current = requirePlayer(room, playerId);
  room.entries.push({ id: crypto.randomUUID(), playerId, playerName: current.nickname, text: clean, score: score.score, reason: score.reason, round: room.round, createdAt: Date.now() });
  current.totalScore += score.score;
  current.availableScore += score.score;
  room.coveredPoints.push(...score.newPoints.filter(Boolean));
  room.openHooks.push(...score.newHooks.filter(Boolean));
  room.openHooks = room.openHooks.filter((hook) => !score.resolvedHooks.includes(hook));
  room.spokenThisRound.push(playerId);
  room.activeEffect = null;
  room.dmMessage = `+${score.score} 言值。${score.reason}`;
  advanceTurn(room);
  return touch(room);
}

export async function runBotTurn(roomCode: string, requestingPlayerId: string) {
  const room = requireRoom(roomCode);
  if (room.hostId !== requestingPlayerId) throw new Error("由房主客户端驱动测试 AI");
  if (room.phase !== "writing") throw new Error("测试 AI 还没拿到笔");
  const bot = currentPlayer(room);
  if (!bot?.isBot) throw new Error("当前执笔者不是测试 AI");
  room.phase = "scoring";
  room.dmMessage = `${bot.nickname} 正在翻看前文……`;
  touch(room);
  const text = await generateBotContribution(room, bot.nickname);
  room.phase = "writing";
  return submitTurn(roomCode, bot.id, text);
}

function advanceTurn(room: Room) {
  room.turnIndex += 1;
  if (room.turnIndex >= room.turnOrder.length) {
    if (room.round >= room.maxRounds) {
      room.phase = "settlement";
      room.turnStartedAt = null;
      room.dmMessage = "最后一笔落下。来看看你们一起写成了什么。";
    } else {
      room.round += 1;
      room.turnOrder = shuffle(room.players.map((item) => item.id));
      room.turnIndex = 0;
      room.spokenThisRound = [];
      room.phase = "writing";
      room.turnStartedAt = Date.now();
    }
  } else {
    room.phase = "writing";
    room.turnStartedAt = Date.now();
  }
}

export async function completeSettlement(roomCode: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "settlement") throw new Error("还没有到合笔时间");
  if (!room.settlement) room.settlement = await settleWork(room);
  return touch(room);
}

export function playCard(roomCode: string, playerId: string, cardId: string) {
  const room = requireRoom(roomCode);
  const cards: readonly CardDefinition[] = room.mode === "question" ? QUESTION_CARDS : STORY_CARDS;
  const card = cards.find((item) => item.id === cardId);
  if (!card) throw new Error("没有这张卡");
  const current = requirePlayer(room, playerId);
  if (current.availableScore < card.cost) throw new Error("可用言值不够");
  if (room.activeEffect) throw new Error("下一笔已经有一个强制效果");
  current.availableScore -= card.cost;
  room.activeEffect = { cardId: card.id, cardName: card.name, instruction: card.description, ownerId: playerId };
  room.dmMessage = `${current.nickname} 拍下「${card.name}」。${card.description}。`;
  return touch(room);
}

export function voteToEnd(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.round < 2) throw new Error("前两轮先让作品长出来");
  if (!room.endVotes.includes(playerId)) room.endVotes.push(playerId);
  if (room.endVotes.length > room.players.length / 2) {
    room.phase = "settlement";
    room.turnStartedAt = null;
    room.dmMessage = "多数人同意收笔。合笔完成。";
  } else {
    room.dmMessage = `${requirePlayer(room, playerId).nickname} 提议收笔，还需要更多人同意。`;
  }
  return touch(room);
}

export function cardsFor(mode: GameMode) {
  return mode === "question" ? QUESTION_CARDS : STORY_CARDS;
}

export function currentPlayer(room: Room) {
  const id = room.turnOrder[room.turnIndex];
  return room.players.find((item) => item.id === id) ?? null;
}

function requireRoom(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room) throw new Error("房间不存在或已经结束");
  return room;
}

function requirePlayer(room: Room, playerId: string) {
  const current = room.players.find((item) => item.id === playerId);
  if (!current) throw new Error("你还没有加入这个房间");
  return current;
}
