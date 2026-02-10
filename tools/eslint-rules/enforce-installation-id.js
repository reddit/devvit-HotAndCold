/**
 * Custom ESLint rule: enforce-installation-id
 *
 * Ensures every drizzle select/update/delete query includes
 * the specified column (default: "installationId") in the .where() clause.
 *
 * Inserts are excluded — installationId is auto-populated via $defaultFn.
 *
 * NOTE: This rule only supports the drizzle query-builder API
 * (db.select / db.update / db.delete). It does NOT support or
 * analyze the drizzle relations (relational queries) API.
 */
export const enforceInstallationId = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce that drizzle select/update/delete queries include a required column in the .where() clause',
    },
    messages: {
      missingColumn:
        'Drizzle .{{method}}() queries must include "{{columnName}}" in the .where() clause.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          drizzleObjectName: {
            type: 'array',
            items: { type: 'string' },
          },
          columnName: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const drizzleObjectNames = options.drizzleObjectName || ['db'];
    const columnName = options.columnName || 'installationId';

    /** Check if a node is a recognized drizzle object identifier */
    function isDrizzleObject(node) {
      return node.type === 'Identifier' && drizzleObjectNames.includes(node.name);
    }

    /**
     * Walk a method-call chain from the outermost call inward.
     * Returns an array of { name, callNode } for each chained method
     * and the root object at the base of the chain.
     *
     * e.g. db.select().from(t).where(...)
     *   methods: [{ name:'where', … }, { name:'from', … }, { name:'select', … }]
     *   root:    Identifier(db)
     */
    function walkChain(node) {
      const methods = [];
      let current = node;

      while (current && current.type === 'CallExpression') {
        if (current.callee && current.callee.type === 'MemberExpression') {
          const prop = current.callee.property;
          const name = prop.type === 'Identifier' ? prop.name : prop.value;
          methods.push({ name, callNode: current });
          current = current.callee.object;
        } else {
          break;
        }
      }

      return { methods, root: current };
    }

    /**
     * Recursively check whether any node in the subtree references
     * the target column name (as an Identifier or MemberExpression property).
     */
    function containsColumnReference(node) {
      if (!node) return false;

      switch (node.type) {
        case 'Identifier':
          return node.name === columnName;

        case 'MemberExpression':
          return (
            (node.property.type === 'Identifier' && node.property.name === columnName) ||
            containsColumnReference(node.object)
          );

        case 'CallExpression':
          return (
            containsColumnReference(node.callee) ||
            node.arguments.some((arg) => containsColumnReference(arg))
          );

        case 'LogicalExpression':
        case 'BinaryExpression':
          return containsColumnReference(node.left) || containsColumnReference(node.right);

        case 'ArrayExpression':
          return node.elements.some((el) => el && containsColumnReference(el));

        case 'SpreadElement':
          return containsColumnReference(node.argument);

        case 'ConditionalExpression':
          return (
            containsColumnReference(node.consequent) ||
            containsColumnReference(node.alternate)
          );

        case 'TemplateLiteral':
          return node.expressions.some((expr) => containsColumnReference(expr));

        case 'TaggedTemplateExpression':
          return node.quasi.expressions.some((expr) => containsColumnReference(expr));

        default:
          return false;
      }
    }

    /**
     * A CallExpression is the "top" of its chain when it is NOT
     * the object of a further MemberExpression (i.e. the chain
     * doesn't continue upward).
     */
    function isTopOfChain(node) {
      const parent = node.parent;
      return !(parent && parent.type === 'MemberExpression' && parent.object === node);
    }

    // ── Visitor ────────────────────────────────────────────────

    return {
      CallExpression(node) {
        // Only inspect the outermost call in a chain
        if (!isTopOfChain(node)) return;

        const { methods, root } = walkChain(node);
        if (!isDrizzleObject(root)) return;

        // Only enforce on queries that filter rows
        const QUERY_METHODS = ['select', 'update', 'delete'];
        const queryMethod = methods.find((m) => QUERY_METHODS.includes(m.name));
        if (!queryMethod) return;

        // Look for .where() in the chain
        const whereCall = methods.find((m) => m.name === 'where');

        if (!whereCall) {
          // No .where() at all
          context.report({
            node: queryMethod.callNode,
            messageId: 'missingColumn',
            data: { method: queryMethod.name, columnName },
          });
          return;
        }

        // .where() exists — make sure it references the required column
        const hasColumnRef = whereCall.callNode.arguments.some((arg) =>
          containsColumnReference(arg)
        );

        if (!hasColumnRef) {
          context.report({
            node: whereCall.callNode,
            messageId: 'missingColumn',
            data: { method: queryMethod.name, columnName },
          });
        }
      },
    };
  },
};
