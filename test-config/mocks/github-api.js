/**
 * Mock processItemForProject implementation
 */
async function processItemForProject(item, projectId) {
  if (mockData.shouldFail) {
    throw new Error('Mock API Error: processItemForProject failed');
  }

  console.log('Mock processItemForProject:', { 
    type: item.__typename,
    id: item.id,
    number: item.number
  });

  const key = `${projectId}:${item.id}`;
  
  // Check if already in project
  if (mockData.projectItems.has(key)) {
    return { 
      added: false, 
      projectItemId: mockData.projectItems.get(key),
      reason: 'Already in project'
    };
  }

  // Add to project
  const projectItemId = `project-item-${++mockData.lastId}`;
  mockData.projectItems.set(key, projectItemId);
  
  return { 
    added: true, 
    projectItemId,
    reason: `Added ${item.__typename} #${item.number}`
  };
}
