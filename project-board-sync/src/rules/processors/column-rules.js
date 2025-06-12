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
const { validator } = require('./shared-validator');
const { log } = require('../../utils/log');

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

            // Check trigger conditions
            if (validator.validateItemCondition(item, rule.trigger)) {
                actions.push({
                    action: `set_column: ${rule.value}`,
                    params: { item }
                });
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
