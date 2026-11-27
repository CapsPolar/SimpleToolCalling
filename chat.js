import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { endpoint, sendMessage } from "./llama.js";
import { tools } from "./tools.js";

function imageContent(name, content, result) {
  return [
    { type: "text", text: `Tool result (${name}):\n${content}` },
    {
      type: "image_url",
      image_url: {
        url: `data:${result.mimeType};base64,${result.data}`,
      },
    },
  ];
}

class ChatWithTools {
  constructor() {
    this.toolMap = new Map(
      tools.map((tool) => [tool.definition.function.name, tool]),
    );
  }

  getSystemPrompt() {
    return null;
  }

  getRequestOptions() {
    return {};
  }

  getToolDefinitions() {
    return tools.map((tool) => tool.definition);
  }

  getToolCalls() {
    throw new Error("Chat-with-tools subclasses must implement getToolCalls().");
  }

  createConversation(messages, turnMessages) {
    const systemPrompt = this.getSystemPrompt();
    return [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
      ...turnMessages,
    ];
  }

  createAssistantMessage(reply, toolCalls) {
    return { role: "assistant", content: reply.content };
  }

  appendToolResults(turnMessages, results) {
    turnMessages.push({
      role: "user",
      content: results
        .map(({ name, content }) => `Tool result (${name}):\n${content}`)
        .join("\n\n"),
    });
  }

  getFollowUpMessages() {
    return [];
  }

  async executeToolCall(call) {
    const tool = this.toolMap.get(call.name);
    if (!tool) {
      throw new Error(`Unknown tool "${call.name}"`);
    }

    const fn = tool.executor ?? tool.execute ?? tool.handler ?? tool.run;
    if (typeof fn !== "function") {
      throw new Error(`Tool "${call.name}" has no executable function`);
    }
    return await fn(call.arguments);
  }

  formatToolResult(result) {
    if (result?.type === "image") {
      return `Loaded image from ${result.filePath} (${result.mimeType}).`;
    }
    return typeof result === "string"
      ? result
      : (JSON.stringify(result, null, 2) ?? String(result));
  }

  async run() {
    const readline = createInterface({ input: stdin, output: stdout });
    const messages = [];

    stdout.write(`Chat endpoint: ${endpoint}\nType /exit to quit.\n`);

    try {
      while (true) {
        let input;
        try {
          input = (await readline.question("you> ")).trim();
        } catch {
          break;
        }

        if (input === "/exit" || input === "/quit") {
          break;
        }
        if (!input) {
          continue;
        }

        const turnMessages = [{ role: "user", content: input }];
        try {
          let followUpMessages = [];
          while (true) {
            const conversation = this.createConversation(messages, turnMessages);
            stdout.write("ai> ");
            const reply = await sendMessage(
              conversation,
              (delta) => stdout.write(delta),
              this.getRequestOptions(),
            );
            stdout.write("\n");

            const toolCalls = this.getToolCalls(reply);
            turnMessages.push(this.createAssistantMessage(reply, toolCalls));
            if (toolCalls.length === 0) {
              if (followUpMessages.length > 0) {
                turnMessages.push(...followUpMessages);
                followUpMessages = [];
                continue;
              }
              break;
            }

            const results = [];
            for (const call of toolCalls) {
              const toolResult = await this.executeToolCall(call);
              const content = this.formatToolResult(toolResult);
              stdout.write(`tool(${call.name})> ${content}\n`);
              results.push({
                name: call.name,
                content,
                result: toolResult,
                call,
              });
            }
            this.appendToolResults(turnMessages, results);
            followUpMessages.push(...this.getFollowUpMessages(results));
          }

          messages.push(...turnMessages);
        } catch (error) {
          stdout.write("\n");
          const detail = error instanceof Error ? error.message : String(error);
          stdout.write(`Error: ${detail}\n`);
        }
      }
    } finally {
      readline.close();
    }
  }
}

export class ToolSupportingModelChatWithTools extends ChatWithTools {
  getRequestOptions() {
    return { tools: this.getToolDefinitions(), tool_choice: "auto" };
  }

  getToolCalls(reply) {
    return reply.toolCalls;
  }

  createAssistantMessage(reply, toolCalls) {
    return {
      role: "assistant",
      content: reply.content || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          }
        : {}),
    };
  }

  appendToolResults(turnMessages, results) {
    for (const { content, call } of results) {
      turnMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content,
      });
    }
  }

  getFollowUpMessages(results) {
    const imageResults = results.filter(
      ({ result }) => result?.type === "image",
    );
    if (imageResults.length === 0) return [];

    return [
      {
        role: "user",
        content: imageResults.flatMap(({ name, content, result }) =>
          imageContent(name, content, result),
        ),
      },
    ];
  }
}

export class LlamaChatWithTools extends ToolSupportingModelChatWithTools {
  appendToolResults(turnMessages, results) {
    for (const { name, content, call, result } of results) {
      turnMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          result?.type === "image"
            ? imageContent(name, content, result)
            : content,
      });
    }
  }

  getFollowUpMessages() {
    return [];
  }
}

export class OllamaChatWithTools extends ToolSupportingModelChatWithTools {}

export class CompatibilityChatWithTools extends ChatWithTools {
  getSystemPrompt() {
    const toolDescriptions = this.getToolDefinitions()
      .map((definition) => JSON.stringify(definition.function, null, 2))
      .join("\n");
    return `You have access to the following tools:
${toolDescriptions}

When calling a tool, include JSON like:
{"name": "tool_name", "arguments": { ... }}`;
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  readBalancedObject(text, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return { json: text.slice(startIndex, i + 1), endIndex: i + 1 };
        }
      }
    }

    return null;
  }

  parseToolCallsWithPattern(reply, pattern) {
    const calls = [];
    let match;

    while ((match = pattern.exec(reply)) !== null) {
      const name = match[1];
      const argsStart = match.index + match[0].length - 1;
      const block = this.readBalancedObject(reply, argsStart);
      if (!block) continue;

      try {
        const args = JSON.parse(block.json);
        calls.push({ name, arguments: args });
        pattern.lastIndex = block.endIndex;
      } catch {
        // Keep scanning if this block wasn't valid JSON.
      }
    }

    return calls;
  }

  parseCompatibilityToolCalls(reply) {
    const names = [...this.toolMap.keys()]
      .map((name) => this.escapeRegex(name))
      .join("|");
    if (!names) return [];

    const jsonCalls = this.parseToolCallsWithPattern(
      reply,
      new RegExp(
        `\\{\\s*"name"\\s*:\\s*"(${names})"\\s*,\\s*"arguments"\\s*:\\s*\\{`,
        "g",
      ),
    );
    const tagCalls = this.parseToolCallsWithPattern(
      reply,
      new RegExp(`\\[TOOL_CALLS\\]\\s*(${names})\\s*\\[ARGS\\]\\s*\\{`, "g"),
    );

    return [...jsonCalls, ...tagCalls];
  }

  getToolCalls(reply) {
    return this.parseCompatibilityToolCalls(reply.content);
  }

  appendToolResults(turnMessages, results) {
    const imageResults = results.filter(
      ({ result }) => result?.type === "image",
    );
    if (imageResults.length === 0) {
      super.appendToolResults(turnMessages, results);
      return;
    }

    const content = results.flatMap(({ name, content, result }) =>
      result?.type === "image"
        ? [
            { type: "text", text: `Tool result (${name}):\n${content}` },
            {
              type: "image_url",
              image_url: {
                url: `data:${result.mimeType};base64,${result.data}`,
              },
            },
          ]
        : [{ type: "text", text: `Tool result (${name}):\n${content}` }],
    );
    turnMessages.push({ role: "user", content });
  }
}

new CompatibilityChatWithTools().run().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start chat: ${detail}`);
  process.exitCode = 1;
});
