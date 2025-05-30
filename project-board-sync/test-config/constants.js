/**
 * Shared constants used by tests and mocks
 * Based on column configuration from requirements.md
 */
const COLUMNS = {
  NEW: 'New',
  ACTIVE: 'Active',
  REVIEW: 'Review',
  DONE: 'Done'
};

const COLUMN_IDS = {
  [COLUMNS.NEW]: 'col_new',
  [COLUMNS.ACTIVE]: 'col_active',
  [COLUMNS.REVIEW]: 'col_review',
  [COLUMNS.DONE]: 'col_done'
};

module.exports = {
  COLUMNS,
  COLUMN_IDS
};
