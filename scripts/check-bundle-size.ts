import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';

const WARN_THRESHOLD_KB = 500;
const FAIL_THRESHOLD_KB = 750;
const DIST_JS_DIR = path.resolve('dist/assets/js');
const DIST_CSS_DIR = path.resolve('dist/assets');
const REPORT_FILE = path.resolve('dist/bundle-report.json');

interface ChunkInfo {
  name: string;
  sizeBytes: number;
  sizeKB: number;
  gzipBytes: number;
  gzipKB: number;
}

function formatSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`;
  return `${kb.toFixed(2)} KB`;
}

function getGzipSize(filePath: string): number {
  const content = fs.readFileSync(filePath);
  return gzipSync(content, { level: 9 }).length;
}

function run(): void {
  if (!fs.existsSync(DIST_JS_DIR)) {
    console.error(`\n❌ Build output not found at ${DIST_JS_DIR}`);
    console.error('   Run "vite build" first.\n');
    process.exit(1);
  }

  const jsFiles = fs.readdirSync(DIST_JS_DIR).filter(f => f.endsWith('.js'));

  if (jsFiles.length === 0) {
    console.error(`\n❌ No JS chunks found in ${DIST_JS_DIR}\n`);
    process.exit(1);
  }

  const chunks: ChunkInfo[] = jsFiles.map(name => {
    const filePath = path.join(DIST_JS_DIR, name);
    const stats = fs.statSync(filePath);
    const gzipBytes = getGzipSize(filePath);
    return {
      name,
      sizeBytes: stats.size,
      sizeKB: stats.size / 1024,
      gzipBytes,
      gzipKB: gzipBytes / 1024,
    };
  });

  chunks.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const cssFiles = fs.existsSync(DIST_CSS_DIR)
    ? fs.readdirSync(DIST_CSS_DIR).filter(f => f.endsWith('.css'))
    : [];
  let totalCssKB = 0;
  let totalCssGzipKB = 0;
  for (const cssFile of cssFiles) {
    const cssPath = path.join(DIST_CSS_DIR, cssFile);
    const stats = fs.statSync(cssPath);
    const gzipBytes = getGzipSize(cssPath);
    totalCssKB += stats.size / 1024;
    totalCssGzipKB += gzipBytes / 1024;
  }

  const top10 = chunks.slice(0, 10);
  const warnings = chunks.filter(c => c.sizeKB >= WARN_THRESHOLD_KB && c.sizeKB < FAIL_THRESHOLD_KB);
  const failures = chunks.filter(c => c.sizeKB >= FAIL_THRESHOLD_KB);
  const totalSizeKB = chunks.reduce((sum, c) => sum + c.sizeKB, 0);
  const totalGzipKB = chunks.reduce((sum, c) => sum + c.gzipKB, 0);

  console.log('\n📦 Bundle Size Report');
  console.log('═'.repeat(70));
  console.log(`JS chunks: ${chunks.length} | Raw: ${formatSize(totalSizeKB)} | Gzip: ${formatSize(totalGzipKB)}`);
  console.log(`CSS files: ${cssFiles.length} | Raw: ${formatSize(totalCssKB)} | Gzip: ${formatSize(totalCssGzipKB)}`);
  console.log(`Warn threshold: ${WARN_THRESHOLD_KB} KB | Fail threshold: ${FAIL_THRESHOLD_KB} KB`);
  console.log('─'.repeat(70));

  console.log('\nTop 10 Largest Chunks (raw / gzip):');
  for (const chunk of top10) {
    let status = '✅';
    if (chunk.sizeKB >= FAIL_THRESHOLD_KB) status = '❌ OVER LIMIT';
    else if (chunk.sizeKB >= WARN_THRESHOLD_KB) status = '⚠️  WARNING';
    console.log(`  ${status}  ${formatSize(chunk.sizeKB).padStart(10)} / ${formatSize(chunk.gzipKB).padStart(10)}  ${chunk.name}`);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} chunk(s) exceed ${WARN_THRESHOLD_KB} KB warning threshold`);
  }

  const report = {
    timestamp: new Date().toISOString(),
    jsChunks: chunks.length,
    totalRawKB: Math.round(totalSizeKB * 100) / 100,
    totalGzipKB: Math.round(totalGzipKB * 100) / 100,
    cssRawKB: Math.round(totalCssKB * 100) / 100,
    cssGzipKB: Math.round(totalCssGzipKB * 100) / 100,
    top10: top10.map(c => ({
      name: c.name,
      rawKB: Math.round(c.sizeKB * 100) / 100,
      gzipKB: Math.round(c.gzipKB * 100) / 100,
    })),
    warnings: warnings.map(c => c.name),
    failures: failures.map(c => c.name),
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to ${REPORT_FILE}`);

  if (failures.length > 0) {
    console.log(`\n❌ ${failures.length} chunk(s) exceed ${FAIL_THRESHOLD_KB} KB limit:`);
    for (const f of failures) {
      console.log(`   - ${f.name} (${formatSize(f.sizeKB)})`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('\n✅ All chunks within budget\n');
}

run();
