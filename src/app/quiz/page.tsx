"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Question {
  id: string;
  wordId: number;
  type: "choice" | "spell" | "cloze";
  stem: { word?: string; phonetic?: string | null; translation?: string; sentence?: string };
  options?: string[];
}

interface Result {
  id: string;
  correct: boolean;
  correctAnswer: string;
  hint?: string;
}

function speak(word: string) {
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-GB";
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

export default function QuizPage() {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<{ id: string; wordId: number; type: string; answer: string; durationMs: number }[]>([]);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    fetch("/api/quiz?count=10")
      .then((r) => r.json())
      .then((d) => {
        setQuestions(d.questions ?? []);
        setStartedAt(Date.now()); // 事件/副作用内调用，合规
      });
  }, []);

  const submit = useCallback(
    async (finalAnswers: typeof answers) => {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      const d = await res.json();
      setResults(d.results ?? []);
    },
    []
  );

  function record(answer: string, now: number) {
    if (!questions) return;
    const q = questions[index];
    const next = [...answers, { id: q.id, wordId: q.wordId, type: q.type, answer, durationMs: startedAt ? now - startedAt : 0 }];
    setAnswers(next);
    setInput("");
    setStartedAt(now);
    if (index + 1 >= questions.length) {
      void submit(next);
    } else {
      setIndex(index + 1);
    }
  }

  if (questions === null) {
    return <main className="flex flex-1 items-center justify-center text-neutral-400">出题中…</main>;
  }

  if (results !== null) {
    const correctCount = results.filter((r) => r.correct).length;
    const wrong = results.filter((r) => !r.correct);
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-6 py-10">
        <h1 className="text-2xl font-bold">测验结果</h1>
        <p className="mt-4 text-4xl font-bold text-teal-700">
          {correctCount} / {results.length}
        </p>
        {wrong.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-medium text-neutral-500">错词（已加入今日复习）</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {wrong.map((r) => (
                <li key={r.id} className="text-red-600">
                  {r.correctAnswer} <span className="text-neutral-400">{r.hint ?? ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link href="/today" className="mt-8 block rounded-xl bg-teal-700 py-3 text-center text-white">
          返回今日
        </Link>
      </main>
    );
  }

  if (questions.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-neutral-500">先学习一些单词，才有题可测</p>
        <Link href="/study" className="rounded-xl bg-teal-700 px-8 py-3 text-white">
          去学习
        </Link>
      </main>
    );
  }

  const q = questions[index];
  const answered = answers.length;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-8">
      <div className="flex items-center gap-2">
        <Link href="/today" className="text-sm text-neutral-400">✕</Link>
        <div className="h-1.5 flex-1 rounded bg-neutral-100">
          <div className="h-1.5 rounded bg-teal-600 transition-all" style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
        <span className="text-xs text-neutral-400">{answered}/{questions.length}</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        {q.type === "choice" && (
          <>
            <h1 className="text-4xl font-bold">{q.stem.word}</h1>
            {q.stem.phonetic && <p className="text-neutral-500">/{q.stem.phonetic}/</p>}
            <p className="text-xs text-neutral-400">选出正确释义</p>
            <div className="w-full space-y-2">
              {q.options?.map((opt) => (
                <button
                  key={opt}
                  onClick={() => record(opt, Date.now())}
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-left text-sm hover:bg-neutral-50"
                >
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}

        {q.type === "spell" && (
          <>
            <button onClick={() => q.stem.word && speak(q.stem.word)} className="text-5xl" aria-label="播放发音">
              🔊
            </button>
            <p className="text-neutral-700">{q.stem.translation}</p>
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && record(input, Date.now())}
              placeholder="输入拼写"
              className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-center text-lg"
            />
            <button
              onClick={() => input.trim() && record(input, Date.now())}
              className="w-full rounded-xl bg-teal-700 py-3 text-white"
            >
              提交
            </button>
          </>
        )}

        {q.type === "cloze" && (
          <>
            <p className="text-lg leading-relaxed">{q.stem.sentence}</p>
            <p className="text-xs text-neutral-400">提示释义：{q.stem.translation}</p>
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && input.trim() && record(input, Date.now())}
              placeholder="填入单词"
              className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-center text-lg"
            />
            <button
              onClick={() => input.trim() && record(input, Date.now())}
              className="w-full rounded-xl bg-teal-700 py-3 text-white"
            >
              提交
            </button>
          </>
        )}
      </div>
    </main>
  );
}
