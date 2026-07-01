import { useCallback, useEffect, useState } from 'react'

export type PersonalityPreset = { key: string; label: string; description: string; prompt: string }
export type WorkerRec = { workerId: string; name: string; role: string; recommendedPreset: string; presetLabel: string; isMain: boolean }
export type SwarmPersonalityData = { presets: Array<PersonalityPreset>; recommendations: Array<WorkerRec> }

// Extracted from ProfilesScreen: all state + fetch effects for the 4-step
// Create Profile wizard (name/clone, model, personality+swarm, review).
// Returns the same names the component already used via destructuring, so
// the wizard's JSX (steps 1-4) and handleCreate() didn't need to change.
export function useProfileWizard(createOpen: boolean) {
  const [newProfileName, setNewProfileName] = useState('')
  const [wizardStep, setWizardStep] = useState(1)
  const [cloneFrom, setCloneFrom] = useState('')
  const [wizardProvider, setWizardProvider] = useState('')
  const [wizardModel, setWizardModel] = useState('')
  const [allModels, setAllModels] = useState<
    Array<{ id: string; name?: string; provider?: string }>
  >([])
  const [loadingModels, setLoadingModels] = useState(false)
  // Personality + swarm step
  const [wizardPersonality, setWizardPersonality] = useState('')
  const [wizardSelectedPreset, setWizardSelectedPreset] = useState('')
  const [wizardEnableSwarm, setWizardEnableSwarm] = useState(false)
  const [swarmData, setSwarmData] = useState<SwarmPersonalityData | null>(null)
  const [loadingSwarm, setLoadingSwarm] = useState(false)
  const [workerPresets, setWorkerPresets] = useState<Record<string, string>>({})

  const fetchAllModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const result = (await res.json()) as {
          models?: Array<{ id: string; name?: string; provider?: string }>
        }
        setAllModels(result.models || [])
      }
    } catch {
      /* ignore */
    }
    setLoadingModels(false)
  }, [])

  useEffect(() => {
    if (createOpen && wizardStep === 2 && allModels.length === 0) {
      void fetchAllModels()
    }
  }, [createOpen, wizardStep, allModels.length, fetchAllModels])

  useEffect(() => {
    if (createOpen && wizardStep === 3 && !swarmData) {
      setLoadingSwarm(true)
      fetch('/api/personality-swarm')
        .then((r) => r.json())
        .then((data: SwarmPersonalityData & { ok?: boolean }) => {
          if (data.ok !== false) {
            setSwarmData(data)
            // Pre-fill recommended presets
            const defaults: Record<string, string> = {}
            for (const rec of data.recommendations ?? []) {
              defaults[rec.workerId] = rec.recommendedPreset
            }
            setWorkerPresets(defaults)
          }
        })
        .catch(() => {
          /* ignore */
        })
        .finally(() => setLoadingSwarm(false))
    }
  }, [createOpen, wizardStep, swarmData])

  const resetWizard = useCallback(() => {
    setNewProfileName('')
    setCloneFrom('')
    setWizardProvider('')
    setWizardModel('')
    setWizardStep(1)
    setAllModels([])
    setWizardPersonality('')
    setWizardSelectedPreset('')
    setWizardEnableSwarm(false)
    setSwarmData(null)
    setWorkerPresets({})
  }, [])

  return {
    newProfileName, setNewProfileName,
    wizardStep, setWizardStep,
    cloneFrom, setCloneFrom,
    wizardProvider, setWizardProvider,
    wizardModel, setWizardModel,
    allModels, setAllModels,
    loadingModels,
    wizardPersonality, setWizardPersonality,
    wizardSelectedPreset, setWizardSelectedPreset,
    wizardEnableSwarm, setWizardEnableSwarm,
    swarmData, setSwarmData,
    loadingSwarm,
    workerPresets, setWorkerPresets,
    resetWizard,
  }
}
