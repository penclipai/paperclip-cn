# Final connection and external adapter review repairs

## Scope

Address the two findings reported on PR #164 at commit
`388765bd887266c7afa61c13604d1812fae3f4c0`. Keep the selected upstream sync
boundary, package dependencies, authentication rules, and connection behavior.

1. Translate application-owned connection choices, accessibility labels, and
   form validation. Cover capability groups, connection methods, Google Sheets,
   generic MCP authentication, OAuth setup, and GitHub identity/access choices.
   Keep provider labels, server error details, identifiers, and user content.
2. Move external adapter credential/provider/login setup metadata into the
   external package. Extend the existing declarative config schema with optional
   typed setup metadata. Reuse the existing config-schema endpoint and generic
   host form paths. Do not add an external adapter to the built-in registry or
   import an external adapter into the core UI or server.

## Verification

- Render the actual connection choice branches in Chinese and English. Check
  their accessible names and required-selection messages.
- Test an external schema with synthetic adapter identifiers. Verify credential
  references, provider configuration, endpoint validation, and missing-metadata
  behavior. Check the external Hermes package's own schema declarations.
- Generate the runtime locale catalogs from their source files. Run catalog
  consistency, key audit, UI token gates, and repository typecheck.
- Review the source changes independently before committing and pushing.
- Build the final source, compare AI SDK imports and all workspace links before
  and after packaging, and seal the complete installed product tree.
- Verify the final installer with fresh profiles on D:, including real Grok
  execution, graceful shutdown, and uninstall/data retention. Complete the
  supported full test inventory and current-head CI before merge readiness.

## Evidence boundaries

The preceding 388765b Windows build and its 82,056-file product seal passed.
Those artifacts remain evidence for that source snapshot. They do not prove
that these subsequent repairs pass installed acceptance. Preserve earlier
failed shutdown/uninstall and aborted test evidence.

Formal version selection, signing-provider selection, and stable publication
remain deferred until engineering acceptance. Secure-desktop UAC confirmation
requires the operator. The required Greptile review result remains a separate
merge gate.
