import path from "node:path";
import { prepareTestDriveEnvironment, testDriveCommand } from "../../../cli/src/commands/test-drive.js";

const [companyName, dataDir] = process.argv.slice(2);
const options = {
  harness: "codex",
  apiKeyEnv: "IN_FEED_FIXTURE_KEY",
  browser: false,
  ...(companyName ? { companyName } : {}),
  ...(dataDir ? { dataDir } : {}),
} as const;

const deliveryHold = process.env.IN_FEED_TEST_CONNECTION_DELIVERY_HOLD;
await prepareTestDriveEnvironment(options);
process.env.NODE_ENV = "test";
process.env.PAPERCLIP_VITE_CACHE_DIR = path.join(process.env.PAPERCLIP_HOME!, "vite-cache");
if (deliveryHold !== undefined) {
  process.env.PAPERCLIP_TEST_CONNECTION_DELIVERY_HOLD = deliveryHold;
}
await testDriveCommand(options);
