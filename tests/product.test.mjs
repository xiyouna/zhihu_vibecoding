import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the three-stage Kanshan Table experience", async () => {
  const [page, app, styles, layout] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/KanshanApp.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.match(page, /KanshanApp/);
  assert.match(app, /创建牌桌/);
  assert.match(app, /当前执笔/);
  assert.match(app, /本局共同作品/);
  assert.match(app, /抢笔/);
  assert.match(app, /测试 AI/);
  assert.match(styles, /--paper:\s*#f4f3ef/);
  assert.match(styles, /--blue:\s*#1772f6/);
  assert.match(layout, /看山牌桌/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
});

test("keeps model credentials server-side and provides game integrations", async () => {
  const [deepseek, rooms, zhihu, zhihuClient, example, gitignore] = await Promise.all([
    readFile(new URL("lib/deepseek.ts", root), "utf8"),
    readFile(new URL("app/api/rooms/route.ts", root), "utf8"),
    readFile(new URL("app/api/zhihu/route.ts", root), "utf8"),
    readFile(new URL("lib/zhihu.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL(".gitignore", root), "utf8"),
  ]);

  assert.match(deepseek, /process\.env\.DEEPSEEK_API_KEY/);
  assert.match(deepseek, /response_format/);
  assert.doesNotMatch(deepseek, /sk-[a-zA-Z0-9]{16,}/);
  assert.match(rooms, /submitTurn/);
  assert.match(rooms, /bot_turn/);
  assert.match(zhihu, /getZhihuHotTitles/);
  assert.match(zhihuClient, /\["hot", "--limit", "10"\]/);
  assert.match(zhihuClient, /\["search", "zhihu"/);
  assert.match(example, /DEEPSEEK_API_KEY=\n/);
  assert.match(gitignore, /\.env\*/);
  await access(new URL("public/og.png", root));
  await access(new URL("public/kanshan-reference.jpg", root));
});

test("defines server-authoritative skill cards and story state", async () => {
  const [types, store, deepseek, app] = await Promise.all([
    readFile(new URL("lib/game-types.ts", root), "utf8"),
    readFile(new URL("lib/game-store.ts", root), "utf8"),
    readFile(new URL("lib/deepseek.ts", root), "utf8"),
    readFile(new URL("app/KanshanApp.tsx", root), "utf8"),
  ]);

  assert.match(types, /STEAL_WINDOW_MS = 5_000/);
  assert.match(types, /CARD_WINDOW_MS = 6_000/);
  assert.match(types, /id: "story-hint"/);
  assert.match(types, /name: "抢笔"/);
  assert.doesNotMatch(types, /name: "角色登场"/);
  assert.match(store, /INITIAL_AVAILABLE_SCORE = 100/);
  assert.match(store, /cardUsages/);
  assert.match(store, /reserveCard/);
  assert.match(store, /resumeAfterCardSetup/);
  assert.match(store, /requestHint/);
  assert.match(deepseek, /effect_completed/);
  assert.match(deepseek, /generateCreativeHint/);
  assert.match(app, /仅你可见/);
  assert.match(app, /createPortal/);
  assert.match(app, /card-dialog-backdrop mode-/);
  assert.match(app, /要求对方回答的问题/);
  assert.match(app, /牌桌倒计时已暂停/);
});
