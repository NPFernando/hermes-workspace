import { MODEL_PRESET_MAP } from './hub-constants'

export function resolveGatewayModelId(modelId: string): string {
  if (Object.prototype.hasOwnProperty.call(MODEL_PRESET_MAP, modelId)) {
    return MODEL_PRESET_MAP[modelId] ?? ''
  }
  return modelId
}
