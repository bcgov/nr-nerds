/**
 * @fileoverview Processor for column management rules
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/column-rules.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect how items move between columns.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { RuleValidation } = require('./validation');

const validator = new RuleValidation();

/**
 * Process rules for managing item columns in the project board
 * @param {Object} item PR or Issue to process
 * @returns {Array<{action: string, params: Object}>} List of actions to take
 */
function processColumnRules(item) {
    const rules = loadBoardRules();
    const actions = [];
    validator.steps.markStepComplete('RULE_CONFIG_LOADED');

    for (const rule of rules.columns) {
        try {
            // Skip rule if conditions not met
            if (rule.skipIf && validator.validateSkipRule(item, rule.skipIf)) {
                continue;
            }

            // Check each trigger
            for (const trigger of rule.triggers) {
                if (validator.validateItemCondition(item, trigger)) {
                    actions.push({
                        action: `set_column: ${rule.targetColumn}`,
                        params: { item }
                    });
                }
            }
        } catch (error) {
            log.error(`Error processing column rule: ${error.message}`);
        }
    }

    return actions;
}

module.exports = {
    processColumnRules
};
