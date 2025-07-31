const test = require('node:test');
const assert = require('node:assert/strict');
const { isItemInProject } = require('../src/github/api');

// Set up test environment
process.env.GITHUB_AUTHOR = 'DerekRoberts';

test('Verify existing item detection works correctly', async (t) => {
    // This is the PR we saw in the logs
    const prNodeId = 'PR_kwDOHWjA886cSajx'; // This is the node ID from the logs
    const projectId = 'PVT_kwDOAA37OM4AFuzg';
    
    try {
        const result = await isItemInProject(prNodeId, projectId);
        console.log('✅ Item in project check result:', result);
        
        if (result.isInProject) {
            console.log(`✅ PR was already in project with ID: ${result.projectItemId}`);
            assert(result.projectItemId, 'Should have a project item ID if in project');
        } else {
            console.log('❌ PR was not in project - this would be unexpected');
        }
        
        console.log('✅ Existing item detection test completed');
    } catch (error) {
        console.error('❌ Error checking if item is in project:', error.message);
        throw error;
    }
}); 
