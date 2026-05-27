import { useEffect, useState } from "react"

const PROJECT_URL = "https://github.com/LangYa466/NodeGet-Nezha-dash-theme"
const REPO_API = "https://api.github.com/repos/LangYa466/NodeGet-Nezha-dash-theme/commits/main"
const CACHE_KEY = "nodeget-update-check"
const CACHE_TTL = 30 * 60 * 1000

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __APP_COMMIT_DATE__: string

type UpdateState = {
  hasUpdate: boolean
  remoteSha: string
  remoteDate: string
}

type CachedCheck = UpdateState & { checkedAt: number; localSha: string }

type LinkProps = {
  href: string
  children: React.ReactNode
}

const FooterLink = ({ href, children }: LinkProps) => (
  <a
    href={href}
    target="_blank"
    className="cursor-pointer font-normal underline decoration-2 decoration-yellow-500 underline-offset-2 transition-colors hover:decoration-yellow-600 dark:decoration-yellow-500/60 dark:hover:decoration-yellow-500/80"
    rel="noreferrer"
  >
    {children}
  </a>
)

const baseTextStyles =
  "text-[13px] font-light tracking-tight text-neutral-600/50 dark:text-neutral-300/50"

const readCache = (): CachedCheck | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as CachedCheck) : null
  } catch {
    return null
  }
}

const writeCache = (data: CachedCheck) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // ignore quota / privacy mode
  }
}

const localSha = typeof __APP_COMMIT__ !== "undefined" ? __APP_COMMIT__ : ""
const localDate = typeof __APP_COMMIT_DATE__ !== "undefined" ? __APP_COMMIT_DATE__ : ""

const Footer = () => {
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"
  const currentYear = new Date().getFullYear()
  const [isMac, setIsMac] = useState(true)
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => {
    setIsMac(/macintosh|mac os x/i.test(navigator.userAgent))
  }, [])

  useEffect(() => {
    if (!localSha) return

    const cached = readCache()
    if (cached && cached.localSha === localSha && Date.now() - cached.checkedAt < CACHE_TTL) {
      setUpdate({ hasUpdate: cached.hasUpdate, remoteSha: cached.remoteSha, remoteDate: cached.remoteDate })
      return
    }

    const controller = new AbortController()
    fetch(REPO_API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.sha) return
        const remoteSha: string = data.sha
        const remoteDate: string = data.commit?.committer?.date ?? data.commit?.author?.date ?? ""
        const hasUpdate =
          remoteSha !== localSha &&
          (!localDate || !remoteDate || new Date(remoteDate).getTime() > new Date(localDate).getTime())
        const next = { hasUpdate, remoteSha, remoteDate }
        setUpdate(next)
        writeCache({ ...next, checkedAt: Date.now(), localSha })
      })
      .catch(() => {})

    return () => controller.abort()
  }, [])

  return (
    <footer className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 lg:px-0 pb-4 server-footer">
      <section className="flex flex-col server-footer-name">
        <p className={`mt-3 flex flex-wrap items-center gap-1 ${baseTextStyles}`}>
          <FooterLink href="https://github.com/LangYa466/">狼牙</FooterLink>
          给
          <FooterLink href="https://nodeget.com/">NodeGet</FooterLink>
          开发的
          <FooterLink href={`${PROJECT_URL}`}>NodeGet-Nezha-dash-theme</FooterLink>
        </p>
        <section className={`mt-1 flex items-center gap-2 ${baseTextStyles}`}>
          © {currentYear}
          <FooterLink href={PROJECT_URL}>v{localSha ? localSha.slice(0, 7) : version}</FooterLink>
          {update?.hasUpdate && (
            <a
              href={PROJECT_URL}
              target="_blank"
              rel="noreferrer"
              title={update.remoteDate ? `最新提交 ${update.remoteSha.slice(0, 7)} · ${new Date(update.remoteDate).toLocaleString()}` : update.remoteSha.slice(0, 7)}
              className="inline-flex items-center rounded border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-[1px] text-[10px] font-medium text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-400"
            >
              有更新
            </a>
          )}
        </section>
      </section>
      <p className={`mt-1 ${baseTextStyles}`}>
        <kbd className="pointer-events-none mx-1 inline-flex h-4 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium font-mono text-[10px] text-muted-foreground opacity-100">
          {isMac ? <span className="text-xs">⌘</span> : "Ctrl "}K
        </kbd>
      </p>
    </footer>
  )
}

export default Footer
