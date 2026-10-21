import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Device, DeviceSummary, Questionnaire } from '../../shared/types'

/**
 * The research fixtures that tools/build_mock.py writes to public/mock/. They are read once at start-up;
 * restart app-api after regenerating them.
 */
export interface Fixtures {
  questionnaire: Questionnaire
  library: DeviceSummary[]
  devices: Map<string, Device>
  codes: Record<string, string>
  household: { devices: { device_id: string; added_at: string }[] }
}

async function readJson<T>(dir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(dir, file), 'utf8')) as T
}

export async function loadFixtures(dir: string): Promise<Fixtures> {
  const [questionnaire, library, codes, household] = await Promise.all([
    readJson<Questionnaire>(dir, 'questionnaire.json'),
    readJson<{ devices: DeviceSummary[] }>(dir, 'library.json'),
    readJson<{ codes: Record<string, string> }>(dir, 'codes.json'),
    readJson<Fixtures['household']>(dir, 'household.json'),
  ])
  // Every library entry has a declaration file, named after its id.
  const devices = new Map<string, Device>()
  for (const summary of library.devices) {
    devices.set(summary.id, await readJson<Device>(dir, path.join('devices', `${summary.id}.json`)))
  }
  return { questionnaire, library: library.devices, devices, codes: codes.codes, household }
}
