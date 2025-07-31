const path = require('path');
const ConfigLoader = require('./loader');

/**
 * Load the board rules configuration.
 * @returns {object} The parsed and validated configuration
 */
function loadBoardRules(context = {}) {
    const loader = new ConfigLoader();
    const config = loader.load(path.join(__dirname, '../../config/rules.yml'));
    // Pass through monitored user from context
    if (context.monitoredUser) {
        config.monitoredUser = context.monitoredUser;
    }
    return config;
}

module.exports = {
    loadBoardRules
};
