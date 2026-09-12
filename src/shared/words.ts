export function ago(moment: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - moment))
  if (seconds < 60) return 'právě teď'
  if (seconds < 3600) return `před ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `před ${Math.floor(seconds / 3600)} h`
  return `před ${Math.floor(seconds / 86400)} d`
}

export function inWords(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 3600) return `${Math.floor(whole / 60)} min`
  if (whole < 86400) return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`
  return `${Math.floor(whole / 86400)} d ${Math.floor((whole % 86400) / 3600)} h`
}

export function clock(moment: number): string {
  return new Date(moment * 1000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
}
