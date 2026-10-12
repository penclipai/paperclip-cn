import { configFieldsForSection } from "../config-sections";
import type { AdapterConfigFieldsProps } from "../types";
import { useTranslation } from "react-i18next";
import {
  DraftInput,
  Field,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Paperclip stages it into the Grok workspace as Agents.md when possible.";

export function GrokLocalConfigFields({
  section,
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  const { t } = useTranslation();
  if (hideInstructionsFile) return null;
  return configFieldsForSection(section, (
    <>
      <Field
        label={t("agentConfig.instructionsFileLabel", {
          defaultValue: "Agent instructions file",
        })}
        hint={t("agentConfig.grokInstructionsFileHint", {
          defaultValue: instructionsFileHint,
        })}
      >
        <div className="flex items-center gap-2">
          <DraftInput
            value={
              isCreate
                ? values!.instructionsFilePath ?? ""
                : eff(
                    "adapterConfig",
                    "instructionsFilePath",
                    String(config.instructionsFilePath ?? ""),
                  )
            }
            onCommit={(v) =>
              isCreate
                ? set!({ instructionsFilePath: v })
                : mark("adapterConfig", "instructionsFilePath", v || undefined)
            }
            immediate
            className={inputClass}
            placeholder={t("agentConfig.instructionsFilePlaceholder", {
              defaultValue: "/absolute/path/to/AGENTS.md",
            })}
          />
          <ChoosePathButton />
        </div>
      </Field>
    </>
  ));
}
