const DEFAULT_SYSTEM_PROMPT = "You are a helpful local AI assistant running through LM Studio.";
const STORAGE_KEY = "xdev-lmstudio-browser-chat.state.v2";

const modelSelect = document.getElementById("modelSelect");
const temperatureInput = document.getElementById("temperatureInput");
const maxTokensInput = document.getElementById("maxTokensInput");
const systemPromptInput = document.getElementById("systemPromptInput");
const presetSelect = document.getElementById("presetSelect");
const savePresetBtn = document.getElementById("savePresetBtn");
const deletePresetBtn = document.getElementById("deletePresetBtn");
const statusBox = document.getElementById("statusBox");
const chatBox = document.getElementById("chatBox");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const regenerateBtn = document.getElementById("regenerateBtn");
const checkConnectionBtn = document.getElementById("checkConnectionBtn");
const conversationList = document.getElementById("conversationList");
const chatCountBadge = document.getElementById("chatCountBadge");
const newChatBtn = document.getElementById("newChatBtn");
const renameChatBtn = document.getElementById("renameChatBtn");
const deleteChatBtn = document.getElementById("deleteChatBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportMdBtn = document.getElementById("exportMdBtn");
const importJsonInput = document.getElementById("importJsonInput");
const refreshMemoryBtn = document.getElementById("refreshMemoryBtn");
const memoryList = document.getElementById("memoryList");

let availableModels = [];
let isStreaming = false;

const state = loadState();

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function newConversation(title = "New Chat") {
  return {
    id: createId("chat"),
    title,
    model: "",
    temperature: 0.7,
    max_tokens: 512,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    messages: [],
    responseIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function defaultPresetList() {
  return [
    { id: createId("preset"), name: "Helpful Assistant", prompt: DEFAULT_SYSTEM_PROMPT },
    { id: createId("preset"), name: "Concise", prompt: "Give short, direct answers with no fluff." },
    { id: createId("preset"), name: "Code Reviewer", prompt: "Review code critically and suggest concrete improvements." },
  ];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = newConversation("Chat 1");
      return {
        conversations: [initial],
        activeConversationId: initial.id,
        modelProfiles: {},
        presets: defaultPresetList(),
      };
    }

    const parsed = JSON.parse(raw);
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations.map((conversation) => ({
        ...newConversation(conversation.title || "Chat"),
        ...conversation,
        messages: Array.isArray(conversation.messages) ? conversation.messages : [],
        responseIds: Array.isArray(conversation.responseIds) ? conversation.responseIds : [],
      }))
      : [];
    if (!conversations.length) {
      const initial = newConversation("Chat 1");
      return {
        conversations: [initial],
        activeConversationId: initial.id,
        modelProfiles: parsed.modelProfiles || {},
        presets: Array.isArray(parsed.presets) && parsed.presets.length ? parsed.presets : defaultPresetList(),
      };
    }

    return {
      conversations,
      activeConversationId: parsed.activeConversationId || conversations[0].id,
      modelProfiles: parsed.modelProfiles || {},
      presets: Array.isArray(parsed.presets) && parsed.presets.length ? parsed.presets : defaultPresetList(),
    };
  } catch {
    const initial = newConversation("Chat 1");
    return {
      conversations: [initial],
      activeConversationId: initial.id,
      modelProfiles: {},
      presets: defaultPresetList(),
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setStatus(message, type = "") {
  statusBox.className = `status panel ${type}`.trim();
  statusBox.textContent = message;
}

function getActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || null;
}

function touchConversation(conversation) {
  conversation.updatedAt = new Date().toISOString();
}

function conversationTitleFromMessage(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 40) || "New Chat";
}

function getLastResponseId(conversation) {
  if (!conversation || !Array.isArray(conversation.responseIds) || !conversation.responseIds.length) {
    return null;
  }
  return conversation.responseIds[conversation.responseIds.length - 1];
}

function renderConversationList() {
  conversationList.innerHTML = "";
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  chatCountBadge.textContent = String(sorted.length);

  for (const conversation of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item ${conversation.id === state.activeConversationId ? "active" : ""}`;

    const title = document.createElement("span");
    title.className = "conversation-item-title";
    title.textContent = conversation.title || "Untitled Chat";

    const meta = document.createElement("span");
    meta.className = "conversation-item-meta";
    meta.textContent = `${conversation.messages?.length || 0} msg`;

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", () => {
      state.activeConversationId = conversation.id;
      saveState();
      renderAll();
    });
    conversationList.appendChild(button);
  }
}

function updateModelControlsFromConversation(conversation) {
  if (!conversation) return;
  modelSelect.value = conversation.model || "";
  temperatureInput.value = String(conversation.temperature ?? 0.7);
  maxTokensInput.value = String(conversation.max_tokens ?? 512);
  systemPromptInput.value = conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}

function renderPresetSelect() {
  presetSelect.innerHTML = "";
  for (const preset of state.presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect.appendChild(option);
  }
}

function applyModelProfileIfPresent(conversation, modelId) {
  if (!modelId || !conversation) return;
  const profile = state.modelProfiles[modelId];
  if (!profile) return;
  conversation.temperature = Number(profile.temperature ?? conversation.temperature ?? 0.7);
  conversation.max_tokens = Number(profile.max_tokens ?? conversation.max_tokens ?? 512);
}

function normalizeModelSelectionForConversation(conversation) {
  if (!conversation) return;
  if (!availableModels.length) {
    conversation.model = "";
    return;
  }

  const exists = availableModels.some((model) => model.id === conversation.model);
  if (exists) return;

  conversation.model = availableModels[0].id;
  applyModelProfileIfPresent(conversation, conversation.model);
}

function appendTextChunk(parent, text) {
  if (!text) return;
  const div = document.createElement("div");
  div.className = "markdown-text";
  div.textContent = text;
  parent.appendChild(div);
}

function renderMessageContent(container, content) {
  const pattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let match;
  let lastIndex = 0;

  while ((match = pattern.exec(content)) !== null) {
    const [fullMatch, language, code] = match;
    const before = content.slice(lastIndex, match.index);
    appendTextChunk(container, before);

    const codeBlock = document.createElement("div");
    codeBlock.className = "code-block";

    const header = document.createElement("div");
    header.className = "code-header";

    const label = document.createElement("span");
    label.textContent = language || "code";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-code-btn";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(code);
      setStatus("Code copied.", "ok");
    });

    header.appendChild(label);
    header.appendChild(copyButton);

    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    codeBlock.appendChild(header);
    codeBlock.appendChild(pre);
    container.appendChild(codeBlock);

    lastIndex = match.index + fullMatch.length;
  }

  appendTextChunk(container, content.slice(lastIndex));
}

function renderMessages() {
  chatBox.innerHTML = "";
  const conversation = getActiveConversation();
  if (!conversation) return;

  for (let index = 0; index < conversation.messages.length; index += 1) {
    const message = conversation.messages[index];
    const wrapper = document.createElement("div");
    wrapper.className = `message ${message.role}`;

    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = message.role === "user" ? "You" : "Assistant";

    const content = document.createElement("div");
    content.className = "message-content";
    const isStreamingDraft =
      isStreaming &&
      message.role === "assistant" &&
      !message.content &&
      index === conversation.messages.length - 1;

    if (isStreamingDraft) {
      const typing = document.createElement("div");
      typing.className = "typing-indicator";
      for (let i = 0; i < 3; i += 1) {
        typing.appendChild(document.createElement("span"));
      }
      content.appendChild(typing);
    } else {
      renderMessageContent(content, message.content || "");
    }

    wrapper.appendChild(role);
    wrapper.appendChild(content);

    if (message.role === "assistant") {
      const messageActions = document.createElement("div");
      messageActions.className = "message-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "secondary-btn";
      copyBtn.textContent = "Copy response";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(message.content || "");
        setStatus("Response copied.", "ok");
      });

      const goodBtn = document.createElement("button");
      goodBtn.type = "button";
      goodBtn.className = "secondary-btn";
      goodBtn.textContent = "👍 Good";
      goodBtn.addEventListener("click", async () => {
        const previousUser = conversation.messages[index - 1]?.role === "user"
          ? conversation.messages[index - 1].content
          : "";
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            messageIndex: index,
            rating: "good",
            userInput: previousUser,
            assistantMessage: message.content || "",
          }),
        });
        setStatus("Feedback saved: good.", "ok");
        await loadMemoryList();
      });

      const badBtn = document.createElement("button");
      badBtn.type = "button";
      badBtn.className = "secondary-btn";
      badBtn.textContent = "👎 Bad";
      badBtn.addEventListener("click", async () => {
        const previousUser = conversation.messages[index - 1]?.role === "user"
          ? conversation.messages[index - 1].content
          : "";
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            messageIndex: index,
            rating: "bad",
            userInput: previousUser,
            assistantMessage: message.content || "",
          }),
        });
        setStatus("Feedback saved: bad.", "ok");
      });

      const rememberBtn = document.createElement("button");
      rememberBtn.type = "button";
      rememberBtn.className = "secondary-btn";
      rememberBtn.textContent = "🧠 Remember";
      rememberBtn.addEventListener("click", async () => {
        const text = (message.content || "").trim();
        if (!text) return;
        const response = await fetch("/api/memory/remember", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Preferred answer style: ${text.slice(0, 280)}`,
            kind: "rule",
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setStatus(`Memory error: ${data.error || "Could not remember"}`, "error");
          return;
        }
        setStatus("Saved to memory.", "ok");
        await loadMemoryList();
      });

      messageActions.appendChild(copyBtn);
      messageActions.appendChild(goodBtn);
      messageActions.appendChild(badBtn);
      messageActions.appendChild(rememberBtn);
      wrapper.appendChild(messageActions);
    }

    chatBox.appendChild(wrapper);
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

function renderMemoryList(memories) {
  memoryList.innerHTML = "";
  if (!Array.isArray(memories) || !memories.length) {
    const empty = document.createElement("div");
    empty.className = "memory-item empty";
    empty.textContent = "No learned memory yet.";
    memoryList.appendChild(empty);
    return;
  }

  for (const memory of memories) {
    const item = document.createElement("div");
    item.className = "memory-item";

    const top = document.createElement("div");
    top.className = "memory-top";

    const meta = document.createElement("div");
    meta.className = "memory-meta";

    const kind = document.createElement("span");
    kind.className = "memory-kind";
    kind.textContent = memory.kind || "fact";

    const weight = document.createElement("span");
    weight.className = "memory-weight";
    weight.textContent = `w:${Number(memory.weight || 0).toFixed(2)}`;

    meta.appendChild(kind);
    meta.appendChild(weight);

    const text = document.createElement("div");
    text.className = "memory-text";
    text.textContent = memory.text || "";

    const forgetBtn = document.createElement("button");
    forgetBtn.type = "button";
    forgetBtn.className = "secondary-btn";
    forgetBtn.textContent = "Forget";
    forgetBtn.addEventListener("click", async () => {
      const response = await fetch("/api/memory/forget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: memory.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setStatus(`Memory error: ${data.error || "Could not forget"}`, "error");
        return;
      }
      setStatus("Memory forgotten.", "ok");
      await loadMemoryList();
    });

    top.appendChild(meta);
    top.appendChild(forgetBtn);

    item.appendChild(top);
    item.appendChild(text);
    memoryList.appendChild(item);
  }
}

async function loadMemoryList() {
  try {
    const response = await fetch("/api/memory/all");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Could not load memory");
    }
    renderMemoryList(data.memories || []);
  } catch (error) {
    setStatus(`Memory load error: ${error.message}`, "error");
  }
}

function renderAll() {
  const conversation = getActiveConversation();
  if (!conversation) return;
  normalizeModelSelectionForConversation(conversation);
  renderConversationList();
  renderPresetSelect();
  renderMessages();
  updateModelControlsFromConversation(conversation);
}

function updateActiveConversationSettings() {
  const conversation = getActiveConversation();
  if (!conversation) return;

  conversation.model = modelSelect.value;
  conversation.temperature = Number(temperatureInput.value || 0.7);
  conversation.max_tokens = Number(maxTokensInput.value || 512);
  conversation.systemPrompt = systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  touchConversation(conversation);

  if (conversation.model) {
    state.modelProfiles[conversation.model] = {
      temperature: conversation.temperature,
      max_tokens: conversation.max_tokens,
    };
  }

  saveState();
}

async function loadModels() {
  try {
    setStatus("Loading models from LM Studio...");
    const response = await fetch("/api/models");
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Could not load models");
    }

    availableModels = data.models || [];
    modelSelect.innerHTML = "";

    if (!availableModels.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No models found";
      modelSelect.appendChild(option);
      setStatus("Connected, but no models were returned. Load or download a model in LM Studio.", "error");
      return;
    }

    for (const model of availableModels) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      modelSelect.appendChild(option);
    }

    const conversation = getActiveConversation();
    if (conversation) {
      if (data.defaultModel && !conversation.model) {
        conversation.model = data.defaultModel;
      }
      normalizeModelSelectionForConversation(conversation);
      modelSelect.value = conversation.model || availableModels[0].id;
      conversation.model = modelSelect.value;
      touchConversation(conversation);
      saveState();
      renderAll();
    }

    setStatus(`Connected. Loaded ${availableModels.length} model(s).`, "ok");
  } catch (error) {
    modelSelect.innerHTML = '<option value="">Could not load models</option>';
    setStatus(`API error: ${error.message}`, "error");
  }
}

async function checkConnection() {
  try {
    setStatus("Checking LM Studio connection...");
    const response = await fetch("/api/health");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || data.message || "Connection failed");
    }
    setStatus(`${data.message}. API: ${data.lmStudioBaseUrl}`, "ok");
  } catch (error) {
    setStatus(`Connection failed: ${error.message}`, "error");
  }
}

async function sendMessage(userText) {
  const conversation = getActiveConversation();
  if (!conversation) return;
  if (!conversation.model) {
    setStatus("Select a model first.", "error");
    return;
  }

  if (!conversation.messages.length) {
    conversation.title = conversationTitleFromMessage(userText);
  }

  conversation.messages.push({ role: "user", content: userText });
  conversation.messages.push({ role: "assistant", content: "" });
  const assistantDraftIndex = conversation.messages.length - 1;
  touchConversation(conversation);
  saveState();
  renderAll();

  isStreaming = true;
  sendBtn.disabled = true;
  sendBtn.textContent = "Streaming...";
  regenerateBtn.disabled = true;
  setStatus("Generating response...");

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: conversation.model,
        input: userText,
        system_prompt: conversation.systemPrompt,
        previous_response_id: getLastResponseId(conversation),
        temperature: conversation.temperature,
        max_output_tokens: conversation.max_tokens,
        store: true,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Chat request failed");
    }

    if (!response.body) {
      throw new Error("Streaming response had no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalMessage = "";
    let finalReasoning = "";
    let finalResponseId = null;
    let streamError = null;

    function processEventBlock(block) {
      const lines = block.split("\n");
      let eventType = "message";
      const dataLines = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (!dataLines.length) return;

      let payload;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        return;
      }

      if (eventType === "message.delta" || payload.type === "message.delta") {
        const delta = typeof payload.content === "string" ? payload.content : "";
        if (delta) {
          finalMessage += delta;
          conversation.messages[assistantDraftIndex].content = finalMessage;
          renderMessages();
        }
        return;
      }

      if (eventType === "reasoning.delta" || payload.type === "reasoning.delta") {
        const delta = typeof payload.content === "string" ? payload.content : "";
        if (delta) {
          finalReasoning += delta;
        }
        return;
      }

      if (eventType === "chat.end" || payload.type === "chat.end") {
        const result = payload.result || {};
        const output = Array.isArray(result.output) ? result.output : [];
        const messageFromOutput = output
          .filter((item) => item?.type === "message" && typeof item?.content === "string")
          .map((item) => item.content)
          .join("");
        const reasoningFromOutput = output
          .filter((item) => item?.type === "reasoning" && typeof item?.content === "string")
          .map((item) => item.content)
          .join("");

        if (!finalMessage) {
          finalMessage = messageFromOutput || reasoningFromOutput || finalReasoning;
        }

        if (finalMessage) {
          conversation.messages[assistantDraftIndex].content = finalMessage;
          renderMessages();
        }

        if (typeof result.response_id === "string" && result.response_id.startsWith("resp_")) {
          finalResponseId = result.response_id;
        }
        return;
      }

      if (eventType === "error" || payload.type === "error") {
        streamError = payload.error?.message || "Streaming request failed";
        return;
      }

      if (payload.type === "model_load.progress" && typeof payload.progress === "number") {
        setStatus(`Loading model... ${Math.round(payload.progress * 100)}%`);
      } else if (payload.type === "prompt_processing.progress" && typeof payload.progress === "number") {
        setStatus(`Processing prompt... ${Math.round(payload.progress * 100)}%`);
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex !== -1) {
        const block = buffer.slice(0, splitIndex).trim();
        buffer = buffer.slice(splitIndex + 2);
        if (block) processEventBlock(block);
        splitIndex = buffer.indexOf("\n\n");
      }
    }

    const tail = buffer.trim();
    if (tail) processEventBlock(tail);

    if (streamError) {
      throw new Error(streamError);
    }

    if (!conversation.messages[assistantDraftIndex].content && !finalMessage) {
      conversation.messages[assistantDraftIndex].content = "No message content returned.";
    }

    if (finalResponseId) {
      conversation.responseIds.push(finalResponseId);
    }

    touchConversation(conversation);
    saveState();
    setStatus("Ready.", "ok");
    await loadMemoryList();
  } catch (error) {
    conversation.messages[assistantDraftIndex].content = `Error: ${error.message}`;
    touchConversation(conversation);
    saveState();
    setStatus(`Chat error: ${error.message}`, "error");
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    sendBtn.textContent = "Send";
    regenerateBtn.disabled = false;
    renderAll();
  }
}

async function regenerateLastAssistantReply() {
  const conversation = getActiveConversation();
  if (!conversation) return;

  const lastAssistantIndex = [...conversation.messages].reverse().findIndex((message) => message.role === "assistant");
  if (lastAssistantIndex === -1) {
    setStatus("No assistant response to regenerate.", "error");
    return;
  }

  const assistantAbsoluteIndex = conversation.messages.length - 1 - lastAssistantIndex;
  const lastUserIndex = assistantAbsoluteIndex - 1;
  if (lastUserIndex < 0 || conversation.messages[lastUserIndex].role !== "user") {
    setStatus("Could not find user message to regenerate.", "error");
    return;
  }

  const userText = conversation.messages[lastUserIndex].content;
  conversation.messages.splice(lastUserIndex);
  if (conversation.responseIds.length) {
    conversation.responseIds.pop();
  }
  touchConversation(conversation);
  saveState();
  renderAll();
  await sendMessage(userText);
}

function createConversation() {
  const nextIndex = state.conversations.length + 1;
  const conversation = newConversation(`Chat ${nextIndex}`);
  state.conversations.push(conversation);
  state.activeConversationId = conversation.id;
  saveState();
  renderAll();
}

function renameActiveConversation() {
  const conversation = getActiveConversation();
  if (!conversation) return;
  const nextName = window.prompt("Rename chat:", conversation.title || "Untitled Chat");
  if (nextName === null) return;
  const name = nextName.trim();
  if (!name) {
    setStatus("Chat name cannot be empty.", "error");
    return;
  }
  conversation.title = name;
  touchConversation(conversation);
  saveState();
  renderAll();
}

function deleteActiveConversation() {
  if (state.conversations.length <= 1) {
    setStatus("You must keep at least one chat.", "error");
    return;
  }
  const conversation = getActiveConversation();
  if (!conversation) return;
  const confirmed = window.confirm(`Delete "${conversation.title}"?`);
  if (!confirmed) return;

  state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
  state.activeConversationId = state.conversations[0].id;
  saveState();
  renderAll();
}

function saveCurrentPromptAsPreset() {
  const prompt = systemPromptInput.value.trim();
  if (!prompt) {
    setStatus("System prompt is empty.", "error");
    return;
  }
  const name = window.prompt("Preset name:");
  if (name === null) return;
  const cleanName = name.trim();
  if (!cleanName) {
    setStatus("Preset name cannot be empty.", "error");
    return;
  }

  state.presets.push({
    id: createId("preset"),
    name: cleanName,
    prompt,
  });
  saveState();
  renderPresetSelect();
  presetSelect.value = state.presets[state.presets.length - 1].id;
  setStatus("Preset saved.", "ok");
}

function deleteSelectedPreset() {
  if (state.presets.length <= 1) {
    setStatus("Keep at least one preset.", "error");
    return;
  }
  const selectedId = presetSelect.value;
  const selected = state.presets.find((preset) => preset.id === selectedId);
  if (!selected) return;
  const confirmed = window.confirm(`Delete preset "${selected.name}"?`);
  if (!confirmed) return;
  state.presets = state.presets.filter((preset) => preset.id !== selectedId);
  saveState();
  renderPresetSelect();
  setStatus("Preset deleted.", "ok");
}

function applySelectedPreset() {
  const selected = state.presets.find((preset) => preset.id === presetSelect.value);
  if (!selected) return;
  systemPromptInput.value = selected.prompt;
  updateActiveConversationSettings();
  setStatus(`Applied preset "${selected.name}".`, "ok");
}

function triggerDownload(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportActiveConversationJson() {
  const conversation = getActiveConversation();
  if (!conversation) return;
  const safeTitle = (conversation.title || "chat").replace(/[^\w-]+/g, "_");
  const payload = {
    exportedAt: new Date().toISOString(),
    conversation,
  };
  triggerDownload(`${safeTitle}.json`, "application/json", JSON.stringify(payload, null, 2));
  setStatus("Conversation exported as JSON.", "ok");
}

function exportActiveConversationMarkdown() {
  const conversation = getActiveConversation();
  if (!conversation) return;
  const safeTitle = (conversation.title || "chat").replace(/[^\w-]+/g, "_");
  const lines = [];
  lines.push(`# ${conversation.title || "Chat"}`);
  lines.push("");
  lines.push(`- Model: ${conversation.model || "(none)"}`);
  lines.push(`- Temperature: ${conversation.temperature}`);
  lines.push(`- Max tokens: ${conversation.max_tokens}`);
  lines.push("");
  lines.push("## System Prompt");
  lines.push("");
  lines.push(conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  lines.push("");
  lines.push("## Messages");
  lines.push("");

  for (const message of conversation.messages) {
    lines.push(`### ${message.role}`);
    lines.push("");
    lines.push(message.content || "");
    lines.push("");
  }

  triggerDownload(`${safeTitle}.md`, "text/markdown", lines.join("\n"));
  setStatus("Conversation exported as Markdown.", "ok");
}

async function importConversationFromFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    setStatus("Invalid JSON file.", "error");
    return;
  }

  const conversation = parsed?.conversation;
  if (!conversation || typeof conversation !== "object" || !Array.isArray(conversation.messages)) {
    setStatus("JSON does not contain a valid exported conversation.", "error");
    return;
  }

  const imported = {
    ...newConversation("Imported Chat"),
    ...conversation,
    id: createId("chat"),
    title: conversation.title || "Imported Chat",
    messages: conversation.messages.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || ""),
    })),
    responseIds: [],
    systemPrompt: String(conversation.systemPrompt || DEFAULT_SYSTEM_PROMPT),
    updatedAt: new Date().toISOString(),
  };

  state.conversations.push(imported);
  state.activeConversationId = imported.id;
  saveState();
  renderAll();
  setStatus(`Imported "${imported.title}".`, "ok");
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userText = messageInput.value.trim();
  if (!userText) return;
  messageInput.value = "";
  await sendMessage(userText);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

modelSelect.addEventListener("change", () => {
  const conversation = getActiveConversation();
  if (!conversation) return;
  conversation.model = modelSelect.value;
  applyModelProfileIfPresent(conversation, conversation.model);
  updateModelControlsFromConversation(conversation);
  updateActiveConversationSettings();
});

temperatureInput.addEventListener("change", updateActiveConversationSettings);
maxTokensInput.addEventListener("change", updateActiveConversationSettings);
systemPromptInput.addEventListener("change", updateActiveConversationSettings);
presetSelect.addEventListener("change", applySelectedPreset);

clearBtn.addEventListener("click", () => {
  const conversation = getActiveConversation();
  if (!conversation) return;
  conversation.messages = [];
  conversation.responseIds = [];
  touchConversation(conversation);
  saveState();
  renderAll();
  setStatus("Chat cleared.", "ok");
});

regenerateBtn.addEventListener("click", regenerateLastAssistantReply);
checkConnectionBtn.addEventListener("click", checkConnection);
newChatBtn.addEventListener("click", createConversation);
renameChatBtn.addEventListener("click", renameActiveConversation);
deleteChatBtn.addEventListener("click", deleteActiveConversation);
refreshMemoryBtn.addEventListener("click", loadMemoryList);
savePresetBtn.addEventListener("click", saveCurrentPromptAsPreset);
deletePresetBtn.addEventListener("click", deleteSelectedPreset);
exportJsonBtn.addEventListener("click", exportActiveConversationJson);
exportMdBtn.addEventListener("click", exportActiveConversationMarkdown);
importJsonInput.addEventListener("change", async () => {
  const file = importJsonInput.files?.[0];
  if (!file) return;
  await importConversationFromFile(file);
  importJsonInput.value = "";
});

renderAll();
loadModels();
loadMemoryList();
