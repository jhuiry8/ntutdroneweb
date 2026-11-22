// Keys of the records kept in the DRONE_DB KV namespace.
export const FINANCE_BUDGETS_KEY = 'finance:budgets';
export const FINANCE_TRANSACTIONS_KEY = 'finance:transactions';
export const MEMBERS_KEY = 'members:list';
export const MEMBERSHIP_RECEIPTS_KEY = 'members:fee-receipts';
export const REGULATIONS_KEY = 'club:regulations';
export const REGULATION_AMENDMENTS_KEY = 'club:regulation-amendments';
export const NOTES_KEY = 'club:class-notes';
export const EQUIPMENT_KEY = 'equipment:assets';
export const EQUIPMENT_MIGRATION_KEY = 'equipment:durable-object-migrated';
export const FORM_SETTINGS_KEY = 'forms:settings';
export const DESKTOP_RELEASE_KEY = 'desktop:release';
export const SITE_SETTINGS_KEY = 'site:settings';
export const AI_REPORTS_KEY = 'ai:reports';
// 學期財務報告（預算書、決算書）: the index lists every version; each version is its own `finance:report:<id>` record.
export const FINANCE_REPORTS_KEY = 'finance:reports';
export const FINANCE_REPORT_PREFIX = 'finance:report:';
