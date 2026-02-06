# Jasper Recall - OpenClaw Plugin

Semantic search over indexed memory using ChromaDB.

## Tools

### `recall`

Search your memory index for relevant context.

**Parameters:**
- `query` (string, required): Natural language search query
- `limit` (number, optional): Max results (default: 5)

**Example:**
```
recall query="what did we decide about the API design" limit=3
```

**Returns:** Formatted markdown with matching memories, scores, and sources.

## Commands

### `/recall <query>`

Quick memory search from chat.

**Example:**
```
/recall worker orchestration decisions
```

### `/index`

Re-index memory files into ChromaDB. Run after updating notes.

## Configuration

In `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "jasper-recall": {
        "enabled": true,
        "config": {
          "defaultLimit": 5,
          "publicOnly": false
        }
      }
    }
  }
}
```

**Options:**
- `enabled`: Enable/disable plugin
- `defaultLimit`: Default number of results
- `publicOnly`: Only search public memory (for sandboxed agents)

## Requirements

- `recall` command in `~/.local/bin/`
- ChromaDB index at `~/.openclaw/chroma-db`
- Python venv at `~/.openclaw/rag-env`

## Installation

```bash
npx jasper-recall setup
```

This sets up:
1. Python venv with ChromaDB + sentence-transformers
2. `recall`, `index-digests`, `digest-sessions` scripts
3. Initial index of memory files

## When to Use

Call `recall` when you need context about:
- Past decisions and their rationale
- Previous work on a topic
- User preferences and patterns
- Technical learnings and gotchas
- Project history

The tool searches semantically, not just keyword matching — "API design" will find discussions about "REST endpoints" too.
