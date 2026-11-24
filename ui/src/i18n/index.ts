// `src/i18n.ts` is the canonical CN i18next bootstrap. This compatibility
// barrel prevents upstream's directory imports from creating a second client
// or resetting the user-selected locale to English.
export { default, getCurrentLocale, i18n, t, translateInstant, useTranslation } from "../i18n";
