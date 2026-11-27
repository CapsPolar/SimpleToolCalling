import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const imageMimeTypes = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

async function loadImage({ filePath }) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("load_image requires a non-empty filePath.");
  }

  const mimeType = imageMimeTypes.get(extname(filePath).toLowerCase());
  if (!mimeType) {
    throw new Error(`Unsupported image file type for "${filePath}".`);
  }

  const data = await readFile(filePath);
  return {
    type: "image",
    filePath,
    mimeType,
    data: data.toString("base64"),
  };
}

export const tools = [
  {
    definition: {
      type: "function",
      function: {
        name: "check_time",
        description: "Returns the current time in UTC.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    executor: async () => new Date().toISOString(),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "load_image",
        description: "Loads an image file from disk so you can see and analyze it.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "The path of the image file to load.",
            },
          },
          required: ["filePath"],
        },
      },
    },
    executor: loadImage,
  },
];
