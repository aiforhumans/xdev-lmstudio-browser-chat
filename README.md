# XDEV LM Studio Browser Chat

A simple local browser UI for chatting with LM Studio through its OpenAI-compatible API.

## What this gives you

- Browser chat UI
- Model dropdown loaded from LM Studio
- Temperature and max token controls
- Multi-chat sidebar (create, rename, delete)
- Editable system prompt + reusable prompt presets
- Per-model parameter profile memory
- Markdown-friendly responses with code blocks + copy buttons
- Export/import chat transcripts (JSON + Markdown)
- Local Express backend proxy
- No OpenAI key needed
- Works with LM Studio running on `http://localhost:1234/v1`

## 1. Start LM Studio

1. Open LM Studio.
2. Load or download a chat model.
3. Start the local server.
4. Keep the server on port `1234`.

The app calls:

```txt
http://localhost:1234/v1/models
http://localhost:1234/v1/chat/completions
```

## 2. Install the app

Open a terminal in this folder:

```bash
npm install
```

## 3. Create your `.env`

Copy the example file:

```bash
copy .env.example .env
```

On PowerShell you can also use:

```powershell
Copy-Item .env.example .env
```

Default `.env`:

```env
LM_STUDIO_BASE_URL=http://localhost:1234/v1
APP_PORT=3000
DEFAULT_MODEL=
```

You can leave `DEFAULT_MODEL` empty because the UI loads models automatically.

## 4. Run

```bash
npm start
```

Open:

```txt
http://localhost:3000
```

## Chat workflow features

- Start multiple chats from the left sidebar (`New`).
- Rename or delete the active chat with `Rename` and `Delete`.
- Set a system prompt per chat and save reusable presets.
- Export the active chat to JSON/Markdown or import a JSON export back in.

## Troubleshooting

### UI says it cannot connect

Test LM Studio directly:

```bash
curl http://localhost:1234/v1/models
```

If that fails, LM Studio server is not running or the port is different.

### No models found

Open LM Studio and load/download a model.

### Chat fails but models load

Make sure you selected the exact model ID from the dropdown.

### Port already in use

Change this in `.env`:

```env
APP_PORT=3001
```
