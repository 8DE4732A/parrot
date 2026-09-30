"use client";

import { useEffect, useState } from "react";

interface Stats {
  todayDone: number;
  streakDays: number;
  deckProgress: { slug: string; name: string; learned: number; total: number }[];
  dueNext7Days: number[];
  quizAccuracyByType: Record<string, { correct: number; total: number }>;
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats);
  }, []);

  if (!stats) {
    return <main className="flex flex-1 items-center justify-center text-neutral-400">加载中…</main>;
  }

  const maxDue = Math.max(1, ...stats.dueNext7Days);
  const days = ["今天", "明天", ...Array.from({ length: 5 }, (_, i) => `+${i + 2}天`)];

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold">学习统计</h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 p-4 text-center">
          <div className="text-3xl font-bold text-teal-700">{stats.todayDone}</div>
          <div className="mt-1 text-xs text-neutral-500">今日复习</div>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 text-center">
          <div className="text-3xl font-bold text-amber-600">{stats.streakDays} 🔥</div>
          <div className="mt-1 text-xs text-neutral-500">连续打卡</div>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-neutral-500">词书进度</h2>
      <div className="mt-2 space-y-3">
        {stats.deckProgress.map((d) => (
          <div key={d.slug} className="text-sm">
            <div className="flex justify-between">
              <span>{d.name}</span>
              <span className="text-neutral-400">
                {d.learned} / {d.total}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded bg-neutral-100">
              <div
                className="h-1.5 rounded bg-teal-600"
                style={{ width: `${d.total ? (d.learned / d.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
        {stats.deckProgress.length === 0 && <p className="text-sm text-neutral-400">暂无激活词书</p>}
      </div>

      <h2 className="mt-8 text-sm font-semibold text-neutral-500">未来 7 天到期</h2>
      <div className="mt-2 flex h-24 items-end gap-2">
        {stats.dueNext7Days.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-teal-600/80"
              style={{ height: `${(n / maxDue) * 80}px`, minHeight: n > 0 ? 4 : 1 }}
            />
            <span className="text-[10px] text-neutral-400">{days[i]}</span>
            <span className="text-[10px] font-medium">{n}</span>
          </div>
        ))}
      </div>

      {Object.keys(stats.quizAccuracyByType).length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-neutral-500">测验正确率</h2>
          <div className="mt-2 space-y-1 text-sm">
            {Object.entries(stats.quizAccuracyByType).map(([type, { correct, total }]) => (
              <div key={type} className="flex justify-between">
                <span className="text-neutral-600">
                  {{ choice: "选择", spell: "拼写", cloze: "填空" }[type] ?? type}
                </span>
                <span className="font-medium">
                  {total ? Math.round((correct / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
