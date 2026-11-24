import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const openapiDir = join(__dirname, '..', '..', '..', 'docs', 'openapi', 'v1');

function loadOpenApiSpecs() {
  const specs = [];
  let entries;
  try {
    entries = readdirSync(openapiDir);
  } catch {
    return specs;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json') && !entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const raw = readFileSync(join(openapiDir, entry), 'utf8');
    if (entry.endsWith('.json')) {
      specs.push({ name: entry, doc: JSON.parse(raw) });
    }
  }
  return specs;
}

function collectSchemas(specs) {
  const schemas = new Map();
  for (const { doc } of specs) {
    const components = doc?.components?.schemas ?? {};
    for (const [name, schema] of Object.entries(components)) {
      schemas.set(name, schema);
    }
  }
  return schemas;
}

function resolveRef(ref, specs) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return null;
  }
  const parts = ref.slice(2).split('/');
  for (const { doc } of specs) {
    let node = doc;
    let ok = true;
    for (const part of parts) {
      if (node && typeof node === 'object' && part in node) {
        node = node[part];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) {
      return node;
    }
  }
  return null;
}

function validate(value, schema, specs, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return errors;
  }
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, specs);
    if (!resolved) {
      errors.push(`${path}: unresolved $ref ${schema.$ref}`);
      return errors;
    }
    return validate(value, resolved, specs, path);
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const matches = types.some((t) => {
      if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
      if (t === 'number') return typeof value === 'number';
      if (t === 'null') return value === null;
      return t === actual;
    });
    if (!matches) {
      errors.push(`${path}: expected ${types.join('|')}, got ${value === null ? 'null' : actual}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property ${key}`);
      }
    }
    const props = schema.properties ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in value) {
        errors.push(...validate(value[key], propSchema, specs, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, idx) => {
      errors.push(...validate(item, schema.items, specs, `${path}[${idx}]`));
    });
  }

  return errors;
}

function loadFixtures() {
  let entries;
  try {
    entries = readdirSync(fixturesDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => ({
      name: entry,
      data: JSON.parse(readFileSync(join(fixturesDir, entry), 'utf8')),
    }));
}

const specs = loadOpenApiSpecs();
const schemas = collectSchemas(specs);
const fixtures = loadFixtures();

test('OpenAPI specs are present for contract validation', () => {
  assert.ok(specs.length > 0, 'expected at least one OpenAPI spec under docs/openapi/v1');
});

test('read-client fixtures validate against OpenAPI response schemas', () => {
  assert.ok(fixtures.length > 0, 'expected at least one fixture under tests/fixtures');

  for (const fixture of fixtures) {
    const schemaName = fixture.data?.$schema ?? fixture.data?.schema;
    if (!schemaName) {
      continue;
    }
    const schema = schemas.get(schemaName);
    assert.ok(schema, `fixture ${fixture.name} references unknown schema ${schemaName}`);
    const payload = fixture.data?.payload ?? fixture.data;
    const errors = validate(payload, schema, specs);
    assert.deepEqual(errors, [], `fixture ${fixture.name} failed schema validation:\n${errors.join('\n')}`);
  }
});
