import { RuleProcessor } from './rule-processor.js';
import { RuleConverter } from './rule-converter.js';
import { RuleMerger } from './rule-merger.js';
import { config, ruleGroups, specialRules } from './rule-sources.js';
import { ensureDirectoryExists, initializeDirectoryStructure } from './utils.js';
import { GeoIPProcessor } from './rule-geoip-processor.js';
import path from 'node:path';
import { RuleFormat } from './rule-types.js';

async function main() {
  try {
    console.log('Starting rule processing...');

    // 初始化目录结构
    initializeDirectoryStructure(config.repoPath, ruleGroups, specialRules);

    const options = {
      enableNoResolve: false,
      enablePreMatching: false,
      enableExtended: false,
    };

    // 创建规则处理器
    const converter = new RuleConverter('Surge' as RuleFormat);
    converter.setOptions(options);

    const merger = new RuleMerger(config.repoPath, converter);
    const processor = new RuleProcessor(config.repoPath, converter, merger);

    // 创建GeoIP处理器
    const geoipProcessor = new GeoIPProcessor(config.repoPath);

    // 处理每个规则组
    for (const group of ruleGroups) {
      console.log(`Processing group: ${group.name}`);

      for (const rule of group.files) {
        const fileExt = path.extname(rule.path).toLowerCase();

        // 根据文件类型选择处理器
        if (fileExt === '.mmdb') {
          await geoipProcessor.process(rule);
        } else {
          await processor.process(rule);
        }
      }
    }

    // 处理特殊规则
    console.log('Processing special rules...');
    await processor.processSpecialRules(specialRules);

    console.log('Rule processing completed successfully.');
  } catch (error) {
    console.error('Rule processing failed:', error);
    process.exit(1);
  }
}

// 执行主函数
main();
