/**
 * Simple logging utility that collects logs for the final summary
 */
class Logger {
  constructor() {
    this.logs = {
      errors: [],
      warnings: [],
      infos: [],
      unchanged: [],
      skipped: [],
      debugs: [],
      states: [] // Add states tracking
    };
  }

  error(message) {
    const fullMessage = message instanceof Error ? message.stack || message.message : message;
    this.logs.errors.push(fullMessage);
    console.error(`ERROR: ${fullMessage}`);
  }

  warning(message) {
    const fullMessage = message instanceof Error ? message.message : message;
    this.logs.warnings.push(fullMessage);
    console.warn(`WARNING: ${fullMessage}`);
  }

  unchanged(message, details = {}) {
    const logEntry = { message, timestamp: new Date(), ...details };
    this.logs.unchanged.push(logEntry);
    console.log(`UNCHANGED: ${message}`);
  }

  skipped(message, details = {}) {
    const logEntry = { message, timestamp: new Date(), ...details };
    this.logs.skipped.push(logEntry);
    console.log(`SKIPPED: ${message}`);
  }

  info(message, raw = false) {
    this.logs.infos.push(message);
    console.log(raw ? message : `INFO: ${message}`);
  }

  debug(message, raw = false) {
    if (process.env.DEBUG) {
      this.logs.debugs.push(message);
      console.log(raw ? message : `DEBUG: ${message}`);
    }
  }

  /**
   * Log the state of an item for comparison
   * @param {string} itemId The GitHub node ID of the item
   * @param {string} context Description of when this state was captured (e.g., 'Before Update')
   * @param {Object} state The current state of the item
   */
  logState(itemId, context, state) {
    const entry = {
      timestamp: new Date(),
      itemId,
      context,
      state
    };
    this.logs.states.push(entry);
    console.log(`STATE [${context}] Item ${itemId}:`, state);
  }

  /**
   * Compare states of an item before and after an operation
   * @param {string} itemId The GitHub node ID of the item
   * @returns {Object|null} The changes detected, or null if comparison not possible
   */
  getStateChanges(itemId) {
    const states = this.logs.states.filter(s => s.itemId === itemId);
    if (states.length < 2) return null;

    const before = states[0].state;
    const after = states[states.length - 1].state;
    
    const changes = {};
    Object.keys(before).forEach(key => {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = {
          from: before[key],
          to: after[key]
        };
      }
    });
    
    return Object.keys(changes).length ? changes : null;
  }

  /**
   * Print a summary of state changes at the end
   */
  printStateSummary() {
    console.log('\nState Changes Summary:');
    const uniqueItems = [...new Set(this.logs.states.map(s => s.itemId))];
    
    for (const itemId of uniqueItems) {
      const changes = this.getStateChanges(itemId);
      if (changes) {
        console.log(`\nItem ${itemId} changes:`);
        Object.entries(changes).forEach(([field, {from, to}]) => {
          console.log(`  ${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
        });
      }
    }
  }

  printSummary() {
    console.log('\n📊 Execution Summary');
    console.log('══════════════════\n');
    
    const stats = {
      total: this.logs.infos.length + this.logs.unchanged.length + this.logs.skipped.length,
      errors: this.logs.errors.length,
      warnings: this.logs.warnings.length,
      unchanged: this.logs.unchanged.length,
      skipped: this.logs.skipped.length,
      stateChanges: this.logs.states.length
    };
    
    console.log(`Total Items Processed: ${stats.total}`);
    console.log(`├─ State Changes: ${stats.stateChanges}`);
    console.log(`├─ Unchanged: ${stats.unchanged}`);
    console.log(`├─ Skipped: ${stats.skipped}`);
    console.log(`├─ Errors: ${stats.errors}`);
    console.log(`└─ Warnings: ${stats.warnings}\n`);

    // Print state changes if any
    if (this.logs.states.length > 0) {
      console.log('🔄 State Changes:');
      this.printStateSummary();
    }

    if (this.logs.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.logs.errors.forEach(msg => console.log(`- ${msg}`));
    }
  }
}

// Create a default logger instance
const defaultLogger = new Logger();

module.exports = {
  Logger,
  log: defaultLogger
};
