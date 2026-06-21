import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();

const APP_PORT = Number(process.env.APP_PORT || 3000);
const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "";
const OPENAI_COMPAT_BASE_URL = LM_STUDIO_BASE_URL.endsWith("/v1")
  ? LM_STUDIO_BASE_URL
  : `${LM_STUDIO_BASE_URL}/v1`;
const REST_V1_BASE_URL = OPENAI_COMPAT_BASE_URL.replace(/\/v1\/?$/, "/api/v1");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "learning.sqlite");

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT DEFAULT 'local-user',
  preferences_text TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  weight REAL NOT NULL DEFAULT 1.0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  user_input TEXT DEFAULT '',
  assistant_message TEXT DEFAULT '',
  rating TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id INTEGER NOT NULL,
  memory_entry_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (feedback_id) REFERENCES message_feedback(id),
  FOREIGN KEY (memory_entry_id) REFERENCES memory_entries(id)
);

INSERT OR IGNORE INTO user_profile (id, display_name, preferences_text) VALUES (1, 'local-user', '');
`);

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getSelectedModel(requestModel) {
  return requestModel || DEFAULT_MODEL;
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user" && typeof messages[index]?.content === "string") {
      return messages[index].content;
    }
  }
  return "";
}

function getSystemPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  const system = messages.find((message) => message?.role === "system" && typeof message?.content === "string");
  return system?.content || "";
}

function getMessageFromRestV1Output(output) {
  if (!Array.isArray(output)) return "";
  return output
    .filter((item) => item?.type === "message" && typeof item?.content === "string")
    .map((item) => item.content)
    .join("");
}

function getRelevantMemories(query, limit = 6) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) {
    return db.prepare(`
      SELECT id, text, kind, weight, updated_at
      FROM memory_entries
      WHERE archived = 0
      ORDER BY weight DESC, updated_at DESC
      LIMIT ?
    `).all(limit);
  }

  return db.prepare(`
    SELECT id, text, kind, weight, updated_at,
      (CASE WHEN lower(text) LIKE lower(?) THEN 1 ELSE 0 END) AS keyword_hit
    FROM memory_entries
    WHERE archived = 0
    ORDER BY keyword_hit DESC, weight DESC, updated_at DESC
    LIMIT ?
  `).all(`%${cleanQuery}%`, limit);
}

function buildLearningSystemPrompt(baseSystemPrompt, userInput) {
  const base = String(baseSystemPrompt || "").trim() || "You are a helpful local AI assistant running through LM Studio.";
  const memories = getRelevantMemories(userInput, 6);
  if (!memories.length) return base;

  const memoryBlock = memories
    .map((memory, index) => `${index + 1}. [${memory.kind}] ${memory.text}`)
    .join("\n");

  return `${base}

Learned user memory (local, high priority):
${memoryBlock}

Use this memory when relevant, but do not invent facts not present in the memory.`;
}

app.get("/api/health", async (_req, res) => {
  try {
    const response = await fetch(`${OPENAI_COMPAT_BASE_URL}/models`);
    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        message: `LM Studio responded with HTTP ${response.status}`,
        lmStudioBaseUrl: OPENAI_COMPAT_BASE_URL,
      });
    }

    const data = await response.json();
    res.json({
      ok: true,
      message: "Connected to LM Studio",
      lmStudioBaseUrl: OPENAI_COMPAT_BASE_URL,
      defaultModel: DEFAULT_MODEL,
      dbPath: DB_PATH,
      models: data.data || [],
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      message: "Could not connect to LM Studio",
      error: getErrorMessage(error),
      lmStudioBaseUrl: OPENAI_COMPAT_BASE_URL,
    });
  }
});

app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch(`${OPENAI_COMPAT_BASE_URL}/models`);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
    }

    const data = await response.json();
    res.json({
      ok: true,
      models: data.data || [],
      defaultModel: DEFAULT_MODEL,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

app.get("/api/memory", (req, res) => {
  try {
    const query = String(req.query.query || req.query.q || "");
    const limit = Math.max(1, Math.min(20, Number(req.query.limit || 8)));
    const memories = getRelevantMemories(query, limit);
    res.json({ ok: true, memories });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.get("/api/memory/all", (_req, res) => {
  try {
    const memories = db.prepare(`
      SELECT id, text, kind, weight, archived, created_at, updated_at
      FROM memory_entries
      WHERE archived = 0
      ORDER BY weight DESC, updated_at DESC
      LIMIT 100
    `).all();
    res.json({ ok: true, memories });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/memory/remember", (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const kind = String(req.body?.kind || "fact").trim() || "fact";
    if (!text) {
      return res.status(400).json({ ok: false, error: "text is required" });
    }

    const existing = db.prepare(`
      SELECT id, weight FROM memory_entries
      WHERE archived = 0 AND lower(text) = lower(?)
      LIMIT 1
    `).get(text);

    let memoryId;
    if (existing) {
      const nextWeight = Number(existing.weight || 1) + 0.4;
      db.prepare(`
        UPDATE memory_entries
        SET weight = ?, kind = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(nextWeight, kind, existing.id);
      memoryId = existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO memory_entries (text, kind, weight)
        VALUES (?, ?, 1.2)
      `).run(text, kind);
      memoryId = Number(result.lastInsertRowid);
    }

    const memory = db.prepare(`
      SELECT id, text, kind, weight, archived, created_at, updated_at
      FROM memory_entries
      WHERE id = ?
    `).get(memoryId);

    res.json({ ok: true, memory });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/memory/forget", (req, res) => {
  try {
    const id = Number(req.body?.id);
    const text = String(req.body?.text || "").trim();
    if (!id && !text) {
      return res.status(400).json({ ok: false, error: "id or text is required" });
    }

    if (id) {
      db.prepare(`
        UPDATE memory_entries
        SET archived = 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
    } else {
      db.prepare(`
        UPDATE memory_entries
        SET archived = 1, updated_at = datetime('now')
        WHERE lower(text) = lower(?)
      `).run(text);
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/feedback", (req, res) => {
  try {
    const conversationId = String(req.body?.conversationId || "").trim();
    const messageIndex = Number(req.body?.messageIndex);
    const rating = String(req.body?.rating || "").trim();
    const userInput = String(req.body?.userInput || "");
    const assistantMessage = String(req.body?.assistantMessage || "");

    if (!conversationId) {
      return res.status(400).json({ ok: false, error: "conversationId is required" });
    }
    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      return res.status(400).json({ ok: false, error: "messageIndex must be a non-negative integer" });
    }
    if (rating !== "good" && rating !== "bad") {
      return res.status(400).json({ ok: false, error: "rating must be 'good' or 'bad'" });
    }

    const result = db.prepare(`
      INSERT INTO message_feedback (conversation_id, message_index, user_input, assistant_message, rating)
      VALUES (?, ?, ?, ?, ?)
    `).run(conversationId, messageIndex, userInput, assistantMessage, rating);

    if (rating === "good" && assistantMessage.trim()) {
      const memoryResult = db.prepare(`
        INSERT INTO memory_entries (text, kind, weight)
        VALUES (?, 'rule', 1.05)
      `).run(`Preferred answer style example: ${assistantMessage.trim().slice(0, 240)}`);

      db.prepare(`
        INSERT INTO memory_links (feedback_id, memory_entry_id, action)
        VALUES (?, ?, 'reinforce')
      `).run(Number(result.lastInsertRowid), Number(memoryResult.lastInsertRowid));
    }

    res.json({ ok: true, feedbackId: Number(result.lastInsertRowid) });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const {
      model,
      input,
      system_prompt,
      previous_response_id,
      messages,
      temperature = 0.7,
      max_tokens = 512,
      store = true,
    } = req.body;

    const selectedModel = getSelectedModel(model);
    const finalInput = typeof input === "string" ? input : getLastUserMessage(messages);
    const baseSystemPrompt = typeof system_prompt === "string" ? system_prompt : getSystemPrompt(messages);
    const finalSystemPrompt = buildLearningSystemPrompt(baseSystemPrompt, finalInput);

    if (!finalInput) {
      return res.status(400).json({
        ok: false,
        error: "input is required (or include a user message in messages).",
      });
    }
    if (!selectedModel) {
      return res.status(400).json({
        ok: false,
        error: "No model selected. Choose a model in the UI or set DEFAULT_MODEL in .env.",
      });
    }

    const response = await fetch(`${REST_V1_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        input: finalInput,
        system_prompt: finalSystemPrompt,
        previous_response_id: previous_response_id || undefined,
        temperature,
        max_output_tokens: max_tokens,
        store: Boolean(store),
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: text });
    }

    const data = JSON.parse(text);
    const assistantMessage = getMessageFromRestV1Output(data.output);
    res.json({
      ok: true,
      message: assistantMessage,
      response_id: data.response_id || null,
      stats: data.stats || null,
      raw: data,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: getErrorMessage(error) });
  }
});

app.post("/api/chat/stream", async (req, res) => {
  try {
    const {
      model,
      input,
      system_prompt,
      previous_response_id,
      temperature = 0.7,
      max_output_tokens = 512,
      store = true,
    } = req.body;

    const selectedModel = getSelectedModel(model);
    if (!selectedModel) {
      return res.status(400).json({
        ok: false,
        error: "No model selected. Choose a model in the UI or set DEFAULT_MODEL in .env.",
      });
    }
    if (typeof input !== "string" || !input.trim()) {
      return res.status(400).json({ ok: false, error: "input must be a non-empty string" });
    }

    const finalSystemPrompt = buildLearningSystemPrompt(system_prompt, input);

    const upstream = await fetch(`${REST_V1_BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        input,
        system_prompt: finalSystemPrompt,
        previous_response_id: previous_response_id || undefined,
        temperature,
        max_output_tokens,
        store: Boolean(store),
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return res.status(upstream.status).json({ ok: false, error: errorText });
    }
    if (!upstream.body) {
      return res.status(502).json({
        ok: false,
        error: "LM Studio returned no response body for streaming request.",
      });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (error) {
    const message = getErrorMessage(error);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: message });
      return;
    }
    res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "unknown", message } })}\n\n`);
    res.end();
  }
});

app.listen(APP_PORT, () => {
  console.log("");
  console.log("XDEV LM Studio Browser Chat");
  console.log("---------------------------");
  console.log(`Browser UI:        http://localhost:${APP_PORT}`);
  console.log(`LM OpenAI API:     ${OPENAI_COMPAT_BASE_URL}`);
  console.log(`LM REST v1 API:    ${REST_V1_BASE_URL}`);
  console.log(`Learning DB:       ${DB_PATH}`);
  console.log("");
  console.log("Make sure LM Studio local server is running.");
  console.log("");
});
