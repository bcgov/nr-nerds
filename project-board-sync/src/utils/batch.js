/**
 * Split array into batches and process with delay between batches
 * @param {Array} items - Array of items to process
 * @param {number} batchSize - Size of each batch (default: 10)
 * @param {number} delayMs - Milliseconds to wait between batches (default: 1000)
 * @param {Function} processFn - Async function to process each batch
 */
async function processBatches(items, batchSize = 10, delayMs = 1000, processFn) {
  const batches = [];
  
  // Split into batches
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  // Process each batch with delay
  for (let i = 0; i < batches.length; i++) {
    await processFn(batches[i]);
    
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = {
  processBatches
};
