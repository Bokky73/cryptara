/**
 * Deterministic route <-> OpenAPI coverage check.
 *
 * Walks every `frontend/src/app/api/**\/route.ts` file, extracts its exported
 * HTTP methods, converts the file path to an OpenAPI-style path (Next.js
 * `[param]` segments become `{param}`), and fails if any route/method pair is
 * missing from `docs/openapi/v1/openapi.json`.
 *
 * It also validates that every documented operation declares the canonical
 * error responses (400, 401, 402, 403, 404, 429, 500, 503) so server responses,
 * docs, and SDK clients cannot drift apart silently.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/** Canonical error responses every documented operation must declare. */
const CANONICAL_ERROR_STATUSES = ["400", "401", "402", "403", "404", "429", "500", "503"] as const;

/** Route prefixes that are intentionally excluded from OpenAPI coverage. */
const EXCLUDED_PATH_PREFIXES = ["/dev"] as const;

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

/** Routes under excluded prefixes (e.g. `/dev/*`) are not required to be documented. */
function isExcluded(apiPath: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => apiPath === prefix || apiPath.startsWith(`${prefix}/`));
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
    .filter((route) => !isExcluded(route.apiPath))
    .sort((a, b) => a.apiPath.localeCompare(b.apiPath));
}

interface OpenApiOperation {
  responses?: Record<string, unknown>;
}

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

function loadSpec(): OpenApiSpec {
  const raw = readFileSync(openapiPath, "utf8");

  // Fails loudly (rather than silently) if the checked-in spec is not valid JSON.
  return JSON.parse(raw) as OpenApiSpec;
}

function main() {
  const spec = loadSpec();
  const routeFiles = collectRouteFiles();

  assert.ok(routeFiles.length > 0, "Expected to find at least one route.ts file under frontend/src/app/api.");

  const missing: string[] = [];
  const missingErrors: string[] = [];
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
      const operation = pathItem[method.toLowerCase()] as OpenApiOperation | undefined;

      if (!operation) {
        missing.push(`${method} ${route.apiPath} — declared in ${route.filePath}`);
        continue;
      }

      coveredOperations += 1;

      const responses = operation.responses ?? {};
      const absent = CANONICAL_ERROR_STATUSES.filter((status) => !(status in responses));

      if (absent.length > 0) {
        missingErrors.push(`${method} ${route.apiPath} — missing responses: ${absent.join(", ")}`);
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

  if (missingErrors.length > 0) {
    console.error("\nDocumented operations missing canonical error responses:");
    for (const entry of missingErrors) {
      console.error(`  - ${entry}`);
    }
    console.error(`\nEvery operation must declare responses for ${CANONICAL_ERROR_STATUSES.join(", ")}.`);
    process.exit(1);
  }

  // Also flag OpenAPI paths that no longer correspond to a real route file,
  // so the spec stays honest as routes are removed or renamed.
  const implementedPaths = new Set(routeFiles.map((route) => route.apiPath));
  const staleDocs: string[] = [];

  for (const [docPath, pathItem] of Object.entries(spec.paths)) {
    if (isExcluded(docPath)) {
      continue;
    }

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

  console.log("All implemented API routes are documented in docs/openapi/v1/openapi.json.");
}

main();
