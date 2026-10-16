import fs from "node:fs";

function writeMarker(value) {
  fs.appendFileSync(process.env.PAPERCLIP_WORKER_TEST_MARKER, `${value}\n`, "utf8");
}

export async function startServer() {
  const delayMs = Number(process.env.PAPERCLIP_WORKER_TEST_START_DELAY_MS ?? "0");
  writeMarker("start");
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return {
    apiUrl: "http://127.0.0.1:3199/api",
    async shutdown() {
      writeMarker("shutdown");
    },
  };
}
