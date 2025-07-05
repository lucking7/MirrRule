/**
 * Trie 树实现，用于域名去重和优化
 * 主要功能：
 * - 自动合并子域名
 * - 智能去重
 * - 支持白名单
 */

export interface TrieNode<T = any> {
  children: Map<string, TrieNode<T>>;
  isEnd: boolean;
  includeAllSubdomain: boolean;
  data?: T;
}

export class HostnameTrie<T = any> {
  private root: TrieNode<T>;
  private _size: number = 0;

  constructor() {
    this.root = {
      children: new Map(),
      isEnd: false,
      includeAllSubdomain: false,
    };
  }

  get size(): number {
    return this._size;
  }

  /**
   * 添加域名到 Trie 树
   * @param domain 域名
   * @param includeAllSubdomain 是否包含所有子域名（DOMAIN-SUFFIX 规则）
   * @param data 附加数据
   */
  add(domain: string, includeAllSubdomain = false, data?: T): void {
    // 域名标准化：转小写，去除前后空格
    domain = domain.toLowerCase().trim();

    // 如果是以点开头的域名，去掉点
    if (domain.startsWith('.')) {
      domain = domain.substring(1);
      includeAllSubdomain = true;
    }

    // 反向存储域名（从右到左），这样更容易处理子域名
    const parts = domain.split('.').reverse();
    let node = this.root;

    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, {
          children: new Map(),
          isEnd: false,
          includeAllSubdomain: false,
        });
      }
      node = node.children.get(part)!;

      // 如果当前节点已经标记为包含所有子域名，则不需要继续
      if (node.isEnd && node.includeAllSubdomain) {
        return;
      }
    }

    // 如果这个域名是新的，增加计数
    if (!node.isEnd) {
      this._size++;
    }

    node.isEnd = true;
    node.includeAllSubdomain = includeAllSubdomain;
    if (data !== undefined) {
      node.data = data;
    }

    // 如果标记为包含所有子域名，清理不必要的子节点
    if (includeAllSubdomain) {
      this.cleanupSubdomains(node);
    }
  }

  /**
   * 清理不必要的子域名节点
   */
  private cleanupSubdomains(node: TrieNode<T>): void {
    for (const [key, child] of node.children) {
      if (child.isEnd) {
        this._size--;
      }
      this.cleanupSubdomains(child);
    }
    node.children.clear();
  }

  /**
   * 检查域名是否存在
   */
  has(domain: string): boolean {
    domain = domain.toLowerCase().trim();
    if (domain.startsWith('.')) {
      domain = domain.substring(1);
    }

    const parts = domain.split('.').reverse();
    let node = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // 检查是否有父域名包含所有子域名
      if (node.isEnd && node.includeAllSubdomain && i > 0) {
        return true;
      }

      if (!node.children.has(part)) {
        return false;
      }

      node = node.children.get(part)!;
    }

    return node.isEnd;
  }

  /**
   * 白名单域名（从 Trie 中移除）
   */
  whitelist(domain: string, includeAllSubdomain = false): void {
    domain = domain.toLowerCase().trim();
    if (domain.startsWith('.')) {
      domain = domain.substring(1);
      includeAllSubdomain = true;
    }

    const parts = domain.split('.').reverse();
    const nodeStack: Array<[TrieNode<T>, string]> = [];
    let node = this.root;

    // 找到目标节点
    for (const part of parts) {
      if (!node.children.has(part)) {
        return; // 域名不存在
      }
      nodeStack.push([node, part]);
      node = node.children.get(part)!;
    }

    if (includeAllSubdomain) {
      // 移除所有子域名
      this.removeAllSubdomains(node);
    }

    // 移除当前节点
    if (node.isEnd) {
      node.isEnd = false;
      node.includeAllSubdomain = false;
      this._size--;

      // 清理空的父节点
      while (nodeStack.length > 0 && node.children.size === 0 && !node.isEnd) {
        const [parent, key] = nodeStack.pop()!;
        parent.children.delete(key);
        node = parent;
      }
    }
  }

  /**
   * 递归移除所有子域名
   */
  private removeAllSubdomains(node: TrieNode<T>): void {
    for (const child of node.children.values()) {
      if (child.isEnd) {
        child.isEnd = false;
        child.includeAllSubdomain = false;
        this._size--;
      }
      this.removeAllSubdomains(child);
    }
  }

  /**
   * 导出所有域名
   */
  dump(): string[] {
    const results: string[] = [];
    this.dumpNode(this.root, [], results);
    return results;
  }

  /**
   * 递归导出节点
   */
  private dumpNode(node: TrieNode<T>, path: string[], results: string[]): void {
    if (node.isEnd) {
      const domain = path.slice().reverse().join('.');
      if (node.includeAllSubdomain) {
        results.push('.' + domain);
      } else {
        results.push(domain);
      }
    }

    // 只有在不包含所有子域名时才遍历子节点
    if (!node.includeAllSubdomain) {
      for (const [key, child] of node.children) {
        path.push(key);
        this.dumpNode(child, path, results);
        path.pop();
      }
    }
  }

  /**
   * 清空 Trie 树
   */
  clear(): void {
    this.root.children.clear();
    this._size = 0;
  }

  /**
   * 合并另一个 Trie 树
   */
  merge(other: HostnameTrie<T>): void {
    const domains = other.dump();
    for (const domain of domains) {
      const includeAllSubdomain = domain.startsWith('.');
      const cleanDomain = includeAllSubdomain ? domain.substring(1) : domain;
      this.add(cleanDomain, includeAllSubdomain);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalDomains: number; suffixRules: number; exactRules: number } {
    let suffixRules = 0;
    let exactRules = 0;

    const domains = this.dump();
    for (const domain of domains) {
      if (domain.startsWith('.')) {
        suffixRules++;
      } else {
        exactRules++;
      }
    }

    return {
      totalDomains: this._size,
      suffixRules,
      exactRules,
    };
  }
}

// 为了兼容 Surge-master-2 的 API，导出别名
export class HostnameSmolTrie<T = any> extends HostnameTrie<T> {
  dumpWithoutDot(
    callback: (domain: string, includeAllSubdomain: boolean) => void,
    _sorted?: boolean
  ): void {
    const domains = this.dump();
    for (const domain of domains) {
      const includeAllSubdomain = domain.startsWith('.');
      const cleanDomain = includeAllSubdomain ? domain.substring(1) : domain;
      callback(cleanDomain, includeAllSubdomain);
    }
  }
}

/**
 * 创建域名 Trie 的辅助函数
 */
export function createDomainTrie<T = any>(domains: string[]): HostnameTrie<T> {
  const trie = new HostnameTrie<T>();
  for (const domain of domains) {
    const includeAllSubdomain = domain.startsWith('.');
    const cleanDomain = includeAllSubdomain ? domain.substring(1) : domain;
    trie.add(cleanDomain, includeAllSubdomain);
  }
  return trie;
}
