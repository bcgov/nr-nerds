/**
 * @fileoverview Processor for board addition rules
 * 
 * @directive Always run tests after modifying this file:
 * ```bash
 * npm test -- processors/board-items.test.js
 * npm test -- processors/real-scenarios.test.js
 * ```
 * Changes here can affect core board item processing logic.
 */

const { loadBoardRules } = require('../../config/board-rules');
const { log } = require('../../utils/log');
const { validator } = require('./shared-validator');

/**
 * Process rules for adding items to the project board
 * @param {Object} item PR or Issue to process
 * @returns {Promise<Array<{action: string, params: Object}>>} List of actions to take
 */
async function processBoardItemRules(item) {
    try {
        const config = await loadBoardRules();
        const actions = [];

        for (const rule of config.rules.board_items) {
            try {
                // Skip if already in project (skip condition)
                if (item.projectItems?.nodes?.length > 0) {
                    log.info(`Skipping ${item.__typename} #${item.number} - Already in project`);
                    continue;
                }

                // Check type and author match (trigger condition)
                if (item.__typename === rule.trigger.type && 
                    validator.validateItemCondition(item, rule.trigger)) {
                    actions.push({
                        action: 'add_to_board',
                        params: { item }
                    });
                    log.info(`Adding ${item.__typename} #${item.number} to board - Matches ${rule.name}`);
                }
            } catch (error) {
                log.error(`Error processing board item rule: ${error.message}`, {
                    rule: rule.name || 'unnamed',
                    item: item.__typename + '#' + item.number
                });
            }
        }

        return actions;
    } catch (error) {
        log.error(`Failed to process board rules: ${error.message}`);
        throw error;
    }
}

module.exports = {
    processBoardItemRules
};
