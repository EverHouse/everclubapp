const fs = require("fs");
const path = require("path");

// --- STEP 1: Create the Brain (src/lib/schemas.ts) ---
const schemaPath = path.join("src", "lib", "schemas.ts");
const schemaContent = `import { z } from 'zod';

export const TierEnum = z.enum([
  'Core',
  'Premium',
  'Social',
  'VIP',
  'Corporate',
  'Staff',
  'Group Lessons'
]);

export type Tier = z.infer<typeof TierEnum>;

export const TierSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    let clean = val.trim();
    // Fix "Core Membership" -> "Core"
    if (clean.toLowerCase().endsWith(' membership')) {
      clean = clean.replace(/ membership$/i, '').trim();
    }
    // Fix capitalization
    const properCase = TierEnum.options.find(
      t => t.toLowerCase() === clean.toLowerCase()
    );
    if (properCase) return properCase;
  }
  return val;
}, TierEnum);
`;

// Ensure directory exists
if (!fs.existsSync(path.dirname(schemaPath))) {
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
}

fs.writeFileSync(schemaPath, schemaContent);
console.log(`✅ Created ${schemaPath}`);

// --- STEP 2: Update the Integrity Check (src/server/core/dataIntegrity.ts) ---
const targetPath = path.join("src", "server", "core", "dataIntegrity.ts");

if (fs.existsSync(targetPath)) {
    let content = fs.readFileSync(targetPath, "utf8");

    // 1. Add Import (if not present)
    if (!content.includes("from '../../lib/schemas'")) {
        content = "import { TierSchema } from '../../lib/schemas';\n" + content;
    }

    // 2. Replace the brittle "Core Membership" check
    const oldCodeRegex =
        /if\s*\(\s*user\.tier\s*===\s*["']Core Membership["']\s*\)\s*\{\s*user\.tier\s*=\s*["']Core["'];\s*\}/g;

    const newCode = `// Normalized by Zod Skill
            const parsed = TierSchema.safeParse(user.tier);
            if (parsed.success) user.tier = parsed.data;`;

    if (oldCodeRegex.test(content)) {
        content = content.replace(oldCodeRegex, newCode);
        fs.writeFileSync(targetPath, content);
        console.log(`✅ Refactored ${targetPath} to use Zod validation`);
    } else {
        console.log(
            `⚠️  Could not find the exact "Core Membership" if-statement in dataIntegrity.ts. It might already be changed.`,
        );
    }
} else {
    console.error(`❌ Could not find ${targetPath}`);
}
