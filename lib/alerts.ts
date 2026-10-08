type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

/** Must be called from a click so the browser allows sound later. */
export function createAudioContext(): AudioContext | null {
  const Context = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
  if (!Context) return null
  try {
    const context = new Context()
    void context.resume()
    return context
  } catch {
    return null
  }
}

export type AlertSound = "beep" | "chime" | "pulse"

const ALERT_TONES: Record<AlertSound, number[]> = {
  beep: [880, 1320],
  chime: [523, 659, 784],
  pulse: [220, 330, 220],
}

/** Two short rising beeps. */
export function playAlertTone(context: AudioContext | null) {
  playNamedTone(context, "beep")
}

export function playNamedTone(context: AudioContext | null, name: AlertSound) {
  if (!context) return
  void context.resume()
  const start = context.currentTime
  ALERT_TONES[name].forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const at = start + index * 0.22
    oscillator.type = "sine"
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.2)
  })
}

export type NotificationState = "granted" | "denied" | "default" | "unsupported"

export function notificationState(): NotificationState {
  if (typeof Notification === "undefined") return "unsupported"
  return Notification.permission
}

export async function requestNotifications(): Promise<NotificationState> {
  if (typeof Notification === "undefined") return "unsupported"
  if (Notification.permission !== "default") return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function sendDesktopNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  try {
    const notification = new Notification(title, { body, tag, requireInteraction: true })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  } catch {
    // Some browsers only allow notifications through a service worker.
  }
}
