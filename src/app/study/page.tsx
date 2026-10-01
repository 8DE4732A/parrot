"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ExplanationContent {
  etymology: { parts: { part: string; type: string; meaning: string }[]; story: string };
  derivatives: { word: string; pos: string; meaning: string }[];
  examples: { en: string; zh: string }[];
  synonyms: { group: string[]; diff: string }[];
  mnemonic: string;
}

interface QueueItem {
  wordId: number;
  word: string;
  phonetic: string | null;
  translation: string;
  card: { state: number } | null;
  explanation: ExplanationContent | null;
  explanationStatus: string | null;
}

type Grade = 1 | 2 | 3 | 4;
const GRADES: { g: Grade; label: string }[] = [
  { g: 1, label: "重来" },
  { g: 2, label: "困难" },
  { g: 3, label: "良好" },
  { g: 4, label: "简单" },
];

function SpeakButton({ word }: { word: string }) {
  const speak = useCallback(() => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, [word]);
  return (
    <button
      onClick={speak}
      aria-label="发音"
      className="rounded-full px-2 py-1 text-xl hover:bg-neutral-100"
    >
      🔊
    </button>
  );
}

export default function StudyPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const pendingGrades = useRef(0);

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("mode");
    const url = mode === "free" ? "/api/queue?mode=free&limit=20" : "/api/queue";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        const items: QueueItem[] = [...(d.reviews ?? []), ...(d.news ?? [])];
        if (items.length === 0) {
          router.replace("/today");
          return;
        }
        setQueue(items);
      });
  }, [router]);

  const current = queue?.[index];
  const done = queue !== null && index >= queue.length;
  const progress = useMemo(
    () => (queue && queue.length > 0 ? Math.min(index, queue.length) : 0),
    [queue, index]
  );

  async function grade(g: Grade) {
    if (!current || !queue) return;
    const wordId = current.wordId;
    setFlipped(false);
    setIndex((i) => i + 1);
    // 乐观更新 + 失败回队尾（详设 §6.2）
    pendingGrades.current++;
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, grade: g }),
      });
      if (!res.ok) throw new Error("review failed");
    } catch {
      setQueue((q) => {
        if (!q) return q;
        const item = q.find((x) => x.wordId === wordId);
        return item ? [...q, item] : q;
      });
    } finally {
      pendingGrades.current--;
    }
  }

  if (done || queue === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {queue === null ? (
          <p className="text-neutral-400">加载中…</p>
        ) : (
          <>
            <p className="text-5xl">🎉</p>
            <p className="text-lg font-medium">今日学习完成</p>
            <Link href="/today" className="rounded-xl bg-teal-700 px-8 py-3 text-white">
              返回
            </Link>
          </>
        )}
      </main>
    );
  }

  const exp = current!.explanation;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-6">
      {/* 进度 */}
      <div className="flex items-center gap-2 py-3">
        <Link href="/today" className="text-sm text-neutral-400">
          ✕
        </Link>
        <div className="h-1.5 flex-1 rounded bg-neutral-100">
          <div
            className="h-1.5 rounded bg-teal-600 transition-all"
            style={{ width: `${(progress / queue.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-neutral-400">
          {progress}/{queue.length}
        </span>
      </div>

      {!flipped ? (
        /* 正面：极简自测 */
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-5xl font-bold tracking-tight">{current!.word}</h1>
          <div className="flex items-center gap-2 text-neutral-500">
            {current!.phonetic && <span>/{current!.phonetic}/</span>}
            <SpeakButton word={current!.word} />
          </div>
          <button
            onClick={() => setFlipped(true)}
            className="mt-10 w-full rounded-xl bg-teal-700 py-4 text-lg font-semibold text-white"
          >
            显示答案
          </button>
        </div>
      ) : (
        /* 背面：深度讲解 */
        <div className="flex-1 space-y-4 overflow-y-auto py-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">{current!.word}</h1>
              <SpeakButton word={current!.word} />
            </div>
            {current!.phonetic && (
              <p className="text-sm text-neutral-500">/{current!.phonetic}/</p>
            )}
            <p className="mt-1 text-neutral-800">{current!.translation}</p>
          </div>

          {exp ? (
            <>
              <Section title="词根拆解">
                <p className="font-medium">
                  {exp.etymology.parts.map((p) => `${p.part}(${p.meaning})`).join(" + ")}
                </p>
                <p className="mt-1 text-sm text-neutral-600">{exp.etymology.story}</p>
              </Section>

              <Section title="地道例句">
                <ol className="space-y-2">
                  {exp.examples.map((ex, i) => (
                    <li key={i} className="text-sm">
                      <p className="text-neutral-800">{ex.en}</p>
                      <p className="text-neutral-500">{ex.zh}</p>
                    </li>
                  ))}
                </ol>
              </Section>

              <Section title="同根衍生">
                <div className="flex flex-wrap gap-2">
                  {exp.derivatives.map((d) => (
                    <span
                      key={d.word}
                      className="rounded-full bg-teal-50 px-3 py-1 text-sm text-teal-800"
                      title={`${d.pos} ${d.meaning}`}
                    >
                      {d.word} <span className="text-teal-500">{d.meaning}</span>
                    </span>
                  ))}
                </div>
              </Section>

              <Section title="近义辨析">
                <div className="space-y-2">
                  {exp.synonyms.map((s, i) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium text-neutral-700">{s.group.join(" vs. ")}</p>
                      <p className="text-neutral-600">{s.diff}</p>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="记忆法">
                <p className="text-sm text-neutral-600">{exp.mnemonic}</p>
              </Section>
            </>
          ) : (
            /* 讲解缺失骨架：触发服务端兜底生成（§7.6），成功后本地替换 */
            <ExplanationSkeleton wordId={current!.wordId} onReady={(exp) => {
              setQueue((q) =>
                q?.map((item) =>
                  item.wordId === current!.wordId ? { ...item, explanation: exp, explanationStatus: "ready" } : item
                ) ?? q
              );
            }} />
          )}
        </div>
      )}

      {/* FSRS 四键 */}
      {flipped && (
        <div className="sticky bottom-0 grid grid-cols-4 gap-2 bg-white pt-3">
          {GRADES.map(({ g, label }) => (
            <button
              key={g}
              onClick={() => grade(g)}
              className={`rounded-lg py-3 text-sm font-medium ${
                g === 1
                  ? "bg-red-50 text-red-700"
                  : g === 2
                    ? "bg-amber-50 text-amber-700"
                    : g === 3
                      ? "bg-teal-700 text-white"
                      : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 讲解缺失：显示骨架并触发兜底生成（客户端直连失败自动降级服务端，M4 先走服务端代理） */
function ExplanationSkeleton({
  wordId,
  onReady,
}: {
  wordId: number;
  onReady: (exp: ExplanationContent) => void;
}) {
  const [error, setError] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    fetch(`/api/explanations/${wordId}/generate`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("generate failed"))))
      .then((d) => onReady(d.explanation))
      .catch(() => setError(true));
  }, [wordId, onReady]);

  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-100" />
      ))}
      <p className="text-xs text-neutral-400">
        {error ? "讲解生成失败，稍后再试" : "AI 老师正在备课…"}
      </p>
    </div>
  );
}
