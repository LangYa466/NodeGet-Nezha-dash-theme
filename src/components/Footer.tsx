import { useEffect, useState } from "react"

const PROJECT_URL = "https://github.com/LangYa466/NodeGet-Nezha-dash-theme"

declare const __APP_VERSION__: string

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

const Footer = () => {
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"
  const currentYear = new Date().getFullYear()
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(/macintosh|mac os x/i.test(navigator.userAgent))
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
          <FooterLink href={PROJECT_URL}>v{version}</FooterLink>
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
