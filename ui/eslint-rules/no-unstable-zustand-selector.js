/**
 * eslint: kanso/no-unstable-zustand-selector
 *
 * Flags Zustand selectors that return ad-hoc array/object literals via `?? []`
 * or `?? {}`. These create a new reference on every render, breaking Zustand 5's
 * strict-equality check and causing infinite re-render loops in React 19 + WebKit.
 *
 * The fix: extract the fallback to a module-level constant (e.g. `const EMPTY = []`)
 * or subscribe to the parent map and do the lookup outside the selector.
 *
 * Bug history: commits ce56dc0..71c9dd0 (Wave 8b hot-fix).
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow returning fresh array/object literals via ?? inside Zustand selectors',
    },
    messages: {
      unstable:
        'Zustand selector returns a fresh `{{ kind }}` via `??`. ' +
        'This creates a new reference every render and breaks strict-equality ' +
        'caching (Zustand 5 + React 19). Extract the fallback to a module-level constant.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        // Match use*Store(...)
        if (callee.type !== 'Identifier' || !/^use\w*Store$/.test(callee.name)) return;
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'ArrowFunctionExpression') return;

        const src = context.sourceCode.getText(arg.body);
        if (/\?\?\s*\[/.test(src)) {
          context.report({ node: arg.body, messageId: 'unstable', data: { kind: '[]' } });
        }
        if (/\?\?\s*\{/.test(src)) {
          context.report({ node: arg.body, messageId: 'unstable', data: { kind: '{}' } });
        }
      },
    };
  },
};

export default rule;
