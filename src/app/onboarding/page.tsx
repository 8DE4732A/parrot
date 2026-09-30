"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface DeckInfo {
  slug: string;
  name: string;
  description: string | null;
  exam: string | null;
  wordCount: number;
  active: boolean;
  dailyNewLimit: number;
  learnedCount: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [limit, setLimit] = useState(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/decks")
      .then((r) => r.json())
      .then((d) => setDecks(d.decks ?? []));
  }, []);

  async function activate(slug: string) {
    setSaving(true);
    await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, dailyNewLimit: limit }),
    });
    setSaving(false);
    router.push("/today");
  }

  if (decks === null) {
    return <main className="flex flex-1 items-center justify-center text-neutral-400">加载中…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold">选择词书</h1>
      <p className="mt-2 text-sm text-neutral-500">选择学习目标，AI 老师会针对该考试生成讲解</p>

      <div className="mt-6 space-y-3">
        {decks.map((d) => (
          <div key={d.slug} className="rounded-xl border border-neutral-200 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{d.name}</h2>
              <span className="text-xs text-neutral-400">{d.exam}</span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">{d.description}</p>
            <p className="mt-2 text-xs text-neutral-400">
              {d.learnedCount} / {d.wordCount} 词已学
            </p>
            {d.active ? (
              <button
                onClick={() => router.push("/today")}
                className="mt-3 w-full rounded-lg bg-teal-700 py-2 text-sm font-medium text-white"
              >
                已激活 · 去学习
              </button>
            ) : (
              <button
                disabled={saving}
                onClick={() => activate(d.slug)}
                className="mt-3 w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "激活中…" : "开始使用"}
              </button>
            )}
          </div>
        ))}
        {decks.length === 0 && (
          <p className="text-sm text-neutral-400">暂无词书素材（需发布素材包后可见）</p>
        )}
      </div>

      <div className="mt-8">
        <label className="text-sm font-medium">每日新词数：{limit}</label>
        <input
          type="range"
          min={5}
          max={30}
          step={5}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="mt-2 w-full accent-teal-700"
        />
      </div>
    </main>
  );
}
