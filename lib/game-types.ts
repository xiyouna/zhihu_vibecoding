export type GameMode = "question" | "story";
export type GamePhase = "waiting" | "writing" | "scoring" | "settlement";
export type TurnStage = "steal" | "card" | "writing";
export const STEAL_WINDOW_MS = 5_000;
export const CARD_WINDOW_MS = 6_000;
export const CARD_SETUP_TIMEOUT_MS = 120_000;

export type Player = {
  id: string;
  nickname: string;
  color: string;
  ready: boolean;
  totalScore: number;
  availableScore: number;
  joinedAt: number;
  online: boolean;
  isBot: boolean;
};

export type EffectResolution = {
  cardId: string;
  cardName: string;
  completed: boolean | null;
  reason: string;
};

export type Contribution = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  score: number;
  reason: string;
  round: number;
  createdAt: number;
  effectResolution?: EffectResolution;
};

export type CardTarget = {
  kind: "entry" | "question" | "hook" | "perspective" | "none";
  value: string;
  label: string;
  prompt?: string;
};

export type CardReservation = {
  playerId: string;
  playerName: string;
  cardId: string;
  cardName: string;
  pausedStage: "card" | "writing";
  remainingMs: number;
  turnKey: string;
  expiresAt: number;
};

export type ActiveEffect = {
  cardId: string;
  cardName: string;
  instruction: string;
  ownerId: string;
  ownerName: string;
  targetPlayerId: string;
  targetPlayerName: string;
  target: CardTarget;
  turnKey: string;
} | null;

export type CardUsage = {
  playerId: string;
  round: number;
  cardId: string;
  createdAt: number;
};

export type StoryState = {
  characters: string[];
  facts: string[];
  hooks: string[];
};

export type Room = {
  code: string;
  hostId: string;
  mode: GameMode;
  phase: GamePhase;
  topic: string;
  subtitle: string;
  players: Player[];
  entries: Contribution[];
  round: number;
  maxRounds: number;
  turnDuration: number;
  turnOrder: string[];
  turnIndex: number;
  turnStage: TurnStage;
  stageStartedAt: number | null;
  spokenThisRound: string[];
  turnStartedAt: number | null;
  stealUsed: boolean;
  cardUsages: CardUsage[];
  cardReservation: CardReservation | null;
  dmMessage: string;
  activeEffect: ActiveEffect;
  coveredPoints: string[];
  openHooks: string[];
  storyState: StoryState;
  endVotes: string[];
  settlement: {
    title: string;
    body: string;
    quote: string;
    summary: string;
    source: "deepseek" | "local";
  } | null;
  createdAt: number;
  updatedAt: number;
};

export type ScoreResult = {
  score: number;
  reason: string;
  newPoints: string[];
  newHooks: string[];
  resolvedHooks: string[];
  characters: string[];
  facts: string[];
  effectCompleted: boolean | null;
  effectReason: string;
  source: "deepseek" | "local";
};

export type CardTiming = "hint" | "constraint" | "steal";
export type CardTargetType = "none" | "entry" | "entry-or-question" | "hook" | "perspective";

export type CardDefinition = {
  id: string;
  symbol: string;
  name: string;
  cost: number;
  description: string;
  timing: CardTiming;
  targetType: CardTargetType;
  selfOnly?: boolean;
};

export const QUESTION_CARDS = [
  { id: "question-hint", symbol: "◉", name: "看山提示", cost: 4, description: "问看山一个问题，得到仅自己可见的新角度", timing: "hint", targetType: "none", selfOnly: true },
  { id: "example", symbol: "□", name: "举个例子", cost: 5, description: "当前执笔者必须用具体案例、场景或类比支持观点", timing: "constraint", targetType: "none" },
  { id: "followup", symbol: "?", name: "追问到底", cost: 6, description: "引用已有文字并写下一个明确问题，要求当前执笔者直接回答", timing: "constraint", targetType: "entry-or-question" },
  { id: "counter", symbol: "↩", name: "站到对面", cost: 7, description: "选择一个已有观点，让下一笔提出反例、限制条件或相反立场", timing: "constraint", targetType: "entry" },
] satisfies readonly CardDefinition[];

export const STORY_CARDS = [
  { id: "story-hint", symbol: "◉", name: "看山提示", cost: 4, description: "输入你想问的问题，得到仅自己可见的创作方向", timing: "hint", targetType: "none", selfOnly: true },
  { id: "perspective", symbol: "◎", name: "换个视角", cost: 5, description: "执笔者为自己指定角色和第一人称或限知第三人称", timing: "constraint", targetType: "perspective", selfOnly: true },
  { id: "foreshadow", symbol: "⌁", name: "伏笔回响", cost: 6, description: "选择一个未充分使用的伏笔，让它重新出现并影响当前行动", timing: "constraint", targetType: "hook" },
  { id: "resolve", symbol: "○→●", name: "填坑", cost: 7, description: "选择一个未解决伏笔，给出答案或明显推进它", timing: "constraint", targetType: "hook" },
] satisfies readonly CardDefinition[];

export const STEAL_CARD = {
  id: "steal",
  symbol: "✎",
  name: "抢笔",
  cost: 8,
  description: "与当前执笔者交换本轮顺序",
  timing: "steal",
  targetType: "none",
} satisfies CardDefinition;

export const cardsForMode = (mode: GameMode): readonly CardDefinition[] => [
  ...(mode === "question" ? QUESTION_CARDS : STORY_CARDS),
  STEAL_CARD,
];
