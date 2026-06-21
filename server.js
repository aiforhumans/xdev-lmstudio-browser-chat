import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const APP_PORT = Number(process.env.APP_PORT || 3000);
const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "";
const OPENAI_COMPAT_BASE_URL = LM_STUDIO_BASE_URL.endsWith("/v1")
  ? LM_STUDIO_BASE_URL
  : `${LM_STUDIO_BASE_URL}/v1`;
const REST_V1_BASE_URL = OPENAI_COMPAT_BASE_URL.replace(/\/v1\/?$/, "/api/v1");

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
    const finalSystemPrompt = typeof system_prompt === "string" ? system_prompt : getSystemPrompt(messages);

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
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        input: finalInput,
        system_prompt: finalSystemPrompt || undefined,
        previous_response_id: previous_response_id || undefined,
        temperature,
        max_output_tokens: max_tokens,
        store: Boolean(store),
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: text,
      });
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
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
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
      return res.status(400).json({
        ok: false,
        error: "input must be a non-empty string",
      });
    }

    const upstream = await fetch(`${REST_V1_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        input,
        system_prompt: typeof system_prompt === "string" ? system_prompt : undefined,
        previous_response_id: previous_response_id || undefined,
        temperature,
        max_output_tokens,
        store: Boolean(store),
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return res.status(upstream.status).json({
        ok: false,
        error: errorText,
      });
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
      res.status(500).json({
        ok: false,
        error: message,
      });
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
  console.log("");
  console.log("Make sure LM Studio local server is running.");
  console.log("");
});
