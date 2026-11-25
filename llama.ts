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

async function sendMessage(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: false }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Llama server returned ${response.status}: ${body}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Llama server returned invalid JSON.");
  }

  if (!isRecord(data) || !Array.isArray(data.choices)) {
    throw new Error("Llama server response did not contain chat choices.");
  }

  const choice = data.choices[0];
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== "string"
  ) {
    throw new Error("Llama server response did not contain a text reply.");
  }

  return choice.message.content;
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
        const reply = await sendMessage(conversation);
        messages.push(
          { role: "user", content: input },
          { role: "assistant", content: reply },
        );
        stdout.write(`ai> ${reply}\n`);
      } catch (error) {
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
