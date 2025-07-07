import fs from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';
import { RuleFile } from './rule-types.js';
import { downloadFile } from './utils.js';

export class GeoIPProcessor {
  constructor(private repoPath: string) {}

  /**
   * 处理MMDB文件的下载和验证
   * @param rule MMDB文件规则配置
   */
  async process(rule: RuleFile): Promise<void> {
    try {
      const filePath = path.join(this.repoPath, rule.path);

      console.log(`处理GeoIP MMDB文件: ${rule.path}`);

      // 下载前检查文件是否存在，保存原始校验和
      let originalChecksum: string | null = null;
      if (fs.existsSync(filePath)) {
        originalChecksum = await this.calculateChecksum(filePath);
        console.log(`原始文件校验和: ${originalChecksum}`);
      }

      // 下载文件
      if (rule.url) {
        // 创建临时文件路径
        const tempFilePath = `${filePath}.temp`;

        // 下载到临时文件
        await downloadFile(rule.url, tempFilePath);

        // 验证下载的文件是否为有效的MMDB格式
        if (await this.isValidMMDB(tempFilePath)) {
          // 计算新文件的校验和
          const newChecksum = await this.calculateChecksum(tempFilePath);
          console.log(`新下载文件校验和: ${newChecksum}`);

          // 如果文件有变化或原始文件不存在，则替换
          if (!originalChecksum || originalChecksum !== newChecksum) {
            // 备份原始文件（如果存在）
            if (originalChecksum && fs.existsSync(filePath)) {
              const backupPath = `${filePath}.bak`;
              fs.copyFileSync(filePath, backupPath);
              console.log(`已备份原始文件到: ${backupPath}`);
            }

            // 将临时文件替换为正式文件
            fs.copyFileSync(tempFilePath, filePath);
            console.log(`已更新MMDB文件: ${rule.path}`);
          } else {
            console.log(`MMDB文件没有变化，跳过更新: ${rule.path}`);
          }

          // 删除临时文件
          fs.unlinkSync(tempFilePath);
        } else {
          console.error(`下载的文件不是有效的MMDB格式: ${rule.path}`);
          // 删除无效的临时文件
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
          // 如果原始文件存在，保留原始文件
        }
      }
    } catch (error) {
      console.error(`处理MMDB文件时出错 ${rule.path}:`, error);
      throw error;
    }
  }

  /**
   * 计算文件的SHA256校验和
   * @param filePath 文件路径
   * @returns SHA256校验和字符串
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('error', err => reject(err));
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * 检查文件是否为有效的MMDB格式
   * @param filePath 文件路径
   * @returns 是否为有效的MMDB格式
   */
  private async isValidMMDB(filePath: string): Promise<boolean> {
    try {
      // 读取文件头部
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(16);
      await fd.read(buffer, 0, 16, 0);
      await fd.close();

      // 检查MMDB文件的魔数或特征
      // 注意：这是一个简化的检查，可能需要根据具体MMDB格式调整
      // MaxMind格式通常以二进制数据开头，而不是ASCII文本

      // 检查文件不是以常见文本格式开头
      const isText =
        buffer.toString('ascii', 0, 7) === 'DOMAIN,' ||
        buffer.toString('ascii', 0, 1) === '#' ||
        buffer.toString('ascii', 0, 2) === '//';

      return !isText;
    } catch (error) {
      console.error(`检查MMDB格式时出错:`, error);
      return false;
    }
  }
}
