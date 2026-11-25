import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const endpoint =
  process.env.LLAMA_URL ?? "http://localhost:8080/v1/chat/completions";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTextDelta(data: unknown): string {
  if (!isRecord(data)) {
    throw new Error("Llama server returned an invalid streaming event.");
  }
  if (isRecord(data.error)) {
    const message = data.error.message;
    throw new Error(
      typeof message === "string" ? message : "Llama server returned an error.",
    );
  }
  if (!Array.isArray(data.choices)) {
    throw new Error("Llama server event did not contain chat choices.");
  }

  const choice = data.choices[0];
  if (!isRecord(choice) || !isRecord(choice.delta)) {
    return "";
  }

  const content = choice.delta.content;
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content !== "string") {
    throw new Error("Llama server returned a non-text response.");
  }
  return content;
}

async function sendMessage(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Llama server returned ${response.status}: ${body}`);
  }
  if (!response.body) {
    throw new Error("Llama server did not provide a response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";

  const processLine = (line: string): void => {
    if (!line.startsWith("data:")) {
      return;
    }

    const data = line.slice(5).trimStart();
    if (!data || data === "[DONE]") {
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error("Llama server returned an invalid streaming event.");
    }

    const delta = getTextDelta(event);
    if (delta) {
      reply += delta;
      stdout.write(delta);
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

  return reply;
}

async function main(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  const messages: ChatMessage[] = [];

  stdout.write(`Chat endpoint: ${endpoint}\nType /exit to quit.\n`);

  try {
    while (true) {
      let input: string;
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

      const conversation: ChatMessage[] = [
        ...messages,
        { role: "user", content: input },
      ];
      try {
        stdout.write("ai> ");
        const reply = await sendMessage(conversation);
        stdout.write("\n");
        messages.push(
          { role: "user", content: input },
          { role: "assistant", content: reply },
        );
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

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start chat: ${detail}`);
  process.exitCode = 1;
});
