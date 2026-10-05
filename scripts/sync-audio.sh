#!/usr/bin/env bash
# 音频同步到 audio 分支（P2：main 分支不含音频，jsDelivr 从 @audio 分支服务）
# 用法：本地跑完 generate-audio.py / generate-audio-us.py 后执行
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ ! -d public/audio ] || [ -z "$(ls -A public/audio 2>/dev/null)" ]; then
  echo "❌ public/audio 为空——先跑 scripts/generate-audio.py（和 generate-audio-us.py）"
  exit 1
fi

# worktree 隔离：在 .git/audio-worktree 检出 audio 分支，拷入音频后提交
ROOT="$(pwd)"
WORKTREE=.git/audio-worktree
git worktree remove --force "$WORKTREE" 2>/dev/null || true
git worktree add "$WORKTREE" audio -f

rsync -a --delete public/audio/ "$WORKTREE/public/audio/"
cd "$WORKTREE"
git add public/audio
if git diff --cached --quiet; then
  echo "✅ audio 分支无变化"
else
  git commit -q -m "chore: 同步发音音频（$(ls public/audio | wc -l | tr -d ' ') 个文件）"
  git push origin audio
  echo "✅ 已提交并推送 audio 分支"
fi

cd "$ROOT"
git worktree remove --force "$WORKTREE"
echo "ℹ️ jsDelivr 有 ~12h 边缘缓存，急用可访问 https://purge.jsdelivr.net/gh/8DE4732A/parrot@audio/public/audio/<file> 刷新"
