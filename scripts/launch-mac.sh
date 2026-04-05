#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROGRAM_ROOT="$HOME/Program"
HF_ROOT="$PROGRAM_ROOT/HuggingFace"
HF_DOWNLOADER_ROOT="$HF_ROOT/HF_Model_Downloader"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  echo "Missing node_modules in $PROJECT_ROOT"
  echo "Installing dependencies first..."
  cd "$PROJECT_ROOT"
  npm install
fi

mkdir -p \
  "$PROGRAM_ROOT/Downloads" \
  "$HF_ROOT/hub" \
  "$HF_ROOT/datasets" \
  "$HF_ROOT/transformers" \
  "$HF_ROOT/xdg-cache" \
  "$HF_ROOT/assets" \
  "$HF_ROOT/token" \
  "$HF_DOWNLOADER_ROOT/cache" \
  "$HF_DOWNLOADER_ROOT/electron-user-data" \
  "$HF_DOWNLOADER_ROOT/electron-session" \
  "$HF_DOWNLOADER_ROOT/logs"

export HF_HOME="$HF_ROOT"
export HF_HUB_CACHE="$HF_ROOT/hub"
export HUGGINGFACE_HUB_CACHE="$HF_ROOT/hub"
export HF_DATASETS_CACHE="$HF_ROOT/datasets"
export TRANSFORMERS_CACHE="$HF_ROOT/transformers"
export XDG_CACHE_HOME="$HF_ROOT/xdg-cache"

cd "$PROJECT_ROOT"

echo "Launching HF Model Downloader on macOS..."
echo "Project root: $PROJECT_ROOT"
echo "HF_HOME: $HF_HOME"
echo "HF cache: $HF_HUB_CACHE"

npm run dev
