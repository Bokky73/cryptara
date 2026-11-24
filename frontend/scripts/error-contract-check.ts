import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { commonErrorCodes } from "../src/server/api/errors";

const validCodes = new Set(Object.values(commonErrorCodes));
const extraAllowed = new Set([
  "chain_family_mismatch",
  "invalid_wallet",
  "invalid_source",
  "source_wallet_mismatch",
  "approval_required",
  "hash_chain_family_mismatch",
  "network_chain_family_mismatch",
  "transaction_not_found",
  "submit_failed",
  "stellar_disabled",
  "invalid_payment_proof",
  "payment_proof_rejected",
  "duplicate_payment",
  "expected_effects_mismatch",
  "incident_mode",
  "not_found"
]);

const ALL_VALID_CODES = new Set([...validCodes, ...extraAllowed]);

const API_ROOT = path.resolve(__dirname, "..", "src", "app", "api");

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS"
]);

const WRAPPER_NAMES = new Set(["withApiHandler", "withPublicApiHandler"]);

function collectRouteFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(full, acc);
    } else if (entry.isFile() && entry.name === "route.ts") {
      acc.push(full);
    }
  }
  return acc;
}

const ROUTE_FILES = collectRouteFiles(API_ROOT).sort();

interface RouteResult {
  file: string;
  ok: boolean;
  problems: string[];
  methods: string[];
  usesWrapper: boolean;
}

function isWrapperCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expr = node.expression;
  if (ts.isIdentifier(expr) && WRAPPER_NAMES.has(expr.text)) {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    WRAPPER_NAMES.has(expr.name.text)
  ) {
    return true;
  }
  return false;
}

function containsWrapperCall(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) {
      return;
    }
    if (isWrapperCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

function isJsonErrorCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expr = node.expression;
  if (ts.isIdentifier(expr) && expr.text === "jsonError") {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === "jsonError"
  ) {
    return true;
  }
  return false;
}

function isResponseJsonCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const expr = node.expression;
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === "json"
  ) {
    const target = expr.expression;
    if (ts.isIdentifier(target) && target.text === "Response") {
      return true;
    }
    if (ts.isIdentifier(target) && target.text === "NextResponse") {
      return true;
    }
  }
  return false;
}

function objectHasProperty(
  obj: ts.ObjectLiteralExpression,
  name: string
): boolean {
  return obj.properties.some((p) => {
    if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
      const propName = p.name;
      if (ts.isIdentifier(propName) || ts.isStringLiteral(propName)) {
        return propName.text === name;
      }
    }
    return false;
  });
}

function getPropertyAssignment(
  obj: ts.ObjectLiteralExpression,
  name: string
): ts.PropertyAssignment | undefined {
  return obj.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name
  );
}

function validateErrorCode(
  codeProp: ts.PropertyAssignment,
  filePath: string,
  problems: string[]
) {
  let codeValue = "";
  const init = codeProp.initializer;
  if (ts.isStringLiteral(init)) {
    codeValue = init.text;
  } else if (ts.isAsExpression(init) && ts.isStringLiteral(init.expression)) {
    codeValue = init.expression.text;
  } else if (ts.isAsExpression(init) && ts.isIdentifier(init.expression)) {
    return;
  } else if (ts.isIdentifier(init)) {
    return;
  }

  if (codeValue && !ALL_VALID_CODES.has(codeValue)) {
    problems.push(`Invalid error code "${codeValue}" in ${filePath}`);
  }
}

function validateFile(filePath: string, program: ts.Program): RouteResult {
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`Could not find source file ${filePath}`);
  }

  const problems: string[] = [];
  const methods: string[] = [];
  let usesWrapper = false;

  function visit(node: ts.Node) {
    // Detect exported HTTP method handlers.
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && HTTP_METHODS.has(decl.name.text)) {
          methods.push(decl.name.text);
          if (decl.initializer && containsWrapperCall(decl.initializer)) {
            usesWrapper = true;
          }
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      node.name &&
      HTTP_METHODS.has(node.name.text)
    ) {
      methods.push(node.name.text);
      if (containsWrapperCall(node)) {
        usesWrapper = true;
      }
    }

    if (isWrapperCall(node)) {
      usesWrapper = true;
    }

    // Validate jsonError codes.
    if (isJsonErrorCall(node)) {
      const args = (node as ts.CallExpression).arguments;
      if (args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
        const codeProp = getPropertyAssignment(args[0], "code");
        if (codeProp) {
          validateErrorCode(codeProp, filePath, problems);
        }
      }
    }

    // Detect bare `{ error: string }` response shapes.
    if (isResponseJsonCall(node)) {
      const args = (node as ts.CallExpression).arguments;
      if (args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
        const obj = args[0];
        if (objectHasProperty(obj, "error") && !objectHasProperty(obj, "code")) {
          problems.push(
            `Bare { error: string } response shape in ${filePath} (missing canonical "code")`
          );
        }
      }
    }

    // Detect stack trace leaks in 500 responses.
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "stack"
    ) {
      problems.push(`Potential stack trace leak ("stack") in ${filePath}`);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (methods.length === 0) {
    problems.push(`No exported HTTP method handlers found in ${filePath}`);
  }

  if (!usesWrapper) {
    problems.push(
      `Route ${filePath} does not use withApiHandler (or returns canonical jsonError envelopes)`
    );
  }

  return {
    file: filePath,
    ok: problems.length === 0,
    problems,
    methods,
    usesWrapper
  };
}

function runCheck() {
  if (ROUTE_FILES.length === 0) {
    console.error(`No route files found under ${API_ROOT}`);
    process.exit(1);
  }

  const program = ts.createProgram(ROUTE_FILES, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    allowJs: true
  });

  const results: RouteResult[] = [];
  let allPassed = true;

  for (const file of ROUTE_FILES) {
    const result = validateFile(file, program);
    results.push(result);
    if (!result.ok) {
      allPassed = false;
    }
  }

  const total = results.length;
  const covered = results.filter((r) => r.ok).length;
  const coveragePct = total === 0 ? 0 : (covered / total) * 100;

  console.log("Error contract coverage report:");
  for (const result of results) {
    const rel = path.relative(path.resolve(__dirname, ".."), result.file);
    const status = result.ok ? "PASS" : "FAIL";
    const methodList = result.methods.length > 0 ? result.methods.join(",") : "-";
    console.log(
      `  [${status}] ${rel} (methods: ${methodList}, wrapper: ${result.usesWrapper ? "yes" : "no"})`
    );
    for (const problem of result.problems) {
      console.error(`      - ${problem}`);
    }
  }

  console.log(
    `\nRoute coverage: ${covered}/${total} (${coveragePct.toFixed(1)}%)`
  );

  if (allPassed && coveragePct === 100) {
    console.log("Static error taxonomy conformance check passed!");
    process.exit(0);
  } else {
    console.error("Static error taxonomy conformance check failed.");
    process.exit(1);
  }
}

runCheck();
