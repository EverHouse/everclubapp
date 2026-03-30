import fs from 'fs';
import path from 'path';

const WARN_THRESHOLD_KB = 500;
const FAIL_THRESHOLD_KB = 750;
const DIST_JS_DIR = path.resolve('dist/assets/js');

interface ChunkInfo {
  name: string;
  sizeBytes: number;
  sizeKB: number;
}

function formatSize(kb: number): string {
  if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`;
  return `${kb.toFixed(2)} KB`;
}

function run(): void {
  if (!fs.existsSync(DIST_JS_DIR)) {
    console.error(`\n❌ Build output not found at ${DIST_JS_DIR}`);
    console.error('   Run "vite build" first.\n');
    process.exit(1);
  }

  const files = fs.readdirSync(DIST_JS_DIR).filter(f => f.endsWith('.js'));

  if (files.length === 0) {
    console.error(`\n❌ No JS chunks found in ${DIST_JS_DIR}\n`);
    process.exit(1);
  }

  const chunks: ChunkInfo[] = files.map(name => {
    const filePath = path.join(DIST_JS_DIR, name);
    const stats = fs.statSync(filePath);
    return {
      name,
      sizeBytes: stats.size,
      sizeKB: stats.size / 1024,
    };
  });

  chunks.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const top10 = chunks.slice(0, 10);
  const warnings = chunks.filter(c => c.sizeKB >= WARN_THRESHOLD_KB && c.sizeKB < FAIL_THRESHOLD_KB);
  const failures = chunks.filter(c => c.sizeKB >= FAIL_THRESHOLD_KB);
  const totalSizeKB = chunks.reduce((sum, c) => sum + c.sizeKB, 0);

  console.log('\n📦 Bundle Size Report');
  console.log('═'.repeat(60));
  console.log(`Total chunks: ${chunks.length} | Total size: ${formatSize(totalSizeKB)}`);
  console.log(`Warn threshold: ${WARN_THRESHOLD_KB} KB | Fail threshold: ${FAIL_THRESHOLD_KB} KB`);
  console.log('─'.repeat(60));

  console.log('\nTop 10 Largest Chunks:');
  for (const chunk of top10) {
    let status = '✅';
    if (chunk.sizeKB >= FAIL_THRESHOLD_KB) status = '❌ OVER LIMIT';
    else if (chunk.sizeKB >= WARN_THRESHOLD_KB) status = '⚠️  WARNING';
    console.log(`  ${status}  ${formatSize(chunk.sizeKB).padStart(10)}  ${chunk.name}`);
  }

  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} chunk(s) exceed ${WARN_THRESHOLD_KB} KB warning threshold`);
  }

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
