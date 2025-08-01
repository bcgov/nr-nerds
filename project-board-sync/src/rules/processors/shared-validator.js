/**
 * @fileoverview Shared validator for rule processing
 * Provides validation methods used by multiple rule processors
 */

const { RuleValidation } = require('./validation');

// Create a singleton validator instance
const validator = new RuleValidation();

module.exports = {
    validator
};
