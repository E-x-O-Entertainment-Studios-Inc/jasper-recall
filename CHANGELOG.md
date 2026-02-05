# Changelog

All notable changes to Jasper Recall will be documented in this file.

## [0.2.1] - 2026-02-05

### Added
- **`serve` command** — HTTP API server for sandboxed/Docker agents
  - `npx jasper-recall serve --port 3458`
  - `GET /recall?q=query` endpoint
  - Public-only enforced by default for security
  - CORS enabled for browser/agent access
- Sandboxed agents can now query memories without CLI access
- Server exports for programmatic use

### Security
- API server enforces `public_only=true` by default
- Private content access requires `RECALL_ALLOW_PRIVATE=true` env var

## [0.2.0] - 2026-02-05

### Added
- **Memory tagging** — Mark entries `[public]` or `[private]` in daily notes
- **`--public-only` flag** — Sandboxed agents query only shared content
- **`privacy-check` command** — Scan text/files for sensitive data before sharing
- **`sync-shared` command** — Extract `[public]` entries to shared memory directory
- **Bidirectional learning** — Main and sandboxed agents share knowledge safely

### Changed
- `recall` now supports post-filtering for privacy-tagged content
- README updated with shared memory documentation

## [0.1.0] - 2026-02-04

### Added
- Initial release
- `recall` — Semantic search over indexed memories
- `index-digests` — Index markdown files into ChromaDB
- `digest-sessions` — Extract summaries from session logs
- `npx jasper-recall setup` — One-command installation
- Local embeddings via sentence-transformers (all-MiniLM-L6-v2)
- ChromaDB persistent vector storage
- Incremental indexing with content hashing
