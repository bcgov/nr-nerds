#!/usr/bin/env node

/**
 * Refresh test board data from the real project board
 * Usage: 
 *   npm run refresh-test-data [--dry-run]
 */

const { fetchBoardData } = require('../test/mocks/board-data');
const fs = require('fs');
const path = require('path');

const isDryRun = process.argv.includes('--dry-run');

async function sanitizeItem(item) {
  return {
    ...item,
    id: `test-${item.id.slice(-8)}`,
    content: {
      ...item.content,
      title: `Test ${item.content.title}`,
      repository: {
        ...item.content.repository,
        nameWithOwner: item.content.repository.nameWithOwner.replace(/bcgov\//, 'test-org/')
      }
    }
  };
}

async function refreshTestData() {
  try {
    console.log('Fetching current board data...');
    const data = await fetchBoardData();
    
    // Sanitize sensitive data
    const sanitized = {
      items: await Promise.all(data.items.nodes.map(sanitizeItem))
    };

    if (isDryRun) {
      console.log('Dry run - would write:', JSON.stringify(sanitized, null, 2));
      return;
    }

    const outputPath = path.join(__dirname, '../test/mocks/test-board.js');
    const output = `/**
 * Mock board data generated from real project board
 * Last updated: ${new Date().toISOString()}
 * Use npm run refresh-test-data to update
 */

module.exports = ${JSON.stringify(sanitized, null, 2)};
`;

    fs.writeFileSync(outputPath, output);
    console.log('Updated test board data in:', outputPath);

  } catch (error) {
    console.error('Failed to refresh test data:', error.message);
    process.exit(1);
  }
}

refreshTestData();
