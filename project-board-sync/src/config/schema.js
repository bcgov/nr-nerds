/**
 * @fileoverview JSON Schema for project board sync configuration
 * 
 * @directive Always run schema validation tests after changes:
 * ```bash
 * npm test -- config/loader.test.js
 * ```
 * Schema changes can affect all rule validation.
 */

const schema = {
  type: 'object',
  required: ['version', 'project', 'rules', 'technical'],
  properties: {
    version: { type: 'string' },
    project: {
      type: 'object',
      required: ['id', 'organization', 'repositories'],
      properties: {
        id: { type: 'string' },
        organization: { type: 'string' },
        repositories: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    rules: {
      type: 'object',
      required: ['board_items', 'columns', 'sprints', 'linked_issues', 'assignees'],
      properties: {
        board_items: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        columns: {
          type: 'array',
          items: { 
            allOf: [
              { $ref: '#/definitions/rule' },
              {
                type: 'object',
                required: ['validTransitions'],
                properties: {
                  validTransitions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['from', 'to', 'conditions'],
                      properties: {
                        from: { 
                          oneOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } }
                          ]
                        },
                        to: { type: 'string' },
                        conditions: { type: 'array', items: { type: 'string' } }
                      }
                    }
                  }
                }
              }
            ]
          }
        },
        sprints: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        linked_issues: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        },
        assignees: {
          type: 'array',
          items: { $ref: '#/definitions/rule' }
        }
      }
    },
    technical: {
      type: 'object',
      required: ['batch_size', 'batch_delay_seconds', 'update_window_hours', 'optimization'],
      properties: {
        batch_size: { type: 'integer', minimum: 1 },
        batch_delay_seconds: { type: 'integer', minimum: 0 },
        update_window_hours: { type: 'integer', minimum: 1 },
        optimization: {
          type: 'object',
          required: ['skip_unchanged', 'dedup_by_id'],
          properties: {
            skip_unchanged: { type: 'boolean' },
            dedup_by_id: { type: 'boolean' }
          }
        }
      }
    }
  },
  definitions: {
    rule: {
      type: 'object',
      required: ['name', 'trigger', 'action'],
      properties: {
        name: { type: 'string' },
        trigger: {
          type: 'object',
          required: ['type', 'condition'],
          properties: {
            type: {
              oneOf: [
                { type: 'string', enum: ['PR', 'Issue', 'LinkedIssue'] },
                { 
                  type: 'array',
                  items: { type: 'string', enum: ['PR', 'Issue', 'LinkedIssue'] }
                }
              ]
            },
            condition: { type: 'string' },
            stateRequirements: {
              type: 'object',
              properties: {
                column: { type: 'string' },
                sprint: { type: 'string' },
                assignees: {
                  type: 'array',
                  items: { type: 'string' }
                },
                labels: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        },
        action: {
          oneOf: [
            { type: 'string' },
            { 
              type: 'array',
              items: { type: 'string' }
            }
          ]
        },
        skip_if: { type: 'string' }
      }
    }
  }
};

module.exports = schema;
