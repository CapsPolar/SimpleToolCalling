import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { endpoint, sendMessage } from "./llama.js";

async function main() {
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

      const conversation = [
        ...messages,
        { role: "user", content: input },
      ];
      try {
        stdout.write("ai> ");
        const reply = await sendMessage(conversation, (delta) =>
          stdout.write(delta),
        );
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

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start chat: ${detail}`);
  process.exitCode = 1;
});
