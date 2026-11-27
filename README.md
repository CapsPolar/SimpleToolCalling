## Simple Tool Calling
Tiny LLM can actually work as agent, they just can't handle the bloat of MCP standards. with SimpleToolCalling, you turn any model into an agent, even tool calling not supported models

### Quick start
Have node js in your system and just run `npm start` at the root. Make sure you already started Ollama or Llama.cpp servers as its the AI engine

### Configuration
The code itself is the configuration. The example tools in `tools.js` include the current time and reading UTF-8 text files (relative to the project directory, up to 1 MiB). Choose Ollama or Llama.cpp in `index.js`; their default endpoints and model are set in `api.js`.