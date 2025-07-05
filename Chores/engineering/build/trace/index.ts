import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import os from 'node:os';

// 导入目录常量
import {
  ROOT_DIR,
  SURGE_DIR,
  DIAL_DIR,
  PUBLIC_DIR,
  OUTPUT_SURGE_DIR,
  OUTPUT_RULESETS_DIR,
  OUTPUT_MODULES_DIR,
  OUTPUT_SCRIPTS_DIR,
  OUTPUT_DIAL_DIR,
  OUTPUT_DOMAINSET_DIR,
  SOURCE_DIR,
} from './constants/dir.js';

// 导入工具函数
import { copyDirectory, mkdirp, writeFile } from './lib/file-utils.js';
import { buildFileTree } from './lib/tree-builder.js';
import { generateHtml } from './lib/html-generator.js';

// 获取构建开始时间
const BUILD_START_TIME = new Date();

// 构建完成标记文件
const BUILD_FINISHED_LOCK = path.join(ROOT_DIR, '.BUILD_FINISHED');

// 项目源目录映射到输出目录的关系
const SOURCE_TO_OUTPUT_MAP = [
  { src: path.join(SURGE_DIR, 'Modules'), dest: OUTPUT_MODULES_DIR },
  { src: path.join(SURGE_DIR, 'Scripts'), dest: OUTPUT_SCRIPTS_DIR },
  { src: path.join(SURGE_DIR, 'Rulesets'), dest: OUTPUT_RULESETS_DIR },
  { src: DIAL_DIR, dest: OUTPUT_DIAL_DIR },
  { src: path.join(ROOT_DIR, 'GeoIP'), dest: path.join(PUBLIC_DIR, 'GeoIP') },
  {
    src: path.join(ROOT_DIR, 'Chores/engineering/data/images/favicon'),
    dest: path.join(PUBLIC_DIR, 'images'),
    hideInFileTree: true,
  },
];

// 必需的源目录，这些目录必须存在
const REQUIRED_SOURCE_DIRS = [SURGE_DIR, DIAL_DIR];

// 打印系统信息
function printSystemInfo() {
  console.log('=== 系统信息 ===');
  console.log(`Node.js 版本: ${process.version}`);
  console.log(`操作系统: ${os.type()} ${os.release()} ${os.arch()}`);
  console.log(`处理器核心: ${os.cpus().length}`);
  console.log(
    `可用内存: ${Math.round(os.freemem() / 1024 / 1024)} MB / ${Math.round(
      os.totalmem() / 1024 / 1024
    )} MB`
  );
  console.log('===============');
  console.log();
}

// 创建输出目录结构
async function createOutputDirectories() {
  console.log('创建输出目录结构...');

  try {
    // 清空并重建输出目录
    console.log(`清空输出目录: ${PUBLIC_DIR}`);
    await fs.rm(PUBLIC_DIR, { recursive: true, force: true }).catch(error => {
      console.warn(`删除目录警告: ${error.message}`);
    });
    await mkdirp(PUBLIC_DIR);

    // 创建各子目录
    for (const { dest } of SOURCE_TO_OUTPUT_MAP) {
      await mkdirp(dest);
      console.log(`创建目录: ${dest}`);
    }

    // 创建样式目录
    await mkdirp(path.join(PUBLIC_DIR, 'styles'));

    console.log('输出目录结构创建完成');
  } catch (error) {
    console.error('创建目录结构失败:', error);
    throw error;
  }
}

// 验证必需目录
async function validateRequiredDirectories() {
  console.log('验证必需目录...');
  const missingDirs = [];

  for (const dir of REQUIRED_SOURCE_DIRS) {
    try {
      await fs.access(dir);
      console.log(`必需目录存在: ${dir}`);
    } catch (error) {
      console.error(`必需目录不存在: ${dir}`);
      missingDirs.push(dir);
    }
  }

  if (missingDirs.length > 0) {
    throw new Error(`缺少必需目录: ${missingDirs.join(', ')}`);
  }

  console.log('必需目录验证通过');
}

// 复制规则文件到输出目录
async function copyRuleFiles() {
  console.log('复制规则文件...');

  // 统计信息
  const stats = {
    totalDirs: 0,
    copiedDirs: 0,
    skippedDirs: 0,
  };

  const copyPromises = SOURCE_TO_OUTPUT_MAP.map(async ({ src, dest }) => {
    try {
      stats.totalDirs++;

      // 检查源目录是否存在
      try {
        await fs.access(src);
      } catch (error) {
        console.log(`目录不存在，跳过: ${src}`);
        stats.skippedDirs++;
        return;
      }

      // 复制目录内容
      await copyDirectory(src, dest);
      console.log(`复制完成: ${src} -> ${dest}`);
      stats.copiedDirs++;
    } catch (error) {
      console.error(`复制失败: ${src} -> ${dest}`, error);
      throw error;
    }
  });

  await Promise.all(copyPromises);
  console.log(
    `规则文件复制完成 (总共: ${stats.totalDirs}, 复制: ${stats.copiedDirs}, 跳过: ${stats.skippedDirs})`
  );
}

// 生成网站首页
async function generateIndexPage() {
  console.log('生成网站首页...');

  try {
    // 构建文件树
    const treeData = await buildFileTree(PUBLIC_DIR, 'https://ruleset.chichi.sh');

    // 生成HTML
    const updateTime = BUILD_START_TIME.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const html = generateHtml(treeData, {
      title: "Luck's Surge Rules & Modules Hub",
      description: 'Everything that happens is good for me.',
      author: 'luck',
      updateTime,
      customDomain: 'https://ruleset.chichi.sh',
    });

    // 写入首页文件
    await writeFile(path.join(PUBLIC_DIR, 'index.html'), html);

    // 创建404页面
    await writeFile(
      path.join(PUBLIC_DIR, '404.html'),
      '<pre>###########################################\n# Esdeath Ruleset - 404 Not Found\n###########################################</pre>'
    );

    console.log('网站首页生成完成');
  } catch (error) {
    console.error('生成网站首页失败:', error);
    throw error;
  }
}

// 清理临时资源
async function cleanupResources() {
  if (process.env.CI === 'true' && process.env.RAM_DIR) {
    console.log(`构建在CI环境中，RAM目录 ${process.env.RAM_DIR} 将由系统自动清理`);
  }

  // 这里可以添加其他需要清理的临时资源
  console.log('资源清理完成');
}

// 主函数
async function main() {
  console.log('开始构建...');
  console.log(`构建时间: ${BUILD_START_TIME.toLocaleString()}`);

  try {
    // 删除旧的构建完成标记（如果存在）
    await fs.unlink(BUILD_FINISHED_LOCK).catch(() => {
      console.log('未找到之前的构建完成标记，继续构建');
    });

    // 打印系统信息
    printSystemInfo();

    // 验证必需目录
    await validateRequiredDirectories();

    // 创建输出目录结构
    await createOutputDirectories();

    // 复制规则文件
    await copyRuleFiles();

    // 生成网站首页
    await generateIndexPage();

    // 创建构建完成标记
    await writeFile(BUILD_FINISHED_LOCK, 'BUILD_FINISHED\n');

    // 清理临时资源
    await cleanupResources();

    // 计算构建耗时
    const buildEndTime = new Date();
    const buildDuration = (buildEndTime.getTime() - BUILD_START_TIME.getTime()) / 1000;

    console.log('构建完成！');
    console.log(`总耗时: ${buildDuration.toFixed(2)}秒`);
  } catch (error) {
    console.error('构建失败:', error);
    process.exit(1);
  }
}

// 检查是否为直接运行此模块
// 在ES模块中，直接运行的文件的import.meta.url会以file://开头
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  // 检查当前执行的文件是否为此模块
  if (process.argv[1] === modulePath) {
    main().catch(error => {
      console.error('未捕获的错误:', error);
      process.exit(1);
    });
  }
}

export { main };
