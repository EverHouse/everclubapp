import fs from 'fs';
import path from 'path';

interface CheckResult {
  file: string;
  line: number;
  content: string;
  issue: string;
}

const failures: CheckResult[] = [];

function requireFile(filePath: string): string {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`\x1b[31m✖ Required file not found: ${filePath}\x1b[0m`);
    console.error('  This file is required for cache header verification.');
    console.error('  If it was renamed or moved, update scripts/check-cache-headers.ts');
    process.exit(1);
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

function checkSecurityMiddleware(filePath: string) {
  const content = requireFile(filePath);
  const lines = content.split('\n');

  let foundNonStaticCachePolicy = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/!isStaticAsset/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n')) && /Cache-Control/.test(line)) {
      foundNonStaticCachePolicy = true;
      if (!/no-store/.test(line)) {
        failures.push({
          file: filePath,
          line: i + 1,
          content: line.trim(),
          issue: 'Default (non-static) cache policy must include no-store',
        });
      }
    }
  }

  if (!foundNonStaticCachePolicy) {
    failures.push({
      file: filePath,
      line: 0,
      content: '',
      issue: 'No non-static Cache-Control policy found — expected !isStaticAsset guard with no-store',
    });
  }
}

function checkSeoMiddleware(filePath: string) {
  const content = requireFile(filePath);
  const lines = content.split('\n');

  let foundHtmlCacheControl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const context = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
    if (/Content-Type.*text\/html/.test(context) && /Cache-Control/.test(line)) {
      foundHtmlCacheControl = true;
      if (!/no-store/.test(line)) {
        failures.push({
          file: filePath,
          line: i + 1,
          content: line.trim(),
          issue: 'HTML response Cache-Control must include no-store',
        });
      }
    }
  }

  if (!foundHtmlCacheControl) {
    failures.push({
      file: filePath,
      line: 0,
      content: '',
      issue: 'No Cache-Control header found for HTML responses — expected no-store',
    });
  }
}

function checkServerIndex(filePath: string) {
  const content = requireFile(filePath);
  const lines = content.split('\n');

  let foundHtmlCacheControl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/\.html/.test(line)) {
      for (let j = i; j < Math.min(i + 3, lines.length); j++) {
        if (/Cache-Control/.test(lines[j])) {
          foundHtmlCacheControl = true;
          if (!/no-store/.test(lines[j])) {
            failures.push({
              file: filePath,
              line: j + 1,
              content: lines[j].trim(),
              issue: 'HTML file cache header must include no-store',
            });
          }
        }
      }
    }
  }

  if (!foundHtmlCacheControl) {
    failures.push({
      file: filePath,
      line: 0,
      content: '',
      issue: 'No HTML cache header found — expected .html check with no-store Cache-Control',
    });
  }
}

console.log('\x1b[36m🔒 Cache Header Regression Guard\x1b[0m\n');

checkServerIndex('server/index.ts');
checkSeoMiddleware('server/middleware/seo.ts');
checkSecurityMiddleware('server/middleware/security.ts');

if (failures.length > 0) {
  console.error('\x1b[31m✖ Cache header check FAILED:\x1b[0m\n');
  for (const f of failures) {
    console.error(`  \x1b[31m${f.file}${f.line ? `:${f.line}` : ''}\x1b[0m`);
    console.error(`    Issue: ${f.issue}`);
    if (f.content) {
      console.error(`    Found: ${f.content}`);
    }
    console.error('');
  }
  console.error('\x1b[31mHTML responses must use "no-store" cache headers to prevent');
  console.error('the iOS Safari stale cache bug. Do not change these headers.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32m✔ All cache headers correctly use no-store\x1b[0m');
}
