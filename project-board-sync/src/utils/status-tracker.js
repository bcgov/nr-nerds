/**
 * Tracks the processing status of items during sync
 */
class StatusTracker {
  constructor() {
    this.items = new Map();
    this.stats = {
      total: 0,
      unchanged: 0,
      skipped: 0,
      changed: 0,
      errors: 0
    };
  }

  /**
   * Record an item's processing status
   */
  trackItem(item, status, details = {}) {
    const key = `${item.__typename}-${item.number}-${item.repository.nameWithOwner}`;
    const timestamp = new Date();
    
    this.items.set(key, {
      type: item.__typename,
      number: item.number,
      repo: item.repository.nameWithOwner,
      status,
      timestamp,
      ...details
    });

    // Update stats
    this.stats.total++;
    this.stats[status]++;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      ...this.stats,
      items: Array.from(this.items.values())
    };
  }

  /**
   * Get items by status
   */
  getItemsByStatus(status) {
    return Array.from(this.items.values())
      .filter(item => item.status === status);
  }

  /**
   * Print detailed report
   */
  printReport() {
    const summary = this.getSummary();
    
    console.log('\n📊 Processing Report');
    console.log('═════════════════\n');
    console.log(`Total Items: ${summary.total}`);
    console.log(`├─ Changed: ${summary.changed}`);
    console.log(`├─ Unchanged: ${summary.unchanged}`);
    console.log(`├─ Skipped: ${summary.skipped}`);
    console.log(`└─ Errors: ${summary.errors}\n`);

    if (summary.changed > 0) {
      console.log('✨ Changed Items:');
      this.getItemsByStatus('changed').forEach(item => {
        console.log(`  • ${item.type} #${item.number} [${item.repo}]`);
        if (item.reason) console.log(`    └─ ${item.reason}`);
      });
    }

    if (summary.unchanged > 0) {
      console.log('\n✓ Unchanged Items:');
      this.getItemsByStatus('unchanged').forEach(item => {
        console.log(`  • ${item.type} #${item.number} [${item.repo}]`);
        if (item.reason) console.log(`    └─ ${item.reason}`);
      });
    }

    if (summary.skipped > 0) {
      console.log('\nℹ Skipped Items:');
      this.getItemsByStatus('skipped').forEach(item => {
        console.log(`  • ${item.type} #${item.number} [${item.repo}]`);
        if (item.reason) console.log(`    └─ ${item.reason}`);
      });
    }

    console.log('\n═══════════════════\n');
  }
}

module.exports = {
  StatusTracker
};
