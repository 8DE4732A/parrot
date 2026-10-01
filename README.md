# Parrot

AI 英语老师深度讲解的背单词 PWA。手机/PC 多端，云端同步。

> 在线使用：**https://parrot.liuping.win**（GitHub 登录，白名单制）
>
> 设计文档：[概要设计](docs/DESIGN-PHASE1.md) · [详细设计](docs/DESIGN-PHASE1-DETAIL.md)（实施依据） · [技术调研](docs/RESEARCH.md)

## 架构一句话

**通用背单词引擎（本仓库 `src/`）+ 素材包（`materials/`，如雅思词书）**：引擎不感知具体考试，一切考试内容由本地流水线生产、校验后发布；LLM 讲解 BYOK（用户配置自己的 key，客户端直连调用，服务端默认零 LLM 成本）。

```
浏览器（PWA）──> Vercel（Next.js 引擎）──> Neon Postgres（素材域 + 用户域）
     │                  │
     └── BYOK 客户端直连 LLM          └── 本地流水线 ── publish ──> 素材域
```

## 功能（一期：雅思）

- **每日学习**：FSRS 间隔复习调度 + 新词分配，四键评分
- **AI 深度讲解卡片**：词根词缀拆解 / 地道例句（听力·阅读·口语三语境）/ 同根衍生词（可点击跳转）/ 近义辨析 / 记忆法——词表预处理后全量预生成，卡片秒开
- **测验**：选择 / 听音拼写 / 例句填空三题型，错词自动回炉
- **多端同步**：进度全在云端，手机/PC 实时一致
- **BYOK**：设置页配置自己的 LLM（OpenAI 兼容协议，key 加密存储），兜底生成与后续 AI 对话走自己的账户
- 发音：浏览器 Web Speech API（英式），预生成真人音频留二期

## 技术栈

Next.js (App Router) · TypeScript · TailwindCSS v4 · PWA · Neon Postgres + Drizzle ORM · ts-fsrs · Vercel AI SDK · Auth.js (GitHub OAuth + 白名单)

## 本地开发

```bash
npm install
cp .env.local.example .env.local   # 按注释填写
npm run dev                        # http://localhost:3000
```

本地无 `DATABASE_URL` 时自动使用 PGlite 嵌入式库（`.pglite/`）；配置后走 Neon。

```bash
npm run lint && npm run typecheck && npm test   # 质量三件套（CI 同款）
npm run build                                   # 生产构建
```

## 素材流水线（本地生产 → 发布）

一期雅思词书已生成完毕（6321 词，讲解 100%）。新增考试词书流程：

```bash
# 0. 下载 ECDICT（github.com/skywind3000/ECDICT releases 的 sqlite 包）
#    放置 scripts/.work/stardict.db；外部词书 JSON 放 scripts/.work/kajweb-<deck>.json
npx tsx scripts/build-wordlists.ts --deck <slug>     # 1. 词表固化（tag+频率过滤+外部词表+LLM 判类）
npx tsx scripts/import-ecdict.ts --deck <slug>       # 2. 清洗 → words.json
npx tsx scripts/build-relations.ts --deck <slug>     # 3. 词形关联
npx tsx scripts/generate-explanations.ts             # 4. AI 讲解（断点续跑，100% ready 为门槛）
npx tsx scripts/package-materials.ts                 # 5. 打包 + 六条规则校验
npx tsx scripts/publish-materials.ts <slug>          # 6. 发布到 Neon（幂等）
npm run material:validate                            # CI 同款校验
```

数据来源：[ECDICT](https://github.com/skywind3000/ECDICT)（开源词库）+ kajweb/dict 词书交叉 + LLM 判类补漏。词表产物版本化提交于 `materials/`。

## 部署

- **Vercel**（Hobby 免费额）：`vercel link` → 环境变量（9 个，见 `.env.local.example`）→ `vercel deploy --prod`
- **Neon**：`npx drizzle-kit push` 建表 → `npx tsx scripts/publish-materials.ts ielts` 发布素材
- **自定义域名**：`vercel domains add <domain> parrot` → DNS 加 CNAME（指向 `cname.vercel-dns.com`，Cloudflare 需灰云 DNS only）→ `vercel domains verify`
- **GitHub OAuth**：Settings → Developer settings → OAuth Apps，callback `https://<域名>/api/auth/callback/github`
- 注意：`.vercelignore` 已排除素材原始数据（100MB 上传限制）

## 许可与数据来源

- 代码：见 [LICENSE](LICENSE)
- 词库数据：[ECDICT](https://github.com/skywind3000/ECDICT)（开源），经预处理固化于 `materials/`
