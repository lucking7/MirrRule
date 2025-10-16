#!/usr/bin/env node

/**
 * Migration script for droid files to new Factory format
 * Updates model names and adds tools field
 */

const fs = require('node:fs');
const path = require('node:path');

// Model name mapping from old to new format
const MODEL_MAPPING = {
  opus: 'claude-opus-4-1-20250805',
  sonnet: 'claude-sonnet-4-20250514',
  'claude-opus-4-0': 'claude-opus-4-1-20250805',
  'claude-sonnet-4-0': 'claude-sonnet-4-20250514',
  'gpt-5': 'gpt-5-2025-08-07',
  inherit: 'inherit'
};

// Default tools based on droid type
const DEFAULT_TOOLS = {
  'code-reviewer': 'read-only',
  debugger: 'all',
  'security-auditor': 'read-only',
  'error-detective': 'all',
  'test-automator': 'all',
  'performance-engineer': 'read-only'
};

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\S\s]*?)\n---\n([\S\s]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content, hasValidFrontmatter: false };
  }

  const [, frontmatterStr, body] = match;
  const frontmatter = {};

  frontmatterStr.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, Math.max(0, colonIndex)).trim();
      const value = line.slice(Math.max(0, colonIndex + 1)).trim();
      frontmatter[key] = value;
    }
  });

  return { frontmatter, body: body.trim(), hasValidFrontmatter: true };
}

function serializeFrontmatter(frontmatter) {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function migrateDroidFile(filePath) {
  console.log(`Processing: ${path.basename(filePath)}`);

  const content = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body, hasValidFrontmatter } = parseFrontmatter(content);

  if (!hasValidFrontmatter) {
    console.log('  ⚠\uFE0F  Skipping (no valid frontmatter)');
    return false;
  }

  let modified = false;

  // Update model field
  if (frontmatter.model) {
    const oldModel = frontmatter.model;
    const newModel = MODEL_MAPPING[oldModel] || oldModel;
    if (oldModel !== newModel) {
      frontmatter.model = newModel;
      console.log(`  ✓ Updated model: ${oldModel} → ${newModel}`);
      modified = true;
    }
  } else {
    // Add default model if missing
    frontmatter.model = 'claude-sonnet-4-20250514';
    console.log('  ✓ Added default model: claude-sonnet-4-20250514');
    modified = true;
  }

  // Add tools field if missing
  if (!frontmatter.tools) {
    const droidName = frontmatter.name;
    const tools = DEFAULT_TOOLS[droidName] || 'all';
    frontmatter.tools = tools;
    console.log(`  ✓ Added tools: ${tools}`);
    modified = true;
  }

  // Add version if missing
  if (!frontmatter.version) {
    frontmatter.version = 'v1';
    modified = true;
  }

  if (modified) {
    const newContent = serializeFrontmatter(frontmatter) + body;
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('  ✅ File updated');
    return true;
  }
  console.log('  ℹ\uFE0F  No changes needed');
  return false;
}

function main() {
  const droidsDir = path.join(__dirname, 'droids');

  if (!fs.existsSync(droidsDir)) {
    console.error(`Error: droids directory not found at ${droidsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(droidsDir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => path.join(droidsDir, f));

  console.log(`Found ${files.length} droid files to process\n`);

  let updatedCount = 0;
  files.forEach(file => {
    if (migrateDroidFile(file)) {
      updatedCount++;
    }
    console.log('');
  });

  console.log('\n✅ Migration complete!');
  console.log(`   Updated: ${updatedCount} files`);
  console.log(`   Total: ${files.length} files`);
}

main();
