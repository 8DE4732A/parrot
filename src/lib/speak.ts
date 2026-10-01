"use client";

/**
 * 单词发音：优先播放预生成的微软神经语音（/audio/<word>.mp3），
 * 加载失败时回退浏览器 Web Speech API。
 */
export function speakWord(word: string) {
  const audio = new Audio(`/audio/${word.toLowerCase()}.mp3`);
  audio.onerror = () => {
    // 回退：浏览器系统 TTS
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  audio.play().catch(() => {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-GB";
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
