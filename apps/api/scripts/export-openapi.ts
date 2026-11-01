// Writes the generated OpenAPI document to docs/openapi.json (run: pnpm --filter @spaceflow/api openapi:export)
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { buildOpenApiDocument } from '../src/openapi/registry.js';

createApp(); // registers every route's documentation
const out = path.resolve(process.cwd(), '../../docs/openapi.json');
fs.writeFileSync(out, JSON.stringify(buildOpenApiDocument(process.env.npm_package_version ?? '0.1.0'), null, 2));
console.log(`OpenAPI document written to ${out}`);
process.exit(0);
