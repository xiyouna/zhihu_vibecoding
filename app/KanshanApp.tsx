"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import {
  CARD_WINDOW_MS,
  STEAL_WINDOW_MS,
  cardsForMode,
  type CardDefinition,
  type GameMode,
  type Room,
} from "@/lib/game-types";

type ApiResult = { ok: boolean; room?: Room; error?: string; hint?: string };

const DEFAULT_QUESTIONS = [
  "AI 会取代程序员吗？",
  "工作除了赚钱，还为人提供了什么？",
  "人为什么会对尚未发生的事感到焦虑？",
];

function makePlayerId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ManuscriptMark({ mode }: { mode: GameMode }) {
  return <span className={`manuscript-mark ${mode}`}>{mode === "question" ? "问" : "章"}</span>;
}

function Kanshan({ mood = "watching", message }: { mood?: string; message: string }) {
  return (
    <section className={`kanshan-card mood-${mood}`}>
      <div className="kanshan-stage" aria-label={`刘看山正在${mood === "thinking" ? "思考" : "主持"}`}>
        <Image src="/kanshan-reference.jpg" alt="刘看山" width={480} height={640} priority unoptimized />
        <span className="kanshan-badge">DM</span>
      </div>
      <div className="dm-copy">
        <span>刘看山</span>
        <p>{message}</p>
      </div>
    </section>
  );
}

export default function KanshanApp() {
  const [playerId, setPlayerId] = useState("");
  const [nickname, setNickname] = useState("");
  const [mode, setMode] = useState<GameMode>("question");
  const [topic, setTopic] = useState(DEFAULT_QUESTIONS[0]);
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);
  const [questionOptions, setQuestionOptions] = useState(DEFAULT_QUESTIONS);
  const [selectedCard, setSelectedCard] = useState<CardDefinition | null>(null);
  const [cardTarget, setCardTarget] = useState("");
  const [cardPrompt, setCardPrompt] = useState("");
  const [hintQuestion, setHintQuestion] = useState("");
  const [privateHint, setPrivateHint] = useState<{ turn: string; text: string } | null>(null);

  useEffect(() => {
    const hydration = setTimeout(() => {
      const id = localStorage.getItem("kanshan-player-id") || makePlayerId();
      localStorage.setItem("kanshan-player-id", id);
      setPlayerId(id);
      setNickname(localStorage.getItem("kanshan-nickname") || "");
      const roomCode = new URLSearchParams(location.search).get("room");
      if (roomCode) setJoinCode(roomCode.toUpperCase());
    }, 0);
    return () => clearTimeout(hydration);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(async (code: string) => {
    try {
      const response = await fetch(`/api/rooms?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (result.ok && result.room) setRoom(result.room);
    } catch {
      // A transient local-network miss should not throw the player out of the room.
    }
  }, []);

  useEffect(() => {
    if (!room?.code || room.phase === "settlement") return;
    const timer = setInterval(() => refresh(room.code), 1200);
    return () => clearInterval(timer);
  }, [refresh, room?.code, room?.phase]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, playerId }),
      });
      const result = await response.json() as ApiResult;
      if (!result.ok || !result.room) throw new Error(result.error || "操作失败");
      setRoom(result.room);
      setJoinCode(result.room.code);
      history.replaceState(null, "", `?room=${result.room.code}`);
      return result.room;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请再试一次");
      return null;
    } finally {
      setBusy(false);
    }
  }, [playerId]);

  const currentBotId = room?.phase === "writing" && room.turnStage === "writing" ? room.turnOrder[room.turnIndex] : "";
  const currentBot = room?.players.find((item) => item.id === currentBotId && item.isBot);
  const botTurnKey = room && currentBot && room.hostId === playerId ? `${room.code}:${room.round}:${room.turnIndex}:${currentBot.id}` : "";
  const botRoomCode = botTurnKey ? room?.code ?? "" : "";

  useEffect(() => {
    if (!botTurnKey || !botRoomCode) return;
    const timer = setTimeout(() => {
      void post({ action: "bot_turn", roomCode: botRoomCode });
    }, 1100);
    return () => clearTimeout(timer);
  }, [botRoomCode, botTurnKey, post]);

  const activeTurnIdentity = room?.phase === "writing" ? `${room.round}:${room.turnIndex}:${room.turnOrder[room.turnIndex] ?? ""}` : "";

  const create = async () => {
    if (!nickname.trim()) return setNotice("先给自己取一个昵称");
    localStorage.setItem("kanshan-nickname", nickname.trim());
    await post({ action: "create", nickname: nickname.trim(), mode, topic, turnDuration: 120 });
  };

  const join = async () => {
    if (!nickname.trim() || !joinCode.trim()) return setNotice("请填写昵称和房间码");
    localStorage.setItem("kanshan-nickname", nickname.trim());
    await post({ action: "join", nickname: nickname.trim(), roomCode: joinCode.trim() });
  };

  const fetchTopics = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/zhihu");
      const data = await response.json() as { titles?: string[] };
      if (data.titles?.length) {
        setQuestionOptions(data.titles);
        setTopic(data.titles[Math.floor(Math.random() * data.titles.length)]);
      }
    } finally {
      setBusy(false);
    }
  };

  const playSelectedCard = async () => {
    if (!room || !selectedCard) return;
    if (selectedCard.timing === "hint") {
      if (!hintQuestion.trim()) return setNotice("请写下你想得到的提示");
      setBusy(true);
      setNotice("");
      try {
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hint", playerId, roomCode: room.code, cardId: selectedCard.id, question: hintQuestion.trim() }),
        });
        const result = await response.json() as ApiResult;
        if (!result.ok || !result.room || !result.hint) throw new Error(result.error || "看山暂时没想好");
        setRoom(result.room);
        setPrivateHint({ turn: activeTurnIdentity, text: result.hint });
        setSelectedCard(null);
        setHintQuestion("");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "获取提示失败");
      } finally {
        setBusy(false);
      }
      return;
    }
    const payload = selectedCard.timing === "steal"
      ? { action: "steal", roomCode: room.code }
      : { action: "card", roomCode: room.code, cardId: selectedCard.id, targetValue: cardTarget, prompt: cardPrompt.trim() };
    const next = await post(payload);
    if (next) {
      setSelectedCard(null);
      setCardTarget("");
      setCardPrompt("");
    }
  };

  const closeSelectedCard = async () => {
    if (!room || !selectedCard || busy) return;
    if (selectedCard.timing !== "steal" && room.cardReservation?.playerId === playerId) {
      await post({ action: "cancel_card", roomCode: room.code });
    }
    setSelectedCard(null);
    setCardTarget("");
    setCardPrompt("");
    setHintQuestion("");
  };

  if (!room) {
    return (
      <main className="home-shell">
        <header className="brand-row">
          <div className="brand-seal">看</div>
          <span>KANSHAN TABLE</span>
          <small>多人文字共创牌桌</small>
        </header>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">今晚，写点不一样的</p>
            <h1>下一笔，<br /><em>你来写。</em></h1>
            <p className="hero-intro">2～6 位玩家围坐一桌，在刘看山的主持下，把零散的念头合成一篇真正属于你们的作品。</p>
            <div className="mode-switch" role="tablist" aria-label="游戏模式">
              <button className={mode === "question" ? "active" : ""} onClick={() => { setMode("question"); setTopic(questionOptions[0]); }}>
                <span>01</span><strong>回答一个问题</strong><small>观点 · 辩论 · 共识</small>
              </button>
              <button className={mode === "story" ? "active story" : "story"} onClick={() => { setMode("story"); setTopic("凌晨三点，所有人的手机同时收到一条来自明天的消息。"); }}>
                <span>02</span><strong>一起写个故事</strong><small>人物 · 伏笔 · 转折</small>
              </button>
            </div>
          </div>
          <div className="hero-table">
            <div className="paper-card">
              <ManuscriptMark mode={mode} />
              <label>{mode === "question" ? "本局问题" : "故事开头"}</label>
              {mode === "question" ? (
                <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                  {questionOptions.map((item) => <option key={item}>{item}</option>)}
                </select>
              ) : (
                <textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={90} />
              )}
              {mode === "question" && <button className="text-action" onClick={fetchTopics} disabled={busy}>↻ 从知乎热榜换一题</button>}
              <div className="identity-row">
                <label><span>你的落款</span><input value={nickname} onChange={(event) => setNickname(event.target.value.slice(0, 12))} placeholder="输入昵称" /></label>
                <button className="primary-button" onClick={create} disabled={busy || !playerId}>创建牌桌 <span>→</span></button>
              </div>
            </div>
            <div className="join-strip">
              <span>已经有房间？</span>
              <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 5))} placeholder="输入房间码" />
              <button onClick={join} disabled={busy || !playerId}>入席</button>
            </div>
            <div className="home-kanshan"><Image src="/kanshan-reference.jpg" alt="站在牌桌旁的刘看山" width={430} height={570} priority unoptimized /></div>
          </div>
        </section>
        <footer className="home-footer"><span>一支笔</span><i /> <span>一张桌</span><i /> <span>一篇共同作品</span></footer>
        {notice && <div className="toast">{notice}</div>}
      </main>
    );
  }

  if (room.phase === "waiting") {
    const me = room.players.find((item) => item.id === playerId);
    const allReady = room.players.length >= 2 && room.players.every((item) => item.ready);
    const botCount = room.players.filter((item) => item.isBot).length;
    return (
      <main className={`lobby-shell mode-${room.mode}`}>
        <header className="room-topbar">
          <div className="mini-brand"><span>看</span> 看山牌桌</div>
          <div className="room-code">房间码 <strong>{room.code}</strong><button onClick={() => navigator.clipboard?.writeText(room.code)}>复制</button></div>
        </header>
        <div className="lobby-grid">
          <section className="lobby-manuscript">
            <p className="eyebrow">{room.mode === "question" ? "问题模式" : "故事模式"}</p>
            <h1>{room.topic}</h1>
            <p>{room.subtitle}</p>
            <div className="seat-grid">
              {Array.from({ length: 6 }, (_, index) => room.players[index] ?? null).map((item, index) => item ? (
                <div className={`seat ${item.ready ? "ready" : ""}`} key={item.id}>
                  <span className="avatar" style={{ background: item.color }}>{item.nickname.slice(0, 1)}</span>
                  <strong>{item.nickname}</strong>
                  <small>{item.isBot ? "测试 AI · 已准备" : item.id === room.hostId ? "房主" : item.ready ? "已备好笔" : "准备中"}</small>
                </div>
              ) : <div className="seat empty" key={index}><span>+</span><small>等待入席</small></div>)}
            </div>
            <div className="lobby-actions">
              <button className="secondary-button" onClick={() => post({ action: "ready", roomCode: room.code })}>{me?.ready ? "再等等" : "我准备好了"}</button>
              {room.hostId === playerId && room.players.length < 6 && <button className="bot-button" disabled={busy} onClick={() => post({ action: "add_bot", roomCode: room.code })}>＋ 测试 AI</button>}
              {room.hostId === playerId && botCount > 0 && <button className="bot-clear" disabled={busy} onClick={() => post({ action: "remove_bots", roomCode: room.code })}>移除 AI</button>}
              {room.hostId === playerId && <button className="primary-button" disabled={!allReady || busy} onClick={() => post({ action: "start", roomCode: room.code })}>开始共创 <span>→</span></button>}
            </div>
            {room.hostId === playerId && !allReady && <p className="hint">至少两人入席，并且所有人准备后即可开始。</p>}
          </section>
          <Kanshan message={room.dmMessage} />
        </div>
        {notice && <div className="toast">{notice}</div>}
      </main>
    );
  }

  if (room.phase === "settlement") return <Settlement room={room} playerId={playerId} onRoom={setRoom} />;

  const currentId = room.turnOrder[room.turnIndex];
  const current = room.players.find((item) => item.id === currentId);
  const me = room.players.find((item) => item.id === playerId);
  const isCurrent = currentId === playerId;
  const remaining = room.cardReservation?.pausedStage === "writing"
    ? Math.ceil(room.cardReservation.remainingMs / 1000)
    : room.turnStartedAt && now > 0
      ? Math.min(room.turnDuration, Math.max(0, room.turnDuration - Math.floor((now - room.turnStartedAt) / 1000)))
      : room.turnDuration;
  const cards = cardsForMode(room.mode);
  const usedCardThisRound = room.cardUsages.some((usage) => usage.playerId === playerId && usage.round === room.round);
  const stageDuration = room.turnStage === "steal" ? STEAL_WINDOW_MS : room.turnStage === "card" ? CARD_WINDOW_MS : 0;
  const stageRemaining = stageDuration && room.stageStartedAt && now > 0
    ? Math.max(0, Math.ceil((stageDuration - (now - room.stageStartedAt)) / 1000))
    : 0;
  const reservationIsMine = room.cardReservation?.playerId === playerId;
  const activeEffectForMe = room.activeEffect?.targetPlayerId === playerId;
  const activeEffectByMe = room.activeEffect?.ownerId === playerId;

  const targetOptions = (card: CardDefinition) => {
    if (card.targetType === "entry" || card.targetType === "entry-or-question") return room.entries.map((entry) => ({ value: entry.id, label: `${entry.playerName}：${entry.text.slice(0, 48)}` }));
    if (card.targetType === "hook") return room.storyState.hooks.map((hook) => ({ value: hook, label: hook }));
    if (card.targetType === "perspective") return [
      { value: "first", label: "第一人称（我）" },
      { value: "third", label: "限知第三人称（仅写角色所知）" },
    ];
    return [];
  };

  const cardDisabledReason = (card: CardDefinition) => {
    if (busy) return "正在处理上一个操作";
    if (usedCardThisRound) return "你这一轮已经用过技能卡";
    if ((me?.availableScore ?? 0) < card.cost) return `还需要 ${card.cost - (me?.availableScore ?? 0)} 言值`;
    if (room.cardReservation) return room.cardReservation.playerId === playerId ? "你正在设置另一张卡" : `${room.cardReservation.playerName} 正在设置「${room.cardReservation.cardName}」`;
    if (card.timing === "steal") {
      if (room.turnStage !== "steal") return "只能在 5 秒抢笔窗口使用";
      if (isCurrent) return "笔已经在你手里";
      if (room.spokenThisRound.includes(playerId)) return "你这一轮已经落过笔";
      return "";
    }
    if (card.timing === "hint") {
      if (!isCurrent || room.turnStage !== "writing") return "只能由正在写作的执笔者使用";
      return "";
    }
    if (room.turnStage !== "card") return "只能在 6 秒约束卡窗口使用";
    if (room.activeEffect) return "这一笔已经有一个约束";
    if (card.selfOnly && !isCurrent) return "这张卡只能对自己使用";
    if (card.targetType === "entry" && targetOptions(card).length === 0) return "还没有可选的发言";
    if (card.targetType === "hook" && targetOptions(card).length === 0) return "还没有未解决伏笔";
    return "";
  };

  const openCard = async (card: CardDefinition) => {
    const reason = cardDisabledReason(card);
    if (reason) return setNotice(reason);
    const options = targetOptions(card);
    setCardTarget(options[0]?.value ?? "");
    setCardPrompt(card.id === "perspective" ? room.storyState.characters[0] ?? "" : "");
    setHintQuestion("");
    if (card.timing !== "steal") {
      const reserved = await post({ action: "reserve_card", roomCode: room.code, cardId: card.id });
      if (!reserved) return;
    }
    setSelectedCard(card);
  };

  return (
    <main className={`table-shell mode-${room.mode}`}>
      <header className="room-topbar table-topbar">
        <div className="mini-brand"><span>看</span> 看山牌桌</div>
        <div className="round-title"><small>{room.mode === "question" ? "共同回答" : "共同故事"}</small><strong>{room.topic}</strong></div>
        <div className="round-count">第 <strong>{room.round}</strong> / {room.maxRounds} 轮</div>
      </header>
      <div className="table-grid">
        <aside className="players-panel">
          <div className="panel-heading"><span>围桌而坐</span><small>{room.players.length}/6</small></div>
          <div className="player-list">
            {room.players.map((item) => (
              <div className={`player-row ${item.id === currentId ? "current" : ""}`} key={item.id}>
                <span className="avatar" style={{ background: item.color }}>{item.nickname.slice(0, 1)}</span>
                <div><strong>{item.nickname}{item.isBot && <em className="bot-chip">AI</em>}</strong><small>{item.id === currentId ? item.isBot ? "正在构思" : "当前执笔" : room.spokenThisRound.includes(item.id) ? "已落笔" : "等候中"}</small></div>
                <span className="score-pill">言 {item.availableScore}</span>
              </div>
            ))}
          </div>
          <div className={`turn-stage stage-${room.turnStage}`}>
            <small>{room.cardReservation ? `${room.cardReservation.playerName} 正在设置卡牌` : room.turnStage === "steal" ? "抢笔窗口" : room.turnStage === "card" ? "效果卡窗口" : "正在执笔"}</small>
            <strong>{room.cardReservation ? "已暂停" : room.turnStage === "writing" ? `${remaining} 秒` : `${stageRemaining} 秒`}</strong>
          </div>
          <div className="room-mini"><span>房间 {room.code}</span><button onClick={() => navigator.clipboard?.writeText(`${location.origin}?room=${room.code}`)}>复制邀请</button></div>
        </aside>

        <section className="manuscript-panel">
          <div className="manuscript-header"><ManuscriptMark mode={room.mode} /><div><small>{room.mode === "question" ? "共同回答" : `第 ${room.round} 章`}</small><h1>{room.topic}</h1></div></div>
          <div className="entries">
            {room.entries.length === 0 && <div className="empty-page"><span>第一页</span><p>稿纸已经铺好，等着第一笔。</p></div>}
            {room.entries.map((entry, index) => (
              <article className="entry" key={entry.id}>
                <div className="entry-byline"><span>{String(index + 1).padStart(2, "0")}</span><strong>{entry.playerName}</strong><i /></div>
                <p>{entry.text}</p>
                <div className="entry-score"><strong>+{entry.score} 言值</strong><span>{entry.reason}</span></div>
                {entry.effectResolution && <div className={`effect-result ${entry.effectResolution.completed === true ? "passed" : entry.effectResolution.completed === false ? "failed" : "unknown"}`}>
                  {entry.effectResolution.completed === true ? "✓" : entry.effectResolution.completed === false ? "×" : "·"} {entry.effectResolution.cardName}：{entry.effectResolution.reason}
                </div>}
              </article>
            ))}
            {room.phase === "scoring" && <div className="judging"><i /><span>刘看山正在批注这一笔……</span></div>}
            {room.phase === "writing" && <div className="next-stroke"><span>等待 {current?.nickname} 的下一笔</span></div>}
          </div>
        </section>

        <aside className="dm-panel">
          <Kanshan mood={room.phase === "scoring" ? "thinking" : "watching"} message={room.dmMessage} />
          <section className="notebook">
            <div className="panel-heading"><span>{room.mode === "question" ? "讨论脉络" : "看山的小本本"}</span><small>局内</small></div>
            {room.mode === "question" ? (
              <ul>{room.coveredPoints.slice(-4).map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}{room.coveredPoints.length === 0 && <li className="muted">还没有被打开的观点</li>}</ul>
            ) : (
              <>
                {room.storyState.characters.length > 0 && <><b className="notebook-label">角色</b><ul>{room.storyState.characters.slice(-4).map((character) => <li key={character}>{character}</li>)}</ul></>}
                <b className="notebook-label">未解决伏笔</b>
                <ul>{room.storyState.hooks.slice(-4).map((hook, index) => <li key={`${hook}-${index}`}>{hook}</li>)}{room.storyState.hooks.length === 0 && <li className="muted">伏笔会在这里留下记号</li>}</ul>
              </>
            )}
          </section>
          {room.cardReservation && <section className={`card-setup-status ${reservationIsMine ? "mine" : ""}`}>
            <strong>{reservationIsMine ? `你正在设置「${room.cardReservation.cardName}」` : `${room.cardReservation.playerName} 正在设置「${room.cardReservation.cardName}」`}</strong>
            <p>效果卡倒计时已暂停，确认或取消后继续。</p>
          </section>}
          {room.activeEffect && <section className={`effect-status ${activeEffectForMe ? "target" : activeEffectByMe ? "owner" : "observer"}`}>
            <small>{activeEffectForMe && activeEffectByMe ? "你对自己使用了" : activeEffectForMe ? `${room.activeEffect.ownerName} 对你使用了` : activeEffectByMe ? `你已对 ${room.activeEffect.targetPlayerName} 使用` : `${room.activeEffect.ownerName} → ${room.activeEffect.targetPlayerName}`}</small>
            <strong>{room.activeEffect.cardName}</strong>
            <p>{room.activeEffect.instruction}</p>
            {activeEffectForMe && <b>必须按要求完成这一笔，否则本次最高只能获得 5 言值。</b>}
          </section>}
          <section className="cards-panel">
            <div className="panel-heading"><span>手边的卡</span><small>{usedCardThisRound ? "本轮已用" : "每轮一张"}</small></div>
            <div className="card-grid">
              {cards.map((card) => (
                <button key={card.id} title={cardDisabledReason(card) || card.description} disabled={Boolean(cardDisabledReason(card))} onClick={() => openCard(card)}>
                  <span>{card.symbol}</span><strong>{card.name}</strong><small>言 {card.cost}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className={`writing-dock ${isCurrent ? "active" : ""} ${isCurrent && room.activeEffect ? "has-effect" : ""}`}>
        <div className="writer-state"><span className="avatar" style={{ background: current?.color }}>{current?.nickname.slice(0, 1)}</span><div><small>当前执笔</small><strong>{current?.nickname}</strong></div></div>
        {isCurrent && room.turnStage === "writing" ? (
          <div className={`writing-area ${room.activeEffect ? "has-effect" : ""}`}>
            {room.activeEffect && <section className="active-effect" aria-label="本次强制续写要求">
              <div><span>{room.activeEffect.ownerName} 对你使用了</span><strong>{room.activeEffect.cardName}</strong></div>
              <p>{room.activeEffect.instruction}</p>
              <b>请按卡面要求续写；未完成将被判定违反效果，本次最高 5 言值。</b>
            </section>}
            {privateHint?.turn === activeTurnIdentity && <div className="private-hint"><button onClick={() => setPrivateHint(null)} aria-label="关闭提示">×</button><strong>看山的提示 · 仅你可见</strong><p>{privateHint.text}</p></div>}
            <textarea value={draft} onChange={(event) => setDraft([...event.target.value].slice(0, 140).join(""))} placeholder={room.mode === "question" ? "写下你的观点……" : "接着写下去……"} disabled={busy || Boolean(room.cardReservation)} />
            <div className="writing-meta"><span className={remaining < 20 ? "urgent" : ""}>{room.cardReservation ? "暂停" : `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`}</span><small>{[...draft].length}/140</small><button disabled={!draft.trim() || busy || Boolean(room.cardReservation)} onClick={async () => { const next = await post({ action: "submit", roomCode: room.code, text: draft }); if (next) setDraft(""); }}>落笔 <b>↗</b></button></div>
          </div>
        ) : <div className="waiting-copy"><span>{room.cardReservation ? `${room.cardReservation.playerName} 正在设置「${room.cardReservation.cardName}」` : room.turnStage === "steal" ? `笔暂时在 ${current?.nickname} 手里` : room.turnStage === "card" ? `正在为 ${current?.nickname} 拍卡` : `笔正在 ${current?.nickname} 手里`}</span><small>{room.cardReservation ? "牌桌倒计时已暂停，等待卡牌确认。" : room.turnStage === "steal" ? `还有 ${stageRemaining} 秒可以使用「抢笔」。` : room.turnStage === "card" ? `还有 ${stageRemaining} 秒可以拍下一张效果卡。` : current?.isBot ? "测试 AI 正在读前文并构思这一笔。" : "读一读前文，想想你的下一笔。"}</small></div>}
        <button className="end-vote" disabled={room.round < 2 || room.endVotes.includes(playerId)} onClick={() => post({ action: "vote", roomCode: room.code })}>收笔投票 {room.endVotes.length}/{Math.floor(room.players.length / 2) + 1}</button>
      </section>
      {selectedCard && createPortal(<div className={`card-dialog-backdrop mode-${room.mode}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) void closeSelectedCard(); }}>
        <section className="card-dialog" role="dialog" aria-modal="true" aria-labelledby="card-dialog-title">
          <button className="dialog-close" onClick={() => void closeSelectedCard()} disabled={busy} aria-label="关闭并继续倒计时">×</button>
          <span className="dialog-symbol">{selectedCard.symbol}</span>
          <p>{selectedCard.timing === "steal" ? "通用技能" : room.mode === "question" ? "问答批注" : "故事灵感"}</p>
          <h2 id="card-dialog-title">{selectedCard.name}</h2>
          <div className="dialog-description">{selectedCard.description}</div>
          <div className="dialog-timing"><span>使用时间</span><strong>{selectedCard.timing === "steal" ? "5 秒抢笔窗口" : selectedCard.timing === "hint" ? "你自己的正式写作阶段" : "执笔前的效果卡阶段"}</strong></div>
          {selectedCard.timing === "hint" && <label className="dialog-field">
            <span>你想问看山什么？</span>
            <textarea value={hintQuestion} onChange={(event) => setHintQuestion([...event.target.value].slice(0, 80).join(""))} maxLength={80} placeholder={room.mode === "story" ? "例如：怎样让这个伏笔自然回到主线？" : "例如：还有哪个角度没有被讨论？"} />
            <small>{[...hintQuestion].length}/80</small>
          </label>}
          {selectedCard.targetType === "entry-or-question" && <>
            <label className="dialog-field">
              <span>引用一段已有文字（可选）</span>
              <select value={cardTarget} onChange={(event) => setCardTarget(event.target.value)}>
                <option value="">不引用，直接提出问题</option>
                {targetOptions(selectedCard).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="dialog-field">
              <span>要求对方回答的问题</span>
              <textarea value={cardPrompt} onChange={(event) => setCardPrompt([...event.target.value].slice(0, 80).join(""))} maxLength={80} placeholder="例如：如果 AI 能理解业务上下文，程序员不可替代的部分还剩什么？" />
              <small>{[...cardPrompt].length}/80 · 对方必须直接回答这个问题</small>
            </label>
          </>}
          {selectedCard.targetType === "perspective" && <>
            <label className="dialog-field">
              <span>这一笔跟随哪个角色？</span>
              <input value={cardPrompt} onChange={(event) => setCardPrompt([...event.target.value].slice(0, 24).join(""))} maxLength={24} list="story-characters" placeholder="输入角色名，例如：李薇" />
              <datalist id="story-characters">{room.storyState.characters.map((character) => <option key={character} value={character} />)}</datalist>
            </label>
            <label className="dialog-field">
              <span>叙事视角</span>
              <select value={cardTarget} onChange={(event) => setCardTarget(event.target.value)}>
                {targetOptions(selectedCard).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </>}
          {(selectedCard.targetType === "entry" || selectedCard.targetType === "hook") && <label className="dialog-field">
            <span>{selectedCard.targetType === "entry" ? "选择一段已有发言" : "选择一个未解决伏笔"}</span>
            <select value={cardTarget} onChange={(event) => setCardTarget(event.target.value)}>
              {targetOptions(selectedCard).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>}
          {selectedCard.timing !== "steal" && <div className="dialog-pause">Ⅱ 牌桌倒计时已暂停，最多保留 2 分钟</div>}
          <div className="dialog-target"><span>作用对象</span><strong>{selectedCard.timing === "hint" ? "你自己，结果仅你可见" : selectedCard.timing === "steal" ? `与 ${current?.nickname} 交换顺序` : `${current?.nickname} 的这一笔`}</strong></div>
          <button className="dialog-confirm" onClick={playSelectedCard} disabled={busy || (selectedCard.timing === "hint" && hintQuestion.trim().length < 2) || (selectedCard.targetType === "entry-or-question" && cardPrompt.trim().length < 2) || (selectedCard.targetType === "perspective" && (!cardPrompt.trim() || !cardTarget)) || ((selectedCard.targetType === "entry" || selectedCard.targetType === "hook") && !cardTarget)}>
            {busy ? "看山正在处理……" : selectedCard.timing === "hint" ? `请看山提示 · 言 ${selectedCard.cost}` : `拍到桌上 · 言 ${selectedCard.cost}`}
          </button>
        </section>
      </div>, document.body)}
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

function Settlement({ room, playerId, onRoom }: { room: Room; playerId: string; onRoom: (room: Room) => void }) {
  const [settling, setSettling] = useState(!room.settlement);
  useEffect(() => {
    if (room.settlement) return;
    let live = true;
    fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settle", playerId, roomCode: room.code }),
    }).then((response) => response.json()).then((result: ApiResult) => {
      if (live && result.ok && result.room) onRoom(result.room);
    }).finally(() => { if (live) setSettling(false); });
    return () => { live = false; };
  }, [onRoom, playerId, room.code, room.settlement]);
  const sorted = useMemo(() => [...room.entries].sort((a, b) => b.score - a.score), [room.entries]);
  const best = room.settlement?.quote || sorted[0]?.text;
  const stats = room.players.map((player) => {
    const entries = room.entries.filter((entry) => entry.playerId === player.id);
    const avg = entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length * 10) / 10 : 0;
    const title = avg >= 8 ? "每笔有回声" : entries.length >= room.maxRounds ? "稳定执笔人" : "灵感突击手";
    return { ...player, count: entries.length, avg, title };
  });
  return (
    <main className={`settlement-shell mode-${room.mode}`}>
      <header className="settlement-head"><div className="mini-brand"><span>看</span> 看山牌桌</div><div className="finished-stamp">合笔</div></header>
      <section className="work-cover">
        <p className="eyebrow">本局共同作品</p>
        <h1>{room.settlement?.title || room.topic}</h1>
        <p>由 {room.players.map((item) => item.nickname).join(" / ")} 共同创作</p>
      </section>
      <div className="settlement-grid">
        <article className="final-work">
          {settling && <div className="judging"><i /><span>刘看山正在整理共同手稿……</span></div>}
          {(room.settlement?.body ? room.settlement.body.split(/\n{2,}/) : room.entries.map((entry) => entry.text)).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}
          {room.entries.length === 0 && <p>这一局在第一笔落下前收笔了。</p>}
        </article>
        <aside>
          <Kanshan mood="award" message={room.settlement?.summary || "句子各有来处，合在一起，就成了只有你们能写出的这一篇。"} />
          {best && <blockquote><small>本局金句</small><p>“{best}”</p><cite>—— 共同作品</cite></blockquote>}
        </aside>
      </div>
      <section className="player-awards">
        <div className="section-title"><span>落笔的人</span><small>本局记录</small></div>
        <div className="awards-grid">{stats.map((item) => <article key={item.id} className={item.id === playerId ? "me" : ""}><span className="avatar" style={{ background: item.color }}>{item.nickname.slice(0, 1)}</span><div><strong>{item.nickname}</strong><em>{item.title}</em></div><p>{item.count} 次落笔 · 平均 {item.avg} 言</p></article>)}</div>
      </section>
      <div className="settlement-actions"><button className="secondary-button" onClick={() => { history.replaceState(null, "", location.pathname); location.reload(); }}>回到首页</button><button className="primary-button" onClick={() => navigator.clipboard?.writeText(location.href)}>复制作品链接 <span>↗</span></button></div>
    </main>
  );
}
