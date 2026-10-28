import { parse } from "@babel/parser";

const forbiddenNames = new Set([
  "window",
  "document",
  "globalThis",
  "global",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "location",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "ServiceWorker",
  "eval",
  "Function",
  "AsyncFunction",
  "require",
  "process",
  "module",
  "exports",
  "Buffer",
  "Deno",
  "Bun",
  "constructor",
  "__proto__",
  "prototype",
  "ownerDocument",
  "defaultView",
  "parentNode",
  "parentElement",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "getRootNode",
  "getElementById",
  "querySelector",
  "querySelectorAll",
  "createElement",
  "dangerouslySetInnerHTML",
]);
const allowedTags = new Set([
  "div",
  "section",
  "span",
  "p",
  "strong",
  "em",
  "small",
  "h2",
  "h3",
  "h4",
  "label",
  "button",
  "ul",
  "li",
  "ol",
  "select",
  "option",
  "input",
  "fieldset",
  "legend",
  "svg",
  "path",
  "polyline",
  "circle",
  "Fragment",
]);
const forbiddenNodeTypes = new Set([
  "NewExpression",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "ImportExpression",
  "TaggedTemplateExpression",
  "WithStatement",
  "DebuggerStatement",
  "ClassDeclaration",
  "ClassExpression",
  "AwaitUsingDeclaration",
  "ThisExpression",
  "Super",
  "MetaProperty",
]);

export function validateCandidateSource(source: string): {
  valid: boolean;
  errors: string[];
} {
  const errors = new Set<string>();
  if (
    typeof source !== "string" ||
    source.length < 100 ||
    source.length > 24000
  )
    return {
      valid: false,
      errors: [
        "A candidate must contain a single React component between 100 and 24,000 characters.",
      ],
    };
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx"],
      errorRecovery: false,
    });
  } catch {
    return { valid: false, errors: ["The candidate is not valid JSX source."] };
  }
  // Local DOM queries are a useful React focus primitive. Grant this capability
  // only at a direct call site on an imported useRef-origin variable's .current.
  // Aliases, computed names, dynamic selectors and ancestor/global queries retain
  // the normal denylist. Browser origin/CSP remain the actual isolation boundary.
  type Node = Record<string, any>;
  const walk = (value: unknown, callback: (node: Node) => void) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, callback));
      return;
    }
    const node = value as Node;
    callback(node);
    for (const [key, child] of Object.entries(node))
      if (!["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        walk(child, callback);
  };
  const refHooks = new Set<string>();
  const reactNamespaces = new Set<string>();
  for (const statement of ast.program.body)
    if (
      statement.type === "ImportDeclaration" &&
      statement.source.value === "react"
    ) {
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === "useRef"
        )
          refHooks.add(specifier.local.name);
        if (
          specifier.type === "ImportDefaultSpecifier" ||
          specifier.type === "ImportNamespaceSpecifier"
        )
          reactNamespaces.add(specifier.local.name);
      }
    }
  const localRefs = new Set<string>();
  walk(ast.program, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      node.id?.type !== "Identifier" ||
      node.init?.type !== "CallExpression"
    )
      return;
    const callee = node.init.callee;
    if (
      (callee.type === "Identifier" && refHooks.has(callee.name)) ||
      (callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object?.type === "Identifier" &&
        reactNamespaces.has(callee.object.name) &&
        callee.property?.name === "useRef")
    )
      localRefs.add(node.id.name);
  });
  const scopedQueryProperties = new Set<object>();
  const queryCallSites = new Map<object, Node>();
  walk(ast.program, (node) => {
    if (!["CallExpression", "OptionalCallExpression"].includes(node.type))
      return;
    const callee = node.callee;
    if (
      !["MemberExpression", "OptionalMemberExpression"].includes(
        callee?.type,
      ) ||
      callee.computed ||
      !["querySelector", "querySelectorAll"].includes(callee.property?.name)
    )
      return;
    queryCallSites.set(callee.property, node);
    const target = callee.object;
    const literal = node.arguments?.[0];
    if (
      ["MemberExpression", "OptionalMemberExpression"].includes(target?.type) &&
      !target.computed &&
      target.property?.name === "current" &&
      target.object?.type === "Identifier" &&
      localRefs.has(target.object.name) &&
      node.arguments.length === 1 &&
      literal?.type === "StringLiteral" &&
      literal.value.length > 0 &&
      literal.value.length <= 160
    )
      scopedQueryProperties.add(callee.property);
  });
  let defaultExports = 0;
  let count = 0;
  const describeNode = (node: Record<string, unknown>) => {
    const start = (node.loc as { start?: { line?: number; column?: number } })
      ?.start;
    const location = start
      ? `line ${start.line}, column ${(start.column ?? 0) + 1}`
      : "unknown location";
    const expression = source
      .slice(Number(node.start ?? 0), Number(node.end ?? 0))
      .replace(/\s+/g, " ")
      .slice(0, 120);
    return `${location}${expression ? ` (${JSON.stringify(expression)})` : ""}`;
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Record<string, unknown>;
    if (++count > 14000) {
      errors.add(
        "The candidate is too complex for the scoped component adapter.",
      );
      return;
    }
    if (forbiddenNodeTypes.has(String(n.type)))
      errors.add(
        `Unsupported source operation: ${String(n.type)} at ${describeNode(n)}. ` +
          (String(n.type).endsWith("Statement")
            ? "Loop statements are forbidden in handlers and effects too; use array methods such as find, findIndex, map, or filter, or direct refs."
            : n.type === "NewExpression"
              ? "Constructor calls are forbidden; use plain arrays, objects, and direct React refs."
              : "Remove this operation from the scoped component."),
      );
    if (n.type === "ImportDeclaration") {
      if ((n.source as { value?: string })?.value !== "react")
        errors.add("Only the React package may be imported.");
    }
    if (
      n.type === "ExportNamedDeclaration" ||
      n.type === "ExportAllDeclaration"
    )
      errors.add("Export only the default interaction component.");
    if (n.type === "ExportDefaultDeclaration") defaultExports += 1;
    if (
      n.type === "Identifier" &&
      forbiddenNames.has(String(n.name)) &&
      !scopedQueryProperties.has(n)
    ) {
      const name = String(n.name);
      errors.add(["querySelector", "querySelectorAll"].includes(name)
        ? `Unsupported ${name} access at ${describeNode(queryCallSites.get(n) ?? n)}. Only a direct call on an imported useRef-origin ref's .current is permitted: ref.current.querySelector('static selector') or ref.current.querySelectorAll('static selector'). Aliases, dynamic selectors, computed method names, and ancestor/global queries remain forbidden.`
        : `The component may not access ${name}.`);
    }
    if (
      (n.type === "StringLiteral" || n.type === "Literal") &&
      forbiddenNames.has(String(n.value))
    )
      errors.add(
        "Dynamic access to a protected global or property is not permitted.",
      );
    if (
      n.type === "MemberExpression" ||
      n.type === "OptionalMemberExpression"
    ) {
      if (
        n.computed &&
        (n.property as { type?: string })?.type !== "NumericLiteral" &&
        (n.property as { type?: string })?.type !== "Identifier"
      )
        errors.add(
          `Unsupported computed index ${(n.property as { type?: string })?.type} at ${describeNode(n)}. Only a numeric literal or a local index identifier is permitted inside brackets. Assign arithmetic or nested index expressions to a local numeric variable first, then use that variable as the index; do not use string-keyed ref maps.`,
        );
    }
    if (
      n.type === "CallExpression" &&
      (n.callee as { type?: string })?.type === "Import"
    )
      errors.add("Dynamic imports are not allowed.");
    if (n.type === "JSXOpeningElement") {
      const name = n.name as { type?: string; name?: string };
      if (name.type !== "JSXIdentifier" || !allowedTags.has(name.name ?? ""))
        errors.add(`Unsupported element ${name.name ?? "component"}.`);
    }
    if (
      n.type === "JSXAttribute" &&
      [
        "dangerouslySetInnerHTML",
        "src",
        "href",
        "srcDoc",
        "formAction",
        "action",
        "form",
        "name",
      ].includes(String((n.name as { name?: string })?.name))
    )
      errors.add(
        "Network, HTML injection, and parent-form attributes are not permitted in the component.",
      );
    for (const [key, value] of Object.entries(n))
      if (!["loc", "start", "end", "extra", "comments", "tokens"].includes(key))
        visit(value);
  };
  visit(ast.program);
  if (defaultExports !== 1)
    errors.add("Exactly one default component export is required.");
  for (const hook of ["slot-trigger", "slot-panel", "data-date"])
    if (!source.includes(hook))
      errors.add(`Preserve the public interaction hook ${hook}.`);
  if (!source.includes("onChange"))
    errors.add(
      "The protected onChange selection boundary must remain present.",
    );
  return { valid: errors.size === 0, errors: [...errors] };
}
