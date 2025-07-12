#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const dns = require('dns');
const { execSync } = require('child_process');

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '../../../../');

// 缓存目录
const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const DEAD_DOMAINS_CACHE = path.join(CACHE_DIR, 'dead-domains.json');
const DOMAIN_STATUS_CACHE = path.join(CACHE_DIR, 'domain-status.json');

// 待检查的目录
const DIRECTORIES_TO_CHECK = [
  path.join(ROOT_DIR, 'Surge/Rulesets'),
  path.join(ROOT_DIR, 'Source/domainset'),
];

// 检查文件的扩展名
const FILE_EXTENSIONS = ['.list', '.conf'];

// Promisify DNS解析方法
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// DNS服务器
const DNS_SERVERS = [
  '8.8.8.8', // Google
  '1.1.1.1', // Cloudflare
  '223.5.5.5', // AliDNS
  '114.114.114.114', // 114DNS
];

// 域名状态缓存
let domainStatusCache = {};
try {
  if (fs.existsSync(DOMAIN_STATUS_CACHE)) {
    domainStatusCache = JSON.parse(fs.readFileSync(DOMAIN_STATUS_CACHE, 'utf8'));
    console.log(`已加载域名缓存，共 ${Object.keys(domainStatusCache).length} 条记录`);
  }
} catch (error) {
  console.error('读取域名缓存失败:', error);
  domainStatusCache = {};
}

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 从规则文件中提取域名
 */
function extractDomainsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const domains = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
      continue;
    }

    if (trimmedLine.startsWith('DOMAIN,')) {
      domains.push(trimmedLine.split(',')[1]);
    } else if (trimmedLine.startsWith('DOMAIN-SUFFIX,')) {
      domains.push('.' + trimmedLine.split(',')[1]);
    } else if (
      !trimmedLine.includes(',') &&
      trimmedLine.includes('.') &&
      !trimmedLine.startsWith('IP-CIDR')
    ) {
      // 可能是纯域名格式
      domains.push(trimmedLine);
    }
  }

  return domains;
}

/**
 * 检查单个域名是否可用
 */
async function checkDomain(domain) {
  // 如果域名以点开头，移除点
  const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;

  // 检查缓存
  if (domainStatusCache[cleanDomain] !== undefined) {
    // 只有状态至少7天前检查过的才会重新验证
    const cacheTime = domainStatusCache[cleanDomain].timestamp || 0;
    const now = Date.now();
    if (now - cacheTime < 7 * 24 * 60 * 60 * 1000) {
      return domainStatusCache[cleanDomain].alive;
    }
  }

  // 尝试解析A记录
  for (const dnsServer of DNS_SERVERS) {
    try {
      // 设置DNS服务器
      dns.setServers([dnsServer]);
      await dnsResolve4(cleanDomain);

      // 成功解析，域名有效
      domainStatusCache[cleanDomain] = {
        alive: true,
        timestamp: Date.now(),
      };
      return true;
    } catch (error) {
      // 继续尝试下一个DNS服务器
    }
  }

  // 尝试解析AAAA记录
  for (const dnsServer of DNS_SERVERS) {
    try {
      dns.setServers([dnsServer]);
      await dnsResolve6(cleanDomain);

      // 成功解析，域名有效
      domainStatusCache[cleanDomain] = {
        alive: true,
        timestamp: Date.now(),
      };
      return true;
    } catch (error) {
      // 继续尝试下一个DNS服务器
    }
  }

  // 所有DNS服务器都无法解析，域名可能无效
  domainStatusCache[cleanDomain] = {
    alive: false,
    timestamp: Date.now(),
  };
  return false;
}

/**
 * 递归获取目录下的所有文件
 */
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (FILE_EXTENSIONS.includes(path.extname(file))) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * 主函数
 */
async function main() {
  console.log('开始验证域名可用性...');

  // 收集所有规则文件
  const allFiles = [];
  for (const dir of DIRECTORIES_TO_CHECK) {
    if (fs.existsSync(dir)) {
      const files = getAllFiles(dir);
      allFiles.push(...files);
    }
  }

  console.log(`找到 ${allFiles.length} 个规则文件`);

  // 提取所有域名
  const allDomains = new Set();
  for (const file of allFiles) {
    const domains = extractDomainsFromFile(file);
    domains.forEach(domain => allDomains.add(domain));
  }

  console.log(`提取出 ${allDomains.size} 个唯一域名`);

  // 批量检查域名可用性
  const deadDomains = [];
  let processed = 0;
  const total = allDomains.size;

  for (const domain of allDomains) {
    processed++;

    // 每处理100个域名显示一次进度
    if (processed % 100 === 0 || processed === total) {
      console.log(`进度: ${processed}/${total} (${Math.round((processed / total) * 100)}%)`);
    }

    const isAlive = await checkDomain(domain);
    if (!isAlive) {
      console.log(`失效域名: ${domain}`);
      deadDomains.push(domain);
    }
  }

  // 保存缓存
  fs.writeFileSync(DOMAIN_STATUS_CACHE, JSON.stringify(domainStatusCache, null, 2));

  // 输出结果
  console.log(`\n验证完成，发现 ${deadDomains.length} 个失效域名`);

  if (deadDomains.length > 0) {
    // 保存失效域名列表
    fs.writeFileSync(DEAD_DOMAINS_CACHE, JSON.stringify(deadDomains, null, 2));

    // 设置GitHub Actions输出变量
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      fs.appendFileSync(outputPath, `has_dead_domains=true\n`);
      fs.appendFileSync(outputPath, `dead_domains_count=${deadDomains.length}\n`);
    }
  } else {
    // 设置GitHub Actions输出变量
    if (process.env.GITHUB_OUTPUT) {
      const outputPath = process.env.GITHUB_OUTPUT;
      fs.appendFileSync(outputPath, `has_dead_domains=false\n`);
      fs.appendFileSync(outputPath, `dead_domains_count=0\n`);
    }
  }
}

// 运行主函数
main().catch(error => {
  console.error('验证域名时出错:', error);
  process.exit(1);
});
