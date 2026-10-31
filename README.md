# Codebase Inspector

[![CI](https://github.com/jocire/codebase-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/jocire/codebase-inspector/actions/workflows/ci.yml)

**Local-first, deterministic source-code inspection and ZIP comparison.** Codebase Inspector analyzes archive contents without AI or an external translation/analysis API. It includes technology inventories, structural metrics, WordPress and Node.js integration analysis, static review signals, documentation exports, and two comparison modes.

**Version:** 0.8.1  

> **GitHub Pages hosts documentation only.** The application requires its Node.js API to analyze ZIP archives. To use the inspector, run it locally or deploy the Node.js service separately. Do not upload confidential source archives to an untrusted hosted instance.

## Requirements

- Node.js 22 or newer (recommended)
- npm

## Quick start

```bash
git clone https://github.com/jocire/codebase-inspector.git
cd codebase-inspector
npm ci
npm start
```

Open **http://localhost:4178**. For auto-reload during development, run `npm run dev`. Use `PORT=5000 npm start` to change the listening port in compatible shells.

## Usage

1. Open **Analyze** and select or drop a ZIP containing a source project.
2. Review the analysis tabs and export JSON, Markdown, CSV, Developer Guide, Compatibility Guide, Recommendations, or the AI-agent prompt.
3. Use **Compare** to upload two ZIP files. Choose **same codebase** for version diffs or **different codebases** for architecture/technology comparisons.

## Capabilities

| Area | What is inspected |
| --- | --- |
| General | File inventory, language mix, byte/line metrics, hashes, dependencies, class/method hints |
| WordPress | Hooks, REST routes, CPTs, taxonomies, Gutenberg blocks, custom fields, AJAX, WP-CLI, WooCommerce, WPML, ACF, and Polyglot indicators |
| Node.js | Package metadata, npm scripts, dependencies, imports, routes, environment variable references |
| Deep review | Signatures, namespace/symbol inventory, superglobals, static code-quality, security and compatibility review hints |
| Comparison | Added/modified/removed files, bounded diffs, dependency deltas, and cross-project differences |
| Exports | JSON, Markdown, CSV and generated technical guides |

**Interpretation:** Findings are deterministic heuristics and review leads, not proof of vulnerabilities, runtime bugs, or compatibility certification. Dynamic constructs may be missed.

## Architecture

- `src/server.js`: Express HTTP server and upload/API flow
- `src/extract.js`: bounded ZIP extraction
- `src/analyze.js`, `src/deep-analysis.js`, `src/platforms.js`: analysis passes
- `src/documentation.js`, `src/insights.js`: reports and guidance
- `src/compare.js`: version and independent-codebase comparisons
- `src/config.js`: size limits and ignored paths
- `public/`: browser UI
- `docs/`: static GitHub Pages documentation website

### API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health and current version |
| `POST` | `/api/analyze` | Multipart form field `archive` (ZIP) |
| `POST` | `/api/compare` | Multipart fields `before`, `after`; optional `comparisonType=versions` or `codebases` |

The API is intended for local use. **Do not expose it directly to the public Internet without additional authentication, isolation, rate limiting, network controls and resource hardening.** The service accepts and processes untrusted ZIP files, with configurable extraction size limits.

## Limits and privacy

Current configuration caps uploads at 150 MiB per ZIP, extracted archives at 750 MiB and 30,000 files, plus per-file limits. Temporary files are normally deleted after requests; a process crash can leave temporary material behind. The browser sends archive bytes to the configured local backend for analysis, rather than processing them entirely inside the browser. If the backend runs on a remote server, the files are transmitted to that server.

## Development and tests

```bash
npm ci
npm test
npm run dev
```

CI runs Node.js tests and syntax checks. No existing automated tests were included in the supplied source archive, so a passing test command alone is **not** evidence of behavioral coverage. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosting and GitHub Pages

GitHub Pages deploys the static files in `docs/` via `.github/workflows/pages.yml`. In **Settings → Pages**, choose **GitHub Actions** as the build/deployment source. Deployment requires Actions to be enabled and account billing/quotas to permit jobs. The Pages site is documentation and provides installation steps, not a live ZIP analyzer.

To deploy the actual application, use a supported Node.js hosting environment with suitable isolation, storage, and abuse protections.

## License

No open-source license has been assigned yet. **Public visibility does not by itself grant permission to reuse, modify or redistribute this code.** Add a `LICENSE` file once the intended license is chosen.
