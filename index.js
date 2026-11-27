import { LlamaAPI, OllamaAPI } from "./api.js";
import { CompatibilityChatWithTools, LlamaChatWithTools } from "./chat.js";
import { tools } from "./tools.js";

const api = new OllamaAPI(); // use OllamaAPI() for Ollama endpoint
const chat = new CompatibilityChatWithTools(api, tools);// use LlamaChatWithTools or OLlamaChatWithTools for using native tooling system

chat.run().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start chat: ${detail}`);
  process.exitCode = 1;
});
