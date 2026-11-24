/**
 * Deterministic route <-> OpenAPI coverage check.
 *
 * Walks every `frontend/src/app/api/**\/route.ts` file, extracts its exported
 * HTTP methods, converts the file path to an OpenAPI-style path (Next.js
 * `[param]` segments become `{param}`), and fails if any route/method pair is
 * missing from `docs/openapi/v1/openapi.json`.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const frontendRoot = join(scriptDir, "..");
const apiRoot = join(frontendRoot, "src", "app", "api");
const openapiPath = join(frontendRoot, "..", "docs", "openapi", "v1", "openapi.json");

interface RouteFile {
  filePath: string;
  apiPath: string;
  methods: HttpMethod[];
}

function walkRouteFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...walkRouteFiles(fullPath));
    } else if (entry === "route.ts" || entry === "route.tsx") {
      files.push(fullPath);
    }
  }

  return files;
}

function extractMethods(source: string): HttpMethod[] {
  const found = new Set<HttpMethod>();
  const exportPattern = /export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  let match: RegExpExecArray | null;

  while ((match = exportPattern.exec(source)) !== null) {
    found.add(match[1] as HttpMethod);
  }

  return Array.from(found).sort();
}

/** Converts `src/app/api/watchlist/[id]/rescan/route.ts` -> `/watchlist/{id}/rescan`. */
function toApiPath(filePath: string): string {
  const relativePath = relative(apiRoot, filePath);
  const segments = relativePath.split(sep).slice(0, -1); // drop `route.ts`
  const converted = segments.map((segment) => {
    const dynamicMatch = segment.match(/^\[(\.{3})?(.+)\]$/);
    return dynamicMatch ? `{${dynamicMatch[2]}}` : segment;
  });

  return `/${converted.join("/")}`;
}

function collectRouteFiles(): RouteFile[] {
  return walkRouteFiles(apiRoot)
    .map((filePath) => {
      const source = readFileSync(filePath, "utf8");

      return {
        filePath: relative(frontendRoot, filePath),
        apiPath: toApiPath(filePath),
        methods: extractMethods(source),
      };
    })
    .sort((a, b) => a.apiPath.localeCompare(b.apiPath));
}

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

function loadSpec(): OpenApiSpec {
  const raw = readFileSync(openapiPath, "utf8");

  // Fails loudly (rather than silently) if the checked-in spec is not valid JSON.
  return JSON.parse(raw) as OpenApiSpec;
}

/** Canonical error envelope fields required on every documented error response. */
const CANONICAL_ERROR_FIELDS = ["code", "message", "retryable", "recoveryAction", "requestId"] as const;
/** Optional fields that are allowed (but not required) on the canonical error envelope. */
const OPTIONAL_ERROR_FIELDS = ["traceId", "details"] as const;
/** Error status codes every route/method pair must document. */
const REQUIRED_ERROR_STATUSES = ["400", "429", "500"] as const;

type JsonSchema = Record<string, unknown>;

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves a local `$ref` (`#/components/schemas/Name`) against the loaded spec. */
function resolveRef(spec: OpenApiSpec, ref: string): JsonSchema | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const segments = ref.slice(2).split("/");
  let current: unknown = spec;

  for (const segment of segments) {
    if (!isJsonSchema(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return isJsonSchema(current) ? current : undefined;
}

/** Follows `$ref` chains (with a small depth guard) until a concrete schema is reached. */
function derefSchema(spec: OpenApiSpec, schema: unknown, depth = 0): JsonSchema | undefined {
  if (depth > 10 || !isJsonSchema(schema)) {
    return undefined;
  }

  const ref = schema.$ref;
  if (typeof ref === "string") {
    return derefSchema(spec, resolveRef(spec, ref), depth + 1);
  }

  return schema;
}

/**
 * Validates that a schema describes the canonical error envelope: required
 * `code`, `message`, `retryable`, `recoveryAction`, `requestId` and only the
 * documented optional extras. Returns a list of human-readable problems.
 */
function validateErrorSchema(spec: OpenApiSpec, schema: unknown, location: string): string[] {
  const problems: string[] = [];
  const resolved = derefSchema(spec, schema);

  if (!resolved) {
    return [`${location}: error response has no resolvable schema`];
  }

  const required = Array.isArray(resolved.required) ? (resolved.required as unknown[]) : [];
  const properties = isJsonSchema(resolved.properties) ? resolved.properties : {};

  for (const field of CANONICAL_ERROR_FIELDS) {
    if (!required.includes(field)) {
      problems.push(`${location}: canonical error field "${field}" is not required`);
    }
    if (!(field in properties)) {
      problems.push(`${location}: canonical error field "${field}" is missing from properties`);
    }
  }

  const allowed = new Set<string>([...CANONICAL_ERROR_FIELDS, ...OPTIONAL_ERROR_FIELDS]);
  for (const property of Object.keys(properties)) {
    if (!allowed.has(property)) {
      problems.push(`${location}: unexpected error envelope field "${property}"`);
    }
  }

  return problems;
}

/** Extracts the JSON schema for a response, unwrapping `content["application/json"].schema`. */
function extractResponseSchema(response: unknown): unknown {
  if (!isJsonSchema(response)) {
    return undefined;
  }

  const content = response.content;
  if (!isJsonSchema(content)) {
    return undefined;
  }

  const json = content["application/json"];
  if (!isJsonSchema(json)) {
    return undefined;
  }

  return json.schema;
}

/**
 * Validates that every documented error response (4xx/5xx) on an operation
 * uses the canonical error envelope, and that the required error statuses
 * (400/429/500) are declared.
 */
function validateOperationErrors(spec: OpenApiSpec, operation: unknown, location: string): string[] {
  const problems: string[] = [];

  if (!isJsonSchema(operation)) {
    return [`${location}: operation is not an object`];
  }

  const responses = operation.responses;
  if (!isJsonSchema(responses)) {
    return [`${location}: operation has no responses object`];
  }

  for (const status of REQUIRED_ERROR_STATUSES) {
    if (!(status in responses)) {
      problems.push(`${location}: missing required error response "${status}"`);
    }
  }

  for (const [status, response] of Object.entries(responses)) {
    if (!/^[45]\d\d$/.test(status)) {
      continue;
    }

    const schema = extractResponseSchema(response);
    if (schema === undefined) {
      problems.push(`${location}: error response "${status}" has no application/json schema`);
      continue;
    }

    problems.push(...validateErrorSchema(spec, schema, `${location} [${status}]`));
  }

  return problems;
}

function main() {
  const spec = loadSpec();
  const routeFiles = collectRouteFiles();

  assert.ok(routeFiles.length > 0, "Expected to find at least one route.ts file under frontend/src/app/api.");

  const missing: string[] = [];
  let coveredOperations = 0;
  let totalOperations = 0;

  for (const route of routeFiles) {
    const pathItem = spec.paths[route.apiPath];

    if (!pathItem) {
      missing.push(`${route.apiPath} (all methods: ${route.methods.join(", ")}) — declared in ${route.filePath}`);
      totalOperations += route.methods.length;
      continue;
    }

    for (const method of route.methods) {
      totalOperations += 1;
      const operation = pathItem[method.toLowerCase()];

      if (!operation) {
        missing.push(`${method} ${route.apiPath} — declared in ${route.filePath}`);
      } else {
        coveredOperations += 1;
      }
    }
  }

  console.log(`OpenAPI route coverage: ${coveredOperations}/${totalOperations} operations across ${routeFiles.length} route files.`);

  if (missing.length > 0) {
    console.error("\nMissing OpenAPI coverage for:");
    for (const entry of missing) {
      console.error(`  - ${entry}`);
    }
    console.error(`\n${missing.length} operation(s) are implemented but not documented in docs/openapi/v1/openapi.json.`);
    process.exit(1);
  }

  // Also flag OpenAPI paths that no longer correspond to a real route file,
  // so the spec stays honest as routes are removed or renamed.
  const implementedPaths = new Set(routeFiles.map((route) => route.apiPath));
  const staleDocs: string[] = [];

  for (const [docPath, pathItem] of Object.entries(spec.paths)) {
    if (!implementedPaths.has(docPath)) {
      staleDocs.push(docPath);
      continue;
    }

    const route = routeFiles.find((entry) => entry.apiPath === docPath)!;
    const documentedMethods = Object.keys(pathItem).filter((key) => HTTP_METHODS.map((m) => m.toLowerCase()).includes(key));

    for (const documentedMethod of documentedMethods) {
      if (!route.methods.map((m) => m.toLowerCase()).includes(documentedMethod)) {
        staleDocs.push(`${documentedMethod.toUpperCase()} ${docPath}`);
      }
    }
  }

  if (staleDocs.length > 0) {
    console.error("\nOpenAPI documents routes/methods that no longer exist in the codebase:");
    for (const entry of staleDocs) {
      console.error(`  - ${entry}`);
    }
    process.exit(1);
  }

  // Validate that every documented operation uses the canonical error envelope
  // for its 4xx/5xx responses and declares the required error statuses.
  const contractProblems: string[] = [];

  for (const route of routeFiles) {
    const pathItem = spec.paths[route.apiPath];
    if (!pathItem) {
      continue;
    }

    for (const method of route.methods) {
      const operation = pathItem[method.toLowerCase()];
      if (!operation) {
        continue;
      }

      contractProblems.push(...validateOperationErrors(spec, operation, `${method} ${route.apiPath}`));
    }
  }

  if (contractProblems.length > 0) {
    console.error("\nOpenAPI error contract violations:");
    for (const entry of contractProblems) {
      console.error(`  - ${entry}`);
    }
    console.error(
      `\n${contractProblems.length} error contract violation(s) found. Every route/method must document 400/429/500 responses using the canonical error envelope (${CANONICAL_ERROR_FIELDS.join(", ")}; optional: ${OPTIONAL_ERROR_FIELDS.join(", ")}).`,
    );
    process.exit(1);
  }

  console.log("All implemented API routes are documented in docs/openapi/v1/openapi.json.");
  console.log("All documented error responses use the canonical error envelope.");
}

main();
