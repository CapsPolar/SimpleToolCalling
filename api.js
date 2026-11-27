function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function appendToolCallDelta(toolCalls, deltas) {
  if (!Array.isArray(deltas)) {
    throw new Error("Chat server returned invalid tool calls.");
  }

  for (const delta of deltas) {
    if (!isRecord(delta) || !Number.isInteger(delta.index) || delta.index < 0) {
      throw new Error("Chat server returned an invalid tool call.");
    }

    let toolCall = toolCalls.get(delta.index);
    if (!toolCall) {
      toolCall = {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      toolCalls.set(delta.index, toolCall);
    }

    if (delta.id !== undefined) {
      if (typeof delta.id !== "string") {
        throw new Error("Chat server returned an invalid tool call ID.");
      }
      toolCall.id += delta.id;
    }

    if (delta.type !== undefined) {
      if (typeof delta.type !== "string") {
        throw new Error("Chat server returned an invalid tool call type.");
      }
      toolCall.type = delta.type;
    }

    if (delta.function !== undefined) {
      if (!isRecord(delta.function)) {
        throw new Error("Chat server returned an invalid tool function.");
      }
      if (delta.function.name !== undefined) {
        if (typeof delta.function.name !== "string") {
          throw new Error("Chat server returned an invalid tool name.");
        }
        toolCall.function.name += delta.function.name;
      }
      if (delta.function.arguments !== undefined) {
        if (typeof delta.function.arguments !== "string") {
          throw new Error("Chat server returned invalid tool arguments.");
        }
        toolCall.function.arguments += delta.function.arguments;
      }
    }
  }
}

function getChoiceDelta(data) {
  if (!isRecord(data)) {
    throw new Error("Chat server returned an invalid streaming event.");
  }
  if (isRecord(data.error)) {
    const message = data.error.message;
    throw new Error(
      typeof message === "string" ? message : "Chat server returned an error.",
    );
  }
  if (!Array.isArray(data.choices)) {
    throw new Error("Chat server event did not contain chat choices.");
  }

  const choice = data.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) {
    return null;
  }

  const { content, tool_calls: toolCalls } = choice.delta;
  if (content !== undefined && content !== null && typeof content !== "string") {
    throw new Error("Chat server returned a non-text response.");
  }
  return { content: content ?? "", toolCalls };
}

function finalizeToolCalls(toolCalls) {
  return [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => {
      if (!toolCall.id || toolCall.type !== "function" || !toolCall.function.name) {
        throw new Error("Chat server returned an incomplete tool call.");
      }

      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        throw new Error(
          `Chat server returned invalid arguments for tool "${toolCall.function.name}".`,
        );
      }
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error(
          `Chat server returned non-object arguments for tool "${toolCall.function.name}".`,
        );
      }

      return {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: args,
      };
    });
}

async function sendOpenAICompatibleMessage(
  endpoint,
  messages,
  onTextDelta,
  requestOptions = {},
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...requestOptions, messages, stream: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat server returned ${response.status}: ${body}`);
  }
  if (!response.body) {
    throw new Error("Chat server did not provide a response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls = new Map();

  const processLine = (line) => {
    if (!line.startsWith("data:")) {
      return;
    }

    const data = line.slice(5).trimStart();
    if (!data || data === "[DONE]") {
      return;
    }

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("Chat server returned an invalid streaming event.");
    }

    const delta = getChoiceDelta(event);
    if (!delta) {
      return;
    }
    if (delta.content) {
      content += delta.content;
      onTextDelta(delta.content);
    }
    if (delta.toolCalls !== undefined) {
      appendToolCallDelta(toolCalls, delta.toolCalls);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      processLine(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }

    if (done) {
      if (buffer) {
        processLine(buffer.replace(/\r$/, ""));
      }
      break;
    }
  }

  return { content, toolCalls: finalizeToolCalls(toolCalls) };
}

class OpenAICompatibleAPI {
  constructor(endpoint, model = null) {
    this.endpoint = endpoint;
    this.model = model;
  }

  sendMessage(messages, onTextDelta, requestOptions = {}) {
    return sendOpenAICompatibleMessage(
      this.endpoint,
      messages,
      onTextDelta,
      {
        ...requestOptions,
        ...(this.model ? { model: this.model } : {}),
      },
    );
  }
}

export class LlamaAPI extends OpenAICompatibleAPI {
  constructor() {
    super(
      process.env.LLAMA_URL ?? "http://localhost:8080/v1/chat/completions",
    );
  }
}

export class OllamaAPI extends OpenAICompatibleAPI {
  constructor() {
    super(
      process.env.OLLAMA_URL ?? "http://localhost:11434/v1/chat/completions",
      process.env.OLLAMA_MODEL ?? "ministral-3:3b",
    );
  }
}
