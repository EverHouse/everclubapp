import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASELINE_PATH = path.resolve('scripts/ts-error-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

interface TscResult {
  errors: string[];
  output: string;
  exitCode: number;
}

function runTsc(args: string): TscResult {
  try {
    const argList = args.split(/\s+/).filter(Boolean);
    const output = execFileSync('npx', ['tsc', ...argList], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { errors: [], output, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    const combined = (error.stdout || '') + (error.stderr || '');
    const errors = combined
      .split('\n')
      .filter((l) => /error TS\d+/.test(l))
      .map((l) => l.trim());
    return { errors, output: combined, exitCode: error.status || 1 };
  }
}

function normalizeError(line: string): string {
  return line.replace(/\(\d+,\d+\)/, '(*)').trim();
}

function loadBaseline(): Set<string> {
  if (!fs.existsSync(BASELINE_PATH)) {
    return new Set();
  }
  return new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as string[]);
}

function saveBaseline(errors: string[]): void {
  const normalized = [...new Set(errors.map(normalizeError))].sort();
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(normalized, null, 2));
}

console.log('\x1b[36m🔧 TypeScript Build Checks\x1b[0m\n');

console.log('Checking frontend (src/, shared/)...');
const frontend = runTsc('--noEmit');
if (frontend.exitCode !== 0) {
  console.error(`\x1b[31m✖ Frontend TypeScript check failed with ${frontend.errors.length} error(s):\x1b[0m\n`);
  for (const line of frontend.errors.slice(0, 20)) {
    console.error(`  ${line}`);
  }
  if (frontend.errors.length > 20) {
    console.error(`  ... and ${frontend.errors.length - 20} more`);
  }
  process.exit(1);
}
console.log('\x1b[32m✔ Frontend TypeScript check passed\x1b[0m\n');

console.log('Checking server (server/, shared/)...');
const server = runTsc('--noEmit -p server/tsconfig.json');

if (UPDATE_BASELINE) {
  saveBaseline(server.errors);
  console.log(`\x1b[36m  Baseline updated with ${server.errors.length} error(s) saved to ${BASELINE_PATH}\x1b[0m`);
  process.exit(0);
}

if (server.errors.length === 0) {
  console.log('\x1b[32m✔ Server TypeScript check passed (zero errors)\x1b[0m');
} else {
  const baseline = loadBaseline();
  const currentNormalized = server.errors.map(normalizeError);
  const newErrors = currentNormalized.filter((e) => !baseline.has(e));

  if (newErrors.length > 0) {
    console.error(`\x1b[31m✖ Server TypeScript check found ${newErrors.length} NEW error(s):\x1b[0m\n`);
    for (const line of newErrors.slice(0, 30)) {
      console.error(`  ${line}`);
    }
    if (newErrors.length > 30) {
      console.error(`  ... and ${newErrors.length - 30} more`);
    }
    console.error('\n\x1b[33mFix these new TypeScript errors. If you also fixed baseline errors,');
    console.error('run: npx tsx scripts/check-typescript.ts --update-baseline\x1b[0m');
    process.exit(1);
  }

  const currentSet = new Set(currentNormalized);
  const fixedCount = [...baseline].filter((e) => !currentSet.has(e)).length;
  if (fixedCount > 0) {
    console.log(`\x1b[32m✔ Server TypeScript: ${fixedCount} baseline error(s) fixed! Run --update-baseline to update.\x1b[0m`);
  } else {
    console.log(`\x1b[32m✔ Server TypeScript check passed (${server.errors.length} baseline errors, no new errors)\x1b[0m`);
  }
}
