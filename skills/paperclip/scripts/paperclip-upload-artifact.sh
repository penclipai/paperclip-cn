#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  paperclip-upload-artifact.sh FILE [options]

Uploads a generated file from the current workspace to the current Paperclip
issue, then creates an attachment-backed artifact work product by default.

Required environment for live uploads:
  PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID, PAPERCLIP_TASK_ID, PAPERCLIP_RUN_ID

Options:
  --issue-id ID          Issue id to attach to (default: PAPERCLIP_TASK_ID)
  --company-id ID        Company id (default: PAPERCLIP_COMPANY_ID)
  --title TEXT           Work product title (default: file basename)
  --summary TEXT         Work product summary
  --content-type TYPE    Override detected upload content type
  --status STATUS        Work product status (default: ready_for_review)
  --chat-comment TEXT    Bind this file to an explicit external-chat response
  --retry-unknown-upload Retry after an unresolved transport failure (duplicate risk)
  --no-work-product      Only upload the issue attachment
  --no-primary           Do not mark the artifact work product primary for its type
  --output FORMAT        markdown or json (default: markdown)
  --dry-run              Print resolved upload settings without calling the API
  --help, -h             Show this help

Examples:
  bash scripts/paperclip-upload-artifact.sh dist/demo.mp4 \
    --title "Demo video render" \
    --summary "MP4 render for board review"

  bash scripts/paperclip-upload-artifact.sh out/walkthrough.webm \
    --title "Walkthrough video" \
    --content-type video/webm

  bash scripts/paperclip-upload-artifact.sh out/result.png \
    --title "Generated image" \
    --chat-comment "Here is the requested image."
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

json_backend=""
json_helper=""
json_helper_native=""

initialize_json_backend() {
  if command -v jq >/dev/null 2>&1; then
    json_backend="jq"
    return
  fi

  require_command node
  local script_directory
  script_directory="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  json_helper="$script_directory/paperclip-artifact-json.mjs"
  if [[ ! -f "$json_helper" ]]; then
    printf 'Missing JSON fallback helper: %s\n' "$json_helper" >&2
    exit 1
  fi
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*)
      require_command cygpath
      json_helper_native="$(cygpath -w -- "$json_helper")"
      ;;
    *) json_helper_native="$json_helper" ;;
  esac
  json_backend="node"
}

node_json() {
  if [[ "$json_backend" != "node" ]]; then
    printf 'JSON fallback was not initialized.\n' >&2
    return 1
  fi
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*) MSYS2_ARG_CONV_EXCL='*' node "$json_helper_native" "$@" ;;
    *) node "$json_helper_native" "$@" ;;
  esac
}

node_json_path() {
  local value="$1"
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*) cygpath -w -- "$value" ;;
    *) printf '%s' "$value" ;;
  esac
}

json_response_is_indeterminate() {
  local response_file="$1"
  if [[ "$json_backend" == "jq" ]]; then
    jq -e '.outcome == "indeterminate"' "$response_file" >/dev/null 2>&1
  else
    node_json response-is-indeterminate <"$response_file" >/dev/null
  fi
}

json_dry_run() {
  if [[ "$json_backend" == "jq" ]]; then
    jq -n \
      --arg file "$1" \
      --arg issueId "$2" \
      --arg companyId "$3" \
      --arg title "$4" \
      --arg summary "$5" \
      --arg contentType "$6" \
      --arg status "$7" \
      --arg chatComment "$8" \
      --argjson createWorkProduct "$9" \
      --argjson isPrimary "${10}" \
      '{file: $file, issueId: $issueId, companyId: $companyId, title: $title, summary: $summary, contentType: $contentType, status: $status, chatComment: (if $chatComment == "" then null else $chatComment end), createWorkProduct: $createWorkProduct, isPrimary: $isPrimary}'
  else
    node_json dry-run "$@"
  fi
}

json_find_attachment() {
  local attachments="$1"
  local run_id="$2"
  local sha256="$3"
  local filename="$4"
  local type="$5"
  if [[ "$json_backend" == "jq" ]]; then
    jq -nc \
      --argjson attachments "$attachments" \
      --arg runId "$run_id" \
      --arg sha256 "$sha256" \
      --arg originalFilename "$filename" \
      --arg contentType "$type" \
      'first(
        $attachments[]
        | select(
            .originatingRunId == $runId
            and ((.sha256 // "") | ascii_downcase) == ($sha256 | ascii_downcase)
            and (.originalFilename // "") == $originalFilename
            and ((.contentType // "") | ascii_downcase) == ($contentType | ascii_downcase)
          )
      ) // empty'
  else
    printf '%s' "$attachments" | node_json find-attachment "$run_id" "$sha256" "$filename" "$type"
  fi
}

json_attachment_value() {
  local attachment="$1"
  local field="$2"
  if [[ "$json_backend" == "jq" ]]; then
    case "$field" in
      id) jq -r '.id // empty' <<<"$attachment" ;;
      content-path) jq -r '.contentPath // empty' <<<"$attachment" ;;
      download-path) jq -r '.downloadPath // (if .contentPath then (.contentPath + "?download=1") else "" end)' <<<"$attachment" ;;
      byte-size) jq -r '.byteSize // 0' <<<"$attachment" ;;
      open-path) jq -r '.openPath // .contentPath // empty' <<<"$attachment" ;;
      original-filename) jq -r '.originalFilename // empty' <<<"$attachment" ;;
      *) printf 'Unsupported attachment JSON field: %s\n' "$field" >&2; return 1 ;;
    esac
  else
    printf '%s' "$attachment" | node_json attachment-value "$field"
  fi
}

json_work_product_payload() {
  if [[ "$json_backend" == "jq" ]]; then
    jq -nc \
      --arg title "$1" \
      --arg summary "$2" \
      --arg status "$3" \
      --arg runId "$4" \
      --arg attachmentId "$5" \
      --arg contentType "$6" \
      --argjson byteSize "$7" \
      --arg contentPath "$8" \
      --arg openPath "$9" \
      --arg downloadPath "${10}" \
      --arg originalFilename "${11}" \
      --argjson isPrimary "${12}" \
      '{
        type: "artifact",
        provider: "paperclip",
        title: $title,
        status: $status,
        reviewState: "none",
        isPrimary: $isPrimary,
        healthStatus: "unknown",
        summary: (if $summary == "" then null else $summary end),
        createdByRunId: $runId,
        metadata: {
          attachmentId: $attachmentId,
          contentType: $contentType,
          byteSize: $byteSize,
          contentPath: $contentPath,
          openPath: $openPath,
          downloadPath: $downloadPath,
          originalFilename: (if $originalFilename == "" then null else $originalFilename end)
        }
      }'
  else
    node_json work-product "$@"
  fi
}

json_chat_comment_payload() {
  if [[ "$json_backend" == "jq" ]]; then
    jq -nc --arg body "$1" --arg attachmentId "$2" '{body: $body, attachmentIds: [$attachmentId]}'
  else
    node_json chat-comment "$@"
  fi
}

json_output_receipt() {
  local attachment="$1"
  local work_product="$2"
  local chat_response="$3"
  if [[ "$json_backend" == "jq" ]]; then
    jq -n \
      --argjson attachment "$attachment" \
      --argjson workProduct "$work_product" \
      --argjson chatComment "$chat_response" \
      '{attachment: $attachment, workProduct: $workProduct, chatComment: $chatComment}'
    return
  fi

  local attachment_file work_product_file chat_response_file
  attachment_file="$(helper_response_file)"
  work_product_file="$(helper_response_file)"
  chat_response_file="$(helper_response_file)"
  printf '%s' "$attachment" >"$attachment_file"
  printf '%s' "$work_product" >"$work_product_file"
  printf '%s' "$chat_response" >"$chat_response_file"
  local output_status=0
  node_json output-receipt \
    "$(node_json_path "$attachment_file")" \
    "$(node_json_path "$work_product_file")" \
    "$(node_json_path "$chat_response_file")" || output_status=$?
  rm -f "$attachment_file" "$work_product_file" "$chat_response_file"
  return "$output_status"
}

json_bool() {
  if [[ "${1:-0}" == "1" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

detect_content_type() {
  local path="$1"
  local lower
  lower="$(printf '%s' "$path" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    *.mp4|*.m4v) printf 'video/mp4' ;;
    *.webm) printf 'video/webm' ;;
    *.mov|*.qt) printf 'video/quicktime' ;;
    *.png) printf 'image/png' ;;
    *.jpg|*.jpeg) printf 'image/jpeg' ;;
    *.gif) printf 'image/gif' ;;
    *.webp) printf 'image/webp' ;;
    *.svg) printf 'image/svg+xml' ;;
    *.pdf) printf 'application/pdf' ;;
    *.txt|*.log) printf 'text/plain' ;;
    *.md|*.markdown) printf 'text/markdown' ;;
    *.json) printf 'application/json' ;;
    *.csv) printf 'text/csv' ;;
    *.html|*.htm) printf 'text/html' ;;
    *.zip) printf 'application/zip' ;;
    *)
      if command -v file >/dev/null 2>&1; then
        file --brief --mime-type "$path"
      else
        printf 'application/octet-stream'
      fi
      ;;
  esac
}

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$path" | awk '{ hash = $1; sub(/^\\/, "", hash); print tolower(hash) }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$path" | awk '{print tolower($1)}'
  else
    printf 'Missing required command: sha256sum or shasum\n' >&2
    exit 1
  fi
}

sha256_text() {
  local value="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$value" | sha256sum | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s' "$value" | shasum -a 256 | awk '{print tolower($1)}'
  else
    printf 'Missing required command: sha256sum or shasum\n' >&2
    exit 1
  fi
}

helper_state_directory() {
  printf '%s' "${PAPERCLIP_HELPER_STATE_DIR:-${PAPERCLIP_WORKSPACE_CWD:-$PWD}/.paperclip/artifact-helper}"
}

helper_response_file() {
  local directory
  directory="$(helper_state_directory)"
  # TMPDIR can name a controller-owned directory outside a CLI sandbox.
  (umask 077; mkdir -p "$directory" && mktemp "$directory/response.XXXXXX")
}

request_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local response_file
  local status_code

  response_file="$(helper_response_file)"
  if [[ -n "$body" ]]; then
    status_code="$(
      curl -sS -X "$method" -w '%{http_code}' -o "$response_file" \
        "$url" \
        -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
        -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
        -H 'Content-Type: application/json' \
        --data-binary "$body"
    )"
  else
    status_code="$(
      curl -sS -X "$method" -w '%{http_code}' -o "$response_file" \
        "$url" \
        -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
        -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID"
    )"
  fi

  if [[ "$status_code" -lt 200 || "$status_code" -ge 300 ]]; then
    printf 'Request failed (%s): %s\n' "$status_code" "$url" >&2
    cat "$response_file" >&2
    printf '\n' >&2
    rm -f "$response_file"
    exit 1
  fi

  cat "$response_file"
  rm -f "$response_file"
}

upload_file() {
  local url="$1"
  local path="$2"
  local content_type="$3"
  local original_filename="$4"
  local escaped_path
  local staged_path=""
  local upload_directory
  local staged_basename
  local response_basename
  local form_path
  local form_filename
  local form_value
  local config_value
  local response_file
  local status_code
  local curl_status=0
  local indeterminate=0

  escaped_path="${path//\\/\\\\}"
  escaped_path="${escaped_path//\"/\\\"}"
  if ! response_file="$(helper_response_file)"; then
    return 1
  fi
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*)
      # Git-for-Windows curl converts UTF-8 form arguments through the active
      # Windows code page. Keep curl's file and response arguments relative to
      # the state directory; send the form configuration as UTF-8 stdin.
      if ! staged_path="$(helper_response_file)"; then
        rm -f "$response_file"
        return 1
      fi
      if ! cp -- "$path" "$staged_path"; then
        rm -f "$staged_path" "$response_file"
        return 1
      fi
      upload_directory="$(dirname "$response_file")"
      staged_basename="$(basename "$staged_path")"
      response_basename="$(basename "$response_file")"
      if [[ "$(dirname "$staged_path")" != "$upload_directory" || ! -d "$upload_directory" ]]; then
        rm -f "$staged_path" "$response_file"
        return 1
      fi
      if ! form_path="$(curl_form_config_escape "$staged_basename")" ||
        ! form_filename="$(curl_form_config_escape "$original_filename")"; then
        rm -f "$staged_path" "$response_file"
        return 1
      fi
      form_value="file=@\"${form_path}\";type=${content_type};filename=\"${form_filename}\""
      if ! config_value="$(curl_form_config_escape "$form_value")"; then
        rm -f "$staged_path" "$response_file"
        return 1
      fi
      if ! (cd -- "$upload_directory"); then
        rm -f "$staged_path" "$response_file"
        return 1
      fi
      status_code="$(
        (
          cd -- "$upload_directory" || exit 125
          printf 'form = "%s"\n' "$config_value" | curl -sS -X POST -w '%{http_code}' -o "$response_basename" \
            "$url" \
            -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
            -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
            --form-escape --config -
        )
      )" || curl_status=$?
      rm -f "$staged_path"
      if [[ "$curl_status" -eq 125 ]]; then
        rm -f "$response_file"
        return 1
      fi
      ;;
    *)
      status_code="$(
        curl -sS -X POST -w '%{http_code}' -o "$response_file" \
          "$url" \
          -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
          -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
          -F "file=@\"${escaped_path}\";type=${content_type}"
      )" || curl_status=$?
      ;;
  esac

  if [[ "$curl_status" -ne 0 ]]; then
    rm -f "$response_file"
    return 75
  fi

  if [[ "$status_code" -lt 200 || "$status_code" -ge 300 ]]; then
    printf 'Upload failed (%s): %s\n' "$status_code" "$url" >&2
    cat "$response_file" >&2
    printf '\n' >&2
    # The bridge uses a structured 409 outcome after a possibly committed
    # mutation. Keep the marker so the next invocation reconciles by listing.
    if [[ "$status_code" == "409" ]] && json_response_is_indeterminate "$response_file" >/dev/null 2>&1; then
      indeterminate=1
    fi
    rm -f "$response_file"
    if [[ "$status_code" == "408" || "$status_code" -ge 500 || "$indeterminate" == "1" ]]; then
      return 75
    fi
    return 1
  fi

  cat "$response_file"
  rm -f "$response_file"
}

# A curl config `form =` value is parsed first by the config reader and then by
# curl's form parser. Apply this before embedding a value at each layer.
curl_form_config_escape() {
  local value="$1"
  case "$value" in
    *$'\r'*|*$'\n'*) printf 'CR/LF is not permitted in curl form values.\n' >&2; return 1 ;;
  esac
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

operation_lock_path=""
operation_lock_owner=""
operation_lock_held=0
operation_state_root=""

process_start_identity() {
  local pid="$1"
  ps -p "$pid" -o lstart= 2>/dev/null | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//'
}

release_operation_lock() {
  if [[ "$operation_lock_held" == "1" && -n "$operation_lock_path" ]]; then
    local current_owner=""
    current_owner="$(cat "$operation_lock_path/owner" 2>/dev/null || true)"
    if [[ "$current_owner" == "$operation_lock_owner" ]]; then
      rm -f "$operation_lock_path/owner"
      rmdir "$operation_lock_path" 2>/dev/null || true
    fi
    operation_lock_held=0
  fi
}

acquire_operation_lock() {
  local operation_key="$1"
  local attempts=0

  umask 077
  operation_state_root="$(helper_state_directory)"
  mkdir -p "$operation_state_root"
  operation_lock_path="$operation_state_root/$operation_key.lock"
  operation_lock_owner="$$|$(process_start_identity "$$" || true)"
  while ! mkdir "$operation_lock_path" 2>/dev/null; do
    local owner_pid=""
    local owner_start=""
    local current_lock_owner=""
    current_lock_owner="$(
      readlink "$operation_lock_path" 2>/dev/null ||
        cat "$operation_lock_path/owner" 2>/dev/null || true
    )"
    IFS='|' read -r owner_pid owner_start <<<"$current_lock_owner"
    if [[ "$owner_pid" =~ ^[0-9]+$ ]]; then
      local current_owner_start=""
      current_owner_start="$(process_start_identity "$owner_pid" || true)"
      if ! kill -0 "$owner_pid" 2>/dev/null ||
        [[ -n "$owner_start" && -n "$current_owner_start" && "$owner_start" != "$current_owner_start" ]]; then
        # Serialize stale-lock reclamation separately. Without this guard, two
        # contenders can both observe the old owner and the slower one can
        # delete the faster contender's newly acquired live lock.
        local reclaim_lock_path="$operation_lock_path.reclaim"
        if mkdir "$reclaim_lock_path" 2>/dev/null; then
          local guarded_owner=""
          guarded_owner="$(
            readlink "$operation_lock_path" 2>/dev/null ||
              cat "$operation_lock_path/owner" 2>/dev/null || true
          )"
          if [[ "$guarded_owner" == "$current_lock_owner" ]]; then
            if [[ -L "$operation_lock_path" ]]; then
              rm -f "$operation_lock_path"
            else
              rm -f "$operation_lock_path/owner"
              rmdir "$operation_lock_path" 2>/dev/null || true
            fi
          fi
          rmdir "$reclaim_lock_path" 2>/dev/null || true
          continue
        fi
      fi
    fi
    attempts=$((attempts + 1))
    if [[ "$attempts" -ge 400 ]]; then
      printf 'Another matching artifact upload is still in progress; retry after it finishes.\n' >&2
      exit 1
    fi
    sleep 0.05
  done
  printf '%s' "$operation_lock_owner" >"$operation_lock_path/owner"
  operation_lock_held=1
}

file_path=""
issue_id="${PAPERCLIP_TASK_ID:-}"
company_id="${PAPERCLIP_COMPANY_ID:-}"
title=""
summary=""
content_type=""
status="ready_for_review"
chat_comment=""
create_work_product=1
is_primary=1
output_format="markdown"
dry_run=0
retry_unknown_upload=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue-id)
      issue_id="${2:-}"
      shift 2
      ;;
    --company-id)
      company_id="${2:-}"
      shift 2
      ;;
    --title)
      title="${2:-}"
      shift 2
      ;;
    --summary)
      summary="${2:-}"
      shift 2
      ;;
    --content-type)
      content_type="${2:-}"
      shift 2
      ;;
    --status)
      status="${2:-}"
      shift 2
      ;;
    --chat-comment)
      chat_comment="${2:-}"
      shift 2
      ;;
    --no-work-product)
      create_work_product=0
      shift
      ;;
    --retry-unknown-upload)
      retry_unknown_upload=1
      shift
      ;;
    --no-primary)
      is_primary=0
      shift
      ;;
    --output)
      output_format="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$file_path" ]]; then
        printf 'Unexpected positional argument: %s\n' "$1" >&2
        usage >&2
        exit 1
      fi
      file_path="$1"
      shift
      ;;
  esac
done

if [[ -z "$file_path" ]]; then
  printf 'Missing file path.\n' >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$file_path" ]]; then
  printf 'Artifact file does not exist: %s\n' "$file_path" >&2
  exit 1
fi

if [[ "$output_format" != "markdown" && "$output_format" != "json" ]]; then
  printf 'Unsupported output format: %s\n' "$output_format" >&2
  exit 1
fi

if [[ -n "$chat_comment" && "$create_work_product" != "1" ]]; then
  printf '%s\n' '--chat-comment requires the attachment-backed work product created by this helper.' >&2
  exit 1
fi

require_command curl
initialize_json_backend

if [[ -z "$title" ]]; then
  title="$(basename "$file_path")"
fi

if [[ -z "$content_type" ]]; then
  content_type="$(detect_content_type "$file_path")"
fi

if [[ "$dry_run" == "1" ]]; then
  create_work_product_json="$(json_bool "$create_work_product")"
  is_primary_json="$(json_bool "$is_primary")"
  json_dry_run "$file_path" "$issue_id" "$company_id" "$title" "$summary" "$content_type" "$status" "$chat_comment" "$create_work_product_json" "$is_primary_json"
  exit 0
fi

if [[ -z "${PAPERCLIP_API_URL:-}" || -z "${PAPERCLIP_API_KEY:-}" || -z "${PAPERCLIP_RUN_ID:-}" ]]; then
  printf 'Missing PAPERCLIP_API_URL, PAPERCLIP_API_KEY, or PAPERCLIP_RUN_ID.\n' >&2
  exit 1
fi

if [[ -z "$issue_id" || -z "$company_id" ]]; then
  printf 'Missing issue or company id. Pass --issue-id/--company-id or set PAPERCLIP_TASK_ID/PAPERCLIP_COMPANY_ID.\n' >&2
  exit 1
fi

api_root="${PAPERCLIP_API_URL%/}"
case "$api_root" in
  */api) api_base="$api_root" ;;
  *) api_base="$api_root/api" ;;
esac
file_sha256="$(sha256_file "$file_path")"
original_filename="$(basename "$file_path")"
operation_key="$(
  sha256_text "$api_base|$company_id|$issue_id|$PAPERCLIP_RUN_ID|$original_filename|$file_sha256|$content_type"
)"
acquire_operation_lock "$operation_key"
trap release_operation_lock EXIT

attachment=""
reused_attachment=0
unknown_upload_marker="$operation_state_root/$operation_key.uncertain"
lookup_attempts=1
if [[ -f "$unknown_upload_marker" && "$retry_unknown_upload" != "1" ]]; then
  lookup_attempts=20
fi
for ((lookup_attempt = 1; lookup_attempt <= lookup_attempts; lookup_attempt++)); do
  existing_attachments="$(request_json GET "$api_base/issues/$issue_id/attachments")"
  attachment="$(json_find_attachment "$existing_attachments" "$PAPERCLIP_RUN_ID" "$file_sha256" "$original_filename" "$content_type")"
  if [[ -n "$attachment" ]]; then
    reused_attachment=1
    rm -f "$unknown_upload_marker"
    break
  fi
  if [[ "$lookup_attempt" -lt "$lookup_attempts" ]]; then
    sleep 0.25
  fi
done

if [[ -z "$attachment" && -f "$unknown_upload_marker" && "$retry_unknown_upload" != "1" ]]; then
  printf '%s\n' 'A previous matching upload ended without a definitive response, and Paperclip has not exposed its durable attachment yet.' >&2
  printf '%s\n' 'Retry this command later. If the upload definitely did not commit, pass --retry-unknown-upload to accept the duplicate-file risk.' >&2
  exit 1
fi

if [[ -z "$attachment" ]]; then
  rm -f "$unknown_upload_marker"
  : >"$unknown_upload_marker"
  upload_status=0
  attachment="$(
    upload_file \
      "$api_base/companies/$company_id/issues/$issue_id/attachments" \
      "$file_path" \
      "$content_type" \
      "$original_filename"
  )" || upload_status=$?
  if [[ "$upload_status" -ne 0 ]]; then
    if [[ "$upload_status" -ne 75 ]]; then
      rm -f "$unknown_upload_marker"
    fi
    exit 1
  fi
fi

attachment_id="$(json_attachment_value "$attachment" id)"
content_path="$(json_attachment_value "$attachment" content-path)"
download_path="$(json_attachment_value "$attachment" download-path)"
if [[ -z "$attachment_id" || -z "$content_path" || -z "$download_path" ]]; then
  printf 'Upload response did not include attachment path metadata.\n' >&2
  printf '%s\n' "$attachment" >&2
  exit 1
fi
rm -f "$unknown_upload_marker"

work_product="null"
if [[ "$create_work_product" == "1" ]]; then
  is_primary_json="$(json_bool "$is_primary")"
  byte_size="$(json_attachment_value "$attachment" byte-size)"
  open_path="$(json_attachment_value "$attachment" open-path)"
  original_filename="$(json_attachment_value "$attachment" original-filename)"

  work_product_payload="$(json_work_product_payload "$title" "$summary" "$status" "$PAPERCLIP_RUN_ID" "$attachment_id" "$content_type" "$byte_size" "$content_path" "$open_path" "$download_path" "$original_filename" "$is_primary_json")"

  work_product="$(
    request_json \
      POST \
      "$api_base/issues/$issue_id/work-products" \
      "$work_product_payload"
  )"
fi

chat_response="null"
if [[ -n "$chat_comment" ]]; then
  chat_comment_payload="$(json_chat_comment_payload "$chat_comment" "$attachment_id")"
  chat_response="$(
    request_json \
      POST \
      "$api_base/issues/$issue_id/comments" \
      "$chat_comment_payload"
  )"
  chat_comment_id="$(json_attachment_value "$chat_response" id)"
  if [[ -z "$chat_comment_id" ]]; then
    printf 'Chat attachment response did not include a comment id.\n' >&2
    exit 1
  fi
fi

if [[ "$output_format" == "json" ]]; then
  json_output_receipt "$attachment" "$work_product" "$chat_response"
  exit 0
fi

work_product_id="$(json_attachment_value "$work_product" id)"

if [[ "$reused_attachment" == "1" ]]; then
  printf 'Reused matching artifact from this run\n\n'
else
  printf 'Uploaded artifact\n\n'
fi
printf -- '- Attachment: [%s](%s)\n' "$title" "$content_path"
printf -- '- Download: [%s](%s)\n' "$title" "$download_path"
printf -- '- Attachment ID: `%s`\n' "$attachment_id"
if [[ -n "$work_product_id" ]]; then
  printf -- '- Work product ID: `%s`\n' "$work_product_id"
fi
if [[ -n "$chat_comment" ]]; then
  printf -- '- Paperclip comment binding: saved. External publication requires an authorized active chat origin; this helper does not confirm provider delivery.\n'
fi
printf '\nFinal comment snippet:\n\n'
printf -- '- Artifact: [%s](%s)\n' "$title" "$content_path"
