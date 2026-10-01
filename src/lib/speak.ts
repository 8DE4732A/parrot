"use client";

/**
 * 单词发音：优先播放预生成的微软神经语音
 * （英式 /audio/<word>.mp3，美式 /audio/<word>-us.mp3），
 * 加载失败时回退浏览器 Web Speech API。
 */
// 美音文件体积大，走 jsDelivr GitHub CDN（.vercelignore 排除），失败回退系统 TTS
const US_CDN =
  process.env.NEXT_PUBLIC_US_AUDIO_CDN ?? "https://cdn.jsdelivr.net/gh/8DE4732A/parrot@main/public/audio";

export function speakWord(word: string, accent: "uk" | "us" = "uk") {
  const file =
    accent === "us" ? `${US_CDN}/${word.toLowerCase()}-us.mp3` : `/audio/${word.toLowerCase()}.mp3`;
  const fallback = () => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = accent === "us" ? "en-US" : "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  const audio = new Audio(file);
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
