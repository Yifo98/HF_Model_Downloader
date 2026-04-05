# HF Model Downloader 2.0.0

## Summary

This release moves the project onto the long-term Electron desktop architecture.

## Included artifacts

- `HF Model Downloader-2.0.0-arm64-mac.zip`
- `HF Model Downloader-2.0.0-win.zip`
- `HF Model Downloader 2.0.0.exe`
- `README-mac.txt`

## Highlights

- Migrated the app to `Electron + React + TypeScript`
- Added repository manifest loading with search and family filtering
- Added recommended selection presets for model weights and full runtime downloads
- Added live queue telemetry history restore retry and file reveal actions
- Unified startup and packaging flow around `package.json` and `scripts/`
- Removed the legacy Tk entrypoint and old root-level bat launch scripts

## Packaging and privacy

- Shared builds are intended to be unpack-and-run
- Packaging scripts verify that release archives do not include cookies history local session files tokens or API keys
- Versioned release notes are refreshed inside the `release/2.0.0/` folder on each packaging run
- macOS and Windows builds are currently unsigned so first-run security prompts are expected
