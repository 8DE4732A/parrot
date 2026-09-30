# Parrot 一期设计：AI 深度背单词 PWA

> 状态：设计稿，未开始开发。
> 日期：2026-09-29。
> **详细设计见 [DESIGN-PHASE1-DETAIL.md](./DESIGN-PHASE1-DETAIL.md)**（架构原则、素材包规范、流水线、DDL、API 契约、任务分解），实施以详设为准。
> 与 INTENT.md 的关系：交互形态由终端 TUI 调整为 PWA 多端；一期只做「背单词」，语音对话、AI 追问对话留待后续阶段。
> 与 docs/RESEARCH.md 的关系：其中 TUI/Ink/pi/语音调研结论已废弃，ECDICT 词库、ts-fsrs、免费额度对比结论仍然有效。

## 1. 背景与目标

**痛点**：百词斩等工具只给单词和释义，不给词根词缀拆解、衍生词、近义辨析——用户背单词时还要去豆包追问。AI 扮演英语老师可以给出更完整的深度讲解。

**一期目标**：一个可安装到手机/PC 主屏幕的 PWA，完成「选词书 → 每日新词+复习 → AI 深度讲解卡片 → 测验 → FSRS 间隔复习」的完整背单词闭环。

**已确认决策**：

| 决策点 | 结论 |
|---|---|
| 部署 | 云端（Vercel + Neon Postgres），多端同步天然成立 |
| AI 讲解 | 预生成 + 缓存（卡片秒开，成本低） |
| 词表 | **一期仅雅思（IELTS）**（ECDICT ielts tag 实测 5040 词）；CET-6/托福词书二期只加数据不改代码 |
| 交互 | 卡片学习 + 测验 + FSRS 四键评分；AI 追问对话二期 |
| 模型 | **BYOK：每用户配置自己的 LLM**（key 服务端 AES-GCM 加密保存、客户端直连调用，服务端默认零 LLM 成本）；Vercel AI SDK + `@ai-sdk/openai-compatible`，CORS 不友好的 provider 自动降级服务端代理 |

**一期明确不做**：离线数据层、多用户、AI 对话、语音、admin 后台、社交功能。

**参考项目 [hefengxian/my-ielts](https://github.com/hefengxian/my-ielts)（3.6k★）**：Vue 3 纯前端静态站（无后端无 AI），词汇模块含练习模式、打字练习模式、原书音频，内容来自刘洪波《雅思词汇真经》等商业教材。借鉴点：① 打字练习是受欢迎的词汇记忆形态，二期可加；② 雅思特色「考点词同义替换」值得在 AI 生成中强化（本设计 `synonyms` 辨析字段天然覆盖，AI 生成例句/辨析时按雅思听说读写场景出题）。**版权差异**：my-ielts 直接电子化版权教材且声明仅限个人使用；本项目为开源项目，内容路线坚持「开源词库（ECDICT）+ AI 生成」，不收录版权教材内容。

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 15 App Router + React 19 + TypeScript | 一套代码产出 API routes 与 PWA 前端；Vercel 部署零配置 |
| 样式 | TailwindCSS v4 | 移动端优先，开发效率高 |
| PWA | 手写 manifest.json + 极简 Service Worker | 只做"可安装 + 静态资源缓存"；数据层离线留二期 |
| 数据库 | Neon Postgres（Vercel Marketplace） | serverless HTTP driver 适配 Serverless 无连接池问题；免费 0.5GB 足够；Supabase 免费层 7 天不活跃暂停故排除 |
| ORM | Drizzle ORM + drizzle-kit | neon-http 一等支持、冷启动低、schema 即 TS、迁移一条命令 |
| AI | Vercel AI SDK v5 + `@ai-sdk/openai-compatible` / `@ai-sdk/deepseek` | `generateObject` + Zod 结构化输出；provider 目录最广满足多模型配置 |
| SRS | ts-fsrs v5 | FSRS 已是 Anki 默认算法，勿自研；`enable_short_term: false` 按天调度 |
| 鉴权 | Auth.js v5 + GitHub OAuth + 用户白名单（`ALLOWED_GITHUB_LOGINS`），多人各自进度隔离 | 个人项目最务实；二期可换 Auth.js 而表结构不动 |
| 发音 | 浏览器 Web Speech API | 零成本零存储，一期够用 |

## 3. 数据模型（Drizzle，9 张表）

```
users ──┬── user_decks ──< decks ──< deck_words >── words
        ├── card_progress >── words          （FSRS 状态，1 词 1 行）
        ├── review_logs                       （FSRS 复习日志，append-only）
        ├── quiz_records                      （测验明细）
        └── settings                          （LLM 配置等）

words ──< word_explanations               （AI 讲解缓存，1 词 1 行，全局共享不挂用户）
```

核心表字段：

- **words**：word(unique)、phonetic、translation、definition、pos、tags、frequency（ECDICT 词频，控制例句难度）
- **decks**：slug('ielts'，一期仅此一个；表结构支持多词书)、name、description、wordCount
- **word_explanations**：wordId(unique)、model（生成时模型，便于审计/重生成）、status(`pending|ready|failed`)、content **jsonb**（结构演进免迁移）、promptTokens/completionTokens、retryCount、lastError
- **user_decks**：userId+deckId、dailyNewLimit(默认 10)、active
- **card_progress**：userId+wordId、state(0New/1Learning/2Review/3Relearning)、due、stability、difficulty、elapsedDays、scheduledDays、reps、lapses、lastReview。⚠️ FSRS 字段**平铺成列**（不存 JSON blob），关键索引 `(userId, due)` 支撑每日队列查询
- **review_logs**：grade(1Again/2Hard/3Good/4Easy)、state、due、stability、difficulty、elapsedDays、scheduledDays、reviewedAt、source(card|quiz_choice|quiz_spell|quiz_cloze)。append-only，为日后 FSRS optimizer 个性化重训 w 权重留数据
- **quiz_records**：type(choice|spell|cloze)、question jsonb（题目快照，可回放错题）、answer、correct、durationMs
- **user_settings**（per-user）：key-value jsonb——llm.provider/baseUrl/apiKey（AES-GCM + AUTH_SECRET 加密入库）、fsrs.requestRetention 等

users 表存 GitHub 身份（githubId/githubLogin/name/avatarUrl），白名单内账号首次登录自动建档；所有用户域表挂 userId 外键，多人进度隔离。

**word_relations（词族关联表，POC 后新增）**：wordId、relatedWordId、relation(`derivative` 衍生 | `inflection` 词形变化)、unique(wordId, relatedWordId)。支撑卡片背面「同根衍生」chips 的**可点击跳转**（衍生词已在词书中则直接跳学习，不在则展示释义）。数据来源见第 5 章。

## 4. AI 讲解生成管线

### 4.1 输出结构（Zod schema，`src/lib/ai/explain.ts`）

```ts
{
  etymology: {
    parts: [{ part: "spect", type: "root", meaning: "看" }],  // 词根拆解，词源学正确，不确定时明说"词源不详"禁止编造
    story: "一段话讲清词源如何推出词义",
  },
  derivatives: [{ word, pos, meaning }],   // 同根/衍生词 4-8 个
  examples: [{ en, zh }],                   // 地道例句 3 个，匹配词频与雅思考试语境（听力场景/阅读学术/口语 Part1-3）
  synonyms: [{ group: ["accept","receive","adopt"], diff: "中文区分规则" }],  // 近义辨析 2-4 组
  mnemonic: "联想记忆法，优先利用已拆解词根",
}
```

Prompt 要求：中文释义/辨析、英文例句；例句与词频匹配；辨析聚焦中国学习者最易混淆的近义词并给可操作区分规则。`generateObject` 失败时用 Zod 报错 repair 重试一次。

### 4.2 生成路径：本地批量为主 + 线上兜底

| 路径 | 机制 |
|---|---|
| **主路径** `scripts/generate-explanations.ts` | 本地（或 GitHub Actions）跑 `pnpm gen:explain --deck ielts --concurrency 5`，扫 status ∈ {缺行, pending, failed且retry<3}，并发 5，按 status 断点续跑。Vercel Hobby 无长任务，5000 词全量放本地最务实 |
| **兜底**：**客户端生成为主 + 服务端代理为辅** | 学卡片遇非 ready 时：前端取用户自己的 key（GET /api/settings/llm-key，仅本人可解密）**在浏览器直连 LLM 生成**（Vercel AI SDK 浏览器端运行）→ `POST /api/explanations/[wordId]` 提交结果，服务端 Zod 校验后写共享缓存（origin='client'）；CORS 不友好或用户未配 key → fallback 服务端代理调用（key 解密后仅在内存使用） |

### 4.3 成本估算（雅思词书 ~5000 词全量）

~400 input + ~900 output tokens/词 ≈ 2.4M in + 5.4M out：
- DeepSeek-chat：约 $6.5 全量一次
- qwen-plus / Gemini Flash 免费额度：接近 $0

成本不构成约束，换模型全量重生成也是 $10 以内。

### 4.4 derivatives 回链与词族关联

AI 生成的 `derivatives[]` 不只是展示文本：写库时把每个衍生词**回链**到 `words` 表（能匹配到词条则建 `word_relations(derivative)` 关联行）。效果：卡片背面的衍生词 chips 可点击——衍生词在用户词书中直接跳学习，不在则弹出释义。同一词的讲解缓存全局共享，回链收益也是全局的。

## 5. 词库预处理管线（POC 验证结论，2026-09-29）

已对 ECDICT 1.0.28 SQLite 版（340 万词条）实测验证，**原始数据不能直接入库**，需要一条预处理管线：

### 5.1 POC 实测数据

- tag 筛词规模（POC 实测）：ielts **5040** / cet6 5407 / toefl 6974，并集 10416（`words` 唯一存储 + `deck_words` 引用的设计成立；一期只导入 ielts 词书）。**实测 tag 双向失真**：含 1443 个 BNC 前 3000 基础词（需频率下限过滤），又漏标 `sustainable/biodiversity` 等雅思学术高频词（需外部词表+LLM 判类补齐）——经预处理后实际学习目标约 3600~5000 词
- `exchange` 词形变化字段格式规整可解析：`take` → `p:took/d:taken/i:taking/3:takes/s:takes`
- 字段质量：音标/中英释义/词频（bnc/frq）完整可用

### 5.2 实测发现的三个问题

1. **tag 漏词（最严重）**：`aristocracy` 仅标 `gre`，不在 cet6/ielts/toefl；`monarchy` 缺 cet6；`demographic` 完全无 tag。BNC 前 20000 高频词中无 tag 者达 **8668 个**（其中含 `an/yeah/Mr/john` 等非学习词，不能纯靠词频补漏）
2. **衍生词噪音大**：字符串前缀匹配 `aristocrat%` 会命中 `aristocratian/aristocratick/aristocraty` 等废弃或罕见词——衍生词关联**不能靠字符串匹配**
3. **衍生词无显式关联**：`aristocrat/aristocratic` 与 `aristocracy` 的词族关系数据里没有表达，需要预处理建立

### 5.3 预处理管线设计（`scripts/` 下三个脚本，一次性/低频运行）

| 步骤 | 脚本 | 逻辑 |
|---|---|---|
| ① 权威词表固化 | `build-wordlists.ts` | ECDICT `ielts` tag 为主 → 交叉对照**外部权威雅思词表**补漏（POC 实证有漏标：如 aristocracy 仅标 gre，但属雅思学术词汇范围）→ 对仍无 tag 的高频候选词（词频阈值以上），用**专名/感叹词黑名单**（首字母大写专名、interjection）过滤后，调 LLM 批量判类「是否属于雅思范围」（一次性离线，数千词 × 几十 token，成本可忽略）→ 产出**一份固化雅思词表 JSON**（**版本化入库，可复查**；管线支持传 `--deck` 参数，二期跑 cet6/toefl 零改码） |
| ② 清洗与入库 | `import-ecdict.ts` | 过滤专名/短语/超长词 → `exchange` 解析为 JSON（{plural, past, pp, ing, comparative, ...}，拼写测验容错用）→ 按 `frq` 排序写入 words/decks/deck_words |
| ③ 词形变化关联 | `build-relations.ts` | 从 `exchange` 确定性解析建 `word_relations(inflection)` 关联（如 take↔took）；**不做**字符串前缀式的衍生词挖掘（POC 证明噪音过大），衍生词统一走 AI 讲解的 4.4 回链 |

预处理在里程碑 2 一次跑完，产物（词表 JSON + 关联表）提交仓库固化；后续换词库版本才需重跑。

## 6. 核心用户流程

```
/login（GitHub OAuth，Auth.js 托管登录页）
→ /onboarding 选词书（一期仅雅思）+ 每日新词数
→ /today 每日主页：到期复习 + 新词队列 → 「开始学习」
→ /study 卡片流（正面自测 → 背面深度讲解 → FSRS 四键评分）
→ /quiz 混合测验（10 题）→ /stats 统计
```

- 队列规则：`dueReviews` = state≠New 且 due≤今日23:59（按 due 排序）；`newWords` = 词书未学词前 N 个（按词书序）。学新卡立即建 card_progress 行（`createEmptyCard`），防刷新重复出词
- `/api/queue` 一次拉全天队列 JSON（含讲解缓存），学习过程中只有评分小请求——弱网体验靠 prefetch 而非离线

### 6.1 深度讲解卡片（移动端优先）

**正面**（极简，先自测）：进度点 + 大字号单词 + 音标 + 🔊 + 「显示答案」大按钮。

**背面**（垂直分区，可滑动，无 Tab）：

```
单词 /音标/ 🔊
adj. 壮观的，惊人的              ← ECDICT 释义
─ 词根拆解 ──────────────
spec(看) + tacle + ar
"被人看的东西 → 壮观"           ← etymology.story
─ 地道例句 ──────────────（3 句，中英对照）
─ 同根衍生 ──────────────（横向 chips：spectator 观众 · inspect 检查）
─ 近义辨析 ──────────────（spectacular vs. grand: …）
─ 记忆法 ────────────────
[重来] [困难] [良好] [简单]      ← FSRS 四键，按钮标注预计间隔（"良好·3天"）
```

- `ExplanationCard` 单组件，分区为子组件数组便于调序；content 缺失时降级隐藏该区
- 评分即 `POST /api/review`（`fsrs().next(card, now, grade)` 持久化），乐观更新后切下一张

### 6.2 测验（三题型）

| 题型 | 形式 | 判分 → FSRS |
|---|---|---|
| 选择 | 看词选释义 / 看释义选词，4 选 1（干扰项取同词书） | 对→Good，错→Again |
| 拼写 | 播发音+中文释义，输入拼写（忽略大小写；编辑距离 1 提示"差一个字母"） | 正确→Good，否则→Again |
| 例句填空 | 讲解缓存例句挖掉目标词，4 选 1 或输入 | 同选择 |

从今日已学词抽 10 题；答错的词 due 拉回今天立即重学。quiz_records 存题目快照。

## 7. 鉴权与多端同步

- GitHub OAuth（免费创建 OAuth App）+ **Auth.js v5**（Next.js 生态标准方案，Vercel 零配置）；JWT session 存 httpOnly Cookie
- **用户白名单** `ALLOWED_GITHUB_LOGINS`（env，逗号分隔 GitHub 用户名）：白名单内账号首次登录自动建档，进度按账号隔离；白名单外 403 拒绝——多人使用与防 LLM 接口滥用同时解决
- `middleware.ts` 全站校验（除登录回调与静态资源）
- 多端同步自动成立：状态全在 Neon，同一 GitHub 账号在手机/PC 登录即同一进度
- **一期不做离线数据层**：背单词场景几乎总有网络；离线队列 + FSRS 写入冲突解决是一期最大复杂度陷阱而收益极低。`review_logs` 设计为 append-only，为二期离线回放合并留路

## 8. ts-fsrs 集成

```ts
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,     // settings 可调
  enable_fuzz: true,          // 避免同批词到期扎堆
  enable_short_term: false,   // 背单词按天粒度，跳过分钟级短期循环
}));
// 首学: createEmptyCard(now) → 持久化
// 复习: scheduler.next(toCard(row), new Date(), grade) → {card, log}
//       card 字段写回 card_progress，log 写入 review_logs
// 队列: state != New AND due <= endOfToday
```

`src/lib/fsrs.ts` 提供 `toCard(row)` / `rowFromCard(card)` 双向转换；v5 ESM-only，Next.js 原生支持。

## 9. 目录结构（单应用，非 monorepo）

```
parrot/
├── INTENT.md / docs/{RESEARCH.md, DESIGN-PHASE1.md}
├── next.config.ts / drizzle.config.ts / package.json
├── public/  manifest.json, icons/, sw.js
├── src/
│   ├── app/
│   │   ├── layout.tsx / page.tsx(→/today)
│   │   ├── login/ onboarding/ today/ study/ quiz/ stats/
│   │   └── api/
│   │       ├── auth/login|logout/
│   │       ├── decks/            # GET 词书列表 / POST 添加
│   │       ├── queue/            # GET 当日队列（含讲解缓存）
│   │       ├── review/           # POST FSRS 评分
│   │       ├── quiz/             # GET 出题 / POST 提交
│   │       └── explanations/[wordId]/{route.ts, generate/route.ts}
│   ├── components/ card/ quiz/ ui/
│   ├── lib/
│   │   ├── db.ts                 # Drizzle neon-http client
│   │   ├── schema.ts             # 8 张表定义
│   │   ├── fsrs.ts / queue.ts / auth.ts / settings.ts
│   │   └── ai/ client.ts explain.ts persist.ts
│   └── middleware.ts
├── scripts/ build-wordlists.ts import-ecdict.ts build-relations.ts generate-explanations.ts ecdict/(gitignore)
└── .env.local.example
```

## 10. 实施里程碑（未开始，每步可独立验证）

| # | 里程碑 | 验证方式 |
|---|---|---|
| 1 | 骨架上线（create-next-app + Tailwind + manifest + Neon + Vercel 部署） | 手机"添加到主屏幕"可安装 |
| 2 | 词库预处理（schema + drizzle-kit push + build-wordlists / import-ecdict / build-relations，见第 5 章，仅跑 ielts） | SQL 抽查雅思词书词数与词条；漏词补齐抽查（aristocracy 必须出现在雅思词书中）；aristocracy↔aristocrat 关联可查 |
| 3 | GitHub OAuth 鉴权（可与 2 并行） | 白名单外账号 403；白名单内双端登录进度隔离互通 |
| 4 | AI 讲解管线（lib/ai + 批量脚本 + 兜底 API） | 50 词全 ready；改坏模型名验证 failed/retry |
| 5 | **学习核心 ⭐**（选词书 + /today + /study + 发音 + FSRS 评分） | 手机完整学 10 词；SQL 验证次日 due；卡片秒开 |
| 6 | 测验（三题型 + 判分写库） | 错词出现在当日复习尾部 |
| 7 | 统计页（纯 CSS 条形） | 与 SQL 手工核对 |
| 8 | 收尾（骨架屏兜底 + README + ECDICT 协议声明 + 全量生成） | Lighthouse PWA 通过；5000 词讲解成本对账 |

依赖：1←2←5；3∥2；4←2；5←4；6/7←5。关键路径 1→2→4→5，第 5 步完成产品即可用。

## 11. 风险与对策

1. **vercel.app 国内可达性不稳** → 必要时绑自有域名（~¥50/年）
2. **AI 编造词源** → prompt 强约束 + 允许"词源不详" + 支持换模型重生成 + 高频词人工抽校
3. **Neon 免费层 scale-to-zero 冷启动 ~500ms** → 可接受；HTTP driver 无连接池问题
4. **ECDICT tag 覆盖不全**（POC 已实证：aristocracy 漏标）→ 第 5 章预处理管线：权威词表交叉 + LLM 判类兜底；词表 JSON 版本化固化可复查
5. **pi 成熟度/TUI 相关风险** → 已随 TUI 方案废弃，不再适用
6. **BYOK 客户端直连的 CORS 不确定性**（DeepSeek 等国内 provider 可能无 CORS 头）→ M4 实测；统一降级流程：客户端直连失败自动转服务端代理（用户 key 内存中使用，体验无感，服务端仍零 LLM 成本）
7. **BYOK 共享缓存的搭便车**（用户 A 的 key 生成的讲解全局共享）→ 一期白名单熟人圈可接受；origin/generatedBy 字段审计 + 服务端 Zod 校验防垃圾数据

## 12. 后续阶段展望（非一期范围）

- 二期：AI 老师追问对话（卡片页内 chat，Vercel AI SDK useChat 流式）、语音口语练习（Qwen-Omni Realtime，见 RESEARCH.md）、离线数据层（serwist + IndexedDB + review_logs 回放合并）、真人发音音频预生成、打字练习模式（借鉴 my-ielts）
- 远期：更多学习目标（CET-6 / 托福 / 考研 / GRE，预处理管线传 `--deck` 参数零改码接入）、例句听力、多用户
