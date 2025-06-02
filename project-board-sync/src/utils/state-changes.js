/**
 * Tracks state changes during item synchronization
 */
class StateChangeTracker {
  constructor() {
    this.changes = new Map();
    this.startTimes = new Map();
  }

  /**
   * Start tracking changes for an item
   */
  startTracking(item) {
    const key = `${item.type}#${item.number}`;
    this.startTimes.set(key, Date.now());
    this.changes.set(key, []);
  }

  /**
   * Record a state change
   */
  recordChange(item, type, before, after, attemptCount = 1) {
    const key = `${item.type}#${item.number}`;
    const changes = this.changes.get(key) || [];
    
    changes.push({
      type,
      timestamp: new Date(),
      before,
      after,
      attemptCount,
      duration: Date.now() - this.startTimes.get(key)
    });

    this.changes.set(key, changes);
  }

  /**
   * Print a summary of state changes
   */
  printSummary() {
    console.log('\n📊 State Change Summary');
    console.log('═══════════════════════\n');

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
      console.log();
    }
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
