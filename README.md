# XDEV LM Studio Browser Chat

Local-first browser chat for LM Studio with:
- REST v1 stateful chat (`response_id` chaining)
- SSE streaming responses
- SQLite-backed learned memory + feedback loop

## Architecture

- **Frontend (`public/`)**: multi-chat UI, prompt controls, streaming render, feedback actions.
- **Backend (`server.js`)**: Express proxy to LM Studio + memory/feedback API + prompt enrichment.
- **Local DB (`data/learning.sqlite`)**: persistent memory entries and feedback events.

## Prerequisites

1. LM Studio running locally.
2. A loaded chat-capable model.
3. Local server available on `http://localhost:1234`.

## Setup

```bash
npm install
copy .env.example .env
```

Default `.env`:

```env
LM_STUDIO_BASE_URL=http://localhost:1234/v1
APP_PORT=3000
DEFAULT_MODEL=
```

Run:

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

## Key features

- Multi-conversation sidebar (new, rename, delete)
- Per-chat system prompt + prompt presets
- Per-model parameter memory
- Streaming token rendering in UI
- Regenerate + copy response
- Export/import chat JSON/Markdown
- Feedback controls per assistant message:
  - 👍 Good
  - 👎 Bad
  - 🧠 Remember
- Learned memory panel with forget action

## API surface (app backend)

### Health and models
- `GET /api/health`
- `GET /api/models`

### Chat
- `POST /api/chat`
  - Non-stream request to LM Studio REST v1 chat.
- `POST /api/chat/stream`
  - Streams SSE events from LM Studio to browser.

### Self-learning memory
- `GET /api/memory?query=...&limit=...`
- `GET /api/memory/all`
- `POST /api/memory/remember`
- `POST /api/memory/forget`
- `POST /api/feedback`

## LM Studio endpoints used

```txt
http://localhost:1234/v1/models
http://localhost:1234/api/v1/chat
```

## Learning storage

SQLite file:

```txt
data/learning.sqlite
```

Primary tables:
- `memory_entries`
- `message_feedback`
- `memory_links`
- `user_profile`

## Troubleshooting

### Cannot connect to LM Studio

```bash
curl http://localhost:1234/v1/models
```

If this fails, LM Studio local server is not running or your base URL/port is different.

### No models in dropdown

Load or download a model in LM Studio first.

### Port already in use

Set another port in `.env`:

```env
APP_PORT=3001
```
