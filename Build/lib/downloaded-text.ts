import { isUtf8 } from 'node:buffer';
import type { Buffer } from 'node:buffer';

export function isNonHtmlText(content: Buffer): boolean {
  if (!isUtf8(content)) return false;
  const prefix = content.toString('utf8').trimStart().slice(0, 8192).toLowerCase();
  return Boolean(prefix) && !/^(?:<!doctype\s+html\b|<(?:html|head|body|script)\b|just a moment\b|attention required\b|enable javascript and cookies to continue\b|window\.location\s*=\s*['"][^'"]*\/cdn-cgi\/challenge-platform\/)/.test(prefix);
}

/** Section headers and comments alone do not make a usable module. */
export function hasActiveSectionEntry(content: string, supportedSections: ReadonlySet<string>): boolean {
  let section: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
    } else if (section && trimmed && supportedSections.has(section) && !/^[#;]/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

const SURGE_FUNCTIONAL_SECTIONS = new Set([
  'general',
  'host',
  'rule',
  'url rewrite',
  'map local',
  'script',
  'panel',
  'mitm',
  'header rewrite',
  'body rewrite',
]);

export function hasActiveSurgeEntry(content: string): boolean {
  return hasActiveSectionEntry(content, SURGE_FUNCTIONAL_SECTIONS);
}
