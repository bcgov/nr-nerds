const { ConfigLoader } = require('./loader');
const path = require('path');

/**
 * Load the board rules configuration.
 * @returns {object} The parsed and validated configuration
 */
function loadBoardRules() {
    const loader = new ConfigLoader();
    return loader.load(path.join(__dirname, '../../config/rules.yml'));
}

module.exports = {
    loadBoardRules
};
