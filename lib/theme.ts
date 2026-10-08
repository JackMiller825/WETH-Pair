export const THEME_KEY = "weth-theme"

export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
] as const

export type ThemeId = (typeof THEMES)[number]["id"]

export function isThemeId(value: string | null): value is ThemeId {
  return value === "dark" || value === "light" || value === "system"
}

/** Runs before paint so the saved theme is already applied. */
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"dark";if(t!=="dark"&&t!=="light"&&t!=="system")t="dark";var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",dark);document.documentElement.dataset.theme=t;}catch(e){}})();`

export function applyTheme(theme: ThemeId) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.dataset.theme = theme
  localStorage.setItem(THEME_KEY, theme)
}
