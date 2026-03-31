import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.resolve('server/routes');
const ALLOWLIST_PATH = path.resolve('scripts/endpoint-allowlist.json');

interface AllowlistEntry {
  file: string;
  method: string;
  path: string;
  reason: string;
}

interface Violation {
  file: string;
  line: number;
  method: string;
  routePath: string;
  missingRateLimit: boolean;
  missingValidation: boolean;
}

function loadAllowlist(): AllowlistEntry[] {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    console.error(`\x1b[31m✖ Allowlist file not found: ${ALLOWLIST_PATH}\x1b[0m`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8'));
}

function getAllRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllRouteFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const RATE_LIMIT_PATTERNS = [
  /RateLimiter/i,
  /rateLimit/i,
  /rateLimiting/i,
];

const VALIDATION_PATTERNS = [
  /validateBody/,
  /validateQuery/,
  /\.safeParse\s*\(/,
  /schema\.parse\s*\(/,
];

function extractBlock(lines: string[], startIdx: number, maxLines = 50): string {
  let block = '';
  let depth = 0;
  let started = false;

  for (let i = startIdx; i < Math.min(startIdx + maxLines, lines.length); i++) {
    const line = lines[i];
    block += line + '\n';

    for (const ch of line) {
      if (ch === '(') { depth++; started = true; }
      if (ch === ')') depth--;
    }

    if (started && depth <= 0) break;
  }
  return block;
}

const SINGLE_LINE_REGEX = /router\.(post|put|delete|patch)\s*\(\s*[`'"]/i;
const SINGLE_LINE_PATH_REGEX = /router\.(post|put|delete|patch)\s*\(\s*[`'"]([^`'"]+)[`'"]/i;

const ROUTE_METHOD_REGEX = /router\.route\s*\(\s*[`'"]([^`'"]+)[`'"]\s*\)\s*\.(post|put|delete|patch)\s*\(/i;
const CHAINED_METHOD_REGEX = /\)\s*\.(post|put|delete|patch)\s*\(/i;

interface RouteMatch {
  method: string;
  routePath: string;
  lineIdx: number;
}

function findRouteRegistrations(lines: string[]): RouteMatch[] {
  const matches: RouteMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const singleMatch = line.match(SINGLE_LINE_REGEX);
    if (singleMatch) {
      const pathMatch = line.match(SINGLE_LINE_PATH_REGEX);
      matches.push({
        method: singleMatch[1].toUpperCase(),
        routePath: pathMatch ? pathMatch[2] : 'unknown',
        lineIdx: i,
      });
      continue;
    }

    const multiLineContext = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');

    const routeMatch = multiLineContext.match(ROUTE_METHOD_REGEX);
    if (routeMatch) {
      matches.push({
        method: routeMatch[2].toUpperCase(),
        routePath: routeMatch[1],
        lineIdx: i,
      });

      const remainingContext = lines.slice(i, Math.min(i + 10, lines.length)).join('\n');
      let searchFrom = 0;
      let chainMatch: RegExpExecArray | null;
      const chainRegex = new RegExp(CHAINED_METHOD_REGEX.source, 'gi');
      let isFirst = true;
      while ((chainMatch = chainRegex.exec(remainingContext)) !== null) {
        if (isFirst) { isFirst = false; continue; }
        matches.push({
          method: chainMatch[1].toUpperCase(),
          routePath: routeMatch[1],
          lineIdx: i,
        });
      }
    }

    if (!singleMatch && !routeMatch) {
      const multiLineSingle = multiLineContext.match(
        /router\.(post|put|delete|patch)\s*\(\s*[`'"]([^`'"]+)[`'"]/i
      );
      if (multiLineSingle && !line.match(SINGLE_LINE_REGEX)) {
        matches.push({
          method: multiLineSingle[1].toUpperCase(),
          routePath: multiLineSingle[2],
          lineIdx: i,
        });
      }
    }
  }

  return matches;
}

function scanFile(filePath: string, allowlist: AllowlistEntry[]): Violation[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: Violation[] = [];
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

  const routeMatches = findRouteRegistrations(lines);

  for (const route of routeMatches) {
    const isAllowlisted = allowlist.some(
      (entry) =>
        relPath === entry.file.replace(/\\/g, '/') &&
        entry.method.toUpperCase() === route.method &&
        (entry.path === route.routePath || entry.path === '*')
    );

    if (isAllowlisted) continue;

    const handlerBlock = extractBlock(lines, route.lineIdx);

    const hasRateLimit = RATE_LIMIT_PATTERNS.some((p) => p.test(handlerBlock));
    const hasValidation = VALIDATION_PATTERNS.some((p) => p.test(handlerBlock));

    if (!hasRateLimit || !hasValidation) {
      violations.push({
        file: relPath,
        line: route.lineIdx + 1,
        method: route.method,
        routePath: route.routePath,
        missingRateLimit: !hasRateLimit,
        missingValidation: !hasValidation,
      });
    }
  }

  return violations;
}

console.log('\x1b[36m🔍 Endpoint Security Audit\x1b[0m\n');

const allowlist = loadAllowlist();
const routeFiles = getAllRouteFiles(ROUTES_DIR);
const allViolations: Violation[] = [];

for (const file of routeFiles) {
  allViolations.push(...scanFile(file, allowlist));
}

if (allViolations.length > 0) {
  console.error(`\x1b[31m✖ Found ${allViolations.length} endpoint(s) missing rate limiting or validation:\x1b[0m\n`);
  for (const v of allViolations) {
    const missing = [
      v.missingRateLimit ? 'rate limiting' : '',
      v.missingValidation ? 'validation' : '',
    ]
      .filter(Boolean)
      .join(', ');

    console.error(`  \x1b[31m${v.file}:${v.line}\x1b[0m`);
    console.error(`    ${v.method} ${v.routePath} — missing: ${missing}`);
    console.error('');
  }
  console.error('\x1b[33mTo fix: Add rate limiting middleware and/or Zod validation to these endpoints.');
  console.error('If an endpoint intentionally lacks these, add it to scripts/endpoint-allowlist.json\x1b[0m');
  process.exit(1);
} else {
  console.log(`\x1b[32m✔ All ${routeFiles.length} route files pass security audit (${allowlist.length} allowlisted)\x1b[0m`);
}
