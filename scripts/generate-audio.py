#!/usr/bin/env python3
"""预生成单词发音音频（微软 Edge 神经语音，免费无 key）。

输出 public/audio/<word>.mp3（英式 en-GB-SoniaNeural）。
断点续跑：已存在的文件跳过。并发 10。
"""
import asyncio
import json
import os
import sys

import edge_tts

VOICE = "en-GB-SoniaNeural"
CONCURRENCY = 10
OUT_DIR = "public/audio"


async def synth(word: str, sem: asyncio.Semaphore, failed: list) -> None:
    path = os.path.join(OUT_DIR, f"{word.lower()}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 500:  # 断点续跑
        return
    async with sem:
        try:
            tts = edge_tts.Communicate(word, VOICE, rate="-5%")
            await tts.save(path)
        except Exception as e:  # noqa: BLE001
            failed.append((word, str(e)[:80]))


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    words = [w["word"] for w in json.load(open("materials/ielts/words.json"))]
    done = sum(
        1
        for w in words
        if os.path.exists(os.path.join(OUT_DIR, f"{w.lower()}.mp3"))
    )
    print(f"共 {len(words)} 词，已有 {done}，待合成 {len(words) - done}")

    sem = asyncio.Semaphore(CONCURRENCY)
    failed: list = []
    batch = 200
    for i in range(0, len(words), batch):
        await asyncio.gather(*(synth(w, sem, failed) for w in words[i : i + batch]))
        total = sum(
            1
            for w in words
            if os.path.exists(os.path.join(OUT_DIR, f"{w.lower()}.mp3"))
        )
        print(f"进度 {total}/{len(words)}，失败 {len(failed)}")
        if failed:
            for w, err in failed[:5]:
                print(f"  ✗ {w}: {err}")
            failed.clear()

    missing = [
        w
        for w in words
        if not os.path.exists(os.path.join(OUT_DIR, f"{w.lower()}.mp3"))
    ]
    if missing:
        print(f"❌ 缺失 {len(missing)}: {missing[:10]}")
        sys.exit(1)
    print("✅ 全部音频生成完毕")


asyncio.run(main())
