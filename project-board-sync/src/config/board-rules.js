const path = require('path');
const ConfigLoader = require('./loader');

/**
 * Load the board rules configuration and normalize it for backward compatibility.
 * @returns {object} The parsed and validated configuration
 */
function loadBoardRules(context = {}) {
    const loader = new ConfigLoader();
    const config = loader.load(path.join(__dirname, '../../config/rules.yml'));

    // Pass through monitored user from context
    if (context.monitoredUser) {
        config.monitoredUser = context.monitoredUser;
    }

    // Normalize the new scope-based structure to the old flat structure for backward compatibility
    if (config.automation) {
        config.rules = mergeRuleScopes(config.automation);
        config.project = {
            ...config.project,
            organization: config.automation.repository_scope.organization,
            repositories: config.automation.repository_scope.repositories
        };

        // Extract monitored user from structured format for backward compatibility
        if (config.automation.user_scope?.monitored_user) {
            const monitoredUserConfig = config.automation.user_scope.monitored_user;
            if (monitoredUserConfig.type === 'static') {
                // Use static value directly
                config.monitoredUser = monitoredUserConfig.name;
            } else if (monitoredUserConfig.type === 'env') {
                // Use environment variable (existing behavior)
                config.monitoredUser = process.env[ monitoredUserConfig.name ] || monitoredUserConfig.name;
            }
        }
    }

    return config;
}

/**
 * Merge user_scope and repository_scope rules into a flat structure
 * @param {object} automation The automation configuration
 * @returns {object} Merged rules object
 */
function mergeRuleScopes(automation) {
    const merged = {
        board_items: [],
        columns: [],
        sprints: [],
        linked_issues: [],
        assignees: []
    };

    // Merge user scope rules
    if (automation.user_scope?.rules) {
        mergeRuleGroup(merged, automation.user_scope.rules);
    }

    // Merge repository scope rules
    if (automation.repository_scope?.rules) {
        mergeRuleGroup(merged, automation.repository_scope.rules);
    }

    return merged;
}

/**
 * Merge a rule group into the merged rules object
 * @param {object} merged The merged rules object
 * @param {object} ruleGroup The rule group to merge
 */
function mergeRuleGroup(merged, ruleGroup) {
    Object.keys(ruleGroup).forEach(ruleType => {
        if (merged[ ruleType ] && Array.isArray(ruleGroup[ ruleType ])) {
            merged[ ruleType ].push(...ruleGroup[ ruleType ]);
        }
    });
}

module.exports = {
    loadBoardRules
};
