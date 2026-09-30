export const metadata = {
  title: "今日 · Parrot",
};

export default function TodayPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Parrot</h1>
      <p className="text-neutral-500">AI 英语老师，陪你把每个单词学透</p>
      <p className="mt-8 rounded-lg bg-neutral-100 px-4 py-2 text-sm text-neutral-400">
        M1 骨架 · 学习功能开发中
      </p>
    </main>
  );
}
