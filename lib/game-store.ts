import { generateBotContribution, generateCreativeHint, scoreContribution, settleWork } from "./deepseek";
import {
  QUESTION_CARDS,
  STORY_CARDS,
  STEAL_CARD,
  CARD_SETUP_TIMEOUT_MS,
  CARD_WINDOW_MS,
  STEAL_WINDOW_MS,
  cardsForMode,
  type CardDefinition,
  type CardTarget,
  type GameMode,
  type Player,
  type Room,
} from "./game-types";
import { searchZhihuContext } from "./zhihu";

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
const INITIAL_AVAILABLE_SCORE = 100;

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

function unique(items: string[], limit = 24) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(-limit);
}

function player(id: string, nickname: string, index: number, isBot = false): Player {
  return {
    id,
    nickname,
    color: COLORS[index % COLORS.length],
    ready: isBot,
    totalScore: 0,
    availableScore: INITIAL_AVAILABLE_SCORE,
    joinedAt: Date.now(),
    online: true,
    isBot,
  };
}

function touch(room: Room) {
  room.updatedAt = Date.now();
  return room;
}

function turnKey(room: Room) {
  return `${room.round}:${room.turnIndex}:${room.turnOrder[room.turnIndex] ?? "none"}`;
}

function beginTurn(room: Room, startedAt = Date.now()) {
  room.phase = "writing";
  room.turnStage = "steal";
  room.stageStartedAt = startedAt;
  room.turnStartedAt = null;
  room.stealUsed = false;
  room.cardReservation = null;
  room.activeEffect = null;
}

function syncTurnStage(room: Room) {
  if (room.phase !== "writing") return;
  const now = Date.now();
  if (room.cardReservation) {
    if (now < room.cardReservation.expiresAt) return;
    resumeAfterCardSetup(room, `${room.cardReservation.playerName} 的卡牌设置超时，倒计时继续。`);
  }
  if (room.turnStage !== "writing" && !room.stageStartedAt) return;
  const stealStartedAt = room.stageStartedAt;
  if (room.turnStage === "steal" && stealStartedAt !== null && now - stealStartedAt >= STEAL_WINDOW_MS) {
    room.turnStage = "card";
    room.stageStartedAt = stealStartedAt + STEAL_WINDOW_MS;
    room.dmMessage = `笔留在 ${currentPlayer(room)?.nickname ?? "当前玩家"} 手里。现在可以拍下一张约束卡。`;
  }
  const cardStartedAt = room.stageStartedAt;
  if (room.turnStage === "card" && cardStartedAt !== null && now - cardStartedAt >= CARD_WINDOW_MS) {
    room.turnStage = "writing";
    room.stageStartedAt = cardStartedAt + CARD_WINDOW_MS;
    room.turnStartedAt = room.stageStartedAt;
    room.dmMessage = room.activeEffect
      ? `${currentPlayer(room)?.nickname ?? "当前玩家"}，这一笔请记得：${room.activeEffect.instruction}`
      : `${currentPlayer(room)?.nickname ?? "当前玩家"}，该你落笔了。`;
  }
  if (room.turnStage === "writing" && room.turnStartedAt && now - room.turnStartedAt >= room.turnDuration * 1000) {
    const missed = currentPlayer(room);
    if (missed && !room.spokenThisRound.includes(missed.id)) room.spokenThisRound.push(missed.id);
    room.dmMessage = `${missed?.nickname ?? "这一位"} 的时间到了，笔先传下去。`;
    advanceTurn(room);
  }
}

export function getRoom(roomCode: string) {
  const room = rooms.get(roomCode.toUpperCase()) ?? null;
  if (room) syncTurnStage(room);
  return room;
}

export function createRoom(input: { playerId: string; nickname: string; mode: GameMode; topic?: string; turnDuration?: number }) {
  let roomCode = code();
  while (rooms.has(roomCode)) roomCode = code();
  const topic = input.topic?.trim() || (input.mode === "question" ? QUESTION_TOPICS[0] : STORY_TOPICS[0]);
  const now = Date.now();
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
    turnStage: "steal",
    stageStartedAt: null,
    spokenThisRound: [],
    turnStartedAt: null,
    stealUsed: false,
    cardUsages: [],
    cardReservation: null,
    dmMessage: "人到了，就把笔放到桌上吧。",
    activeEffect: null,
    coveredPoints: [],
    openHooks: [],
    storyState: { characters: [], facts: [], hooks: [] },
    endVotes: [],
    settlement: null,
    createdAt: now,
    updatedAt: now,
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
  room.round = 1;
  room.turnOrder = shuffle(room.players.map((item) => item.id));
  room.turnIndex = 0;
  room.spokenThisRound = [];
  beginTurn(room);
  room.dmMessage = `第一轮，${currentPlayer(room)?.nickname} 先拿到笔。有 5 秒可以抢笔。`;
  return touch(room);
}

function hasUsedCard(room: Room, playerId: string) {
  return room.cardUsages.some((usage) => usage.playerId === playerId && usage.round === room.round);
}

function ensureCanUseCard(room: Room, current: Player, card: CardDefinition) {
  if (current.isBot) throw new Error("测试 AI 暂不主动使用技能卡");
  if (hasUsedCard(room, current.id)) throw new Error("你这一轮已经用过技能卡了");
  if (current.availableScore < card.cost) throw new Error("可用言值不够");
}

function spendCard(room: Room, player: Player, card: CardDefinition) {
  ensureCanUseCard(room, player, card);
  player.availableScore -= card.cost;
  room.cardUsages.push({ playerId: player.id, round: room.round, cardId: card.id, createdAt: Date.now() });
}

export function stealTurn(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "writing" || room.turnStage !== "steal") throw new Error("抢笔窗口已经结束");
  if (room.stealUsed) throw new Error("这一笔已经被抢过了");
  if (room.spokenThisRound.includes(playerId)) throw new Error("你这一轮已经落过笔了");
  const targetIndex = room.turnOrder.indexOf(playerId);
  if (targetIndex < room.turnIndex) throw new Error("你已经错过这一轮的抢笔机会");
  if (targetIndex === room.turnIndex) throw new Error("笔已经在你手里");
  const current = requirePlayer(room, playerId);
  spendCard(room, current, STEAL_CARD);
  const previous = currentPlayer(room);
  [room.turnOrder[room.turnIndex], room.turnOrder[targetIndex]] = [room.turnOrder[targetIndex], room.turnOrder[room.turnIndex]];
  room.stealUsed = true;
  room.turnStage = "card";
  room.stageStartedAt = Date.now();
  room.turnStartedAt = null;
  room.dmMessage = `${current.nickname} 拍下「抢笔」，从 ${previous?.nickname ?? "上一位"} 手里接过了笔。`;
  return touch(room);
}

function cardFor(room: Room, cardId: string) {
  const cards: readonly CardDefinition[] = room.mode === "question" ? QUESTION_CARDS : STORY_CARDS;
  return cards.find((item) => item.id === cardId);
}

function resumeAfterCardSetup(room: Room, message: string) {
  const reservation = room.cardReservation;
  if (!reservation) return;
  const now = Date.now();
  if (reservation.pausedStage === "card") {
    room.turnStage = "card";
    room.stageStartedAt = now - Math.max(0, CARD_WINDOW_MS - reservation.remainingMs);
  } else {
    room.turnStage = "writing";
    room.turnStartedAt = now - Math.max(0, room.turnDuration * 1000 - reservation.remainingMs);
    room.stageStartedAt = room.turnStartedAt;
  }
  room.cardReservation = null;
  room.dmMessage = message;
}

export function reserveCard(roomCode: string, playerId: string, cardId: string) {
  const room = requireRoom(roomCode);
  const card = cardFor(room, cardId);
  if (!card || card.timing === "steal") throw new Error("这张卡不需要设置");
  const owner = requirePlayer(room, playerId);
  ensureCanUseCard(room, owner, card);
  if (room.cardReservation) {
    if (room.cardReservation.playerId === playerId && room.cardReservation.cardId === cardId) return room;
    throw new Error(`${room.cardReservation.playerName} 正在设置「${room.cardReservation.cardName}」`);
  }
  if (room.phase !== "writing") throw new Error("现在不能使用技能卡");
  const targetPlayer = currentPlayer(room);
  if (!targetPlayer) throw new Error("当前没有执笔者");
  let pausedStage: "card" | "writing";
  let remainingMs: number;
  if (card.timing === "constraint") {
    if (room.turnStage !== "card" || !room.stageStartedAt) throw new Error("现在不是拍效果卡的时间");
    if (room.activeEffect) throw new Error("这一笔已经有一个强制效果");
    if (card.selfOnly && targetPlayer.id !== playerId) throw new Error("这张卡只能由当前执笔者对自己使用");
    pausedStage = "card";
    remainingMs = Math.max(500, CARD_WINDOW_MS - (Date.now() - room.stageStartedAt));
    room.stageStartedAt = null;
  } else {
    if (room.turnStage !== "writing" || !room.turnStartedAt) throw new Error("提示卡只能由正在写作的执笔者使用");
    if (targetPlayer.id !== playerId) throw new Error("提示卡只能由当前执笔者使用");
    pausedStage = "writing";
    remainingMs = Math.max(1_000, room.turnDuration * 1000 - (Date.now() - room.turnStartedAt));
    room.turnStartedAt = null;
    room.stageStartedAt = null;
  }
  room.cardReservation = {
    playerId,
    playerName: owner.nickname,
    cardId: card.id,
    cardName: card.name,
    pausedStage,
    remainingMs,
    turnKey: turnKey(room),
    expiresAt: Date.now() + CARD_SETUP_TIMEOUT_MS,
  };
  room.dmMessage = `${owner.nickname} 正在设置「${card.name}」，牌桌倒计时已暂停。`;
  return touch(room);
}

export function cancelCard(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (!room.cardReservation) return room;
  if (room.cardReservation.playerId !== playerId) throw new Error("只有正在设置卡牌的人可以取消");
  resumeAfterCardSetup(room, `${room.cardReservation.playerName} 收回了卡牌，倒计时继续。`);
  return touch(room);
}

function cleanPrompt(value: string, maximum = 100) {
  return [...value.trim()].slice(0, maximum).join("");
}

function resolveTarget(room: Room, card: CardDefinition, targetValue: string, prompt: string): CardTarget {
  if (card.targetType === "none") return { kind: "none", value: "", label: "当前这一笔" };
  if (card.targetType === "entry-or-question") {
    const question = cleanPrompt(prompt, 80);
    if (question.length < 2) throw new Error("请写下要当前执笔者回答的明确问题");
    const entry = targetValue ? room.entries.find((item) => item.id === targetValue) : null;
    if (targetValue && !entry) throw new Error("引用的已有文字无效");
    return {
      kind: "question",
      value: entry?.id ?? "",
      label: entry ? `${entry.playerName}：${entry.text.slice(0, 52)}` : "施加者提出的问题",
      prompt: question,
    };
  }
  if (card.targetType === "entry") {
    const entry = room.entries.find((item) => item.id === targetValue);
    if (!entry) throw new Error("请选择一段有效的已有发言");
    return { kind: "entry", value: entry.id, label: `${entry.playerName}：${entry.text.slice(0, 52)}` };
  }
  if (card.targetType === "hook") {
    const hook = room.storyState.hooks.find((item) => item === targetValue);
    if (!hook) throw new Error("请选择一个小本本里的未解决伏笔");
    return { kind: "hook", value: hook, label: hook };
  }
  const character = cleanPrompt(prompt, 24);
  const perspective = targetValue;
  if (character.length < 1) throw new Error("请输入这一笔要跟随的角色");
  if (!["first", "third"].includes(perspective)) throw new Error("请选择第一人称或限知第三人称");
  const perspectiveLabel = perspective === "first" ? "第一人称" : "限知第三人称";
  return { kind: "perspective", value: `${character}::${perspective}`, label: `${character} · ${perspectiveLabel}`, prompt: character };
}

function instructionFor(card: CardDefinition, target: CardTarget) {
  switch (card.id) {
    case "example":
      return "用一个具体案例、场景或类比支持观点，并说明它与问题的关系。";
    case "followup":
      return `${target.value ? `先阅读引用文字「${target.label}」，` : ""}必须直接回答问题：「${target.prompt}」。不能绕开问题，至少给出一个明确判断和理由。`;
    case "counter":
      return `针对「${target.label}」提出反例、限制条件或相反立场，并给出至少一个理由。`;
    case "perspective":
      return `整段采用 ${target.label} 叙述，不得写出该角色无法知道的信息。`;
    case "foreshadow":
      return `让伏笔「${target.label}」重新出现，并实际影响当前人物的行动或判断。`;
    case "resolve":
      return `针对伏笔「${target.label}」给出答案，或提供一条能明显推进它的关键线索。`;
    default:
      return card.description;
  }
}

export function playCard(roomCode: string, playerId: string, cardId: string, targetValue = "", prompt = "") {
  const room = requireRoom(roomCode);
  if (room.phase !== "writing" || room.turnStage !== "card") throw new Error("现在不是拍效果卡的时间");
  if (room.activeEffect) throw new Error("这一笔已经有一个强制效果");
  const card = cardFor(room, cardId);
  if (!card || card.timing !== "constraint") throw new Error("这张卡不能在这里使用");
  const owner = requirePlayer(room, playerId);
  const targetPlayer = currentPlayer(room);
  if (!targetPlayer) throw new Error("当前没有执笔者");
  if (card.selfOnly && targetPlayer.id !== playerId) throw new Error("这张卡只能对自己使用");
  const reservation = room.cardReservation;
  if (!reservation || reservation.playerId !== playerId || reservation.cardId !== cardId || reservation.turnKey !== turnKey(room)) {
    throw new Error("请先在卡牌设置窗口完成配置");
  }
  const target = resolveTarget(room, card, targetValue, prompt);
  spendCard(room, owner, card);
  room.activeEffect = {
    cardId: card.id,
    cardName: card.name,
    instruction: instructionFor(card, target),
    ownerId: owner.id,
    ownerName: owner.nickname,
    targetPlayerId: targetPlayer.id,
    targetPlayerName: targetPlayer.nickname,
    target,
    turnKey: turnKey(room),
  };
  room.cardReservation = null;
  room.turnStage = "writing";
  room.stageStartedAt = Date.now();
  room.turnStartedAt = room.stageStartedAt;
  room.dmMessage = `${owner.nickname} 给 ${targetPlayer.nickname} 拍下「${card.name}」。${room.activeEffect.instruction}`;
  return touch(room);
}

export async function requestHint(roomCode: string, playerId: string, cardId: string, question: string) {
  const room = requireRoom(roomCode);
  const card = cardFor(room, cardId);
  if (!card || card.timing !== "hint") throw new Error("这不是一张提示卡");
  if (room.phase !== "writing" || room.turnStage !== "writing") throw new Error("请在正式写作阶段询问看山");
  if (currentPlayer(room)?.id !== playerId) throw new Error("看山提示只能由当前执笔者使用");
  const cleanQuestion = question.trim().slice(0, 80);
  if (cleanQuestion.length < 2) throw new Error("请写下你想得到的提示");
  const owner = requirePlayer(room, playerId);
  if (owner.isBot) throw new Error("测试 AI 不使用提示卡");
  if (hasUsedCard(room, playerId)) throw new Error("你这一轮已经用过技能卡了");
  if (owner.availableScore < card.cost) throw new Error("可用言值不够");
  const reservation = room.cardReservation;
  if (!reservation || reservation.playerId !== playerId || reservation.cardId !== cardId || reservation.pausedStage !== "writing") {
    throw new Error("请先打开提示卡，让写作倒计时暂停");
  }
  const requestedTurn = turnKey(room);
  const zhihuContext = room.mode === "question" ? await searchZhihuContext(`${room.topic} ${cleanQuestion}`) : "";
  const hint = await generateCreativeHint(room, cleanQuestion, zhihuContext);
  if (!hint) {
    resumeAfterCardSetup(room, "看山暂时没想好，写作倒计时继续；这次不扣言值。");
    touch(room);
    throw new Error("看山暂时没想好，这次不扣言值");
  }
  syncTurnStage(room);
  if (room.phase !== "writing" || turnKey(room) !== requestedTurn || currentPlayer(room)?.id !== playerId || room.cardReservation?.playerId !== playerId) {
    throw new Error("笔已经传下去了，这次不扣言值");
  }
  const remainingMs = room.cardReservation.remainingMs;
  spendCard(room, owner, card);
  room.cardReservation = null;
  room.turnStage = "writing";
  room.turnStartedAt = Date.now() - Math.max(0, room.turnDuration * 1000 - remainingMs);
  room.stageStartedAt = room.turnStartedAt;
  room.dmMessage = `${owner.nickname} 低声问了看山一个问题。`;
  touch(room);
  return { room, hint };
}

export async function submitTurn(roomCode: string, playerId: string, text: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "writing" || room.turnStage !== "writing") throw new Error("现在还不能落笔");
  if (room.cardReservation) throw new Error("技能卡正在设置中，请先完成或取消");
  if (currentPlayer(room)?.id !== playerId) throw new Error("现在还没轮到你");
  const clean = text.trim();
  if (!clean) throw new Error("这一笔还没有写内容");
  if ([...clean].length > 140) throw new Error("每一笔最多 140 字");
  room.phase = "scoring";
  room.dmMessage = "让我看看，这一笔把作品带去了哪里……";
  touch(room);
  const effect = room.activeEffect;
  const score = await scoreContribution(room, clean);
  const current = requirePlayer(room, playerId);
  room.entries.push({
    id: crypto.randomUUID(),
    playerId,
    playerName: current.nickname,
    text: clean,
    score: score.score,
    reason: score.reason,
    round: room.round,
    createdAt: Date.now(),
    effectResolution: effect ? {
      cardId: effect.cardId,
      cardName: effect.cardName,
      completed: score.effectCompleted,
      reason: score.effectReason,
    } : undefined,
  });
  current.totalScore += score.score;
  current.availableScore += score.score;
  room.coveredPoints = unique([...room.coveredPoints, ...score.newPoints]);
  room.storyState.characters = unique([...room.storyState.characters, ...score.characters], 16);
  room.storyState.facts = unique([...room.storyState.facts, ...score.facts], 24);
  const resolved = new Set(score.resolvedHooks);
  if (effect?.cardId === "resolve" && score.effectCompleted === true) resolved.add(effect.target.value);
  room.openHooks = unique([...room.openHooks, ...score.newHooks]).filter((hook) => !resolved.has(hook));
  room.storyState.hooks = unique([...room.storyState.hooks, ...score.newHooks]).filter((hook) => !resolved.has(hook));
  if (!room.spokenThisRound.includes(playerId)) room.spokenThisRound.push(playerId);
  room.activeEffect = null;
  const effectCopy = effect
    ? score.effectCompleted === true
      ? `「${effect.cardName}」已完成。`
      : score.effectCompleted === false
        ? `「${effect.cardName}」未完成，本次最高 5 言值。`
        : `「${effect.cardName}」暂无法可靠判定。`
    : "";
  room.dmMessage = `+${score.score} 言值。${score.reason}${effectCopy ? ` ${effectCopy}` : ""}`;
  advanceTurn(room);
  return touch(room);
}

export async function runBotTurn(roomCode: string, requestingPlayerId: string) {
  const room = requireRoom(roomCode);
  if (room.hostId !== requestingPlayerId) throw new Error("由房主客户端驱动测试 AI");
  if (room.phase !== "writing" || room.turnStage !== "writing") throw new Error("测试 AI 还没拿到笔");
  const bot = currentPlayer(room);
  if (!bot?.isBot) throw new Error("当前执笔者不是测试 AI");
  room.phase = "scoring";
  room.dmMessage = `${bot.nickname} 正在翻看前文……`;
  touch(room);
  const text = await generateBotContribution(room, bot.nickname);
  room.phase = "writing";
  room.turnStage = "writing";
  return submitTurn(roomCode, bot.id, text);
}

function advanceTurn(room: Room) {
  room.turnIndex += 1;
  if (room.turnIndex >= room.turnOrder.length) {
    if (room.round >= room.maxRounds) {
      room.phase = "settlement";
      room.turnStartedAt = null;
      room.stageStartedAt = null;
      room.cardReservation = null;
      room.activeEffect = null;
      room.dmMessage = "最后一笔落下。来看看你们一起写成了什么。";
      return;
    }
    room.round += 1;
    room.turnOrder = shuffle(room.players.map((item) => item.id));
    room.turnIndex = 0;
    room.spokenThisRound = [];
  }
  beginTurn(room);
  room.dmMessage = `${currentPlayer(room)?.nickname ?? "下一位"} 拿到了笔。有 5 秒可以抢笔。`;
}

export async function completeSettlement(roomCode: string) {
  const room = requireRoom(roomCode);
  if (room.phase !== "settlement") throw new Error("还没有到合笔时间");
  if (!room.settlement) room.settlement = await settleWork(room);
  return touch(room);
}

export function voteToEnd(roomCode: string, playerId: string) {
  const room = requireRoom(roomCode);
  if (room.round < 2) throw new Error("前两轮先让作品长出来");
  if (!room.endVotes.includes(playerId)) room.endVotes.push(playerId);
  if (room.endVotes.length > room.players.length / 2) {
    room.phase = "settlement";
    room.turnStartedAt = null;
    room.stageStartedAt = null;
    room.cardReservation = null;
    room.activeEffect = null;
    room.dmMessage = "多数人同意收笔。合笔完成。";
  } else {
    room.dmMessage = `${requirePlayer(room, playerId).nickname} 提议收笔，还需要更多人同意。`;
  }
  return touch(room);
}

export function cardsFor(mode: GameMode) {
  return cardsForMode(mode);
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
