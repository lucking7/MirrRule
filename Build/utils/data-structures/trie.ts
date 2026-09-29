/**
 * Hostbane-Optimized Trie based on Mnemonist Trie
 */

import { fastStringCompare } from '../../lib/misc';
import { noop } from 'foxts/noop';
import { fastStringArrayJoin } from 'foxts/fast-string-array-join';

import { deleteBit, getBit, missingBit, setBit } from 'foxts/bitwise';
import { toASCII } from 'punycode/';

const START = 1 << 1;
const INCLUDE_ALL_SUBDOMAIN = 1 << 2;

type TrieNode<Meta = unknown> = [
  /** end, includeAllSubdomain (.example.org, ||example.com) */ flag: number,
  /** parent */ TrieNode<Meta> | null,
  /** children */ Map<string, TrieNode<Meta>>,
  /** token */ token: string,
  /** meta */ Meta
];

function createNode<Meta = unknown>(token: string,
  parent: TrieNode<Meta> | null = null): TrieNode<Meta> {
  return [1, parent, new Map<string, TrieNode<Meta>>(), token, null as Meta];
}

function hostnameToTokens(hostname: string, hostnameFromIndex: number): string[] {
  const tokens = hostname.split('.');
  const results: string[] = [];
  let token = '';

  for (let i = hostnameFromIndex, l = tokens.length; i < l; i++) {
    token = tokens[i];
    if (token.length > 0) {
      results.push(token);
    } else {
      throw new TypeError(JSON.stringify({ hostname, hostnameFromIndex }, null, 2));
    }
  }

  return results;
}

function walkHostnameTokens(
  hostname: string,
  onToken: (token: string) => boolean | null,
  hostnameFromIndex: number
): boolean | null {
  const tokens = hostname.split('.');

  const l = tokens.length - 1;

  // we are at the first of hostname, no splitor there
  let token = '';

  for (let i = l; i >= hostnameFromIndex; i--) {
    token = tokens[i];
    if (token.length > 0) {
      const t = onToken(token);
      if (t === null) {
        return null;
      }
      // if the callback returns true, we should skip the rest
      if (t) {
        return true;
      }
    }
  }

  return false;
}

interface FindSingleChildLeafResult<Meta> {
  node: TrieNode<Meta>;
  toPrune: TrieNode<Meta> | null;
  tokenToPrune: string | null;
  parent: TrieNode<Meta>;
}

abstract class Triebase<Meta = unknown> {
  protected readonly $root: TrieNode<Meta> = createNode('$root');

  constructor(from?: string[] | Set<string> | null) {
    // Actually build trie
    if (Array.isArray(from)) {
      for (let i = 0, l = from.length; i < l; i++) {
        this.add(from[i]);
      }
    } else if (from) {
      from.forEach(value => this.add(value));
    }
  }

  public abstract add(
    suffix: string,
    includeAllSubdomain?: boolean,
    meta?: Meta,
    hostnameFromIndex?: number
  ): void;

  protected walkIntoLeafWithTokens(
    tokens: string[],
    onLoop: (node: TrieNode<Meta>, parent: TrieNode<Meta>, token: string) => void = noop
  ) {
    let node: TrieNode<Meta> = this.$root;
    let parent: TrieNode<Meta> = node;

    let token: string;
    let child: Map<string, TrieNode<Meta>> = node[2];

    // reverse lookup from end to start
    for (let i = tokens.length - 1; i >= 0; i--) {
      token = tokens[i];

      // if (token === '') {
      //   break;
      // }

      parent = node;

      child = node[2];
      // cache node index access is 20% faster than direct access when doing twice
      if (child.has(token)) {
        node = child.get(token)!;
      } else {
        return null;
      }

      onLoop(node, parent, token);
    }

    return { node, parent };
  }

  private static bfsResults: [node: TrieNode | null, suffix: string[]] = [null, []];

  private static dfs<Meta>(
    this: void,
    nodeStack: Array<TrieNode<Meta>>,
    suffixStack: string[][]
  ): [TrieNode<Meta> | null, string[]] {
    const node = nodeStack.pop()!;
    const suffix = suffixStack.pop()!;

    node[2].forEach((childNode, k) => {
      // Pushing the child node to the stack for next iteration of DFS
      nodeStack.push(childNode);

      suffixStack.push([k, ...suffix]);
    });

    Triebase.bfsResults[0] = node;
    Triebase.bfsResults[1] = suffix;

    return Triebase.bfsResults as [TrieNode<Meta> | null, string[]];
  }

  private static dfsWithSort<Meta>(
    this: void,
    nodeStack: Array<TrieNode<Meta>>,
    suffixStack: string[][]
  ): [TrieNode<Meta> | null, string[]] {
    const node = nodeStack.pop()!;
    const suffix = suffixStack.pop()!;

    const child = node[2];

    if (child.size) {
      const keys = Array.from(child.keys()).sort(Triebase.compare);

      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i];
        const childNode = child.get(key)!;

        // Pushing the child node to the stack for next iteration of DFS
        nodeStack.push(childNode);
        suffixStack.push([key, ...suffix]);
      }
    }

    Triebase.bfsResults[0] = node;
    Triebase.bfsResults[1] = suffix;

    return Triebase.bfsResults as [TrieNode<Meta> | null, string[]];
  }

  private walk(
    onMatches: (suffix: string[], subdomain: boolean, meta: Meta) => void,
    withSort = false,
    initialNode = this.$root,
    initialSuffix: string[] = []
  ) {
    const dfsImpl: (
      nodeStack: Array<TrieNode<Meta>>,
      suffixStack: string[][]
    ) => [TrieNode<Meta> | null, string[]] = withSort ? Triebase.dfsWithSort : Triebase.dfs;

    const nodeStack: Array<TrieNode<Meta>> = [initialNode];

    // Resolving initial string (begin the start of the stack)
    const suffixStack: string[][] = [initialSuffix];

    let node: TrieNode<Meta> = initialNode;
    let r: [TrieNode<Meta> | null, string[]];

    do {
      r = dfsImpl(nodeStack, suffixStack);
      node = r[0]!;
      const suffix = r[1];

      // If the node is a sentinel, we push the suffix to the results
      if (getBit(node[0], START)) {
        onMatches(suffix, getBit(node[0], INCLUDE_ALL_SUBDOMAIN), node[4]);
      }
    } while (nodeStack.length);
  }

  static compare(this: void, a: string, b: string) {
    if (a === b) return 0;
    return a.length - b.length || fastStringCompare(a, b);
  }

  protected getSingleChildLeaf(tokens: string[]): FindSingleChildLeafResult<Meta> | null {
    let toPrune: TrieNode<Meta> | null = null;
    let tokenToPrune: string | null = null;

    const onLoop = (node: TrieNode<Meta>, parent: TrieNode<Meta>, token: string) => {
      // Keeping track of a potential branch to prune

      const child = node[2];

      const childSize = child.size + (getBit(node[0], INCLUDE_ALL_SUBDOMAIN) ? 1 : 0);

      if (toPrune !== null) {
        // the most near branch that could potentially being pruned
        if (childSize >= 1) {
          // The branch has some children, the branch need retain.
          // And we need to abort prune that parent branch, so we set it to null
          toPrune = null;
          tokenToPrune = null;
        }
      } else if (childSize < 1) {
        // There is only one token child, or no child at all, we can prune it safely
        // It is now the top-est branch that could potentially being pruned
        toPrune = parent;
        tokenToPrune = token;
      }
    };

    const res = this.walkIntoLeafWithTokens(tokens, onLoop);

    if (res === null) return null;
    return { node: res.node, toPrune, tokenToPrune, parent: res.parent };
  }

  public dumpWithoutDot(onSuffix: (suffix: string, subdomain: boolean) => void, withSort = false) {
    const handleSuffix = (suffix: string[], subdomain: boolean) => {
      onSuffix(toASCII(fastStringArrayJoin(suffix, '.')), subdomain);
    };

    this.walk(handleSuffix, withSort);
  }

  public dump(onSuffix: (suffix: string) => void, withSort?: boolean): void;
  public dump(onSuffix?: null, withSort?: boolean): string[];
  public dump(onSuffix?: ((suffix: string) => void) | null, withSort = false): string[] | void {
    const results: string[] = [];

    const handleSuffix = onSuffix
      ? (suffix: string[], subdomain: boolean) => {
          const d = toASCII(fastStringArrayJoin(suffix, '.'));
          onSuffix(subdomain ? '.' + d : d);
        }
      : (suffix: string[], subdomain: boolean) => {
          const d = toASCII(fastStringArrayJoin(suffix, '.'));
          results.push(subdomain ? '.' + d : d);
        };

    this.walk(handleSuffix, withSort);

    return results;
  }
}

export class HostnameSmolTrie<Meta = unknown> extends Triebase<Meta> {
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

        // During the adding of `[start]blog|.skk.moe` and find out that there is a `[start].skk.moe` in the trie, skip adding the rest of the node
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

    // When walkHostnameTokens returns true, we should skip the rest
    if (walkHostnameTokens(suffix, onToken, hostnameFromIndex)) {
      return;
    }

    // Collapse redundant descendants when adding an all-subdomain rule.
    if (includeAllSubdomain) {
      // Trying to add `[.]sub.example.com` where there is already a `blog.sub.example.com` in the trie

      // Make sure parent `[start]sub.example.com` (without dot) is removed (SETINEL to false)
      // (/** parent */ node[2]!)[0] = false;

      // Removing the rest of the parent's child nodes
      node[2].clear();
      // The SENTINEL of this node will be set to true at the end of the function, so we don't need to set it here

      // we can use else-if here, because the children is now empty, we don't need to check the leading "."
    } else if (getBit(node[0], INCLUDE_ALL_SUBDOMAIN)) {
      // Trying to add `example.com` when there is already a `.example.com` in the trie
      // No need to increment size and set SENTINEL to true (skip this "new" item)
      return;
    }

    node[0] = setBit(node[0], START);
    if (includeAllSubdomain) {
      node[0] = setBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    } else {
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    }
    node[4] = meta!;
  }

  public whitelist(
    suffix: string,
    includeAllSubdomain = suffix[0] === '.',
    hostnameFromIndex = suffix[0] === '.' ? 1 : 0
  ) {
    const tokens = hostnameToTokens(suffix, hostnameFromIndex);
    const res = this.getSingleChildLeaf(tokens);
    if (res === null) return;

    const { node, toPrune, tokenToPrune } = res;

    // Trying to whitelist `[start].sub.example.com` where there might already be a `[start]blog.sub.example.com` in the trie
    if (includeAllSubdomain) {
      // If there is a `[start]sub.example.com` here, remove it
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
      // Removing all the child nodes by empty the children
      node[2].clear();
      // we do not remove sub.example.com for now, we will do that later
    } else {
      // Trying to whitelist `example.com` when there is already a `.example.com` in the trie
      node[0] = deleteBit(node[0], INCLUDE_ALL_SUBDOMAIN);
    }

    if (includeAllSubdomain) {
      node[1]?.[2].delete(node[3]);
    } else if (missingBit(node[0], START) && node[1]) {
      return;
    }

    if (toPrune && tokenToPrune) {
      toPrune[2].delete(tokenToPrune);
    } else {
      node[0] = deleteBit(node[0], START);
    }

    cleanUpEmptyTrailNode(node);
  }
}

function cleanUpEmptyTrailNode<Meta>(node: TrieNode<Meta>) {
  if (
    // the current node is not an "end node", a.k.a. not the start of a domain
    missingBit(node[0], START) &&
    // also no leading "." (no subdomain)
    missingBit(node[0], INCLUDE_ALL_SUBDOMAIN) &&
    // child is empty
    node[2].size === 0 &&
    // has parent: we need to detele the cureent node from the parent
    // we also need to recursively clean up the parent node
    node[1]
  ) {
    node[1][2].delete(node[3]);
    // finish of the current stack
    return cleanUpEmptyTrailNode(node[1]);
  }
}
