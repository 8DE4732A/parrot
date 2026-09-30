"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DeckInfo {
  slug: string;
  name: string;
  active: boolean;
  learnedCount: number;
  wordCount: number;
}

export default function TodayPage() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckInfo[] | null>(null);
  const [queue, setQueue] = useState<{ reviews: unknown[]; news: unknown[] } | null>(null);

  useEffect(() => {
    fetch("/api/decks")
      .then((r) => r.json())
      .then(async (d) => {
        const list: DeckInfo[] = d.decks ?? [];
        setDecks(list);
        if (list.some((x) => x.active)) {
          const q = await fetch("/api/queue").then((r) => r.json());
          setQueue({ reviews: q.reviews ?? [], news: q.news ?? [] });
        }
      });
  }, []);

  const loading = decks === null;
  const hasActive = decks?.some((d) => d.active) ?? false;
  const dueCount = queue?.reviews.length ?? 0;
  const newCount = queue?.news.length ?? 0;
  const total = dueCount + newCount;

  if (loading) {
    return <main className="flex flex-1 items-center justify-center text-neutral-400">加载中…</main>;
  }

  if (!hasActive) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-bold">Parrot</h1>
        <p className="text-neutral-500">先选择一本词书开始学习</p>
        <Link
          href="/onboarding"
          className="rounded-xl bg-teal-700 px-8 py-3 font-medium text-white"
        >
          选择词书
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
      <h1 className="text-2xl font-bold">今日学习</h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 p-4 text-center">
          <div className="text-3xl font-bold text-teal-700">{dueCount}</div>
          <div className="mt-1 text-xs text-neutral-500">待复习</div>
        </div>
        <div className="rounded-xl border border-neutral-200 p-4 text-center">
          <div className="text-3xl font-bold text-neutral-800">{newCount}</div>
          <div className="mt-1 text-xs text-neutral-500">新词</div>
        </div>
      </div>

      <button
        disabled={total === 0}
        onClick={() => router.push("/study")}
        className="mt-6 w-full rounded-xl bg-teal-700 py-4 text-lg font-semibold text-white disabled:bg-neutral-200 disabled:text-neutral-400"
      >
        {total > 0 ? `开始学习（${total} 张卡片）` : "今日已完成 🎉"}
      </button>

      <div className="mt-8 space-y-2">
        {decks
          ?.filter((d) => d.active)
          .map((d) => (
            <div key={d.slug} className="text-sm text-neutral-500">
              {d.name}：{d.learnedCount} / {d.wordCount}
              <div className="mt-1 h-1.5 w-full rounded bg-neutral-100">
                <div
                  className="h-1.5 rounded bg-teal-600"
                  style={{ width: `${d.wordCount ? (d.learnedCount / d.wordCount) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
      </div>

      <Link href="/onboarding" className="mt-8 block text-center text-xs text-neutral-400 underline">
        词书设置
      </Link>
    </main>
  );
}
