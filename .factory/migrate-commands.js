#!/usr/bin/env node

/**
 * Migration script for command files to new Factory format
 * Flattens nested directories and updates model names
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
  if (Object.keys(frontmatter).length === 0) {
    return '';
  }
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function updateModelName(content) {
  const { frontmatter, body, hasValidFrontmatter } = parseFrontmatter(content);

  if (!hasValidFrontmatter) {
    return { content, modified: false };
  }

  let modified = false;

  // Update model field if present
  if (frontmatter.model) {
    const oldModel = frontmatter.model;
    const newModel = MODEL_MAPPING[oldModel] || oldModel;
    if (oldModel !== newModel) {
      frontmatter.model = newModel;
      modified = true;
    }
  }

  if (modified) {
    const newContent = serializeFrontmatter(frontmatter) + body;
    return { content: newContent, modified: true };
  }

  return { content, modified: false };
}

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (file.endsWith('.md') || hasShebang(filePath)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

function hasShebang(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(2);
    fs.readSync(fd, buffer, 0, 2, 0);
    fs.closeSync(fd);
    return buffer.toString() === '#!';
  } catch {
    return false;
  }
}

function flattenCommands(commandsDir) {
  console.log('Scanning commands directory...\n');

  // Get all nested directories
  const nestedDirs = fs.readdirSync(commandsDir)
    .map(name => path.join(commandsDir, name))
    .filter(p => fs.statSync(p).isDirectory());

  if (nestedDirs.length === 0) {
    console.log('No nested directories found. Structure is already flat.\n');
    return 0;
  }

  console.log(`Found ${nestedDirs.length} nested directories:`);
  nestedDirs.forEach(dir => console.log(`  - ${path.basename(dir)}`));
  console.log('');

  let movedCount = 0;
  let updatedCount = 0;

  nestedDirs.forEach(dir => {
    const dirName = path.basename(dir);
    const files = getAllFiles(dir);

    console.log(`Processing ${dirName}/ (${files.length} files):`);

    files.forEach(file => {
      const fileName = path.basename(file);
      const relativePath = path.relative(dir, file);

      // Generate a new name that includes the subdirectory path
      let newFileName = fileName;
      if (relativePath.includes(path.sep)) {
        // For deeply nested files, include the path in the name
        newFileName = relativePath.replaceAll(/[/\\]/g, '-');
      } else {
        // For files directly in the subdirectory, prefix with dir name
        const nameWithoutExt = path.basename(fileName, path.extname(fileName));
        const ext = path.extname(fileName);
        newFileName = `${dirName}-${nameWithoutExt}${ext}`;
      }

      const newPath = path.join(commandsDir, newFileName);

      // Check if file already exists at root level
      if (fs.existsSync(newPath)) {
        console.log(`  ⚠\uFE0F  Skipped ${fileName} (already exists at root)`);
        return;
      }

      // Read, update model name if needed, and move file
      const content = fs.readFileSync(file, 'utf8');
      const { content: newContent, modified } = updateModelName(content);

      fs.writeFileSync(newPath, newContent, 'utf8');

      if (modified) {
        console.log(`  ✓ Moved and updated: ${fileName} → ${newFileName}`);
        updatedCount++;
      } else {
        console.log(`  ✓ Moved: ${fileName} → ${newFileName}`);
      }

      movedCount++;
    });

    console.log('');
  });

  // Ask user if they want to remove the nested directories
  console.log('\n⚠\uFE0F  Old nested directories still exist. You can safely delete them:');
  nestedDirs.forEach(dir => console.log(`   rm -rf "${dir}"`));
  console.log('');

  return { movedCount, updatedCount };
}

function main() {
  const commandsDir = path.join(__dirname, 'commands');

  if (!fs.existsSync(commandsDir)) {
    console.error(`Error: commands directory not found at ${commandsDir}`);
    process.exit(1);
  }

  const { movedCount, updatedCount } = flattenCommands(commandsDir);

  console.log('✅ Migration complete!');
  console.log(`   Files moved: ${movedCount}`);
  console.log(`   Files updated: ${updatedCount}`);
}

main();
