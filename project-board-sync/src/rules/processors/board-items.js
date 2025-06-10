const { loadBoardRules } = require('../../config/board-rules');
const { log } = require('../../utils/log');
const { RuleValidation } = require('./validation');

const validator = new RuleValidation();

/**
 * Process rules for adding items to the project board
 * @param {Object} item PR or Issue to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processBoardItemRules(item, context = {}) {
    const rules = await loadBoardRules();
    const actions = [];
    validator.steps.markStepComplete('RULE_CONFIG_LOADED');

    for (const rule of rules.boardItems) {
        try {
            // Skip rule if conditions not met
            if (rule.skipIf && validator.validateSkipRule(item, rule.skipIf)) {
                continue;
            }

            // Check each trigger
            for (const trigger of rule.triggers) {
                if (validator.validateItemCondition(item, trigger, context)) {
                    actions.push({
                        action: 'add_to_board',
                        params: { item }
                    });
                }
            }
        } catch (error) {
            log.error(`Error processing board item rule: ${error.message}`);
        }
    }

    return actions;
}

module.exports = {
    processBoardItemRules
};
