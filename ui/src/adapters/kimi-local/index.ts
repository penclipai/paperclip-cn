import type { UIAdapterModule } from "../types";
import { parseKimiStdoutLine } from "@penclipai/adapter-kimi-local/ui";
import { KimiLocalConfigFields } from "./config-fields";
import { buildKimiLocalConfig } from "@penclipai/adapter-kimi-local/ui";
import { translateInstant } from "../../i18n";

export const kimiLocalUIAdapter: UIAdapterModule = {
  type: "kimi_local",
  label: translateInstant("Kimi Code"),
  parseStdoutLine: parseKimiStdoutLine,
  ConfigFields: KimiLocalConfigFields,
  buildAdapterConfig: buildKimiLocalConfig,
  // Kimi streams token-level deltas (~16k per run, ~50x a comparable Claude
  // run): keep a wide transcript window so heartbeats don't drop rendered
  // content mid-run, and render live reasoning as a scrollable log instead of
  // the one-line ticker.
  transcriptPresentation: {
    maxVisibleEntries: 400,
    liveReasoningView: "scrollLog",
  },
};
