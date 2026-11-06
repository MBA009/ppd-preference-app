/**
 * What each simulated device does when someone uses it, for the demo console. A control changes the device's
 * state and triggers some of the data flows its research fixture declares (by statement id); a periodic
 * report does the same on a timer. Which of those flows actually leave the device is decided by the household
 * policy the device received (see Simulator.fire), not here.
 *
 * Only controls the real product offers are modelled. PPD devices use only flows they declare (source-linked
 * in the fixture); the TV has no PPD and may use any flow its fixture lists.
 */

export type DeviceState = Record<string, string | number | boolean>

export interface Control {
  id: string
  label: string
  hint: string
  /** Statement ids (the fixture flow id after the device prefix) this control triggers. */
  flows: string[]
  /** The next state, given the current one. */
  apply?: (s: DeviceState) => DeviceState
}

export interface DeviceModel {
  initial: DeviceState
  /** How the state reads on the console, in order. */
  show: (s: DeviceState) => [string, string][]
  controls: (s: DeviceState) => Control[]
  /** Sent on its own while the device is on, every `seconds`. */
  periodic?: { seconds: number; label: string; flows: string[]; when?: (s: DeviceState) => boolean; apply?: (s: DeviceState) => DeviceState }
}

const round = (n: number) => Math.round(n * 10) / 10
const jitter = (n: number, by: number) => round(n + (Math.random() - 0.5) * by)

export const MODELS: Record<string, DeviceModel> = {
  // Aqara Thermostat Hub W200: a wall thermostat with a touch screen, presence radar and the Aqara Home app.
  'aqara-w200': {
    initial: { setpoint: 21, room: 22.4, humidity: 41, occupied: false },
    show: (s) => [['Set to', `${s.setpoint} °C`], ['Room', `${s.room} °C · ${s.humidity} %`], ['Someone in the room', s.occupied ? 'Yes' : 'No']],
    controls: (s) => [
      {
        id: 'warmer', label: 'Turn it up 1 °C', hint: 'On the thermostat’s screen',
        flows: ['linked-temperature-sensor-input-for-hvac-control', 'climate-environment-data-used-for-adaptive-hvac', 'device-usage-history-sent-to-aqara-services'],
        apply: (x) => ({ ...x, setpoint: Number(x.setpoint) + 1 }),
      },
      {
        id: 'cooler', label: 'Turn it down 1 °C', hint: 'On the thermostat’s screen',
        flows: ['linked-temperature-sensor-input-for-hvac-control', 'climate-environment-data-used-for-adaptive-hvac', 'device-usage-history-sent-to-aqara-services'],
        apply: (x) => ({ ...x, setpoint: Number(x.setpoint) - 1 }),
      },
      {
        id: 'remote', label: 'Change it from the Aqara app', hint: 'Away from home, through Aqara’s cloud',
        flows: ['device-usage-history-sent-to-aqara-services'],
        apply: (x) => ({ ...x, setpoint: 20 }),
      },
      {
        id: 'presence', label: s.occupied ? 'Everyone leaves the room' : 'Someone walks in', hint: 'The radar notices it; heating follows presence',
        flows: ['built-in-mmwave-presence-occupancy-sensing', 'presence-data-used-for-follow-presence-adaptive-hvac'],
        apply: (x) => ({ ...x, occupied: !x.occupied }),
      },
      {
        id: 'app', label: 'Open the Aqara app on a phone', hint: 'The app reads the phone’s location and shares usage',
        flows: ['precise-mobile-geolocation-collected-for-location-based-analysis', 'aqara-service-app-usage-activity-shared-with-analytics'],
      },
    ],
    periodic: {
      seconds: 30, label: 'Climate reading',
      flows: ['linked-temperature-sensor-input-for-hvac-control', 'linked-humidity-sensor-input-for-climate-balancing', 'device-diagnostics-logs-status-sent-to-aqara'],
      apply: (x) => ({ ...x, room: jitter(Number(x.setpoint) + 0.8, 0.6), humidity: Math.round(jitter(41, 4)) }),
    },
  },

  // Reolink E1 Zoom: an indoor pan-tilt camera with local AI detection, microSD recording and the Reolink app.
  'reolink-e1-zoom': {
    initial: { last_detection: 'None yet', recording: false },
    show: (s) => [['Last detection', String(s.last_detection)], ['Recording to microSD', s.recording ? 'Yes' : 'No']],
    controls: () => [
      {
        id: 'person', label: 'A person walks past', hint: 'Detected on the camera; alert and clip',
        flows: ['video-capture-from-camera-sensor', 'person-event-inferred-by-local-ai', 'local-microsd-video-recording-playback',
          'device-alert-event-information-sent-for-push-notifications', 'email-alert-event-sent-when-email-alerts-are', 'cloud-video-upload-when-reolink-cloud-is-enabled'],
        apply: (x) => ({ ...x, last_detection: 'Person', recording: true }),
      },
      {
        id: 'pet', label: 'The dog walks past', hint: 'Detected on the camera; alert',
        flows: ['video-capture-from-camera-sensor', 'pet-event-inferred-by-local-ai', 'device-alert-event-information-sent-for-push-notifications'],
        apply: (x) => ({ ...x, last_detection: 'Pet' }),
      },
      {
        id: 'live', label: 'Watch live from the Reolink app', hint: 'Video and sound through Reolink',
        flows: ['live-recorded-video-delivered-through-reolink-remote-app', 'optional-reolink-app-usage-analytics-experience-program-telemetry'],
      },
      {
        id: 'display', label: 'Show it on a smart display', hint: 'Alexa or Google display',
        flows: ['live-video-shared-to-alexa-google-assistant-display'],
      },
    ],
  },

  // Level Lock: a smart deadbolt with Bluetooth, Matter and the Level Home app.
  'level-lock': {
    initial: { locked: true, battery: 87 },
    show: (s) => [['Door', s.locked ? 'Locked' : 'Unlocked'], ['Battery', `${s.battery} %`]],
    controls: (s) => [
      {
        id: 'door', label: s.locked ? 'Unlock at the door' : 'Lock at the door', hint: 'By hand, key or touch',
        flows: ['lock-unlock-event-recorded-by-the-lock', 'lock-unlock-activity-communicated-to-level-services', 'lock-state-shared-with-matter-ecosystem'],
        apply: (x) => ({ ...x, locked: !x.locked }),
      },
      {
        id: 'remote', label: s.locked ? 'Unlock from the Level app' : 'Lock from the Level app', hint: 'Away from home, through Level',
        flows: ['remote-lock-unlock-command-through-level-app', 'lock-state-activity-returned-to-level-service', 'lock-state-shared-with-matter-ecosystem'],
        apply: (x) => ({ ...x, locked: !x.locked }),
      },
      {
        id: 'arrive', label: 'Arrive home (Auto Unlock)', hint: 'The phone’s location unlocks the door',
        flows: ['mobile-geolocation-collected-for-home-away-boundary-features', 'geofence-state-used-for-auto-unlock-touch-to', 'lock-unlock-event-recorded-by-the-lock', 'lock-unlock-activity-communicated-to-level-services'],
        apply: (x) => ({ ...x, locked: false }),
      },
      {
        id: 'matter', label: s.locked ? 'Unlock with a voice assistant' : 'Lock with a voice assistant', hint: 'Through Matter',
        flows: ['matter-ecosystem-lock-unlock-command-received', 'lock-unlock-event-recorded-by-the-lock', 'lock-state-shared-with-matter-ecosystem'],
        apply: (x) => ({ ...x, locked: !x.locked }),
      },
    ],
    periodic: {
      seconds: 60, label: 'Status report',
      flows: ['device-software-battery-status-telemetry-sent-to-level', 'device-serial-stable-device-identifier-sent-to-level'],
      apply: (x) => ({ ...x, battery: Math.max(5, Number(x.battery) - (Math.random() < 0.2 ? 1 : 0)) }),
    },
  },

  // LG OLED C6 TV: no PPD. It never receives the household's rules, so everything it does goes out.
  'lg-oled65c6pua-c6': {
    initial: { on: false, watching: 'Nothing' },
    show: (s) => [['Power', s.on ? 'On' : 'Off'], ['Watching', String(s.watching)]],
    controls: (s) => [
      { id: 'power', label: s.on ? 'Turn off' : 'Turn on', hint: 'With the remote', flows: [], apply: (x) => ({ ...x, on: !x.on, watching: x.on ? 'Nothing' : x.watching }) },
      ...(s.on
        ? [
            {
              id: 'watch', label: 'Watch a show', hint: 'ACR recognises what is on screen',
              flows: ['acr-audio-fingerprint-derived-from-program-audio-when', 'viewing-information-derived-through-acr', 'acr-viewing-information-shared-with-lg-ad-solutions',
                'acr-audience-data-used-for-interest-based-advertising', 'acr-related-viewing-data-shared-with-advertiser-for'],
              apply: (x: DeviceState) => ({ ...x, watching: 'A cooking show' }),
            },
            {
              id: 'voice', label: 'Ask the voice remote', hint: '“Find comedies”',
              flows: ['user-activated-voice-audio-captured-by-tv-remote', 'voice-audio-transferred-for-speech-recognition-when-enabled', 'voice-recognition-result-derived-from-activated-voice-interaction'],
            },
          ]
        : []),
    ],
    periodic: {
      seconds: 30, label: 'While watching', when: (s) => !!s.on && s.watching !== 'Nothing',
      flows: ['viewing-information-derived-through-acr', 'acr-related-viewing-data-shared-with-advertiser-for', 'smart-tv-device-software-network-telemetry-for-service'],
    },
  },
}
