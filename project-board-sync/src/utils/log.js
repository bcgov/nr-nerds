/**
 * Simple logging utility that collects logs for the final summary
 */
class Logger {
  constructor() {
    this.logs = {
      errors: [],
      warnings: [],
      infos: [],
      debugs: []
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

  info(message) {
    this.logs.infos.push(message);
    console.log(`INFO: ${message}`);
  }

  debug(message) {
    if (process.env.DEBUG) {
      this.logs.debugs.push(message);
      console.log(`DEBUG: ${message}`);
    }
  }

  /**
   * Print final summary of all logs
   */
  printSummary() {
    console.log('\n=== Execution Summary ===\n');
    
    if (this.logs.errors.length > 0) {
      console.log('\nErrors:');
      this.logs.errors.forEach(msg => console.log(`- ${msg}`));
    }
    
    if (this.logs.warnings.length > 0) {
      console.log('\nWarnings:');
      this.logs.warnings.forEach(msg => console.log(`- ${msg}`));
    }
    
    if (this.logs.infos.length > 0) {
      console.log('\nInfo:');
      this.logs.infos.forEach(msg => console.log(`- ${msg}`));
    }

    if (process.env.DEBUG && this.logs.debugs.length > 0) {
      console.log('\nDebug:');
      this.logs.debugs.forEach(msg => console.log(`- ${msg}`));
    }
    
    console.log('\n=== End Summary ===\n');
  }
}

// Create a default logger instance
const defaultLogger = new Logger();

module.exports = {
  Logger,
  log: defaultLogger
};
