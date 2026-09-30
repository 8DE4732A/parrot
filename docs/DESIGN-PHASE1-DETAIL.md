# Parrot 详细设计（一期：雅思）

> 版本：v1.0（2026-09-29）
> 上游文档：`docs/DESIGN-PHASE1.md`（概要设计）、`docs/RESEARCH.md`（技术调研）
> 本文档是实施依据，覆盖：架构原则、素材包规范、素材生产流水线、数据库 DDL、API 契约、前端组件设计、AI 生成规范、FSRS 集成、部署与 CI、任务分解。

---

## 1. 架构原则：程序与素材分离

**核心思想：程序是通用背单词引擎，不感知任何具体考试；一切考试相关内容都是「素材包」（Material Package）数据。**

```
┌───────────────────────────────────────────────────────────┐
│  引擎（src/，通用，不含考试字样）                            │
│  Next.js PWA + Drizzle + ts-fsrs + Vercel AI SDK           │
│  只认 schema，不认 'ielts'/'cet6' —— 渲染什么由 DB 数据决定  │
├───────────────────────────────────────────────────────────┤
│  素材域（materials/，本地生产 → 校验 → 发布）               │
│  materials/ielts/   ← 一期唯一素材包                        │
│  materials/<slug>/  ← 未来新增考试 = 新增目录，引擎零改动    │
├───────────────────────────────────────────────────────────┤
│  线上数据库（Neon）                                         │
│  素材域表 ← publish 覆盖写入                                │
│  用户域表 ← 运行时写入，永不覆盖                             │
└───────────────────────────────────────────────────────────┘
```

**分离带来的硬约束**（写进 CI 检查）：

1. `src/` 目录源码中不得出现任何素材 slug 字面量（`ielts`、`cet6`、`toefl` 等），CI 用 grep 检查
2. 词书列表、词书元信息（名称/描述/每日新词默认值）全部来自 `decks` 表数据驱动
3. 素材包必须通过 Zod schema 校验才能发布，schema 是素材与引擎之间的唯一契约
4. 引擎对素材内容不做任何业务假设（如"雅思要考同义替换"），内容特性由素材数据本身承载

---

## 2. 素材包规范（Material Package Spec v1）

### 2.1 目录结构

```
materials/
├── schema/                      # 素材包 Zod schema（引擎与素材共享的唯一契约）
│   ├── manifest.ts
│   ├── word.ts
│   ├── relation.ts
│   ├── explanation.ts
│   └── index.ts                 # validatePackage() 入口
└── ielts/                       # 一期唯一素材包（产物全部提交仓库）
    ├── manifest.json            # 包描述 + 校验和
    ├── words.json               # 词条
    ├── relations.json           # 词族关联
    └── explanations.json        # AI 讲解缓存
```

**产物提交仓库**：素材包是版本化的数据资产（词表可复查、可 diff、可回滚），不放在 .gitignore。ECDICT 原始数据（812MB DB）不进仓库，流水线脚本可重复下载。

### 2.2 manifest.json

```jsonc
{
  "schemaVersion": 1,                    // 素材包规范版本，引擎按此兼容
  "deck": {
    "slug": "ielts",                     // 全局唯一，^[a-z0-9-]{2,32}$
    "name": "雅思核心词汇",
    "description": "基于 ECDICT 雅思词表 + 权威大纲补漏",
    "exam": "IELTS",                     // 展示用
    "defaultDailyNewLimit": 10,          // 词书级默认，用户可改
    "order": 1                           // 词书展示排序
  },
  "wordCount": 5102,
  "generator": {                         // 生产溯源
    "ecdictVersion": "1.0.28",
    "wordlistSources": ["ecdict:tag:ielts", "kajweb-dict:ielts", "llm:judged"],
    "llmModel": "deepseek-chat",
    "generatedAt": "2026-10-01T00:00:00Z"
  },
  "files": {                             // 内容哈希，publish 前校验完整性
    "words.json": "sha256:...",
    "relations.json": "sha256:...",
    "explanations.json": "sha256:..."
  }
}
```

### 2.3 words.json —— WordEntry

```ts
// materials/schema/word.ts
const InflectionsSchema = z.object({
  plural: z.string().optional(),      // s:
  past: z.string().optional(),        // p:
  pastParticiple: z.string().optional(), // d:
  presentParticiple: z.string().optional(), // i:
  thirdPerson: z.string().optional(), // 3:
  comparative: z.string().optional(), // r:
  superlative: z.string().optional(), // t:
  lemma: z.string().optional(),       // 0:/1: 还原为原形
});

const WordEntrySchema = z.object({
  word: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z'-]*$/),  // 必须以字母开头，禁专名/数字
  phonetic: z.string().optional(),      // ECDICT 音标（可能缺）
  translation: z.string().min(1),       // 中文释义（必填，缺失即校验失败）
  definition: z.string().optional(),    // 英文释义
  pos: z.string().optional(),           // 如 "n:100/v:30"（ECDICT 带词频占比）
  frequency: z.object({                 // 词频，例句难度控制 + 词书内新词顺序
    bnc: z.number().int().optional(),   // BNC 语料排名
    frq: z.number().int().optional(),   // 当代美语语料排名
  }).optional(),
  inflections: InflectionsSchema.optional(), // exchange 解析产物
  source: z.enum(['ecdict-tag', 'external-list', 'llm-judged']),  // 词表来源，审计用
});

// 全包约束：word 唯一、按 frequency 排序（队列新词顺序依赖此排序）
```

### 2.4 relations.json —— RelationEntry

```ts
const RelationEntrySchema = z.object({
  word: z.string(),                     // 须在 words.json 中（外键约束）
  related: z.string(),
  relation: z.enum(['inflection']),     // v1 只有确定性关联（来自 exchange 解析）
});
// 'derivative' 关联 v1 不进素材包：由线上 AI 讲生成后回链 DB（见 §7.4）
// 校验规则：word 与 related 都必须存在于 words.json；不允许自关联；双向各存一行
```

### 2.5 explanations.json —— ExplanationEntry

```ts
const ExplanationEntrySchema = z.object({
  word: z.string(),                     // 须在 words.json 中
  model: z.string(),                    // 生成模型，审计/重生成依据
  status: z.literal('ready'),           // 素材包只收 ready；failed 不打包
  content: ExplanationContentSchema,    // 见 §7.2（etymology/derivatives/examples/synonyms/mnemonic）
  tokens: z.object({ prompt: z.number(), completion: z.number() }).optional(),
});
// 全包约束：word 唯一；一期要求覆盖率 100%（发布门槛，见 2.6）
```

### 2.6 校验规则清单（`validatePackage()`，CI 强制）

| # | 规则 |
|---|---|
| 1 | 所有 JSON 通过对应 Zod schema |
| 2 | manifest.files 的 sha256 与实际文件一致 |
| 3 | words.json 内 word 唯一；`translation` 非空；无专名（首字母大写且非句首词）、无短语（含空格的词条标 warning 允许豁免清单） |
| 4 | relations/explanations 中的 word 均存在于 words.json |
| 5 | explanations 覆盖率 = 100%（一期雅思门槛；未来大词书可降为"前 N 高频 100%"，阈值进 manifest） |
| 6 | schemaVersion 为引擎支持的版本，否则拒绝发布 |

---

## 3. 素材生产流水线（本地开发环境）

### 3.1 流水线总览

```
[下载]     [词表固化]      [清洗入库格式]     [词形关联]      [AI 讲解]      [打包校验]      [发布]
ECDICT ──→ build-       ──→ import-       ──→ build-      ──→ generate-  ──→ package+    ──→ publish-
SQLite     wordlists         ecdict            relations      explanations   validate       materials
(一次性)   (ielts)                                                                    │
                                                                                        ▼
                                                                                   线上 Neon DB（素材域表）
```

每一步是独立脚本，产物落 `materials/ielts/` 或 `scripts/.work/`（中间产物，gitignore），支持断点重跑。

### 3.2 各步骤详细设计

**Step 0 下载** `fetch-ecdict.ts`
- 下载 release 1.0.28 SQLite 包到 `scripts/.work/stardict.db`（812MB，已有 /tmp 缓存可复用），记录版本号进 manifest

**Step 1 词表固化** `build-wordlists.ts --deck ielts`
1. ECDICT `tag LIKE '%ielts%'` → 基础集（5040 词）
2. **频率下限过滤（POC 实证必要）**：剔除 BNC 前 3000 的基础词（ielts tag 里混入了 `in/get/make` 等 1443 个初中级词，不进背单词队列；阈值进 manifest 可调）
3. 外部权威雅思词表交叉（kajweb/dict 雅思词表等）→ 并集
4. 漏词挖掘（POC 实证必要：`sustainable/biodiversity/urbanisation/demographic/renewable` 等雅思学术高频词均无 ielts tag）：BNC/COCA 高频（如前 15000）且无 tag 的词 → 专名/感叹词黑名单过滤 → LLM 批量判类（prompt："该词是否属于雅思学术/生活场景词汇范围？输出 yes/no + 理由"，100 词/批）
5. 产物：`scripts/.work/ielts-wordlist.json`（word → source 映射），人工 review 后固化

**Step 2 清洗** `import-ecdict.ts --deck ielts`
- 按 wordlist 从 ECDICT 抽取 → 字段清洗（translation 格式化、pos 保留、audio 弃用）→ exchange 解析为 inflections → 按 `frq` 升序排序（词频高的排前 = 新词先学高频）→ 产出 `materials/ielts/words.json`
- **音标补齐（POC 实测 95.1% 覆盖）**：缺音标的 246 词几乎全为复数/短语类——复数/屈折形式经 inflections.lemma 还原到原形词取音标；还原不到的短语类词直接过滤。音标仅一套（英式为主），英美差异留给 AI 讲解补充，不加字段

**Step 3 词形关联** `build-relations.ts --deck ielts`
- 遍历 inflections，若变化形式也在 words.json 中则建双向 `inflection` 关联 → `relations.json`
- 明确不做字符串相似/前缀挖掘（POC 实证噪音大）

**Step 4 AI 讲解** `generate-explanations.ts --deck ielts`（详见 §7）
- 对 wordlist 全量词生成讲解，断点续跑（已有 ready 的跳过）→ `explanations.json`；要求 100% ready 才停

**Step 5 打包校验** `package-materials.ts`
- 汇集四个文件 → 计算 sha256 写入 manifest → 调 `validatePackage()` 全量校验 → 输出包体积报告

**Step 6 发布** `publish-materials.ts --deck ielts`
- 读素材包 → 校验 → 单事务 upsert 线上 DB：
  - `decks`：按 slug upsert 元信息
  - `words`：按 word upsert（保留已有 id，新增插入；**不删除**——孤儿词无副作用）
  - `deck_words`：重建该 deck 的全量映射（delete + insert，事务内）
  - `word_relations`、`word_explanations`：按 word upsert
    - 覆盖边界：`word_explanations` 仅覆盖 `origin='pipeline'` 的行；`origin='client'/'server'`（用户在线生成）的行**不覆盖**——素材包版本更新不冲掉用户已生成的内容
- 幂等：重复运行结果一致；发布完成打印统计（新增/更新/跳过词数）
- **用户域表零接触**：publish 只写素材域表（见 §4.1），card_progress 等用户数据永不触碰

---

## 4. 数据库 Schema（DDL 级）

### 4.1 素材域 / 用户域划分

| 域 | 表 | 写入者 |
|---|---|---|
| **素材域** | decks, words, deck_words, word_relations, word_explanations | 仅 `publish-materials.ts`（线上兜底生成也会写 word_explanations） |
| **用户域** | users, user_decks, card_progress, review_logs, quiz_records, user_settings | 仅运行时 API |

### 4.2 表定义（Drizzle pgTable）

```ts
// ---- 素材域 ----
decks:      id serial pk, slug text unique not null, name text not null,
            description text, exam text, defaultDailyNewLimit int default 10,
            displayOrder int default 0, createdAt timestamptz default now()
            // displayOrder 避免 SQL 保留字 order；对应 manifest.deck.order

words:      id serial pk, word text unique not null, phonetic text,
            translation text not null, definition text, pos text,
            bnc int, frq int, inflections jsonb, source text,
            createdAt timestamptz default now()
            // 索引: idx_words_word (word)  ← unique 已覆盖

deck_words: deckId int fk→decks.id onDelete cascade, wordId int fk→words.id,
            ord int not null,                          // 词书内顺序（= 词频序）
            pk(deckId, wordId)
            // 索引: idx_deck_words_deck_ord (deckId, ord)  ← 新词分配查询

word_relations: id serial pk, wordId fk, relatedWordId fk,
            relation text not null,                    // 'inflection'（素材包发布）| 'derivative'（AI 回链，见 §7.4）
            pk(wordId, relatedWordId)
            // 索引: idx_relations_related (relatedWordId)  ← 反向查"哪些词与我同族"

word_explanations: id serial pk, wordId int unique fk, model text not null,
            status text not null default 'pending',    // pending|ready|failed
            content jsonb, promptTokens int, completionTokens int,
            origin text default 'pipeline',            // pipeline|client|server（本地管线/用户客户端/服务端代理）
            generatedBy int fk→users.id nullable,      // client/server 来源时记录是哪个用户的 key
            retryCount int default 0, lastError text, generatedAt timestamptz

// ---- 用户域 ----
users:      id serial pk, githubId text unique not null,   // GitHub 数字 id（字符串存）
            githubLogin text not null,                     // GitHub username，白名单匹配用
            name text, avatarUrl text, createdAt timestamptz default now()
            // 首次登录 upsert by githubId；所有用户域表挂 userId

user_decks: userId fk, deckId fk, dailyNewLimit int not null default 10,
            active boolean default true, addedAt timestamptz default now(),
            pk(userId, deckId)

card_progress: userId fk, wordId fk,
            state smallint not null default 0,         // 0New 1Learning 2Review 3Relearning
            due timestamptz not null, stability real default 0, difficulty real default 0,
            elapsedDays int default 0, scheduledDays int default 0,
            reps int default 0, lapses int default 0, lastReview timestamptz,
            pk(userId, wordId)
            // 索引: idx_card_progress_user_due (userId, due)  ← 每日队列核心索引

review_logs: id serial pk, userId fk, wordId fk, grade smallint not null,
            state smallint, due timestamptz, stability real, difficulty real,
            elapsedDays int, scheduledDays int, reviewedAt timestamptz default now,
            source text default 'card'                 // card|quiz_choice|quiz_spell|quiz_cloze
            // 索引: idx_review_logs_user_time (userId, reviewedAt)  ← 统计页

quiz_records: id serial pk, userId fk, wordId fk, type text not null,
            question jsonb, answer text, correct boolean not null,
            durationMs int, createdAt timestamptz default now

user_settings: userId fk, key text not null, value jsonb not null,
               pk(userId, key)                             // per-user：llm / fsrs 配置
               // llm.value: { provider, baseUrl, model, apiKeyEnc }
               // fsrs.value: { requestRetention }
```

### 4.3 数据完整性约束

- 新学一个词必然先存在 `card_progress` 行（学习 API 内 insert，防重复出词）
- `review_logs` 只增不改（append-only），删除用户数据也保留（二期 optimizer 训练数据）
- publish 与运行时写入通过"域"隔离，天然无锁冲突

---

## 5. API 设计（契约级）

统一约定：鉴权经 middleware（见 §9）；响应错误格式 `{ error: { code, message } }`；素材数据只读走 GET。

### 5.1 认证（Auth.js v5 托管，自写代码极少）

```
GET  /api/auth/signin          → 跳转 GitHub OAuth 授权页（Auth.js 内置登录页可定制品牌）
GET  /api/auth/callback/github → 回调：Auth.js 完成 token 交换
                                 → signIn 回调中校验白名单（githubLogin ∈ ALLOWED_GITHUB_LOGINS）
                                 → 通过：upsert users(by githubId) → 签发 JWT session Cookie
                                    （HttpOnly; Secure; SameSite=Lax；默认 30 天）
                                 → 拒绝：返回错误页（403 NOT_ALLOWED）
POST /api/auth/signout         → 清 Cookie
```

后续请求的 userId 由 Auth.js `auth()` helper 在 middleware/server 侧取 session 解出。

### 5.2 词书与队列

```
GET /api/decks
  → 200 { decks: [{ slug, name, description, exam, wordCount,
                    active, dailyNewLimit, learnedCount, dueToday }] }

POST /api/decks          { slug: string, dailyNewLimit?: number }   // 激活词书
  → 200 { userDeck }   // 幂等，重复激活只更新 limit
  → 404 { DECK_NOT_FOUND }    // slug 不在素材域 → 引擎确实不认识，返回 404

GET /api/queue
  → 200 {
      reviews: [{ wordId, word, card: {...FSRS 字段},
                  explanation: {...content} | null }],     // 按 due 升序
      news:    [{ wordId, word, explanation: {...} | null }],  // 按词书 ord 升序，取 dailyNewLimit
      quizReady: number                                    // 可测验词数（已学且未测）
    }
  // 讲解内嵌随队列返回（20 卡 ≈ 20KB），一次请求拉全天数据，学习过程零加载
  // news 中的词若 explanation 非 ready → 前端显示骨架屏并调兜底接口
```

### 5.3 学习与测验

```
POST /api/review         { wordId: number, grade: 1|2|3|4, source?: string }
  → 200 { card: {...} }   // 评分后 FSRS 状态
  // 服务端流程：读 card_progress → toCard → scheduler.next(card, now, grade)
  //           → 事务写 card_progress + review_logs
  // 新词首学：无 card_progress 行时先 createEmptyCard 再评分（一个事务内完成）

GET  /api/quiz?count=10
  → 200 { questions: [{ id, wordId, type: 'choice'|'spell'|'cloze',
                        stem: {...}, options?: [...] }] }   // 不含答案
POST /api/quiz           { answers: [{ id, wordId, type, answer, durationMs }] }
  → 200 { results: [{ id, correct, correctAnswer }], correctCount }
  // 判分规则见 §6.3；每题写 quiz_records，答错词 grade=Again 写 review_logs(source=quiz_*)
  // 并把该词 due 拉到当前时间（立即进入今日复习）
```

### 5.4 讲解兜底与配置（BYOK 模式）

```
GET  /api/settings                        // 当前用户配置（llm provider/baseUrl/model + apiKey 掩码 sk-...abcd）
PUT  /api/settings                        // 保存配置；apiKey 服务端 AES-256-GCM 加密后入库，不落明文
GET  /api/settings/llm-key                // ★ 仅本人 session：解密返回明文 apiKey，供客户端直连 LLM 使用
POST /api/explanations/[wordId]           // ★ 客户端生成后提交结果
  body: { model, content, tokens? }
  → 服务端用 ExplanationContentSchema（§7.2）严格校验 → upsert 写共享缓存
    （origin='client', generatedBy=userId；校验失败 422 不写库）
  → 幂等：已 ready 则 409（避免覆盖管线生成的高质量内容）
POST /api/explanations/[wordId]/generate  // 服务端兜底（fallback，见 §7.6）
  → 200 { explanation }   // 解密用户 key 在内存中调用；用户未配 key 时用 DEFAULT_LLM_*
  → 429 { RATE_LIMITED }  // 10 req/min/IP
```

### 5.5 统计

```
GET /api/stats
  → 200 { todayDone, streakDays, deckProgress: [{ slug, learned, total }],
          dueNext7Days: [n1..n7], quizAccuracyByType }
```

---

## 6. 前端设计

### 6.1 路由与组件树

```
/ (page) ──redirect→ /today
/login            SignInButton（触发 Auth.js GitHub 登录）
/onboarding       DeckPicker（数据驱动渲染 decks 表内容）· DailyLimitSlider
/today            TodaySummary · StartButton · DeckProgressStrip
/study            StudySession
                    ├─ CardFront（word 大字 · phonetic · SpeakButton）
                    ├─ CardBack
                    │    ├─ MeaningSection        （ECDICT 释义）
                    │    ├─ EtymologySection      （parts 图形化：spec(看)+tacle+ar）
                    │    ├─ ExamplesSection       （3 句中英， SpeakButton）
                    │    ├─ DerivativesSection    （chips，可点击 → 跳词详情弹层）
                    │    ├─ SynonymsSection       （组内辨析 diff 文本）
                    │    ├─ MnemonicSection
                    │    └─ RatingButtons         （四键，标注预计间隔）
                    └─ SessionProgress（进度点 · 队列余量）
/quiz             QuizRunner
                    ├─ ChoiceQuiz · SpellQuiz · ClozeQuiz
                    └─ QuizResult（错词列表 → 一键重学）
/stats            StatCards · StreakBadge · DueBarChart（纯 CSS）· DeckProgress
/settings         LlmConfigForm · FsrsConfigForm · LogoutButton
```

### 6.2 状态与数据流

- 不引全局状态库：服务端数据用 React Server Components 直查 DB（/today、/stats）；交互态页面（/study、/quiz）用 Client Component + 本地 state，初始数据来自 `GET /api/queue`
- **评分流（乐观更新）**：点击评分键 → 本地立即切下一张 + pending 标记 → `POST /api/review` → 成功静默；失败 Toast + 该卡回队尾。学习会话本地维护队列数组，评分只改数组位置
- **讲解缺失兜底（BYOK 流程，§7.6）**：CardBack 对 `status!=='ready'` 的分区显示骨架 → 前端 `generateExplanation()`（客户端直连 → 失败自动降级服务端代理）→ 成功后本地替换展示
- 弱网策略：进入 /study 时预取整个队列（一次请求），学习中只有评分小请求，失败可重试不打断

### 6.3 测验判分规则

| 题型 | 出题 | 判分 |
|---|---|---|
| choice | 从已学词抽 N，干扰项取同词书 ord 相近的 3 词释义 | 答案精确匹配 |
| spell | 播发音 + 中文释义 → 输入 | 忽略大小写/首尾空格；`inflections` 命中视为正确；编辑距离 1 → 判错但提示"差一个字母" |
| cloze | 讲解例句挖掉目标词（例句含词形变化则挖变化形） | 同 spell，词形还原后比对 |

### 6.4 PWA 资产

- `manifest.json`：standalone、主题色、192/512 图标、`display_override: ["standalone"]`
- `sw.js`：仅 cache-first 缓存 `/_next/static/*` 与图标（版本化目录名天然失效）；API 请求永不缓存
- iOS 特殊处理：apple-touch-icon、`viewport-fit=cover`、safe-area padding

---

## 7. AI 讲解生成规范（BYOK：三个执行环境，共用一套 schema/prompt/回链）

### 7.1 三个执行环境

| 环境 | 运行位置 | 用的 key | 用途 |
|---|---|---|---|
| **管线脚本** | 本地开发机（`scripts/generate-explanations.ts`） | 开发者自己的（`DEFAULT_LLM_*`） | 素材包全量预生成（主力，5000 词 $5） |
| **客户端直连** ★ | 用户浏览器（Vercel AI SDK 本身可跑在浏览器，fetch 驱动） | 用户自己的（BYOK） | 学习中遇未 ready 词的兜底生成；二期 AI 对话流式 |
| **服务端代理** | Vercel Function（fallback） | 用户自己的（解密后仅内存使用）；未配 key 用 `DEFAULT_LLM_*` | 客户端 CORS 失败 / 未配 key 时的降级路径 |

- provider 配置 per-user 存 `user_settings`（加密）；`@ai-sdk/openai-compatible` 统一适配，三个环境同一套 `client.ts` 构造逻辑
- **服务端默认零 LLM 成本**：批量在本地、兜底用用户的 key；`DEFAULT_LLM_*` 仅在用户未配 key 时兜底，用量可忽略

### 7.2 讲解内容 Schema（与素材包共享 `materials/schema/explanation.ts`）

```ts
const ExplanationContentSchema = z.object({
  etymology: z.object({
    parts: z.array(z.object({
      part: z.string(),                    // "spect"
      type: z.enum(['prefix', 'root', 'suffix']),
      meaning: z.string(),                 // "看"
    })).min(1),
    story: z.string().min(10),             // 词源如何推出词义，一段话
  }),
  derivatives: z.array(z.object({
    word: z.string(), pos: z.string(), meaning: z.string(),
  })).min(3).max(8),
  examples: z.array(z.object({ en: z.string(), zh: z.string() })).length(3),
  synonyms: z.array(z.object({
    group: z.array(z.string()).min(2).max(4),
    diff: z.string(),                      // 中文可操作区分规则
  })).min(1).max(4),
  mnemonic: z.string().min(5),
});
```

### 7.3 Prompt（全文，三个执行环境共用，随代码分发）

```
System:
你是资深英语词汇老师，为备考 {exam}（由 deck.exam 字段注入）的学生生成单词深度讲解。
给定词条：word、音标、中文释义、英文释义、词性、词频、目标考试。
要求：
1. 词根词缀拆解必须词源学正确；不确定时 parts 给出最可信拆法并在 story 中明确"词源存在争议/不详"，禁止编造词源。
2. 例句 3 句：使用与给定词频匹配的地道表达，覆盖 {exam} 听力场景对话、阅读学术文本、口语表达三类语境各一；例句中必须自然包含目标词（允许合理词形变化）。
3. 近义辨析：聚焦中国学习者最易混淆的近义词，diff 必须给出可操作的区分规则（如"接动名词 vs 接不定式"），禁止空泛比较。
4. 记忆法优先基于已拆解的词根讲故事；无合适词根时才用谐音/联想。
5. 衍生词 3-8 个，按考试常用度排序。
6. 严格输出 JSON，符合给定 schema；中文释义/辨析用简体中文，例句用英文。
```

### 7.4 生成流程与 derivatives 回链

```
generateOne(word):
  1. 组装输入（word + ECDICT 字段 + exam）→ generateObject(schema, {prompt})
  2. 失败：Zod 报错信息追加 follow-up repair 重试 1 次；再失败 → status=failed + lastError
  3. 成功：upsert word_explanations(status='ready', content, tokens, model)
  4. 回链：content.derivatives[].word 逐一查 words 表
     → 命中：upsert word_relations(relation='derivative')（双向）
     → 未命中：跳过（chips 仍展示文本，点击弹层用讲解内释义）
```

- 批量脚本：并发 5、断点续跑（扫 status ∈ {缺行, pending, failed 且 retryCount<3}）、进度条、token 用量汇总
- **100% 覆盖是打包门槛**：跑完脚本若仍有 failed，人工 review lastError 后决定重跑或人工修 content

### 7.5 成本核算（5000 词）

- 输入 ~400 tok + 输出 ~900 tok = 1.3K/词 → 全量 6.5M tok ≈ **DeepSeek $5 一次**（管线脚本，开发者承担）
- 线上兜底生成：走 BYOK（用户自己的 key），平台方成本为零；`DEFAULT_LLM_*` 兜底占比可忽略

### 7.6 BYOK 与 CORS 兼容策略（客户端直连的核心约束）

**浏览器直连 LLM 的前提是 provider 支持 CORS**（响应无 `Access-Control-Allow-Origin` 则浏览器拒绝请求）：

| Provider | 浏览器直连 | 备注 |
|---|---|---|
| OpenAI / Gemini / OpenRouter | ✅ | 官方支持浏览器调用 |
| DeepSeek | ❓ 一期实测 | M4 验收项之一 |
| 阿里 DashScope 等国内 provider | ⚠️ 假定不支持 | 无 CORS 头先例 |

**统一降级流程**（前端封装 `generateExplanation()`）：

```
用户遇未 ready 词
  1. GET /api/settings/llm-key（本人解密取 key，内存缓存，不进 localStorage）
  2. 未配 key → 直接走 4（服务端代理，用 DEFAULT_LLM_*）
  3. 客户端直连 generateObject → 成功 → POST /api/explanations/[wordId] 提交（服务端 Zod 校验写库）
     ↘ 失败（CORS TypeError / 网络错误）→ 自动转 4
  4. 服务端代理 POST /api/explanations/[wordId]/generate：
     解密用户 key → 内存中调用 LLM → 校验写库 → 返回（key 用后即弃，不落日志）
```

- **共享缓存与审计**：讲解缓存全局共享，A 用户 key 生成的讲解 B 用户受益（一期白名单熟人圈可接受）；`origin` + `generatedBy` 字段记录来源供审计
- **防垃圾数据**：客户端提交的 content 必须通过 §7.2 schema 严格校验才写共享缓存；已 ready 的词拒绝覆盖（409）
- **key 安全边界**：key 明文只存在于 ① 用户浏览器内存（XSS 风险自担，个人项目接受）② 服务端代理调用的函数内存（用后即弃）；持久化只有密文

---

## 8. ts-fsrs 集成细节（`src/lib/fsrs.ts`）

```ts
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,       // user_settings 可调
  enable_fuzz: true,            // 同批词到期分散
  enable_short_term: false,     // 按天调度，跳过分钟级短期循环
}));
```

**DB ↔ Card 字段映射**：`toCard(row)` / `rowFromCard(card)` 双向转换（state/due/stability/difficulty/elapsedDays/scheduledDays/reps/lapses/lastReview 一一对应）；v5 的 `Card.due`/`last_review` 为 Date 对象，与 timestamptz 直接互转。

**评分状态转移**（`enable_short_term: false`）：

| 当前态 | 评分 | 结果 |
|---|---|---|
| New（首学） | 1-4 | → Learning（今天再排 1 次）或 Review（直接按天排期） |
| Learning/Review/Relearning | 1 Again | → Relearning，due = 明天或更近 |
| | 2 Hard / 3 Good / 4 Easy | → Review，due 按稳定度延长（"良好·3天"展示间隔） |

**每日队列 SQL 语义**：

```sql
-- 复习队列
SELECT * FROM card_progress
WHERE user_id = $1 AND state != 0 AND due <= date_trunc('day', now()) + interval '1 day'
ORDER BY due;
-- 新词分配（active 词书、按 ord、排除已学）
SELECT dw.* FROM deck_words dw
JOIN user_decks ud ON ud.deck_id = dw.deck_id AND ud.user_id = $1 AND ud.active
LEFT JOIN card_progress cp ON cp.word_id = dw.word_id AND cp.user_id = $1
WHERE cp.word_id IS NULL
ORDER BY ud.added_at, dw.ord
LIMIT (各词书 dailyNewLimit 之和);
```

**单元测试重点**（`src/lib/fsrs.test.ts`）：四态 × 四评分的转移矩阵快照；due 永不早于 reviewedAt；`enable_short_term:false` 下无分钟级 due。

---

## 9. 鉴权与安全

- **GitHub OAuth + Auth.js v5**：GitHub 上创建免费 OAuth App（callback URL `https://<domain>/api/auth/callback/github`）；Auth.js 用 JWT session（不引入 adapter 表，users 表由我们自己的 signIn 回调 upsert）
- **用户白名单**：`ALLOWED_GITHUB_LOGINS`（env，逗号分隔 GitHub username）。Auth.js `signIn` 回调校验：白名单内 → upsert users 建档放行；白名单外 → 403 拒绝。这是多人使用与防 LLM 接口滥用的唯一闸门，也是本方案的安全核心
- **middleware**：除 `/api/auth/*`、`/_next/*`、图标/manifest 等静态资源外全站校验 session；未登录 API 返回 401、页面 302 → `/api/auth/signin`
- **API key 安全（BYOK）**：user_settings 中 llm.apiKey 用 AES-256-GCM（key 由 `AUTH_SECRET` 派生）加密入库，服务端不落明文；GET /api/settings 只回掩码；明文仅经 `GET /api/settings/llm-key` 下发给**本人 session**（供客户端直连 LLM），服务端代理调用时解密进函数内存、用后即弃
- **限流**：讲解兜底生成接口内存限流 10 req/min/IP（白名单已挡陌生人，此处防自己误触）

---

## 10. 部署与 CI

### 10.1 环境变量（`.env.local.example`）

```
DATABASE_URL=            # Neon connection string
AUTH_SECRET=             # Auth.js 密钥（openssl rand -base64 32），兼作 API key 加密密钥源
AUTH_GITHUB_ID=          # GitHub OAuth App Client ID
AUTH_GITHUB_SECRET=      # GitHub OAuth App Client Secret
ALLOWED_GITHUB_LOGINS=   # 逗号分隔的 GitHub username 白名单
DEFAULT_LLM_PROVIDER=openai-compatible
DEFAULT_LLM_BASE_URL=    # 如 https://api.deepseek.com/v1
DEFAULT_LLM_MODEL=deepseek-chat
DEFAULT_LLM_API_KEY=
```

### 10.2 部署拓扑

- Vercel Hobby：Next.js 自动部署；`main` 分支 → production，PR → preview
- Neon：主分支 `main`（生产）+ `dev` 分支（本地开发指向，schema 变更先在 dev 验证）——`drizzle-kit push` 指向 dev，生产迁移用 `drizzle-kit generate` 产出 SQL 手动应用（一期表少，可接受）
- 域名：先用 vercel.app 默认域，国内不可达时再绑自有域名

### 10.3 CI（GitHub Actions）

```
ci.yml（PR + main push）:
  1. pnpm lint && pnpm typecheck
  2. pnpm test                    # vitest：fsrs/queue/material schema
  3. pnpm material:validate       # validatePackage() 校验 materials/ 全部包
  4. 引擎纯净性检查：! grep -riE "'(ielts|cet6|toefl)'" src/    # src 中禁素材字面量
deploy：Vercel Git 集成自动，CI 绿才允许 merge（branch protection）
```

---

## 11. 任务分解（里程碑 → 任务清单）

### M1 骨架上线（预计可独立验证）
- [ ] create-next-app（TS + App Router + Tailwind v4）+ ESLint/Prettier + vitest
- [ ] Vercel 项目创建、Neon 开通（main/dev 分支）、env 配置
- [ ] manifest.json + 图标 + sw.js + 空白 /today
- [ ] CI 三件套跑通
- ✅ 验收：手机打开 preview URL，添加到主屏幕可安装、二次打开有壳缓存

### M2 素材流水线（一期核心资产）
- [ ] Drizzle schema（9 表）+ drizzle-kit push（dev）
- [ ] `materials/schema/` 全部 Zod schema + `validatePackage()`
- [ ] 流水线 7 脚本（fetch → wordlists → import → relations → explanations → package → publish）
- [ ] 雅思素材包产出并通过校验（words 100% + explanations 100%）
- [ ] publish 到 dev 库
- ✅ 验收：SQL 抽查——aristocracy 在雅思词书中且词源讲解 ready；aristocracy↔aristocrat 双向关联可查；词数与 manifest 一致；重跑 publish 幂等（统计无 diff）

### M3 GitHub OAuth 鉴权与基础页面
- [ ] GitHub OAuth App 创建（dev/prod 各一套 callback）+ Auth.js v5 接入 + 白名单校验
- [ ] users 表 upsert（首次登录自动建档）+ middleware + 登出
- [ ] /onboarding（词书激活 + dailyNewLimit）+ /api/decks
- ✅ 验收：白名单外 GitHub 账号 403；白名单内两个账号在双端登录，进度相互隔离且各自多端一致

### M4 学习核心 ⭐
- [ ] /api/queue + /api/review + lib/queue.ts + lib/fsrs.ts（含单测）
- [ ] /study 全组件（CardFront/Back 六分区 + RatingButtons）
- [ ] BYOK 兜底链路：generateExplanation() 前端封装（客户端直连 → 服务端代理降级）+ POST 提交端点（Zod 校验写库）+ **DeepSeek CORS 实测**
- [ ] Web Speech 发音
- ✅ 验收：手机端完整学 10 新词 + 复习到期卡；断网重进进度不丢；讲解卡片秒开；SQL 核对次日 due 正确；故意删一条讲解验证 BYOK 兜底（客户端直连成功 → 拦截请求验证降级代理也成功）

### M5 测验
- [ ] /api/quiz GET/POST + 三题型组件 + 判分（含 inflections 容错）
- ✅ 验收：10 题混合测验；错词出现在当日复习尾部且 review_logs.source 正确

### M6 统计与设置
- [ ] /api/stats + /stats 页
- [ ] /settings 页 + GET/PUT /api/settings + GET /api/settings/llm-key（BYOK 配置：provider/baseUrl/model/apiKey 加密存取）
- ✅ 验收：统计数字与 SQL 手工核对一致；settings 保存后 DB 中为密文；llm-key 仅本人 session 可取、另一账号 403

### M7 收尾
- [ ] 讲解骨架屏与兜底全路径 + 错误边界
- [ ] README（部署指南 + 素材流水线使用说明 + ECDICT/词表来源声明）
- [ ] 发布到生产库 + 全量讲解生成对账
- ✅ 验收：Lighthouse PWA ≥ 90；生产 URL 端到端走完 M4-M6 全部验收项

依赖：M1 → M2 → M4 → M5/M6 → M7；M3 可与 M2 并行。**M2 + M4 是关键路径，完成即产品可用。**

---

## 12. 测试与质量策略

| 层 | 工具 | 范围 |
|---|---|---|
| 单元测试 | vitest | fsrs 状态转移矩阵、queue 队列计算、quiz 判分（含词形容错）、material schema 校验规则、auth 白名单校验与 users upsert |
| 素材校验 | `material:validate`（CI 强制） | §2.6 全部规则 |
| 数据验收 | SQL 脚本（`scripts/verify-*.sql`） | 各里程碑验收条款固化成脚本，可重复执行 |
| 端到端 | 手机真机手动清单 | 每个里程碑验收项 |
| 引擎纯净性 | CI grep | src/ 无素材字面量 |

---

## 附录 A：一个单词的端到端效果示例（aristocracy）

> 此词贯穿本项目全部关键环节：POC 时它是 tag 漏标实证（仅标 gre），预处理后进入雅思词书。讲解 JSON 为**模拟的期望 AI 输出样例**（正式内容由 §7 管线生成）。

### A.1 词条（words.json 条目 → words 表）

```jsonc
{
  "word": "aristocracy",
  "phonetic": "ˌærɪˈstɒkrəsi",            // ECDICT 原始 ".æri'stɒkrәsi" 经清洗规范化
  "translation": "n. 贵族，贵族统治；上层社会",
  "definition": "a privileged class holding hereditary titles",
  "pos": "n",
  "frequency": { "bnc": 8817, "frq": 13722 },
  "inflections": { "plural": "aristocracies" },
  "source": "llm-judged"                    // ★ tag 漏标词，Step 1 LLM 判类补进雅思词书
}
```

### A.2 AI 讲解（explanations.json 条目 → word_explanations.content）

```jsonc
{
  "word": "aristocracy",
  "model": "deepseek-chat",
  "status": "ready",
  "origin": "pipeline",
  "content": {
    "etymology": {
      "parts": [
        { "part": "aristo", "type": "root",   "meaning": "最佳（希腊 aristos）" },
        { "part": "cracy",  "type": "root",   "meaning": "统治、权力（希腊 kratos）" },
        { "part": "y",      "type": "suffix", "meaning": "名词后缀" }
      ],
      "story": "来自希腊语 aristokratia：aristos（最好的）+ kratos（权力），本义「由最优秀的人掌权」，后来指世袭贵族掌握权力的阶层与制度。"
    },
    "derivatives": [
      { "word": "aristocrat",   "pos": "n.",   "meaning": "贵族（个人）" },
      { "word": "aristocratic", "pos": "adj.", "meaning": "贵族的；气派讲究的" },
      { "word": "democracy",    "pos": "n.",   "meaning": "民主（demo 人民 + cracy）" },
      { "word": "autocracy",    "pos": "n.",   "meaning": "独裁（auto 自己 + cracy）" },
      { "word": "bureaucracy",  "pos": "n.",   "meaning": "官僚体制（bureau 办公室 + cracy）" },
      { "word": "meritocracy",  "pos": "n.",   "meaning": "精英管理制度（merit 功绩 + cracy）" }
    ],
    "examples": [
      { "en": "The old aristocracy enjoyed considerable influence over national politics.",
        "zh": "旧贵族阶层曾对国家政治拥有相当大的影响力。" },            // 听力场景
      { "en": "Britain's aristocracy lost much of its political power during the nineteenth century.",
        "zh": "19 世纪期间，英国贵族失去了大部分政治权力。" },            // 阅读学术
      { "en": "Some people argue that a new aristocracy of wealth has replaced the old one.",
        "zh": "有人认为一个新的财富贵族阶层已经取代了旧贵族。" }          // 口语表达
    ],
    "synonyms": [
      { "group": ["aristocracy", "nobility", "elite"],
        "diff": "aristocracy 强调世袭的贵族阶层或贵族统治制度；nobility 泛指贵族身份/高贵出身（更中性，可作称号集合）；elite 指任何领域的上层精英，不必然世袭——说「精英统治」用 meritocracy。辨析口诀：看血统用 aristocracy，看身份用 nobility，看实力用 elite。" },
      { "group": ["aristocracy", "democracy"],
        "diff": "同一 -cracy 词根的直接对照：aristocracy 少数「最优秀的人」统治，democracy（demo=人民）人民统治。写作中常用对比：aristocracy vs. democracy。"
      }
    ],
    "mnemonic": "词根记忆：aristo（最佳）+ cracy（统治）→「由最佳的人统治」→ 贵族统治/贵族阶层。一次记住整个 -cracy 家族：民主（demo）、独裁（auto）、官僚（bureau）、精英（merit）。"
  }
}
```

### A.3 衍生词回链（§7.4 自动执行）

derivatives 中 `aristocrat` / `aristocratic` 存在于 words 表 → 写入 `word_relations(derivative)` 双向关联；`democracy` 等若不在词书中则仅展示文本。用户点击卡片背面 chips：在词书中 → 跳该词卡片；不在 → 弹层显示讲解内释义。

### A.4 卡片渲染效果

**正面**（先自测）：

```
┌──────────────────────────────┐
│   3 / 20    ●●●○○○○○○○       │
│                              │
│       aristocracy            │
│     /ˌærɪˈstɒkrəsi/ 🔊       │
│                              │
│        [ 显示答案 ]           │
└──────────────────────────────┘
```

**背面**（垂直滑动）：

```
┌────────────────────────────────────────┐
│ aristocracy /ˌærɪˈstɒkrəsi/ 🔊         │
│ n. 贵族，贵族统治；上层社会              │ ← A.1 释义
├─ 词根拆解 ─────────────────────────────┤
│ aristo(最佳) + cracy(统治) + y          │
│ 来自希腊语 aristokratia……"由最优秀的    │ ← etymology
│ 人掌权"，后指世袭贵族阶层与制度。        │
├─ 地道例句 ─────────────────────────────┤
│ 1. The old aristocracy enjoyed…        │
│    旧贵族阶层曾对国家政治拥有…           │ ← 3 句，听力/阅读/口语各一
│ 2. Britain's aristocracy lost much…    │
│ 3. Some people argue that a new…       │
├─ 同根衍生 ─────────────────────────────┤
│ [aristocrat] [aristocratic] [democracy]│ ← chips，可点击
│ [autocracy] [bureaucracy] [meritocracy]│
├─ 近义辨析 ─────────────────────────────┤
│ aristocracy vs nobility vs elite:      │
│ 看血统用 aristocracy，看身份用          │ ← 可操作区分规则
│ nobility，看实力用 elite。              │
├─ 记忆法 ───────────────────────────────┤
│ aristo(最佳)+cracy(统治)→"由最佳的      │
│ 人统治"。一次记住 -cracy 家族…          │
├────────────────────────────────────────┤
│ [重来]  [困难]  [良好·1天]  [简单·4天]   │ ← FSRS 四键+预计间隔
└────────────────────────────────────────┘
```

### A.5 FSRS 状态流转（首学示例）

```
首学点击「良好」→ card_progress 建行：state=Learning, due=今天稍后（enable_short_term=false 按天粒度）
明日复习再点「良好」→ state=Review, due≈+3 天, stability 上升
隔 3 天点「简单」→ due≈+9 天 …… 间隔随记忆稳定度指数拉长
某次点「重来」→ state=Relearning, due=明天，lapses+1
```

### A.6 测验题示例（三题型各一）

| 题型 | 题面 | 判分 |
|---|---|---|
| choice | aristocracy 的意思是？ A. 贵族统治；贵族阶层 B. 官僚主义 C. 民主制度 D. 君主立宪（干扰项取自同词书近场景词） | 精确匹配 |
| spell | 🔊 播发音 +「n. 贵族，贵族统治」→ 输入拼写 | 输入 `aristocracy` ✅；`aristocrasy` 差 1 字母 → 判错但提示"差一个字母" |
| cloze | "Britain's ______ lost much of its political power during the nineteenth century."（讲解例句 2 挖空） | 词形还原后比对 |

测验数据写入 `quiz_records`（题目 JSON 快照）；答错 → 该词 due 拉回今天、review_logs 记 `source=quiz_*`。
