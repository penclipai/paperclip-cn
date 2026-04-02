import type { UIAdapterModule } from "../types";
import { parseQwenStdoutLine, buildQwenLocalConfig } from "@penclipai/adapter-qwen-local/ui";
import { QwenLocalConfigFields } from "./config-fields";

export const qwenLocalUIAdapter: UIAdapterModule = {
  type: "qwen_local",
  label: "Qwen (local)",
  parseStdoutLine: parseQwenStdoutLine,
  ConfigFields: QwenLocalConfigFields,
  buildAdapterConfig: buildQwenLocalConfig,
};
