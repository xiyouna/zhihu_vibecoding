export type GameMode = "question" | "story";
export type GamePhase = "waiting" | "writing" | "scoring" | "settlement";

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

export type Contribution = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  score: number;
  reason: string;
  round: number;
  createdAt: number;
};

export type ActiveEffect = {
  cardId: string;
  cardName: string;
  instruction: string;
  ownerId: string;
} | null;

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
  spokenThisRound: string[];
  turnStartedAt: number | null;
  dmMessage: string;
  activeEffect: ActiveEffect;
  coveredPoints: string[];
  openHooks: string[];
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
  source: "deepseek" | "local";
};

export const QUESTION_CARDS = [
  { id: "hint", symbol: "◉", name: "看山提示", cost: 4, description: "打开一个尚未讨论的方向" },
  { id: "counter", symbol: "↩", name: "反方", cost: 5, description: "下一笔必须反驳或补充限制" },
  { id: "followup", symbol: "?", name: "追问", cost: 4, description: "让下一笔先回应一个追问" },
  { id: "example", symbol: "□", name: "举例", cost: 3, description: "下一笔必须包含具体案例" },
] as const;

export const STORY_CARDS = [
  { id: "foreshadow", symbol: "⌁", name: "伏笔", cost: 4, description: "让一个旧元素重新进入剧情" },
  { id: "resolve", symbol: "○→●", name: "填坑", cost: 5, description: "推进一个现存悬念的解决" },
  { id: "character", symbol: "●", name: "角色", cost: 3, description: "指定已有角色参与下一段" },
  { id: "perspective", symbol: "◎", name: "视角", cost: 4, description: "改变下一段的叙述视角" },
] as const;

export type CardDefinition = (typeof QUESTION_CARDS)[number] | (typeof STORY_CARDS)[number];
