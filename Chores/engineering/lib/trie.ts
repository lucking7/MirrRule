/**
 * Hostname-Optimized Trie based on Mnemonist Trie
 */

import { toASCII } from 'punycode/';

const START = 1 << 1;
const INCLUDE_ALL_SUBDOMAIN = 1 << 2;

type TrieNode<Meta = any> = [
  /** flag */ number,
  /** parent */ TrieNode<Meta> | null,
  /** children */ Map<string, TrieNode<Meta>>,
  /** token */ string,
  /** meta */ Meta
];

function createNode<Meta>(token: string, parent: TrieNode<Meta> | null): TrieNode<Meta> {
  return [0, parent, new Map(), token, undefined as any];
}

function setBit(flag: number, bit: number): number {
  return flag | bit;
}

function deleteBit(flag: number, bit: number): number {
  return flag & ~bit;
}

function getBit(flag: number, bit: number): boolean {
  return (flag & bit) !== 0;
}

function missingBit(flag: number, bit: number): boolean {
  return (flag & bit) === 0;
}

function walkHostnameTokens(
  hostname: string,
  onToken: (token: string) => boolean | null,
  hostnameFromIndex: number
): boolean | null {
  const tokens = hostname.split('.');
  const l = tokens.length - 1;

  for (let i = l; i >= hostnameFromIndex; i--) {
    const token = tokens[i];
    if (token.length > 0) {
      const t = onToken(token);
      if (t === null) return null;
      if (t) return true;
    }
  }

  return false;
}

abstract class Triebase<Meta = unknown> {
  protected $size = 0;
  protected $root: TrieNode<Meta> = createNode('', null);

  constructor(from?: string[] | Set<string> | null) {
    if (from) {
      for (const suffix of from) {
        this.add(suffix);
      }
    }
  }

  abstract add(
    suffix: string,
    includeAllSubdomain?: boolean,
    meta?: Meta,
    hostnameFromIndex?: number
  ): void;

  protected walkIntoLeafWithSuffix(suffix: string, hostnameFromIndex: number) {
    let node: TrieNode<Meta> = this.$root;
    const res = walkHostnameTokens(
      suffix,
      token => {
        if (node[2].has(token)) {
          node = node[2].get(token)!;
          return false;
        }
        return null;
      },
      hostnameFromIndex
    );

    if (res === null) return null;
    return { node };
  }

  public has(suffix: string, includeAllSubdomain = suffix[0] === '.'): boolean {
    const hostnameFromIndex = suffix[0] === '.' ? 1 : 0;
    const res = this.walkIntoLeafWithSuffix(suffix, hostnameFromIndex);

    if (res === null) return false;
    if (missingBit(res.node[0], START)) return false;
    if (includeAllSubdomain) return getBit(res.node[0], INCLUDE_ALL_SUBDOMAIN);
    return true;
  }

  protected dumpFrom(
    node: TrieNode<Meta>,
    tokens: string[],
    cb: (tokens: string[], node: TrieNode<Meta>) => void
  ) {
    if (getBit(node[0], START)) {
      cb(tokens, node);
    }

    node[2].forEach(child => {
      tokens.unshift(child[3]);
      this.dumpFrom(child, tokens, cb);
      tokens.shift();
    });
  }

  public dump(cb?: (suffix: string, includeAllSubdomain: boolean) => void): string[] {
    const results: string[] = [];

    this.dumpFrom(this.$root, [], (tokens, node) => {
      const hostname = tokens.join('.');
      const includeAllSubdomain = getBit(node[0], INCLUDE_ALL_SUBDOMAIN);

      if (cb) {
        cb(hostname, includeAllSubdomain);
      } else {
        results.push(includeAllSubdomain ? '.' + hostname : hostname);
      }
    });

    return results;
  }

  public dumpWithoutDot(
    cb: (suffix: string, includeAllSubdomain: boolean) => void,
    dedupe = false
  ): void {
    if (!dedupe) {
      this.dumpFrom(this.$root, [], (tokens, node) => {
        const hostname = tokens.join('.');
        const includeAllSubdomain = getBit(node[0], INCLUDE_ALL_SUBDOMAIN);
        cb(hostname, includeAllSubdomain);
      });
      return;
    }

    // 去重逻辑
    const seen = new Set<string>();
    this.dumpFrom(this.$root, [], (tokens, node) => {
      const hostname = tokens.join('.');
      if (!seen.has(hostname)) {
        seen.add(hostname);
        const includeAllSubdomain = getBit(node[0], INCLUDE_ALL_SUBDOMAIN);
        cb(hostname, includeAllSubdomain);
      }
    });
  }

  public find(suffix: string): string[] {
    const results: string[] = [];
    const res = this.walkIntoLeafWithSuffix(suffix, suffix[0] === '.' ? 1 : 0);

    if (res) {
      this.dumpFrom(res.node, [], (tokens, node) => {
        results.push(tokens.join('.'));
      });
    }

    return results;
  }
}

export class HostnameSmolTrie<Meta = unknown> extends Triebase<Meta> {
  public smolTree = true;

  add(
    suffix: string,
    includeAllSubdomain = suffix[0] === '.',
    meta?: Meta,
    hostnameFromIndex = suffix[0] === '.' ? 1 : 0
  ): void {
    let node: TrieNode<Meta> = this.$root;
    let curNodeChildren: Map<string, TrieNode<Meta>> = node[2];

    const onToken = (token: string) => {
      curNodeChildren = node[2];
      if (curNodeChildren.has(token)) {
        node = curNodeChildren.get(token)!;

        // 如果遇到已存在的包含所有子域名的节点，跳过
        if (getBit(node[0], INCLUDE_ALL_SUBDOMAIN)) {
          return true;
        }
      } else {
        const newNode = createNode(token, node);
        curNodeChildren.set(token, newNode);
        node = newNode;
      }

      return false;
    };

    if (walkHostnameTokens(suffix, onToken, hostnameFromIndex)) {
      return;
    }

    if (includeAllSubdomain) {
      // 清除子节点
      node[2].clear();
    } else if (getBit(node[0], INCLUDE_ALL_SUBDOMAIN)) {
      // 如果已经存在包含所有子域名的标记，跳过
      return;
    }

    node[0] = setBit(node[0], START);
    if (includeAllSubdomain) {
      node[0] = setBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    } else {
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    }
    node[4] = meta!;
    this.$size++;
  }

  public whitelist(
    suffix: string,
    includeAllSubdomain = suffix[0] === '.',
    hostnameFromIndex = suffix[0] === '.' ? 1 : 0
  ) {
    const res = this.walkIntoLeafWithSuffix(suffix, hostnameFromIndex);
    if (res === null) return;

    const { node } = res;

    if (includeAllSubdomain) {
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
      node[2].clear();
    } else {
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    }

    if (getBit(node[0], START)) {
      node[0] = deleteBit(node[0], START);
      this.$size--;
    }
  }
}

export class HostnameTrie<Meta = unknown> extends Triebase<Meta> {
  get size() {
    return this.$size;
  }

  add(
    suffix: string,
    includeAllSubdomain = suffix[0] === '.',
    meta?: Meta,
    hostnameFromIndex = suffix[0] === '.' ? 1 : 0
  ): void {
    let node: TrieNode<Meta> = this.$root;
    let child: Map<string, TrieNode<Meta>> = node[2];

    const onToken = (token: string) => {
      child = node[2];
      if (child.has(token)) {
        node = child.get(token)!;
      } else {
        const newNode = createNode(token, node);
        child.set(token, newNode);
        node = newNode;
      }

      return false;
    };

    if (walkHostnameTokens(suffix, onToken, hostnameFromIndex)) {
      return;
    }

    // 如果已存在相同条目，跳过
    if (getBit(node[0], START)) {
      return;
    }

    this.$size++;

    node[0] = setBit(node[0], START);
    if (includeAllSubdomain) {
      node[0] = setBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    } else {
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    }
    node[4] = meta!;
  }
}
