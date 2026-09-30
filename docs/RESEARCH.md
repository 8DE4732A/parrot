# Parrot 实现思路调研报告

> 调研日期：2026-09-28。基于 INTENT.md 五项需求：终端工具、可配置 LLM/实时语音模型、学习目标（六级/雅思/托福）、进度云同步、基座 agent 扮演学习助手。

## 一、总体推荐架构

**技术栈：TypeScript / Node.js 单仓库（monorepo）**

```
┌─────────────────────────────────────────────────┐
│  TUI 层：Ink（或 pi-tui）                        │
│    聊天视图 / 练习视图 / 学习面板 / 配置向导       │
├─────────────────────────────────────────────────┤
│  Agent 层：pi-agent-core + pi-ai                │
│    学习助手 system prompt、结构化出题/判分工具、   │
│    会话持久化、多 provider 模型配置               │
├─────────────────────────────────────────────────┤
│  语音层（独立通道）：Qwen-Omni Realtime WebSocket │
│    麦克风采音 + Silero VAD + barge-in            │
├─────────────────────────────────────────────────┤
│  内容层：ECDICT 词库 + LLM 动态出题 + FSRS 复习   │
├─────────────────────────────────────────────────┤
│  数据层：本地 SQLite（进度唯一事实源）             │
│    同步：Turso embedded replica（备选 Gist）      │
└─────────────────────────────────────────────────┘
```

分层关键原则：**Agent 层与语音层解耦**。实时语音 API 都是独立的 WebSocket 通道，任何 agent SDK 都需要单独接语音层，因此文本对话（agent）和口语对话（realtime WS）共享用户进度与会话状态，但实现上互不阻塞。

## 二、各维度选型结论

### 1. 终端 UI —— 首选 Ink，备选 Textual

- **Ink（Node/TS，35k★）**：Claude Code、Gemini CLI、Copilot CLI 同款。与 TS 生态的 agent SDK 同生态，事件流 → React state 自然衔接，npm 分发最简。
- **Textual（Python）**：组件最全（内置 Markdown widget、CSS），但若选 TypeScript 技术栈则不适用。
- **已知坑**：Ink 默认全量清屏重绘，高频流式 token 下会闪烁——需 alternate buffer + incremental rendering，或 setState 节流（~30fps）。
- **备注**：若基座选 pi，其自带的 `pi-tui` 也是候选，可与 Ink 二选一（pi-tui 与 pi 生态一致性更好，Ink 组件生态更丰富）。

### 2. 基座 Agent —— 首选 pi（badlogic/pi-mono），备选 Vercel AI SDK

| 候选 | 多模型配置 | 结构化输出 | 会话持久化 | 结论 |
|---|---|---|---|---|
| **pi** (MIT, TS) | models.json 自定义 provider，OpenAI 兼容端点原生支持（qwen 直连） | TypeBox schema（出题/判分） | 内建 save/resume | ✅ 首选 |
| Vercel AI SDK | provider 目录最广 | 支持 | 自行实现 | 备选（agent runtime 偏薄、Web 导向） |
| Claude Agent SDK | 非 Claude 模型需网关且能力退化 | 支持 | 支持 | ❌ 为 coding agent 设计，ToS 商业许可 |
| Google ADK | 模型无关 | 支持 | 支持 | 仅当语音为第一优先级时重新考虑 |

pi 分层：`pi-agent-core`（通用 agent 框架，非 coding-agent 专属）+ `pi-ai`（15+ provider 统一抽象）+ `pi-tui`。四项需求（TUI + 多 provider + 结构化出题 + 语音独立层）全部正面命中。风险：版本 ~0.81，成熟度中等，需锁定版本并做好抽象隔离，便于日后换 Vercel AI SDK。

### 3. 实时语音 —— 主推 Qwen-Omni Realtime，Gemini Live 做调试

| 方案 | 接入 | 成本 | 国内可用性 |
|---|---|---|---|
| **Qwen-Omni Realtime**（qwen-omni-turbo-realtime） | `wss://dashscope.aliyuncs.com/api-ws/v1/inference`，OpenAI 兼容事件协议，服务端 VAD | 0.02/0.1 元每千 token（约 OpenAI 1/10~1/20） | ✅ 直连 |
| Gemini Live | WebSocket 直连，16kHz 入 / 24kHz 出 PCM | 免费层可用（限速） | ❌ 需代理，适合开发调试 |
| OpenAI Realtime | 同源事件协议 | ~$1.4–1.9/分钟 | ❌ 不建议主力 |

关键技术要点：
- 音频：16kHz PCM16 单声道输入；单会话上限 10 分钟，不存历史，多轮需客户端重传上下文
- VAD：本地用 **Silero VAD**（~2MB ONNX，CPU 实时）做断句与打断检测
- **barge-in**：播放回声期间持续跑 VAD，检测到用户语音即停播；兼容协议发 `input_audio_buffer.clear` + `response.cancel`
- 延迟预算 ~400ms（mic 20 + VAD 10 + ASR 150 + LLM 100 + TTS 100），TTS chunk 取 200–320ms
- **分阶段**：MVP 半双工（录音→ASR→文本→TTS 播放，`afplay`/`mpg123` 子进程最稳）；全双工 realtime 放二期
- 补充：realtime API 不给音素级反馈，发音纠错建议走「录音 → ASR 转写对比」管道（edge-tts + FunASR/whisper + LLM），作为第二档功能

### 4. 云同步 —— 首选 Turso，备选 Gist

| 方案 | 免费额度 | 国内访问性 | 结论 |
|---|---|---|---|
| **Turso**（libSQL） | 5GB / 5 亿行读每月 | GitHub 系域名相对可达 | ✅ 与本地 SQLite 同构，embedded replica 天然离线优先 |
| Gist | 零成本 | 可达 | 备选：PAT push/pull 单 JSON，MVP 最省事 |
| Cloudflare D1 | 10 万请求/天 | workers.dev 常被墙 | 可绑自有域名缓解 |
| Supabase | 500MB | 最差；免费层 7 天不活跃即暂停 | 多用户/Web 化后再考虑 |

架构：**本地 SQLite 是唯一事实源**，云端只是同步副本；离线优先，同步是后台低频任务（练习结束/启动时 push-pull）。

### 5. 内容体系 —— ECDICT 词库 + LLM 动态出题 + FSRS 复习

- **词库底座**：[ECDICT](https://github.com/skywind3000/ECDICT)（77 万词条，含 CET6/IELTS/TOEFL tag、音标、词频，可直接筛出目标词表转 JSON）+ [kajweb/dict](https://github.com/kajweb/dict)
- ⚠️ kajweb/wtp（TPO 真题）已 404（ETS 版权下架），勿依赖；雅思口语按 1/5/9 月换题季更新，静态题库维护性差 → **口语题走 LLM 按 Part 1/2/3 动态生成**
- **混合模式**：静态种子词表保证覆盖 + LLM 动态生成练习题保证新鲜度；Item 带 `source: static | llm` 标记
- 数据结构：`Goal(CET6/IELTS/TOEFL) → Unit/题型 → Item(vocab/listening/reading/speaking)`
- **SRS**：直接用官方 [open-spaced-repetition](https://github.com/open-spaced-repetition) 实现（TS 栈用 `ts-fsrs`），FSRS 已是 Anki 默认算法，勿自研 SM-2

## 三、建议实施阶段

| 阶段 | 内容 |
|---|---|
| **P0 骨架** | TS monorepo + Ink TUI + pi agent（文本对话）+ SQLite 本地存储 + 多 provider 配置（`parrot config`） |
| **P1 学习功能** | 目标选择（六级/雅思/托福）+ ECDICT 词表导入 + LLM 出题/判分（TypeBox schema）+ ts-fsrs 每日复习 |
| **P2 语音 MVP** | 半双工口语练习：录音→ASR→agent 对话→TTS 播放 |
| **P3 实时语音** | Qwen-Omni Realtime WebSocket 全双工 + Silero VAD + barge-in |
| **P4 云同步** | Turso embedded replica（或先 Gist JSON 快照）多设备同步 |

## 四、主要风险

1. **pi 成熟度**（~0.81）：在 agent 层做薄抽象隔离，保留换 Vercel AI SDK 的退路
2. **Ink 流式渲染闪烁**：预留 incremental rendering / 节流方案
3. **终端音频跨平台**：录音依赖 PortAudio 绑定（原生编译），播放 MVP 先用系统播放器子进程兜底
4. **版权**：TPO/雅思真题库不可用，内容以「词表 + LLM 生成」为主规避版权风险

## 附：主要来源

- https://github.com/badlogic/pi-mono ｜ https://code.claude.com/docs/en/agent-sdk ｜ https://vercel.com/ai
- https://help.aliyun.com/zh/model-studio/qwen-omni-realtime ｜ https://ai.google.dev/gemini-api/docs/live ｜ https://platform.openai.com/docs/guide/realtime
- https://github.com/skywind3000/ECDICT ｜ https://github.com/kajweb/dict ｜ https://github.com/open-spaced-repetition/ts-fsrs
- https://turso.tech/pricing ｜ https://supabase.com/pricing ｜ https://developers.cloudflare.com/d1/platform/pricing
- 终端 UI 参考：https://claude-code-from-source.com/ch13-terminal-ui/ ｜ https://github.com/streampunk/naudiodon
