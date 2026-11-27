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
];
