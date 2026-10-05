"use client";

/**
 * 单词发音：预生成的微软神经语音经 jsDelivr CDN 分发（@audio 分支），
 * 加载失败时回退浏览器 Web Speech API。
 * 音频文件不入 main 分支（149MB），由 scripts/sync-audio.sh 同步到 audio 分支。
 */
// env 覆盖口（如换其他 CDN）；默认 jsDelivr 代理 GitHub @audio 分支
const AUDIO_CDN =
  process.env.NEXT_PUBLIC_AUDIO_CDN ??
  "https://cdn.jsdelivr.net/gh/8DE4732A/parrot@audio/public/audio";

export function speakWord(word: string, accent: "uk" | "us" = "uk") {
  const file =
    accent === "us" ? `${word.toLowerCase()}-us.mp3` : `${word.toLowerCase()}.mp3`;
  const fallback = () => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = accent === "us" ? "en-US" : "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  const audio = new Audio(`${AUDIO_CDN}/${file}`);
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
