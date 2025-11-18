/**
 * Section 解析器
 * 用于解析 .sgmodule 文件中的各个 Section
 */

import type { ParsedSection, SectionType } from './types';
import { cleanPolicy } from '../../core/parsers/policy-cleaner';
import { RuleValidator } from '../../utils/validation/validators';

export interface SectionParserOptions {
  header: string,
  stripComments: boolean
}

const SECTION_HEADER_REGEX = /^\s*\[([^\]]+)]\s*$/;
const HOSTNAME_REGEX = /hostname\s*=\s*(.*)/i;
const SECTION_ALIASES: Record<string, SectionType> = {
  rule: 'Rule',
  rules: 'Rule',
  'url rewrite': 'URL Rewrite',
  rewrite: 'URL Rewrite',
  'map local': 'Map Local',
  maplocal: 'Map Local',
  script: 'Script',
  scripts: 'Script',
  mitm: 'MITM',
  general: 'General',
  argument: 'Argument',
  arguments: 'Argument',
  panel: 'Panel',
  task: 'Task',
  schedule: 'Task'
};

export const SectionParser = {
  parse(content: string, options: SectionParserOptions): ParsedSection[] {
    const sections: ParsedSection[] = [];
    let currentName: string | null = null;
    let buffer: string[] = [];

    const flushSection = () => {
      if (!currentName) {
        return;
      }
      const type = resolveSectionType(currentName);
      sections.push({
        type,
        content: cleanSectionContent(buffer.join('\n'), type, options.stripComments),
        header: options.header
      });
      buffer = [];
    };

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const match = SECTION_HEADER_REGEX.exec(line);
      if (match) {
        flushSection();
        currentName = match[1];
        continue;
      }

      if (currentName) {
        buffer.push(line);
      }
    }

    flushSection();
    return sections;
  },

  extractHostnames(content: string): string[] {
    const match = HOSTNAME_REGEX.exec(content);
    if (!match) {
      return [];
    }

    const normalized: string[] = [];
    const rawHostnames = match[1].replaceAll('%APPEND%', '').split(',');
    for (const raw of rawHostnames) {
      const host = raw.trim();
      if (host) {
        normalized.push(host);
      }
    }

    return normalized;
  }
} as const;

function resolveSectionType(name: string): SectionType {
  const normalized = name.trim();
  const key = normalized.toLowerCase();
  return SECTION_ALIASES[key] ?? normalized;
}

function cleanSectionContent(content: string, type: SectionType, stripComments: boolean): string {
  let cleaned = content.trim();

  if (type.toLowerCase() === 'rule') {
    const normalizedRules: string[] = [];
    for (const line of cleaned.split('\n')) {
      normalizedRules.push(cleanPolicy(line));
    }
    cleaned = normalizedRules.join('\n');
  }

  if (!stripComments) {
    return cleaned;
  }

  const preserved: string[] = [];
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !RuleValidator.isComment(trimmed)) {
      preserved.push(trimmed);
    }
  }

  return preserved.join('\n');
}
