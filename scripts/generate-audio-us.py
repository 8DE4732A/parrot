#!/usr/bin/env python3
"""合成美式发音音频（微软 Edge 神经语音 en-US-AriaNeural）。
输出 public/audio/<word>-us.mp3。断点续跑，并发 10。"""
import asyncio
import json
import os
import sys

import edge_tts

VOICE = "en-US-AriaNeural"
CONCURRENCY = 10
OUT_DIR = "public/audio"


async def synth(word: str, sem: asyncio.Semaphore, failed: list) -> None:
    path = os.path.join(OUT_DIR, f"{word.lower()}-us.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return
    async with sem:
        try:
            await edge_tts.Communicate(word, VOICE).save(path)
        except Exception as e:  # noqa: BLE001
            failed.append((word, str(e)[:80]))


async def main() -> None:
    words = json.load(open("scripts/.work/us-words.json"))
    sem = asyncio.Semaphore(CONCURRENCY)
    failed: list = []
    batch = 200
    for i in range(0, len(words), batch):
        await asyncio.gather(*(synth(w, sem, failed) for w in words[i : i + batch]))
        done = sum(1 for w in words if os.path.exists(os.path.join(OUT_DIR, f"{w.lower()}-us.mp3")))
        print(f"进度 {done}/{len(words)}，失败 {len(failed)}")
        if failed:
            for w, err in failed[:5]:
                print(f"  ✗ {w}: {err}")
            failed.clear()

    missing = [w for w in words if not os.path.exists(os.path.join(OUT_DIR, f"{w.lower()}-us.mp3"))]
    if missing:
        print(f"❌ 缺失 {len(missing)}: {missing[:10]}")
        sys.exit(1)
    print("✅ 美音全部生成完毕")


asyncio.run(main())
