/**
 * Simple logging utility that collects logs for the final summary
 */
let instance = null;

class Logger {
  constructor() {
    if (!instance) {
      this.logs = {
        errors: [],
        warnings: [],
        infos: [],
        unchanged: [],
        skipped: [],
        debugs: []
      };
      instance = this;
    }
    return instance;
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

  printSummary() {
    console.log('\n📊 Execution Summary');
    console.log('══════════════════\n');
    
    const stats = {
      total: this.logs.infos.length + this.logs.unchanged.length + this.logs.skipped.length,
      errors: this.logs.errors.length,
      warnings: this.logs.warnings.length,
      unchanged: this.logs.unchanged.length,
      skipped: this.logs.skipped.length
    };
    
    console.log(`Total Items Processed: ${stats.total}`);
    console.log(`├─ Unchanged: ${stats.unchanged}`);
    console.log(`├─ Skipped: ${stats.skipped}`);
    console.log(`├─ Errors: ${stats.errors}`);
    console.log(`└─ Warnings: ${stats.warnings}\n`);

    if (this.logs.errors.length > 0) {
      console.log('❌ Errors:');
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
