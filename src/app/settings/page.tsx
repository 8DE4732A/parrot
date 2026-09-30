"use client";

import { useEffect, useState } from "react";

interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string | null;
}

export default function SettingsPage() {
  const [llm, setLlm] = useState<LlmConfig | null>(null);
  const [retention, setRetention] = useState(0.9);
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.llm) setLlm(d.llm);
        if (d.fsrs?.requestRetention) setRetention(d.fsrs.requestRetention);
      });
  }, []);

  async function save() {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        llm: {
          provider: "openai-compatible",
          baseUrl: llm?.baseUrl ?? "",
          model: llm?.model ?? "",
          apiKey: apiKey || undefined, // 留空则保留原 key
        },
        fsrs: { requestRetention: retention },
      }),
    });
    setApiKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    const d = await fetch("/api/settings").then((r) => r.json());
    if (d.llm) setLlm(d.llm);
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold">设置</h1>

      <section className="mt-6 rounded-xl border border-neutral-200 p-4">
        <h2 className="font-semibold">我的 LLM（BYOK）</h2>
        <p className="mt-1 text-xs text-neutral-500">
          配置你自己的模型 key，讲解生成与后续 AI 对话将直接从你的浏览器调用，费用走你的账户。
        </p>
        <label className="mt-4 block text-xs text-neutral-500">API Base URL（OpenAI 兼容）</label>
        <input
          value={llm?.baseUrl ?? ""}
          onChange={(e) => setLlm({ ...(llm ?? { provider: "openai-compatible", model: "", apiKeyMasked: null }), baseUrl: e.target.value })}
          placeholder="如 https://api.deepseek.com/v1"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <label className="mt-3 block text-xs text-neutral-500">模型名</label>
        <input
          value={llm?.model ?? ""}
          onChange={(e) => setLlm({ ...(llm ?? { provider: "openai-compatible", baseUrl: "", apiKeyMasked: null }), model: e.target.value })}
          placeholder="如 deepseek-chat"
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <label className="mt-3 block text-xs text-neutral-500">
          API Key {llm?.apiKeyMasked && <span className="text-neutral-400">(当前 {llm.apiKeyMasked})</span>}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={llm?.apiKeyMasked ? "留空保持不变" : "sk-..."}
          className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </section>

      <section className="mt-4 rounded-xl border border-neutral-200 p-4">
        <h2 className="font-semibold">复习参数</h2>
        <label className="mt-3 block text-xs text-neutral-500">
          目标记忆率：{Math.round(retention * 100)}%（越高复习越频繁）
        </label>
        <input
          type="range"
          min={0.8}
          max={0.97}
          step={0.01}
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
          className="mt-2 w-full accent-teal-700"
        />
      </section>

      <button onClick={save} className="mt-6 w-full rounded-xl bg-teal-700 py-3 font-medium text-white">
        {saved ? "已保存 ✓" : "保存设置"}
      </button>
    </main>
  );
}
