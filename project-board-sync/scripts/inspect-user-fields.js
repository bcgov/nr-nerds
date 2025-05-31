// Utility script to inspect GitHub GraphQL schema for user fields
const { octokit } = require('../src/github/api');

async function inspectUserFields() {
  try {
    // Try to get more information about fields that can be used with users
    const result = await octokit.graphql(`
      query {
        __schema {
          types {
            name
            description
            kind
            fields {
              name
              description
            }
          }
        }
      }
    `);
    
    // Filter for types related to users and projects
    const userRelatedTypes = result.__schema.types.filter(type => 
      type.name && 
      (type.name.includes('User') || type.name.includes('Assignee') || 
       type.name.includes('ProjectV2') && type.name.includes('Field'))
    );
    
    console.log('User and Project Field Types:');
    userRelatedTypes.forEach(type => {
      console.log(`\n${type.name}: ${type.description || 'No description'}`);
      if (type.fields) {
        type.fields.forEach(field => {
          console.log(`  - ${field.name}: ${field.description || 'No description'}`);
        });
      }
    });
    
  } catch (error) {
    console.error('Error inspecting user fields:', error.message);
  }
}

inspectUserFields();
