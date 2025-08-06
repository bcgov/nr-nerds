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
        const monitoredUser = getMonitoredUser(config.automation);
        if (monitoredUser) {
            config.monitoredUser = monitoredUser;
        }
        // Note: If no monitored user is configured, config.monitoredUser will be undefined
        // This is handled gracefully by the rule processors
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

    // Check if monitored user is properly configured
    const monitoredUser = getMonitoredUser(automation);
    
    if (monitoredUser) {
        // Merge user scope rules only if monitored user is configured
        if (automation.user_scope?.rules) {
            mergeRuleGroup(merged, automation.user_scope.rules);
        }
    } else {
        // Log warning and skip user-scope rules
        console.warn('⚠️  No monitored user configured. Skipping user-scope rules (board_items, assignees that depend on user).');
        console.warn('   To enable user-based rules, configure monitored_user in automation.user_scope');
    }

    // Merge repository scope rules (always included)
    if (automation.repository_scope?.rules) {
        mergeRuleGroup(merged, automation.repository_scope.rules);
    }

    return merged;
}

/**
 * Extract monitored user from automation configuration
 * @param {object} automation The automation configuration
 * @returns {string|null} The monitored user name or null if not configured
 */
function getMonitoredUser(automation) {
    if (!automation.user_scope?.monitored_user) {
        return null;
    }

    const monitoredUserConfig = automation.user_scope.monitored_user;
    
    // Only support static user configuration for security and predictability
    if (monitoredUserConfig.type === 'static') {
        return monitoredUserConfig.name;
    } else {
        console.warn(`⚠️  Unsupported monitored_user type: ${monitoredUserConfig.type}. Only 'static' is supported for security.`);
        return null;
    }
}

/**
 * Merge a rule group into the merged rules object
 * @param {object} merged The merged rules object
 * @param {object} ruleGroup The rule group to merge
 */
function mergeRuleGroup(merged, ruleGroup) {
    Object.keys(ruleGroup).forEach(ruleType => {
        if (Array.isArray(ruleGroup[ ruleType ])) {
            merged[ ruleType ].push(...ruleGroup[ ruleType ]);
        }
    });
}

module.exports = {
    loadBoardRules
};
