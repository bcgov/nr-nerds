const { log } = require('./log');

/**
 * Default batch processing options
 */
const DEFAULT_OPTIONS = {
  batchSize: 10,
  delayBetweenBatches: 1000,
  maxRetries: 3,
  retryDelay: 5000
};

/**
 * Process items in batches with rate limiting and retries
 * @param {Array} items - Array of items to process
 * @param {Function} processItem - Async function to process a single item
 * @param {Object} options - Processing options
 * @returns {Promise<{processed: number, errors: number}>}
 */
async function processBatch(items, processItem, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < items.length; i += opts.batchSize) {
    const batch = items.slice(i, i + opts.batchSize);
    
    for (const item of batch) {
      let retries = 0;
      let success = false;

      while (!success && retries < opts.maxRetries) {
        try {
          await processItem(item);
          processed++;
          success = true;
        } catch (error) {
          retries++;
          log.warn(`Failed to process item (attempt ${retries}/${opts.maxRetries}):`, error.message);
          
          if (retries < opts.maxRetries) {
            await delay(opts.retryDelay);
          } else {
            errors++;
            log.error(`Failed to process item after ${opts.maxRetries} attempts:`, error.message);
          }
        }
      }
    }

    // Delay between batches to respect rate limits
    if (i + opts.batchSize < items.length) {
      await delay(opts.delayBetweenBatches);
    }
  }

  return { processed, errors };
}

/**
 * Helper to delay execution
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  processBatch,
  DEFAULT_OPTIONS
};
