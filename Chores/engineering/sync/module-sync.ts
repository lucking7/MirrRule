import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { REPO_PATH } from './rule-sources.js';
import axios from 'axios';
import { execSync } from 'child_process';

// 创建目录（如果不存在）
async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory: ${dir}`, error);
  }
}

// 计算文件的SHA256校验和
async function calculateSHA256(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch (error) {
    console.error(`Failed to calculate SHA256 for ${filePath}:`, error);
    throw error;
  }
}

// 下载文件
async function downloadFile(url: string, outputPath: string, tempPath: string): Promise<boolean> {
  try {
    console.log(`Downloading from ${url} to ${outputPath}`);

    const response = await axios.get(url, { responseType: 'arraybuffer' });

    // 将文件保存到临时位置
    await fs.writeFile(tempPath, response.data);

    // 检查目标文件是否存在
    let fileChanged = false;
    try {
      const newChecksum = await calculateSHA256(tempPath);
      console.log(`New checksum for ${path.basename(outputPath)}: ${newChecksum}`);

      try {
        await fs.access(outputPath);
        // 文件存在，比较校验和
        const existingChecksum = await calculateSHA256(outputPath);
        console.log(`Existing checksum for ${path.basename(outputPath)}: ${existingChecksum}`);

        if (newChecksum !== existingChecksum) {
          console.log(`Updating ${path.basename(outputPath)}`);
          await fs.rename(tempPath, outputPath);
          fileChanged = true;
        } else {
          console.log(`No changes in ${path.basename(outputPath)}`);
          await fs.unlink(tempPath);
        }
      } catch (error) {
        // 文件不存在，直接移动
        console.log(`Adding new file ${path.basename(outputPath)}`);
        await fs.rename(tempPath, outputPath);
        fileChanged = true;
      }
    } catch (error) {
      console.error(`Failed to process downloaded file ${path.basename(outputPath)}:`, error);
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // 忽略删除临时文件的错误
      }
    }

    return fileChanged;
  } catch (error) {
    console.error(`Failed to download from ${url}:`, error);
    return false;
  }
}

// 下载并处理Sukka模块
async function mirrorSukkaModules() {
  console.log('开始同步 Sukka 模块...');

  // 修改目录结构为 /Dial/Sukka/Modules
  const modulesDir = path.join(REPO_PATH, 'Dial', 'Sukka', 'Modules');
  await ensureDir(modulesDir);

  const modules: Record<string, string> = {
    'google_cn_307.sgmodule': 'https://ruleset.skk.moe/Modules/google_cn_307.sgmodule',
    'sukka_common_always_realip.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_common_always_realip.sgmodule',
    'sukka_disable_netease_music_v2_update_check.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_disable_netease_music_v2_update_check.sgmodule',
    'sukka_enhance_adblock.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_enhance_adblock.sgmodule',
    'sukka_local_dns_mapping.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_local_dns_mapping.sgmodule',
    'sukka_mitm_all_hostnames.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_mitm_all_hostnames.sgmodule',
    'sukka_mitm_hostnames.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_mitm_hostnames.sgmodule',
    'sukka_surge_network_test_domain.sgmodule':
      'https://ruleset.skk.moe/Modules/sukka_surge_network_test_domain.sgmodule',
    'sukka_url_redirect.sgmodule': 'https://ruleset.skk.moe/Modules/sukka_url_redirect.sgmodule',
    'sukka_url_rewrite.sgmodule': 'https://ruleset.skk.moe/Modules/sukka_url_rewrite.sgmodule',
  };

  let assetsChanged = false;
  const updatedFiles: string[] = [];

  for (const [moduleName, sourceUrl] of Object.entries(modules)) {
    const outputFile = path.join(modulesDir, moduleName);
    const tempFile = `${outputFile}.tmp`;

    const fileChanged = await downloadFile(sourceUrl, outputFile, tempFile);
    if (fileChanged) {
      updatedFiles.push(moduleName);
      assetsChanged = true;

      // 添加分类标记到模块文件
      try {
        let content = await fs.readFile(outputFile, 'utf8');
        if (!content.includes('#!category=[Sukka]')) {
          // 查找模块名称行
          const nameLineMatch = content.match(/^#!(name|desc)/m);
          if (nameLineMatch) {
            // 在名称行之前插入分类标记
            const nameLineIndex = content.indexOf(nameLineMatch[0]);
            content =
              content.substring(0, nameLineIndex) +
              '#!category=[Sukka]\n' +
              content.substring(nameLineIndex);
          } else {
            // 如果找不到名称行，在文件开头添加
            content = '#!category=[Sukka]\n' + content;
          }
          await fs.writeFile(outputFile, content, 'utf8');
          console.log(`已添加分类标记到: ${moduleName}`);
        }
      } catch (error) {
        console.error(`给模块 ${moduleName} 添加分类标记时出错:`, error);
      }
    } else {
      // 即使文件没有更新，也检查并添加分类标记
      try {
        // 检查文件是否存在
        await fs.access(outputFile);

        let content = await fs.readFile(outputFile, 'utf8');
        if (!content.includes('#!category=[Sukka]')) {
          // 查找模块名称行
          const nameLineMatch = content.match(/^#!(name|desc)/m);
          if (nameLineMatch) {
            // 在名称行之前插入分类标记
            const nameLineIndex = content.indexOf(nameLineMatch[0]);
            content =
              content.substring(0, nameLineIndex) +
              '#!category=[Sukka]\n' +
              content.substring(nameLineIndex);
          } else {
            // 如果找不到名称行，在文件开头添加
            content = '#!category=[Sukka]\n' + content;
          }
          await fs.writeFile(outputFile, content, 'utf8');
          console.log(`已添加分类标记到现有文件: ${moduleName}`);
          assetsChanged = true; // 文件内容有变化
        }
      } catch (error) {
        // 文件可能不存在或无法读取，忽略
        console.log(`无法处理现有文件 ${moduleName}: ${(error as Error).message}`);
      }
    }
  }

  // 下载DNS规则 - 更新目录结构
  console.log('开始同步 Sukka DNS 映射规则...');

  const dnsRulesDir = path.join(
    REPO_PATH,
    'Dial',
    'Sukka',
    'Modules',
    'Rules',
    'sukka_local_dns_mapping'
  );
  await ensureDir(dnsRulesDir);

  const dnsMapping: Record<string, string> = {
    'alibaba.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/alibaba.conf',
    'baidu.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/baidu.conf',
    'bilibili.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/bilibili.conf',
    'bytedance.conf':
      'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/bytedance.conf',
    'lan.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/lan.conf',
    'lan_with_realip.conf':
      'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/lan_with_realip.conf',
    'lan_without_real_ip.conf':
      'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/lan_without_real_ip.conf',
    'qihoo360.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/qihoo360.conf',
    'router.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/router.conf',
    'tencent.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/tencent.conf',
    'xiaomi.conf': 'https://ruleset.skk.moe/Modules/Rules/sukka_local_dns_mapping/xiaomi.conf',
  };

  let dnsRulesChanged = false;
  const updatedDnsFiles: string[] = [];

  for (const [fileName, sourceUrl] of Object.entries(dnsMapping)) {
    const outputFile = path.join(dnsRulesDir, fileName);
    const tempFile = `${outputFile}.tmp`;

    const fileChanged = await downloadFile(sourceUrl, outputFile, tempFile);
    if (fileChanged) {
      updatedDnsFiles.push(fileName);
      dnsRulesChanged = true;
    }
  }

  // 下载Mock文件
  console.log('开始同步 Sukka Mock 文件...');

  const mockDir = path.join(REPO_PATH, 'Dial', 'Sukka', 'Mock');
  await ensureDir(mockDir);

  const mockFiles: Record<string, string> = {
    '200.array.json': 'https://ruleset.skk.moe/Mock/200.array.json',
    '200.json': 'https://ruleset.skk.moe/Mock/200.json',
    '200.txt': 'https://ruleset.skk.moe/Mock/200.txt',
    'addthis-com_addthis_widget.js': 'https://ruleset.skk.moe/Mock/addthis-com_addthis_widget.js',
    'amazon-adsystem-com_amazon-apstag.js':
      'https://ruleset.skk.moe/Mock/amazon-adsystem-com_amazon-apstag.js',
    'ampproject-org_v0.js': 'https://ruleset.skk.moe/Mock/ampproject-org_v0.js',
    'doubleclick-net_instream_ad_status.js':
      'https://ruleset.skk.moe/Mock/doubleclick-net_instream_ad_status.js',
    'nomo.json': 'https://ruleset.skk.moe/Mock/nomo.json',
    'securepubads-g-doubleclick-net_tag_js_gpt.js':
      'https://ruleset.skk.moe/Mock/securepubads-g-doubleclick-net_tag_js_gpt.js',
    'static-chartbeat-com_chartbeat_mab.js':
      'https://ruleset.skk.moe/Mock/static-chartbeat-com_chartbeat_mab.js',
    'widgets-outbrain-com_outbrain.js':
      'https://ruleset.skk.moe/Mock/widgets-outbrain-com_outbrain.js',
    'www-google-analytics-com_analytics.js':
      'https://ruleset.skk.moe/Mock/www-google-analytics-com_analytics.js',
    'www-google-analytics-com_cx_api.js':
      'https://ruleset.skk.moe/Mock/www-google-analytics-com_cx_api.js',
    'www-google-analytics-com_ga.js': 'https://ruleset.skk.moe/Mock/www-google-analytics-com_ga.js',
    'www-google-analytics-com_inpage_linkid.js':
      'https://ruleset.skk.moe/Mock/www-google-analytics-com_inpage_linkid.js',
    'www-googlesyndication-com_adsbygoogle.js':
      'https://ruleset.skk.moe/Mock/www-googlesyndication-com_adsbygoogle.js',
    'www-googletagservices-com_gpt.js':
      'https://ruleset.skk.moe/Mock/www-googletagservices-com_gpt.js',
  };

  let mockFilesChanged = false;
  const updatedMockFiles: string[] = [];

  for (const [fileName, sourceUrl] of Object.entries(mockFiles)) {
    const outputFile = path.join(mockDir, fileName);
    const tempFile = `${outputFile}.tmp`;

    const fileChanged = await downloadFile(sourceUrl, outputFile, tempFile);
    if (fileChanged) {
      updatedMockFiles.push(fileName);
      mockFilesChanged = true;
    }
  }

  // 如果有文件变更，修改模块文件中的URL
  if (assetsChanged || dnsRulesChanged || mockFilesChanged) {
    let modificationsMode = false;

    // 处理模块文件URL
    if (assetsChanged) {
      for (const moduleName of updatedFiles) {
        if (moduleName === 'sukka_local_dns_mapping.sgmodule') {
          console.log('特殊处理 sukka_local_dns_mapping.sgmodule');

          const filePath = path.join(modulesDir, moduleName);
          let content = await fs.readFile(filePath, 'utf8');

          // 替换DNS规则URL - 指向新的目录结构
          content = content.replace(
            /https:\/\/ruleset\.skk\.moe\/Modules\/Rules\/sukka_local_dns_mapping\//g,
            'https://ruleset.chichi.sh/Dial/Sukka/Modules/Rules/sukka_local_dns_mapping/'
          );

          await fs.writeFile(filePath, content, 'utf8');
          modificationsMode = true;
        }

        // 更新所有模块中的Mock引用URL
        const filePath = path.join(modulesDir, moduleName);
        let content = await fs.readFile(filePath, 'utf8');

        // 替换Mock URL
        content = content.replace(
          /https:\/\/ruleset\.skk\.moe\/Mock\//g,
          'https://ruleset.chichi.sh/Dial/Sukka/Mock/'
        );

        // 替换模块URL
        if (content.includes('ruleset.skk.moe')) {
          content = content.replace(
            /https:\/\/ruleset\.skk\.moe\/Modules\//g,
            'https://ruleset.chichi.sh/Dial/Sukka/Modules/'
          );

          await fs.writeFile(filePath, content, 'utf8');
          modificationsMode = true;
        }
      }
    }

    console.log(`Sukka 资源同步完成，${modificationsMode ? '并已修改URL' : '无需修改'}`);
    return {
      assetsChanged: assetsChanged || dnsRulesChanged || mockFilesChanged,
      modificationsMode,
      mockUpdated: mockFilesChanged,
    };
  } else {
    console.log('Sukka 资源没有变化');
    return { assetsChanged: false, modificationsMode: false, mockUpdated: false };
  }
}

// 下载BiliUniverse模块
async function mirrorBiliUniverseModules() {
  console.log('开始同步 BiliUniverse 模块...');

  const outputDir = path.join(REPO_PATH, 'Dial', 'BiliUniverse');
  await ensureDir(outputDir);

  const repositories = [
    'BiliUniverse/Global',
    'BiliUniverse/ADBlock',
    'BiliUniverse/Enhanced',
    'BiliUniverse/PlayEvo',
    'BiliUniverse/BoxJs',
  ];

  let assetsChanged = false;
  let modificationsMode = false;
  const updatedFiles: string[] = [];

  try {
    for (const repo of repositories) {
      console.log(`处理仓库: ${repo}`);

      // 获取最新release
      const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const releaseResponse = await axios.get(releaseUrl);

      if (!releaseResponse.data) {
        console.log(`没有找到${repo}的Release，跳过`);
        continue;
      }

      const assets = releaseResponse.data.assets;

      for (const asset of assets) {
        const assetName = asset.name;
        const assetUrl = asset.browser_download_url || asset.url;

        // 过滤出Surge模块
        if (
          assetName.endsWith('.sgmodule') ||
          assetName.endsWith('.js') ||
          assetName.endsWith('.conf') ||
          assetName.endsWith('.json')
        ) {
          const outputFile = path.join(outputDir, assetName);
          const tempFile = `${outputFile}.tmp`;

          const fileChanged = await downloadFile(assetUrl, outputFile, tempFile);
          if (fileChanged) {
            updatedFiles.push(assetName);
            assetsChanged = true;
          }
        }
      }
    }

    // 修改BiliUniverse模块中的代理设置
    try {
      console.log('修改 BiliUniverse 模块中的代理设置...');

      const sgmoduleFiles = await fs.readdir(outputDir);

      for (const file of sgmoduleFiles) {
        if (file.endsWith('.sgmodule')) {
          const filePath = path.join(outputDir, file);
          let content = await fs.readFile(filePath, 'utf8');
          let contentChanged = false;

          // 修改Proxies.HKG为香港国旗，修改Proxies.TWN为台湾国旗
          let newContent = content.replace(/Proxies\.HKG/g, '🇭🇰');
          newContent = newContent.replace(/Proxies\.TWN/g, '🇹🇼');

          // 检查是否有变化
          if (newContent !== content) {
            await fs.writeFile(filePath, newContent, 'utf8');
            modificationsMode = true;
            contentChanged = true;
          }

          if (contentChanged) {
            console.log(`已修改: ${file}`);
          }
        }
      }

      if (modificationsMode) {
        console.log('BiliUniverse 模块代理设置已修改');
      } else {
        console.log('BiliUniverse 模块无需修改代理设置');
      }
    } catch (error) {
      console.error('修改 BiliUniverse 模块代理设置时出错:', error);
    }

    console.log(`BiliUniverse 模块同步完成${assetsChanged ? '，有文件更新' : '，无文件更新'}`);
    return { assetsChanged, updatedFiles, modificationsMode };
  } catch (error) {
    console.error('同步 BiliUniverse 模块时出错:', error);
    return { assetsChanged: false, updatedFiles: [], modificationsMode: false };
  }
}

// 下载DualSubs模块
async function mirrorDualSubsModules() {
  console.log('开始同步 DualSubs 模块...');

  const outputDir = path.join(REPO_PATH, 'Dial', 'DualSubs');
  await ensureDir(outputDir);

  const repositories = [
    'DualSubs/YouTube',
    'DualSubs/Universal',
    'DualSubs/Netflix',
    'DualSubs/Spotify',
  ];

  let assetsChanged = false;
  const updatedFiles: string[] = [];

  try {
    for (const repo of repositories) {
      console.log(`处理仓库: ${repo}`);

      // 获取最新release
      const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const releaseResponse = await axios.get(releaseUrl);

      if (!releaseResponse.data) {
        console.log(`没有找到${repo}的Release，跳过`);
        continue;
      }

      const assets = releaseResponse.data.assets;

      for (const asset of assets) {
        const assetName = asset.name;
        const assetUrl = asset.browser_download_url || asset.url;
        const extension = path.extname(assetName).toLowerCase();

        if (extension === '.sgmodule') {
          const outputFile = path.join(outputDir, assetName);
          const tempFile = `${outputFile}.tmp`;

          const fileChanged = await downloadFile(assetUrl, outputFile, tempFile);
          if (fileChanged) {
            updatedFiles.push(assetName);
            assetsChanged = true;
          }
        } else {
          console.log(`跳过文件: ${assetName}`);
        }
      }
    }

    console.log(`DualSubs 模块同步完成${assetsChanged ? '，有文件更新' : '，无文件更新'}`);
    return { assetsChanged, updatedFiles };
  } catch (error) {
    console.error('同步 DualSubs 模块时出错:', error);
    return { assetsChanged: false, updatedFiles: [] };
  }
}

// 下载iRingo模块 (NSRingo)
async function mirrorIRingoModules() {
  console.log('开始同步 iRingo 模块...');

  const outputDir = path.join(REPO_PATH, 'Dial', 'iRingo');
  await ensureDir(outputDir);

  // 创建子目录
  const pluginDir = path.join(outputDir, 'plugin');
  const sgmoduleDir = path.join(outputDir, 'sgmodule');
  const snippetDir = path.join(outputDir, 'snippet');
  const stoverrideDir = path.join(outputDir, 'stoverride');

  await ensureDir(pluginDir);
  await ensureDir(sgmoduleDir);
  await ensureDir(snippetDir);
  await ensureDir(stoverrideDir);

  // NSRingo 仓库列表
  const repositories = [
    'NSRingo/WeatherKit',
    'NSRingo/News',
    'NSRingo/Testflight',
    'NSRingo/GeoServices',
    'NSRingo/Siri',
    'NSRingo/TV',
  ];

  let assetsChanged = false;
  let modificationsMode = false;
  const updatedFiles: string[] = [];

  try {
    for (const repo of repositories) {
      console.log(`处理仓库: ${repo}`);

      // 获取最新release
      const releaseUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const releaseResponse = await axios.get(releaseUrl, {
        headers: {
          'User-Agent': 'mirror-sync-bot',
        },
      });

      if (!releaseResponse.data || releaseResponse.data.message === 'Not Found') {
        console.log(`Release not found for ${repo}, skipping.`);
        continue;
      }

      console.log(`Release data for ${repo}:`);
      const assets = releaseResponse.data.assets;

      for (const asset of assets) {
        const assetName = asset.name;
        const assetUrl = asset.url;
        const assetSize = asset.size;

        console.log(`Found asset: ${assetName} (Size: ${assetSize} bytes)`);

        const extension = path.extname(assetName).toLowerCase().substring(1);
        let targetDir = outputDir;

        // 根据扩展名分类存储
        switch (extension) {
          case 'plugin':
            targetDir = pluginDir;
            break;
          case 'sgmodule':
            targetDir = sgmoduleDir;
            break;
          case 'snippet':
            targetDir = snippetDir;
            break;
          case 'stoverride':
            targetDir = stoverrideDir;
            break;
          default:
            console.log(`Skipping file: ${assetName}`);
            continue;
        }

        const outputFile = path.join(targetDir, assetName);
        const tempFile = `${outputFile}.tmp`;

        // 下载文件
        try {
          console.log(`Downloading: ${assetName}`);

          // 使用现有的 downloadFile 函数，它已经包含了完整的下载和校验逻辑
          const fileChanged = await downloadFile(assetUrl, outputFile, tempFile);
          if (fileChanged) {
            updatedFiles.push(assetName);
            assetsChanged = true;
          }
        } catch (error) {
          console.error(`Failed to download ${assetName}:`, error);
        }
      }
    }

    // 下载额外的Siri模块
    console.log('下载额外的Siri模块...');
    const extraSiriModules = [
      {
        url: 'https://raw.githubusercontent.com/NSRingo/Siri/dev/debug/Siri.V2.beta.sgmodule',
        name: 'Siri.V2.beta.sgmodule',
      },
      {
        url: 'https://raw.githubusercontent.com/NSRingo/Siri/dev/debug/Siri.V2.macOS.beta.sgmodule',
        name: 'Siri.V2.macOS.beta.sgmodule',
      },
    ];

    for (const module of extraSiriModules) {
      const outputFile = path.join(sgmoduleDir, module.name);
      const tempFile = `${outputFile}.tmp`;

      try {
        const fileChanged = await downloadFile(module.url, outputFile, tempFile);
        if (fileChanged) {
          updatedFiles.push(module.name);
          assetsChanged = true;
        }
      } catch (error) {
        console.error(`Failed to download ${module.name}:`, error);
      }
    }

    // 修改sgmodule文件中的代理设置
    try {
      console.log('修改 iRingo sgmodule 文件中的代理设置...');

      const sgmoduleFiles = await fs.readdir(sgmoduleDir);

      for (const file of sgmoduleFiles) {
        if (file.endsWith('.sgmodule')) {
          const filePath = path.join(sgmoduleDir, file);
          let content = await fs.readFile(filePath, 'utf8');
          let contentChanged = false;

          // 修改#!arguments=行中的Proxy设置
          const newContent = content.replace(/^#!arguments=.*Proxy:\s*[^,]*/gm, match =>
            match.replace(/(Proxy:\s*)[^,]*/, '$1United States')
          );

          if (newContent !== content) {
            await fs.writeFile(filePath, newContent, 'utf8');
            modificationsMode = true;
            contentChanged = true;
          }

          if (contentChanged) {
            console.log(`已修改: ${file}`);
          }
        }
      }

      if (modificationsMode) {
        console.log('iRingo sgmodule 文件代理设置已修改为 United States');
      } else {
        console.log('iRingo sgmodule 文件无需修改代理设置');
      }
    } catch (error) {
      console.error('修改 iRingo sgmodule 文件代理设置时出错:', error);
    }

    console.log(`iRingo 模块同步完成${assetsChanged ? '，有文件更新' : '，无文件更新'}`);
    return { assetsChanged, updatedFiles, modificationsMode };
  } catch (error) {
    console.error('同步 iRingo 模块时出错:', error);
    return { assetsChanged: false, updatedFiles: [], modificationsMode: false };
  }
}

// 主函数
export async function mirrorAll() {
  console.log('开始镜像同步所有模块...');

  const results = await Promise.all([
    mirrorSukkaModules(),
    mirrorBiliUniverseModules(),
    mirrorDualSubsModules(),
    mirrorIRingoModules(),
  ]);

  const [sukkaResult, biliResult, dualSubsResult, iRingoResult] = results;
  const anyChanged = results.some(result => result.assetsChanged);

  if (anyChanged) {
    console.log('有模块发生变化，正在提交修改...');

    const date = new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // 设置git配置
    try {
      execSync('git config --global user.name "mirror-sync[bot]"');
      execSync('git config --global user.email "mirror-sync[bot]@users.noreply.github.com"');

      // 添加所有变更 - 更新路径
      execSync('git add ./Dial/');

      // 准备提交信息
      let commitMessage = '';

      if (sukkaResult.assetsChanged) {
        commitMessage +=
          sukkaResult.modificationsMode || sukkaResult.mockUpdated
            ? '🔧 同步并修改 Sukka 模块'
            : '🌬️ 同步 Sukka 模块';
      }

      if (biliResult.assetsChanged) {
        if (commitMessage) commitMessage += ' 和 ';
        commitMessage += '🌬️ BiliUniverse 模块';
      }

      if (dualSubsResult.assetsChanged) {
        if (commitMessage) commitMessage += ' 和 ';
        commitMessage += '🌬️ DualSubs 模块';
      }

      if (iRingoResult.assetsChanged) {
        if (commitMessage) commitMessage += ' 和 ';
        commitMessage += iRingoResult.modificationsMode ? '🔧 修改 iRingo 模块' : '🌬️ iRingo 模块';
      }

      commitMessage += ` (${date}, UTC+8)`;

      // 检查是否有需要提交的变更
      try {
        execSync('git diff --cached --quiet');
        console.log('没有需要提交的变更。');
      } catch (error) {
        // 如果有变更，上面的命令会返回非零状态码
        execSync(`git commit -m "${commitMessage}"`);
        execSync('git push origin main');
        console.log('已提交并推送变更到仓库。');
      }
    } catch (error) {
      console.error('提交变更时出错:', error);
    }
  } else {
    console.log('所有模块都没有变化，无需提交。');
  }

  console.log('镜像同步完成！');
  return anyChanged;
}

// 如果直接运行该脚本，执行mirrorAll函数
// ES 模块中通过检查 import.meta.url 是否与 process.argv[1] 的 URL 相匹配来判断
if (import.meta.url.endsWith(process.argv[1].replace('file:', ''))) {
  mirrorAll().catch(error => {
    console.error('镜像同步出错:', error);
    process.exit(1);
  });
}
