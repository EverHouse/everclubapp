import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[0;33m';
const NC = '\x1b[0m';

interface TableSchema {
  tableName: string;
  columns: Set<string>;
  sourceFile: string;
}

function parseSchemaFiles(): TableSchema[] {
  const modelsDir = path.join(__dirname, '..', 'shared', 'models');
  const tables: TableSchema[] = [];

  for (const file of fs.readdirSync(modelsDir)) {
    if (!file.endsWith('.ts')) continue;
    const filePath = path.join(modelsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const tableRegex = /pgTable\(\s*["'](\w+)["']/g;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
      const tableName = match[1];
      const startIdx = match.index + match[0].length;
      const columns = new Set<string>();

      const afterTable = content.slice(startIdx, startIdx + 15000);
      const colTypeRegex = /(?:serial|integer|varchar|text|boolean|timestamp|jsonb|bigint|real|doublePrecision|smallint|numeric|date|uuid|char|json|customType|time|interval|inet|cidr|macaddr)\s*\(\s*["'](\w+)["']/g;
      let colMatch;

      let braceDepth = 0;
      let foundOpen = false;
      let endPos = afterTable.length;
      for (let ci = 0; ci < afterTable.length; ci++) {
        if (afterTable[ci] === '{') { braceDepth++; foundOpen = true; }
        if (afterTable[ci] === '}') { braceDepth--; }
        if (foundOpen && braceDepth === 0) { endPos = ci; break; }
      }

      const columnsBlock = afterTable.slice(0, endPos);
      while ((colMatch = colTypeRegex.exec(columnsBlock)) !== null) {
        columns.add(colMatch[1]);
      }

      const enumColRegex = /(\w+Enum)\s*\(\s*["'](\w+)["']/g;
      let enumMatch;
      while ((enumMatch = enumColRegex.exec(columnsBlock)) !== null) {
        columns.add(enumMatch[2]);
      }

      if (columns.size > 0) {
        tables.push({ tableName, columns, sourceFile: file });
      }
    }
  }
  return tables;
}

function scanServerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanServerFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

interface Violation {
  file: string;
  line: number;
  table: string;
  column: string;
  snippet: string;
}

const KNOWN_SAFE = new Set([
  'booking_participants.updated_at',
  'booking_requests.updated_at',
  'booking_requests.cancellation_reason',
  'booking_fee_snapshots.updated_at',
  'day_pass_purchases.tracking_booking_id',
  'day_pass_purchases.trackman_booking_id',
  'day_pass_purchases.booking_date',
  'guest_passes.session_id',
  'stripe_payment_intents.updated_at',
  'stripe_payment_intents.product_id',
  'stripe_payment_intents.product_name',
  'stripe_payment_intents.payment_intent_id',
  'stripe_payment_intents.member_email',
  'stripe_payment_intents.member_id',
  'stripe_payment_intents.created_by',
  'trackman_webhook_events.retry_count',
  'trackman_webhook_events.last_retry_at',
  'usage_ledger.updated_at',
  'users.updated_at',
  'users.email_delivery_status',
  'users.email_bounced_at',
  'users.email_marketing_opt_in',
  'users.notes',
  'users.membership_tier',
  'users.joined_on',
  'users.mindbody_id',
  'webhook_processed_events.resource_id',
  'wellness_classes.updated_at',
  'wellness_enrollments.updated_at',
]);

const SQL_KEYWORDS = new Set(['now', 'null', 'true', 'false', 'coalesce', 'greatest', 'least', 'case', 'when', 'then', 'else', 'end', 'and', 'or', 'not', 'in', 'is', 'set', 'where', 'from', 'join', 'on', 'as', 'select', 'insert', 'delete', 'returning', 'values', 'into', 'exists', 'any', 'all', 'between', 'like', 'ilike', 'asc', 'desc', 'limit', 'offset', 'group', 'having', 'order', 'by', 'with', 'distinct', 'union', 'except', 'intersect', 'cast', 'interval', 'extract', 'current_timestamp', 'current_date', 'update', 'table', 'add', 'column', 'default', 'primary', 'key', 'references', 'create', 'alter', 'drop', 'index', 'constraint', 'check', 'unique', 'foreign', 'cascade', 'restrict', 'begin', 'commit', 'do', 'declare', 'raise', 'exception', 'if', 'type', 'using', 'trigger', 'function', 'returns', 'language', 'plpgsql', 'execute', 'format', 'new', 'old', 'tg_op', 'perform', 'notice', 'elsif', 'array', 'unnest', 'row_number', 'over', 'partition', 'first_value', 'last_value', 'count', 'sum', 'avg', 'min', 'max', 'lower', 'upper', 'trim', 'replace', 'substring', 'concat', 'string_agg', 'array_agg', 'jsonb_build_object', 'json_build_object', 'to_char', 'to_timestamp', 'date_trunc', 'age', 'floor', 'ceil', 'round', 'abs', 'left', 'right', 'inner', 'outer', 'cross', 'full', 'natural', 'lateral', 'recursive', 'temporary', 'temp', 'view', 'materialized', 'refresh', 'concurrently', 'only', 'for', 'no', 'row', 'rows', 'fetch', 'next', 'prior', 'first', 'last', 'absolute', 'relative', 'forward', 'backward', 'scroll', 'hold', 'close', 'move', 'plan']);

interface SqlBlock {
  sql: string;
  startLine: number;
  filePath: string;
}

function extractSqlBlocks(content: string, filePath: string): SqlBlock[] {
  const blocks: SqlBlock[] = [];

  const backtickRegex = /(?:sql|execute\s*\(\s*sql)\s*`/g;
  let btMatch;
  while ((btMatch = backtickRegex.exec(content)) !== null) {
    const startIdx = btMatch.index + btMatch[0].length;
    let depth = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '`' && content[i - 1] !== '\\') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
      if (content[i] === '$' && content[i + 1] === '{') {
        let braceDepth = 1;
        i += 2;
        while (i < content.length && braceDepth > 0) {
          if (content[i] === '{') braceDepth++;
          if (content[i] === '}') braceDepth--;
          if (content[i] === '`') {
            let innerDepth = 1;
            i++;
            while (i < content.length && innerDepth > 0) {
              if (content[i] === '`' && content[i - 1] !== '\\') innerDepth--;
              i++;
            }
            continue;
          }
          i++;
        }
        i--;
        continue;
      }
    }

    const sqlText = content.slice(startIdx, endIdx);
    const startLine = content.slice(0, btMatch.index).split('\n').length;
    blocks.push({ sql: sqlText, startLine, filePath });
  }

  const stringQueryRegex = /(?:execute|query)\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g;
  let sqMatch;
  while ((sqMatch = stringQueryRegex.exec(content)) !== null) {
    const sqlText = sqMatch[1] || sqMatch[2] || sqMatch[3];
    if (!sqlText) continue;
    if (!/\b(?:UPDATE|INSERT|DELETE|SELECT|ALTER)\b/i.test(sqlText)) continue;
    const startLine = content.slice(0, sqMatch.index).split('\n').length;
    blocks.push({ sql: sqlText, startLine, filePath });
  }

  return blocks;
}

function flattenSql(sql: string): string {
  return sql.replace(/\$\{[^}]*\}/g, '$EXPR').replace(/\s+/g, ' ').trim();
}

function parseDbInitColumns(): Map<string, Set<string>> {
  const dbInitPath = path.join(__dirname, '..', 'server', 'db-init.ts');
  const content = fs.readFileSync(dbInitPath, 'utf8');
  const cols = new Map<string, Set<string>>();

  const addColRegex = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi;
  let match;
  while ((match = addColRegex.exec(content)) !== null) {
    const table = match[1].toLowerCase();
    const col = match[2].toLowerCase();
    if (!cols.has(table)) cols.set(table, new Set());
    cols.get(table)!.add(col);
  }
  return cols;
}

function validateRawSql(tables: TableSchema[]): Violation[] {
  const tableMap = new Map<string, Set<string>>();
  for (const t of tables) {
    tableMap.set(t.tableName, t.columns);
  }

  const dbInitCols = parseDbInitColumns();
  for (const [table, cols] of dbInitCols.entries()) {
    const existing = tableMap.get(table);
    if (existing) {
      for (const col of cols) existing.add(col);
    }
  }

  const serverDir = path.join(__dirname, '..', 'server');
  const files = scanServerFiles(serverDir);
  const violations: Violation[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const blocks = extractSqlBlocks(content, filePath);

    for (const block of blocks) {
      const flat = flattenSql(block.sql);

      for (const [tableName, schema] of tableMap.entries()) {
        const updatePattern = new RegExp(
          `UPDATE\\s+${tableName}\\s+SET\\s+(.+?)\\s+(?:WHERE|RETURNING|$)`,
          'gis'
        );
        let setMatch;
        while ((setMatch = updatePattern.exec(flat)) !== null) {
          const setClauses = setMatch[1];
          const colAssignPattern = /(\w+)\s*=/g;
          let colMatch;
          while ((colMatch = colAssignPattern.exec(setClauses)) !== null) {
            const col = colMatch[1].toLowerCase();
            if (SQL_KEYWORDS.has(col) || /^\d+$/.test(col) || col.startsWith('$') || col === 'expr') continue;
            if (!schema.has(col)) {
              const key = `${tableName}.${col}`;
              if (!KNOWN_SAFE.has(key)) {
                violations.push({
                  file: path.relative(process.cwd(), filePath),
                  line: block.startLine,
                  table: tableName,
                  column: col,
                  snippet: flat.substring(0, 150),
                });
              }
            }
          }
        }

        const insertPattern = new RegExp(
          `INSERT\\s+INTO\\s+${tableName}\\s*\\(([^)]+)\\)`,
          'gis'
        );
        let insMatch;
        while ((insMatch = insertPattern.exec(flat)) !== null) {
          const colList = insMatch[1];
          const cols = colList.split(',').map(c => c.trim().toLowerCase());
          for (const col of cols) {
            if (!col || SQL_KEYWORDS.has(col) || /^\d+$/.test(col) || col.startsWith('$')) continue;
            if (!schema.has(col)) {
              const key = `${tableName}.${col}`;
              if (!KNOWN_SAFE.has(key)) {
                violations.push({
                  file: path.relative(process.cwd(), filePath),
                  line: block.startLine,
                  table: tableName,
                  column: col,
                  snippet: flat.substring(0, 150),
                });
              }
            }
          }
        }

        const qualifiedRefPattern = new RegExp(`\\b${tableName}\\.(\\w+)`, 'g');
        let refMatch;
        while ((refMatch = qualifiedRefPattern.exec(flat)) !== null) {
          const col = refMatch[1];
          if (/[A-Z]/.test(col)) continue;
          const colLower = col.toLowerCase();
          if (colLower === 'id' || SQL_KEYWORDS.has(colLower) || /^\d+$/.test(colLower) || colLower.startsWith('$')) continue;
          if (!schema.has(colLower)) {
            const key = `${tableName}.${colLower}`;
            if (!KNOWN_SAFE.has(key)) {
              violations.push({
                file: path.relative(process.cwd(), filePath),
                line: block.startLine,
                table: tableName,
                column: colLower,
                snippet: flat.substring(0, 150),
              });
            }
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  return violations.filter(v => {
    const key = `${v.file}:${v.line}:${v.table}.${v.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  console.log('=== Raw SQL Schema Validator ===\n');

  const tables = parseSchemaFiles();
  console.log(`Parsed ${tables.length} tables from Drizzle schema`);
  for (const t of tables) {
    console.log(`  ${t.tableName}: ${t.columns.size} columns (${t.sourceFile})`);
  }
  console.log('');

  const violations = validateRawSql(tables);

  if (violations.length === 0) {
    console.log(`${GREEN}✓ No raw SQL schema violations found.${NC}`);
    process.exit(0);
  }

  console.log(`${RED}Found ${violations.length} potential raw SQL schema violation(s):${NC}\n`);
  for (const v of violations) {
    console.log(`${RED}FAIL:${NC} ${v.file}:${v.line}`);
    console.log(`  Table: ${YELLOW}${v.table}${NC}, Column: ${RED}${v.column}${NC} — does not exist in schema`);
    console.log(`  ${v.snippet}`);
    console.log('');
  }

  process.exit(1);
}

main();
