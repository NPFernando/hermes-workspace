// Interface for Novus optimization suggestions
export interface NovusSuggestion {
  suggestedModel: string;
  potentialSavingsPercent: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Detects when a task could be optimized by using free Novus/Ollama models instead of paid models
 * @param taskContext Context about the task including type, risk level, and description
 * @returns NovusSuggestion if optimization is possible, null otherwise
 */
export function detectNovusOpportunity(taskContext: {
  type: string;
  risk: string;
  description?: string;
}): NovusSuggestion | null {
  const { type, risk, description } = taskContext;
  
  // Normalize inputs
  const normalizedType = type.toLowerCase().trim();
  const normalizedRisk = risk.toLowerCase().trim();
  
  // Tasks NOT suitable for local execution (require paid models)
  const unsuitableTypes = [
    'code_generation',
    'debugging',
    'audit',
    'deployment',
    'security_scan',
    'architecture_design',
    'complex_reasoning',
    'multi_step_plan'
  ];
  
  if (unsuitableTypes.some(unsuitable => normalizedType.includes(unsuitable))) {
    return null;
  }
  
  // Tasks that are suitable for local execution with Novus/Ollama
  const suitableTypes = [
    'text_summary',
    'documentation',
    'structured_output',
    'file_read',
    'status_check',
    'basic_explanation',
    'simple_query',
    'data_extraction',
    'format_conversion'
  ];
  
  // Check if task type matches suitable patterns
  const isSuitableType = suitableTypes.some(suitable => 
    normalizedType.includes(suitable) || 
    isSimilarTaskType(normalizedType, suitable)
  );
  
  if (!isSuitableType) {
    // Check for similar patterns in description if type is unclear
    if (description) {
      const descLower = description.toLowerCase();
      const summaryKeywords = ['summarize', 'summary', 'tl;dr', 'brief', 'overview'];
      const docKeywords = ['document', 'doc', 'readme', 'guide', 'explain'];
      const formatKeywords = ['format', 'convert', 'transform', 'parse'];
      
      if (summaryKeywords.some(k => descLower.includes(k)) || 
          docKeywords.some(k => descLower.includes(k)) ||
          formatKeywords.some(k => descLower.includes(k))) {
        // Found suitable pattern in description
      } else {
        return null; // Not suitable for optimization
      }
    } else {
      return null; // No clear indication of suitability
    }
  }
  
  // Risk assessment - only suggest Novus for low/standard risk tasks
  const highRiskLevels = ['complex', 'high_risk', 'production', 'critical'];
  if (highRiskLevels.some(level => normalizedRisk.includes(level))) {
    return null; // Too risky for local model
  }
  
  // Determine the suggested model based on task characteristics
  let suggestedModel = 'hermes3:8b'; // Default Novus model
  let baseSavings = 80; // Base savings percentage
  
  // Adjust model and savings based on task complexity
  if (normalizedType.includes('summary') || normalizedType.includes('documentation')) {
    suggestedModel = 'hermes3:8b';
    baseSavings = 85;
  } else if (normalizedType.includes('structured') || normalizedType.includes('format')) {
    suggestedModel = 'hermes3:8b';
    baseSavings = 75;
  } else {
    suggestedModel = 'hermes3:8b';
    baseSavings = 70;
  }
  
  // Calculate confidence level
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  
  // High confidence for exact matches
  if (suitableTypes.some(st => normalizedType === st)) {
    confidence = 'high';
  } 
  // Lower confidence for inferred matches
  else if (description && 
           (description.toLowerCase().includes('summarize') || 
            description.toLowerCase().includes('document') ||
            description.toLowerCase().includes('format'))) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  // Adjust savings based on confidence
  const potentialSavingsPercent = Math.round(baseSavings * 
    (confidence === 'high' ? 1.0 : confidence === 'medium' ? 0.85 : 0.7));
  
  // Generate reason
  const reason = generateReason(normalizedType, normalizedRisk, suggestedModel, potentialSavingsPercent);
  
  return {
    suggestedModel,
    potentialSavingsPercent,
    confidence,
    reason
  };
}

/**
 * Helper function to check if task types are similar (for fuzzy matching)
 */
function isSimilarTaskType(type: string, target: string): boolean {
  const typeWords = type.split(/[_\s-]+/);
  const targetWords = target.split(/[_\s-]+/);
  
  // Check for significant word overlap
  const overlap = typeWords.filter(word => targetWords.includes(word)).length;
  return overlap >= Math.min(typeWords.length, targetWords.length) * 0.5;
}

/**
 * Helper function to calculate savings percentage based on confidence and risk
 */
function calculateSavings(confidence: 'high' | 'medium' | 'low', risk: string): number {
  const baseByConfidence = {
    high: 90,
    medium: 75,
    low: 60
  };
  
  let base = baseByConfidence[confidence] || 75;
  
  // Adjust for risk (even within acceptable levels)
  if (risk.includes('standard')) {
    base -= 5;
  } // low risk gets full bonus
  
  return Math.max(base, 50); // Never less than 50% savings
}

/**
 * Generate human-readable reason for the suggestion
 */
function generateReason(type: string, risk: string, model: string, savings: number): string {
  const typeMap: Record<string, string> = {
    'text_summary': 'text summarization',
    'documentation': 'documentation writing',
    'structured_output': 'structured data formatting',
    'file_read': 'file reading operations',
    'status_check': 'system status checks',
    'basic_explanation': 'basic concept explanations',
    'simple_query': 'simple information queries',
    'data_extraction': 'data extraction tasks',
    'format_conversion': 'format conversion operations'
  };
  
  const readableType = typeMap[type] || type.replace(/_/g, ' ');
  
  return `Task involves ${readableType} (${risk} risk). Using ${model} can save approximately ${savings}% on costs while maintaining adequate quality for this use case.`;
}

