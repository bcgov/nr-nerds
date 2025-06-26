/**
 * @fileoverview Shared validation instance for rule processors
 * All rule processors should use this shared validator to ensure
 * validation steps are properly synchronized across processors.
 */

const { RuleValidation } = require('./validation');

// Create a singleton validator instance
const validator = new RuleValidation();

module.exports = {
    validator
};
