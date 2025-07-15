import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import picocolors from 'picocolors';

// 获取当前文件所在目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 项目根目录
const REPO_PATH = path.resolve(__dirname, '../../../..');
const CACHE_DIR = path.join(REPO_PATH, '.cache');
const PREVIOUS_BUILD_DIR = path.join(CACHE_DIR, 'previous-build');

// GitHub 相关配置
const GITHUB_OWNER = process.env.GITHUB_REPOSITORY_OWNER || 'jasperl';
const GITHUB_REPO = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'esdeath';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface Asset {
  url: string;
  name: string;
  size: number;
}

// 下载文件
async function downloadFile(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = {
    'User-Agent': 'esdeath-build-system',
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const fileStream = createWriteStream(dest);
  await pipeline(response.body!, fileStream);
}

// 获取最新的 Release
async function getLatestRelease(): Promise<Asset[]> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'esdeath-build-system',
  };

  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  console.log(`📥 获取最新 Release 信息...`);

  const response = await fetch(url, { headers });

  if (response.status === 404) {
    console.log(picocolors.yellow('⚠️  没有找到任何 Release'));
    return [];
  }

  if (!response.ok) {
    throw new Error(`获取 Release 失败: ${response.status} ${response.statusText}`);
  }

  const release = await response.json();
  console.log(`📦 最新 Release: ${release.tag_name} (${release.published_at})`);

  return release.assets || [];
}

// 下载并解压构建产物
async function downloadPreviousBuild(): Promise<boolean> {
  try {
    // 确保缓存目录存在
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.mkdir(PREVIOUS_BUILD_DIR, { recursive: true });

    // 获取最新 Release 的资源
    const assets = await getLatestRelease();

    if (assets.length === 0) {
      console.log(picocolors.yellow('⚠️  没有找到构建产物'));
      return false;
    }

    // 查找规则集压缩包
    const rulesetAsset = assets.find(
      a => a.name === 'rulesets.tar.gz' || a.name === 'surge-rulesets.tar.gz'
    );

    if (!rulesetAsset) {
      console.log(picocolors.yellow('⚠️  没有找到规则集压缩包'));
      return false;
    }

    console.log(
      `📥 下载构建产物: ${rulesetAsset.name} (${(rulesetAsset.size / 1024 / 1024).toFixed(2)} MB)`
    );

    const tempFile = path.join(CACHE_DIR, 'previous-build.tar.gz');
    await downloadFile(rulesetAsset.url, tempFile);

    console.log('📦 解压构建产物...');

    // 清空目标目录
    await fs.rm(PREVIOUS_BUILD_DIR, { recursive: true, force: true });
    await fs.mkdir(PREVIOUS_BUILD_DIR, { recursive: true });

    // 解压文件
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    await execAsync(`tar -xzf ${tempFile} -C ${PREVIOUS_BUILD_DIR}`, {
      cwd: CACHE_DIR,
    });

    // 删除临时文件
    await fs.unlink(tempFile);

    console.log(picocolors.green('✅ 上次构建产物下载完成'));
    return true;
  } catch (error) {
    console.error(picocolors.red('❌ 下载失败:'), error);
    return false;
  }
}

// 主函数
async function main() {
  console.log(picocolors.bold(picocolors.cyan('🔄 下载上次构建产物\n')));

  const success = await downloadPreviousBuild();

  if (success) {
    // 列出下载的文件
    const files = await fs.readdir(PREVIOUS_BUILD_DIR, { recursive: true });
    console.log(`\n📁 下载的文件: ${files.length} 个`);
  }

  process.exit(success ? 0 : 1);
}

// 执行
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main();
}
