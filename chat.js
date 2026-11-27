import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { endpoint, sendMessage } from "./llama.js";
import { tools } from "./tools.js";

const toolMap = new Map(
  tools.map((tool) => [tool.definition.function.name, tool]),
);

const compatibilitySystemPrompt = `You have access to the following tools:
${tools.map((tool) => JSON.stringify(tool.definition.function, null, 2)).join("\n")}

When calling a tool, include JSON like:
{"name": "tool_name", "arguments": { ... }}`;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readBalancedObject(text, startIndex) {
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

function parseJsonToolCalls(reply, names) {
  const prefixRegex = new RegExp(
    `\\{\\s*"name"\\s*:\\s*"(${names})"\\s*,\\s*"arguments"\\s*:\\s*\\{`,
    "g",
  );

  const calls = [];
  let match;

  while ((match = prefixRegex.exec(reply)) !== null) {
    const name = match[1];
    const argsStart = match.index + match[0].length - 1;
    const block = readBalancedObject(reply, argsStart);
    if (!block) continue;

    try {
      const args = JSON.parse(block.json);
      calls.push({ name, arguments: args });
      prefixRegex.lastIndex = block.endIndex;
    } catch {
      // Keep scanning if this block wasn't valid JSON.
    }
  }

  return calls;
}

function parseTagToolCalls(reply, names) {
  const tagRegex = new RegExp(
    `\\[TOOL_CALLS\\]\\s*(${names})\\s*\\[ARGS\\]\\s*\\{`,
    "g",
  );

  const calls = [];
  let match;

  while ((match = tagRegex.exec(reply)) !== null) {
    const name = match[1];
    const argsStart = match.index + match[0].length - 1;
    const block = readBalancedObject(reply, argsStart);
    if (!block) continue;

    try {
      const args = JSON.parse(block.json);
      calls.push({ name, arguments: args });
      tagRegex.lastIndex = block.endIndex;
    } catch {
      // Keep scanning if this block wasn't valid JSON.
    }
  }

  return calls;
}

function parseCompatibilityToolCalls(reply) {
  const names = [...toolMap.keys()].map(escapeRegex).join("|");
  if (!names) return [];

  return [
    ...parseJsonToolCalls(reply, names),
    ...parseTagToolCalls(reply, names),
  ];
}

async function executeToolCall(call) {
  const tool = toolMap.get(call.name);
  if (!tool) {
    throw new Error(`Unknown tool "${call.name}"`);
  }

  const fn = tool.executor ?? tool.execute ?? tool.handler ?? tool.run;
  if (typeof fn !== "function") {
    throw new Error(`Tool "${call.name}" has no executable function`);
  }
  return await fn(call.arguments);
}

function formatToolResult(result) {
  return typeof result === "string"
    ? result
    : (JSON.stringify(result, null, 2) ?? String(result));
}

class Chat {
  getSystemPrompt() {
    return null;
  }

  getRequestOptions() {
    return {};
  }

  getToolCalls() {
    throw new Error("Chat subclasses must implement getToolCalls().");
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
              break;
            }

            const results = [];
            for (const call of toolCalls) {
              const result = formatToolResult(await executeToolCall(call));
              stdout.write(`tool(${call.name})> ${result}\n`);
              results.push({ name: call.name, content: result, call });
            }
            this.appendToolResults(turnMessages, results);
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

export class ToolSupportingModelChat extends Chat {
  getRequestOptions() {
    return { tools: tools.map((tool) => tool.definition), tool_choice: "auto" };
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
}

export class CompatibilityChat extends Chat {
  getSystemPrompt() {
    return compatibilitySystemPrompt;
  }

  getToolCalls(reply) {
    return parseCompatibilityToolCalls(reply.content);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  new CompatibilityChat().run().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Unable to start chat: ${detail}`);
    process.exitCode = 1;
  });
}
