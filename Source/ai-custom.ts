/**
 * 自定义 AI 规则补充
 * 这些规则会合并到 ai.list
 */

export interface AIService {
  name: string;
  /** 规则描述/备注 */
  description?: string;
  rules: string[];
}

// ============================================
// OpenAI 补充规则
// ============================================
const OPENAI_EXTRA: AIService = {
  name: 'OpenAI Extra',
  description: '官方规则可能遗漏的 OpenAI 相关域名',
  rules: [
    // 示例：添加你发现的新域名
    // 'DOMAIN-SUFFIX,openai.com',
  ],
};

// ============================================
// Anthropic (Claude) 补充规则
// ============================================
const CLAUDE_EXTRA: AIService = {
  name: 'Claude Extra',
  description: 'Anthropic Claude 相关补充',
  rules: [
    // 'DOMAIN-SUFFIX,anthropic.com',
    // 'DOMAIN-SUFFIX,claude.ai',
  ],
};

// ============================================
// Google AI 补充规则
// ============================================
const GOOGLE_AI_EXTRA: AIService = {
  name: 'Google AI Extra',
  description: 'Google Gemini/Bard 相关补充',
  rules: [
    // 'DOMAIN-SUFFIX,gemini.google.com',
    // 'DOMAIN-SUFFIX,bard.google.com',
  ],
};

// ============================================
// 其他 AI 服务
// ============================================
const OTHER_AI: AIService = {
  name: 'Other AI Services',
  description: '其他 AI 平台和服务',
  rules: [
    // Perplexity
    // 'DOMAIN-SUFFIX,perplexity.ai',

    // Midjourney
    // 'DOMAIN-SUFFIX,midjourney.com',

    // Stability AI
    // 'DOMAIN-SUFFIX,stability.ai',

    // Hugging Face
    // 'DOMAIN-SUFFIX,huggingface.co',

    // Replicate
    // 'DOMAIN-SUFFIX,replicate.com',

    // Runway
    // 'DOMAIN-SUFFIX,runwayml.com',
  ],
};

// ============================================
// 导出所有规则
// ============================================
export const ALL: AIService[] = [
  OPENAI_EXTRA,
  CLAUDE_EXTRA,
  GOOGLE_AI_EXTRA,
  OTHER_AI,
];

/**
 * 获取所有规则（扁平化）
 */
export function getAllRules(): string[] {
  return ALL.flatMap(service => service.rules).filter(rule => rule.length > 0);
}

/**
 * 获取所有规则（按服务分组，带注释）
 */
export function getRulesWithComments(): string[] {
  const result: string[] = [];

  for (const service of ALL) {
    const validRules = service.rules.filter(rule => rule.length > 0);
    if (validRules.length === 0) continue;

    // 添加服务名称作为注释
    result.push(`# ${service.name}${service.description ? ` - ${service.description}` : ''}`, ...validRules, ''); // 空行分隔
  }

  return result;
}
