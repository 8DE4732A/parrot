# Parrot

AI 英语老师深度讲解的背单词 PWA。手机/PC 多端，云端同步。

> 设计文档：[概要设计](docs/DESIGN-PHASE1.md) · [详细设计](docs/DESIGN-PHASE1-DETAIL.md)（实施依据） · [技术调研](docs/RESEARCH.md)

## 架构一句话

**通用背单词引擎（本仓库 `src/`）+ 素材包（`materials/`，如雅思词书）**：引擎不感知具体考试，一切考试内容由本地流水线生产、校验后发布；LLM 讲解 BYOK（用户配置自己的 key，客户端直连调用，服务端默认零 LLM 成本）。

## 技术栈

Next.js (App Router) · TypeScript · TailwindCSS v4 · PWA · Neon Postgres + Drizzle ORM · ts-fsrs · Vercel AI SDK · Auth.js (GitHub OAuth)

## 本地开发

```bash
npm install
cp .env.local.example .env.local   # 按注释填写（本地 LLM 网关已预置）
npm run dev                        # http://localhost:3000
```

```bash
npm run lint && npm run typecheck && npm test   # 质量三件套（CI 同款）
npm run build                                   # 生产构建
```

## 素材流水线（M2 起）

```bash
# 详见 docs/DESIGN-PHASE1-DETAIL.md §3
# fetch-ecdict → build-wordlists → import-ecdict → build-relations
#   → generate-explanations → package-materials → publish-materials
npm run material:validate         # 素材包校验（CI 强制）
```

## 部署

Vercel（Hobby 免费额）+ Neon Postgres。`main` 分支 push 自动部署生产，PR 出 preview 链接。

## 许可与数据来源

- 代码：见 [LICENSE](LICENSE)
- 词库数据：[ECDICT](https://github.com/skywind3000/ECDICT)（开源），经预处理固化于 `materials/`
