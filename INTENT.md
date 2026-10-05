# Parrot 项目意图（2026-10 更新）

**Parrot** 是一个 AI 英语老师背单词应用：对每个单词给出百词斩类工具没有的深度讲解——词根词缀拆解、同根衍生词、考试语境例句、近义辨析、联想记忆法。

## 当前形态（一期已上线）

- **PWA 多端**（手机可安装到主屏 + PC），GitHub OAuth 白名单登录，进度云端同步
  在线地址：https://parrot.liuping.win
- **架构一句话**：通用背单词引擎（`src/`，不感知具体考试）+ 素材包（`materials/`，本地流水线生产、校验后发布到 Neon）
- **一期目标**：雅思词书（6322 词，AI 讲解 100% 预生成，英美双音标/双口音发音）
- **LLM BYOK**：用户配置自己的模型 key（加密存储），讲解兜底生成走自己的账户，服务端默认零 LLM 成本
- 技术栈：Next.js (App Router) · Neon Postgres + Drizzle · ts-fsrs 间隔复习 · Vercel AI SDK · Vercel 部署

## 历史沿革

- 最初构想为终端 TUI 工具（含 qwen omni / Gemini Live 实时语音对话、pi/Claude Agent SDK 基座），2026-09-29 调整为 PWA，实时语音等能力列入后续阶段
- 完整决策过程见 `docs/RESEARCH.md`（技术调研）与 `docs/DESIGN-PHASE1.md` / `docs/DESIGN-PHASE1-DETAIL.md`（概要/详细设计）

## 后续规划（见设计文档 §12）

AI 老师追问对话、语音口语练习（Qwen-Omni Realtime）、更多学习目标（六级/托福，流水线加数据即可）、打字练习模式
