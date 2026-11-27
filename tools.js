import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const maxTextFileSize = 1024 * 1024;

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
        name: "read_text_file",
        description:
          "Reads a UTF-8 text file up to 1 MiB from within the project directory. Provide a relative path.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to a text file relative to the project directory.",
            },
          },
          required: ["filePath"],
        },
      },
    },
    executor: async ({ filePath }) => {
      if (typeof filePath !== "string" || !filePath.trim()) {
        throw new Error("read_text_file requires a non-empty filePath.");
      }
      if (isAbsolute(filePath)) {
        throw new Error(
          "read_text_file requires a path relative to the project directory.",
        );
      }

      const projectDirectory = await realpath(process.cwd());
      const resolvedPath = resolve(projectDirectory, filePath);
      const relativePath = relative(projectDirectory, resolvedPath);
      const parentPath = `..${process.platform === "win32" ? "\\" : "/"}`;
      if (
        !relativePath ||
        relativePath === ".." ||
        relativePath.startsWith(parentPath)
      ) {
        throw new Error(
          "read_text_file can only read files inside the project directory.",
        );
      }

      const actualPath = await realpath(resolvedPath);
      const actualRelativePath = relative(projectDirectory, actualPath);
      if (
        !actualRelativePath ||
        actualRelativePath === ".." ||
        actualRelativePath.startsWith(parentPath)
      ) {
        throw new Error(
          "read_text_file can only read files inside the project directory.",
        );
      }

      const fileStats = await stat(actualPath);
      if (!fileStats.isFile()) {
        throw new Error("read_text_file requires a regular file.");
      }
      if (fileStats.size > maxTextFileSize) {
        throw new Error("read_text_file only supports files up to 1 MiB.");
      }

      const contents = await readFile(actualPath);
      if (contents.includes(0)) {
        throw new Error("read_text_file only supports text files.");
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(contents);
      } catch {
        throw new Error("read_text_file requires a UTF-8 text file.");
      }
    },
  },
];
