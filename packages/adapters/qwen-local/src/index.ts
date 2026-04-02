export const type = "qwen_local";
export const label = "Qwen (local)";
export const DEFAULT_QWEN_LOCAL_MODEL = "coder-model";
export const DEFAULT_QWEN_LOCAL_SKIP_PERMISSIONS = true;

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# qwen_local agent configuration

Adapter: qwen_local

Use when:
- You want Paperclip to run Qwen Code CLI locally on the host machine
- You want Qwen conversation resume across wake-ups via --resume
- You want Qwen's structured stream-json logs and local tool execution model

Don't use when:
- You need webhook-style or remote gateway invocation (use openclaw_gateway or http)
- You only need a one-shot process execution (use process)
- Qwen CLI is not installed or authenticated on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- promptTemplate (string, optional): run prompt template
- model (string, optional): Qwen model id (defaults to coder-model)
- maxTurnsPerRun (number, optional): passed as --max-session-turns when greater than zero
- dangerouslySkipPermissions (boolean, optional): sets --approval-mode yolo unless approval flags are already present
- command (string, optional): defaults to "qwen"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): termination grace period in seconds

Notes:
- Runs are executed with: qwen --output-format stream-json ...
- Prompts are piped to Qwen via stdin.
- Paperclip does not enumerate Qwen models. Enter the model id available in your local Qwen configuration, or leave it empty to use the adapter default.
- Sessions are resumed with --resume when stored session cwd matches current cwd.
- Paperclip auto-injects shared skills into "~/.qwen/skills" when missing so Qwen can discover "$paperclip" and related skills on local runs.
- Paperclip passes --add-dir for AGENT_HOME or instruction directories that live outside the current cwd.
- Run \`qwen auth\` if the CLI reports missing or expired authentication.
`;
