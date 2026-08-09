# Contributing to HF Model Downloader

Thank you for helping improve HF Model Downloader. Contributions should stay within the project's scope: an Electron desktop workspace for discovering, selecting, downloading, verifying, and managing files from Hugging Face model repositories.

## Bugs and feature requests

Use GitHub Issues for normal bug reports and feature requests. Search existing issues first and keep each report focused on one problem or proposal. Bug reports should include the application version, operating system, clear reproduction steps, expected and actual behavior, and sanitized logs or screenshots when useful.

Do not report a suspected security vulnerability in a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Local development

Development requires Node.js 20 or newer and npm. Install the locked dependency set from the repository root:

```bash
npm ci
```

Start the Vite renderer and Electron application together:

```bash
npm run dev
```

Keep changes small and focused. Follow the existing TypeScript, React, and Electron structure, add or update tests for changed behavior, and avoid unrelated refactors or generated release artifacts. Update user-facing documentation when behavior changes, and update the architecture or security documentation when a trust boundary changes.

## Validation

Before opening a pull request, run the checks supported by the repository:

```bash
npm test
npm run lint
npm run build
npm audit --json
git diff --check
```

Do not suppress failures. If a relevant check cannot run on your platform, explain the limitation and the checks that did run in the pull request.

Pull requests should explain the problem, the chosen change, any user-visible or security-boundary impact, and the validation performed. Prefer a small pull request that can be reviewed independently over a broad collection of unrelated changes.

## Security and privacy boundaries

Preserve the project's security boundaries around Electron IPC, renderer and main-process separation, network endpoints and redirects, Hugging Face tokens, filesystem access, download integrity and resumption, and update discovery and verification. Changes to these areas should include focused tests and corresponding documentation.

Never include credentials, Hugging Face tokens, private filesystem paths, downloaded contents from private models or repositories, or other secrets in issues, logs, fixtures, screenshots, commits, or pull requests. Use public test repositories and sanitized examples.
