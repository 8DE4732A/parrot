"use client";

/**
 * 单词发音：优先播放预生成的微软神经语音
 * （英式 /audio/<word>.mp3，美式 /audio/<word>-us.mp3），
 * 加载失败时回退浏览器 Web Speech API。
 */
export function speakWord(word: string, accent: "uk" | "us" = "uk") {
  const file = accent === "us" ? `${word.toLowerCase()}-us.mp3` : `${word.toLowerCase()}.mp3`;
  const fallback = () => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = accent === "us" ? "en-US" : "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  const audio = new Audio(`/audio/${file}`);
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
