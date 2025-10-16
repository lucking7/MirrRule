/**
 * 镜像同步配置
 * 定义需要同步的上游仓库和处理规则
 */

import path from 'node:path';
import { FileType } from './types';
import type { MirrorGroup } from './types';

// CommonJS 中的 __dirname 直接可用

/**
 * 输出根目录
 */
const OUTPUT_ROOT = path.join(__dirname, '../../../public/Mirror');

/**
 * iRingo 后处理：替换 Proxy 参数为 United States
 */
function postProcessIRingo(filePath: string, content: string): string {
  if (!filePath.endsWith('.sgmodule')) {
    return content;
  }

  // 替换 #!arguments= 行中的 Proxy 参数
  return content.replaceAll(/^(#!arguments=.*Proxy:)[^\n,]*/gm, '$1United States');
}

/**
 * 镜像配置组
 */
export const MIRROR_GROUPS: MirrorGroup[] = [
  // iRingo / NSRingo 项目
  {
    name: 'iRingo',
    repositories: [
      {
        repo: 'NSRingo/WeatherKit',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      },
      {
        repo: 'NSRingo/News',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      },
      {
        repo: 'NSRingo/Testflight',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      },
      {
        repo: 'NSRingo/GeoServices',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      },
      {
        repo: 'NSRingo/Siri',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      },
      {
        repo: 'NSRingo/TV',
        outputDir: path.join(OUTPUT_ROOT, 'iRingo'),
        allowedTypes: [FileType.PLUGIN, FileType.SGMODULE, FileType.SNIPPET, FileType.STOVERRIDE],
        postProcess: postProcessIRingo
      }
    ],
    extraDownloads: [
      {
        url: 'https://raw.githubusercontent.com/NSRingo/Siri/dev/debug/Siri.V2.beta.sgmodule',
        outputPath: path.join(OUTPUT_ROOT, 'iRingo/sgmodule/Siri.V2.beta.sgmodule')
      },
      {
        url: 'https://raw.githubusercontent.com/NSRingo/Siri/dev/debug/Siri.V2.macOS.beta.sgmodule',
        outputPath: path.join(OUTPUT_ROOT, 'iRingo/sgmodule/Siri.V2.macOS.beta.sgmodule')
      }
    ]
  },

  // DualSubs 项目
  {
    name: 'DualSubs',
    repositories: [
      {
        repo: 'DualSubs/YouTube',
        outputDir: path.join(OUTPUT_ROOT, 'DualSubs'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'DualSubs/Universal',
        outputDir: path.join(OUTPUT_ROOT, 'DualSubs'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'DualSubs/Netflix',
        outputDir: path.join(OUTPUT_ROOT, 'DualSubs'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'DualSubs/Spotify',
        outputDir: path.join(OUTPUT_ROOT, 'DualSubs'),
        allowedTypes: [FileType.SGMODULE]
      }
    ]
  },

  // BiliUniverse 项目
  {
    name: 'BiliUniverse',
    repositories: [
      {
        repo: 'BiliUniverse/Global',
        outputDir: path.join(OUTPUT_ROOT, 'BiliUniverse'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'BiliUniverse/Redirect',
        outputDir: path.join(OUTPUT_ROOT, 'BiliUniverse'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'BiliUniverse/Enhanced',
        outputDir: path.join(OUTPUT_ROOT, 'BiliUniverse'),
        allowedTypes: [FileType.SGMODULE]
      },
      {
        repo: 'BiliUniverse/ADBlock',
        outputDir: path.join(OUTPUT_ROOT, 'BiliUniverse'),
        allowedTypes: [FileType.SGMODULE]
      }
    ]
  }
];

/**
 * 获取所有仓库列表
 */
export function getAllRepositories() {
  return MIRROR_GROUPS.flatMap(group => group.repositories);
}

/**
 * 获取所有额外下载项
 */
export function getAllExtraDownloads() {
  return MIRROR_GROUPS.flatMap(group => group.extraDownloads || []);
}

/**
 * 根据名称获取镜像组
 */
export function getMirrorGroup(name: string): MirrorGroup | undefined {
  return MIRROR_GROUPS.find(group => group.name === name);
}
