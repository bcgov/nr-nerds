/**
 * Tracks state changes during item synchronization
 */
class StateChangeTracker {
  constructor() {
    this.changes = new Map();
    this.startTimes = new Map();
    this.errors = new Map();
    this.currentState = new Map(); // Track current state for each item
    this.timingStats = {
      totalDuration: 0,
      verificationCounts: {},
      averageDurations: {},
      maxRetries: {},
    };
  }

  /**
   * Start tracking changes for an item
   */
  startTracking(item) {
    const key = `${item.type}#${item.number}`;
    this.startTimes.set(key, Date.now());
    this.changes.set(key, []);
    // Initialize state if not exists
    if (!this.currentState.has(key)) {
      this.currentState.set(key, {});
    }
  }

  /**
   * Record a state change
   */
  recordChange(item, type, before, after, attemptCount = 1) {
    const key = `${item.type}#${item.number}`;
    const changes = this.changes.get(key) || [];
    
    // Get the last known state
    const lastChange = changes[changes.length - 1];
    const currentState = lastChange ? lastChange.after : {};
    
    // Create new state by merging current with after
    const newState = {
      ...currentState,
      ...after
    };
    
    changes.push({
      type,
      timestamp: new Date(),
      before: attemptCount === 1 ? before : currentState,
      after: newState,
      attemptCount,
      duration: Date.now() - this.startTimes.get(key)
    });

    this.changes.set(key, changes);
    
    // Update timing stats
    this.updateTimingStats(type, changes[changes.length - 1].duration, attemptCount);
  }

  /**
   * Track verification error
   */
  recordError(item, type, error, attempt) {
    const key = `${item.type}#${item.number}`;
    if (!this.errors.has(key)) {
      this.errors.set(key, []);
    }
    this.errors.get(key).push({
      type,
      error: error.message,
      attempt,
      timestamp: new Date()
    });
  }

  /**
   * Update timing statistics
   */
  updateTimingStats(type, duration, attempts) {
    if (!this.timingStats.verificationCounts[type]) {
      this.timingStats.verificationCounts[type] = 0;
      this.timingStats.averageDurations[type] = 0;
      this.timingStats.maxRetries[type] = 0;
    }

    // Update counts and averages
    const count = ++this.timingStats.verificationCounts[type];
    const oldAvg = this.timingStats.averageDurations[type];
    this.timingStats.averageDurations[type] = oldAvg + (duration - oldAvg) / count;
    this.timingStats.totalDuration += duration;

    // Track max retries
    if (attempts > this.timingStats.maxRetries[type]) {
      this.timingStats.maxRetries[type] = attempts;
    }
  }

  /**
   * Print a summary of state changes with enhanced statistics
   */
  printSummary() {
    console.log('\n📊 State Change Summary');
    console.log('═══════════════════════\n');

    // Print changes per item
    for (const [itemKey, changes] of this.changes.entries()) {
      if (changes.length === 0) continue;

      console.log(`🔄 ${itemKey}`);
      changes.forEach(change => {
        const duration = (change.duration / 1000).toFixed(1);
        console.log(`  • ${change.type} (${duration}s, ${change.attemptCount} attempts)`);
        
        if (typeof change.before === 'object') {
          const diffs = this.getDiffs(change.before, change.after);
          diffs.forEach(diff => console.log(`    ${diff}`));
        } else {
          console.log(`    ${change.before} → ${change.after}`);
        }
      });

      // Print any errors for this item
      const itemErrors = this.errors.get(itemKey) || [];
      if (itemErrors.length > 0) {
        console.log(`  ❌ Verification Errors:`);
        itemErrors.forEach(err => {
          console.log(`    • ${err.type} (attempt ${err.attempt})`);
          console.log(`      ${err.error}`);
        });
      }
      console.log();
    }

    // Print timing statistics
    console.log('⏱️  Timing Statistics');
    console.log('══════════════════\n');
    console.log(`Total Duration: ${(this.timingStats.totalDuration / 1000).toFixed(1)}s\n`);
    
    Object.keys(this.timingStats.verificationCounts).forEach(type => {
      const count = this.timingStats.verificationCounts[type];
      const avgDuration = this.timingStats.averageDurations[type];
      const maxRetries = this.timingStats.maxRetries[type];
      
      console.log(`${type}:`);
      console.log(`  Count: ${count}`);
      console.log(`  Avg Duration: ${(avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Max Retries: ${maxRetries}`);
    });
  }

  /**
   * Get differences between two states
   */
  getDiffs(before, after) {
    const diffs = [];
    const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    
    for (const key of allKeys) {
      if (!(key in before)) {
        diffs.push(`+ ${key}: ${JSON.stringify(after[key])}`);
      } else if (!(key in after)) {
        diffs.push(`- ${key}: ${JSON.stringify(before[key])}`);
      } else if (before[key] !== after[key]) {
        diffs.push(`~ ${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
      }
    }
    
    return diffs;
  }
}

module.exports = {
  StateChangeTracker
};
