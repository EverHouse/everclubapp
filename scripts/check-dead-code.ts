import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.resolve('server/routes');
const CORE_DIR = path.resolve('server/core');
const ROUTES_LOADER = path.resolve('server/loaders/routes.ts');
const SERVER_DIR = path.resolve('server');
const SRC_DIR = path.resolve('src');
const SHARED_DIR = path.resolve('shared');

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

function getRouteImportsFromLoader(): Set<string> {
  const content = fs.readFileSync(ROUTES_LOADER, 'utf-8');
  const importPaths = new Set<string>();

  const importRegex = /from\s+['"]\.\.\/routes\/([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    importPaths.add(match[1]);
  }

  return importPaths;
}

function exportsRouter(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  return /export\s+default\s+\w*[Rr]outer/.test(content) ||
    /export\s+default\s+router/.test(content) ||
    /Router\(\)/.test(content);
}

function isImportedByParent(filePath: string): boolean {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, '.ts');
  const isIndex = baseName === 'index';

  const siblings = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
  for (const sibling of siblings) {
    if (sibling === path.basename(filePath)) continue;
    const siblingPath = path.join(dir, sibling);
    const content = fs.readFileSync(siblingPath, 'utf-8');
    if (content.includes(`'./${baseName}'`) || content.includes(`"./${baseName}"`)) {
      return true;
    }
  }

  const parentDir = path.dirname(dir);
  if (parentDir !== dir) {
    const parentFiles = fs.readdirSync(parentDir).filter(f => f.endsWith('.ts'));
    const dirName = path.basename(dir);
    for (const pf of parentFiles) {
      const content = fs.readFileSync(path.join(parentDir, pf), 'utf-8');
      if (content.includes(`'./${dirName}/${baseName}'`) || content.includes(`"./${dirName}/${baseName}"`)) {
        return true;
      }
      if (isIndex && (content.includes(`'./${dirName}'`) || content.includes(`"./${dirName}"`))) {
        return true;
      }
    }

    if (isIndex) {
      const grandParentDir = path.dirname(parentDir);
      if (grandParentDir !== parentDir) {
        const gpFiles = fs.readdirSync(grandParentDir).filter(f => f.endsWith('.ts'));
        const parentDirName = path.basename(parentDir);
        for (const gpf of gpFiles) {
          const content = fs.readFileSync(path.join(grandParentDir, gpf), 'utf-8');
          if (content.includes(`'./${parentDirName}/${dirName}'`) || content.includes(`"./${parentDirName}/${dirName}"`)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function getTopLevelRoutableFiles(): Array<{ importPath: string; fullPath: string }> {
  const results: Array<{ importPath: string; fullPath: string }> = [];
  if (!fs.existsSync(ROUTES_DIR)) return results;

  const entries = fs.readdirSync(ROUTES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const indexPath = path.join(ROUTES_DIR, entry.name, 'index.ts');
      if (fs.existsSync(indexPath) && exportsRouter(indexPath)) {
        results.push({ importPath: entry.name, fullPath: indexPath });
      }
    } else if (entry.name.endsWith('.ts')) {
      const fp = path.join(ROUTES_DIR, entry.name);
      if (exportsRouter(fp)) {
        const name = entry.name.replace(/\.ts$/, '');
        results.push({ importPath: name, fullPath: fp });
      }
    }
  }

  return results;
}

function getNestedRoutableFiles(): Array<{ importPath: string; fullPath: string }> {
  const results: Array<{ importPath: string; fullPath: string }> = [];
  if (!fs.existsSync(ROUTES_DIR)) return results;

  function scanDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, prefix + entry.name + '/');
      } else if (entry.name.endsWith('.ts')) {
        if (exportsRouter(fullPath)) {
          const name = entry.name === 'index.ts' ? '' : entry.name.replace(/\.ts$/, '');
          const importPath = prefix + name;
          results.push({ importPath: importPath.replace(/\/$/, ''), fullPath });
        }
      }
    }
  }

  const entries = fs.readdirSync(ROUTES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanDir(path.join(ROUTES_DIR, entry.name), entry.name + '/');
    }
  }

  return results;
}

function getExportedFunctions(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const exports: string[] = [];

  const regex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return exports;
}

function buildContentIndex(dirs: string[]): string {
  const chunks: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of getAllTsFiles(dir)) {
      chunks.push(fs.readFileSync(file, 'utf-8'));
    }
  }
  return chunks.join('\n');
}

function run(): void {
  console.log('\n🔍 Dead Code Detection Report');
  console.log('═'.repeat(60));

  let totalIssues = 0;

  console.log('\n── Unmounted Route Files ──');
  console.log('  Checking top-level route entry points...');
  const importedRoutes = getRouteImportsFromLoader();
  const topLevelRoutes = getTopLevelRoutableFiles();

  const unmountedTopLevel: string[] = [];
  for (const route of topLevelRoutes) {
    if (!importedRoutes.has(route.importPath)) {
      unmountedTopLevel.push(route.importPath);
    }
  }

  if (unmountedTopLevel.length === 0) {
    console.log('  ✅ All top-level route files are imported in routes loader');
  } else {
    for (const route of unmountedTopLevel) {
      console.log(`  ⚠️  UNMOUNTED: server/routes/${route}`);
      totalIssues++;
    }
  }

  console.log('\n  Checking nested route sub-modules...');
  const nestedRoutes = getNestedRoutableFiles();
  const orphanedNested: string[] = [];

  for (const route of nestedRoutes) {
    const isTopLevel = topLevelRoutes.some(t => t.fullPath === route.fullPath);
    if (isTopLevel) continue;

    if (!importedRoutes.has(route.importPath) && !isImportedByParent(route.fullPath)) {
      orphanedNested.push(route.importPath);
    }
  }

  if (orphanedNested.length === 0) {
    console.log('  ✅ All nested route sub-modules are imported by their parent');
  } else {
    for (const route of orphanedNested) {
      console.log(`  ⚠️  ORPHANED: server/routes/${route}`);
      totalIssues++;
    }
  }

  console.log('\n── Unused Exported Functions in server/core/ ──');
  console.log('  Building content index...');
  const coreFiles = getAllTsFiles(CORE_DIR);
  const fullIndex = buildContentIndex([SERVER_DIR, SRC_DIR, SHARED_DIR]);
  const unusedExports: Array<{ file: string; name: string }> = [];

  for (const coreFile of coreFiles) {
    const exportedFunctions = getExportedFunctions(coreFile);
    if (exportedFunctions.length === 0) continue;

    const selfContent = fs.readFileSync(coreFile, 'utf-8');
    const indexWithoutSelf = fullIndex.replace(selfContent, '');

    for (const fnName of exportedFunctions) {
      if (fnName.length <= 2) continue;

      const pattern = new RegExp(`\\b${fnName}\\b`);
      if (!pattern.test(indexWithoutSelf)) {
        const relPath = path.relative(path.resolve('.'), coreFile);
        unusedExports.push({ file: relPath, name: fnName });
      }
    }
  }

  if (unusedExports.length === 0) {
    console.log('  ✅ All exported functions in server/core/ have at least one consumer');
  } else {
    const groupedByFile = new Map<string, string[]>();
    for (const { file, name } of unusedExports) {
      if (!groupedByFile.has(file)) groupedByFile.set(file, []);
      groupedByFile.get(file)!.push(name);
    }

    for (const [file, names] of groupedByFile) {
      console.log(`  📄 ${file}`);
      for (const name of names) {
        console.log(`     ⚠️  ${name}()`);
        totalIssues++;
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  if (totalIssues === 0) {
    console.log('✅ No dead code detected');
  } else {
    console.log(`⚠️  ${totalIssues} potential dead code issue(s) found`);
    console.log('   Review manually before removing — some may be used dynamically.');
  }
  console.log('');
}

run();
