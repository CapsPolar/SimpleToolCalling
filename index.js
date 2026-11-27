import { LlamaAPI } from "./api.js";
import { LlamaChatWithTools } from "./chat.js";
import { tools } from "./tools.js";

const api = new LlamaAPI();
const chat = new LlamaChatWithTools(api, tools);

chat.run().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start chat: ${detail}`);
  process.exitCode = 1;
});
