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

        // Extract monitored users from structured format for backward compatibility
        const monitoredUsers = getMonitoredUsers(config.automation);
        if (monitoredUsers && monitoredUsers.length > 0) {
            // For backward compatibility, use the first user as the primary monitored user
            config.monitoredUser = monitoredUsers[0];
            // Store the full array for new functionality
            config.monitoredUsers = monitoredUsers;
        }
        // Note: If no monitored users are configured, config.monitoredUser will be undefined
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

    // Check if monitored users are properly configured
    const monitoredUsers = getMonitoredUsers(automation);
    
    if (monitoredUsers && monitoredUsers.length > 0) {
        // Merge user scope rules only if monitored users are configured
        if (automation.user_scope?.rules) {
            mergeRuleGroup(merged, automation.user_scope.rules);
        }
    } else {
        // Log warning and skip user-scope rules
        console.warn('⚠️  No monitored users configured. Skipping user-scope rules (board_items, assignees that depend on users).');
        console.warn('   To enable user-based rules, configure monitored_users in automation.user_scope');
    }

    // Merge repository scope rules (always included)
    if (automation.repository_scope?.rules) {
        mergeRuleGroup(merged, automation.repository_scope.rules);
    }

    return merged;
}

/**
 * Extract monitored users from automation configuration
 * @param {object} automation The automation configuration
 * @returns {Array<string>|null} The monitored users array or null if not configured
 */
function getMonitoredUsers(automation) {
    if (!automation.user_scope?.monitored_users) {
        return null;
    }

    const monitoredUsers = automation.user_scope.monitored_users;
    
    // If it's an array of strings, use it directly
    if (Array.isArray(monitoredUsers) && monitoredUsers.every(user => typeof user === 'string')) {
        return monitoredUsers;
    }
    
    // Legacy support for single user object format (with warning)
    if (typeof monitoredUsers === 'object' && monitoredUsers.type === 'static') {
        console.warn('⚠️  Legacy monitored_user object format detected. Consider using monitored_users array format.');
        return [monitoredUsers.name];
    }
    
    return null;
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
