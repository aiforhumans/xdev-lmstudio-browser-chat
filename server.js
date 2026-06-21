import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const APP_PORT = Number(process.env.APP_PORT || 3000);
const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "";

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

app.get("/api/health", async (_req, res) => {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`);

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        message: `LM Studio responded with HTTP ${response.status}`,
        lmStudioBaseUrl: LM_STUDIO_BASE_URL,
      });
    }

    const data = await response.json();

    res.json({
      ok: true,
      message: "Connected to LM Studio",
      lmStudioBaseUrl: LM_STUDIO_BASE_URL,
      defaultModel: DEFAULT_MODEL,
      models: data.data || [],
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      message: "Could not connect to LM Studio",
      error: getErrorMessage(error),
      lmStudioBaseUrl: LM_STUDIO_BASE_URL,
    });
  }
});

app.get("/api/models", async (_req, res) => {
  try {
    const response = await fetch(`${LM_STUDIO_BASE_URL}/models`);

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
      messages,
      temperature = 0.7,
      max_tokens = 512,
    } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        ok: false,
        error: "messages must be an array",
      });
    }

    const selectedModel = model || DEFAULT_MODEL;

    if (!selectedModel) {
      return res.status(400).json({
        ok: false,
        error: "No model selected. Choose a model in the UI or set DEFAULT_MODEL in .env.",
      });
    }

    const response = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature,
        max_tokens,
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
    const assistantMessage = data.choices?.[0]?.message?.content || "";

    res.json({
      ok: true,
      message: assistantMessage,
      raw: data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: getErrorMessage(error),
    });
  }
});

app.listen(APP_PORT, () => {
  console.log("");
  console.log("XDEV LM Studio Browser Chat");
  console.log("---------------------------");
  console.log(`Browser UI:        http://localhost:${APP_PORT}`);
  console.log(`LM Studio API:     ${LM_STUDIO_BASE_URL}`);
  console.log("");
  console.log("Make sure LM Studio local server is running.");
  console.log("");
});
