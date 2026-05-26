import { cn } from "@/lib/utils"
import { m } from "framer-motion"
import { type RefObject, createRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

type IndicatorRect = { x: number; y: number; width: number; height: number }

export default function TabSwitch({ tabs, currentTab, setCurrentTab }: { tabs: string[]; currentTab: string; setCurrentTab: (tab: string) => void }) {
  const { t } = useTranslation()
  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const listRef = useRef<HTMLDivElement>(null)

  // 标签数量变化时保持 ref 数组长度一致
  const tagRefs = useRef<RefObject<HTMLDivElement>[]>([])
  if (tagRefs.current.length !== tabs.length) {
    tagRefs.current = tabs.map((_, i) => tagRefs.current[i] ?? createRef<HTMLDivElement>())
  }

  // 单一持久化滑块：测量当前标签位置后由 framer-motion 平滑跟随，
  // 切换时不再卸载/重建元素，连续快速点击也不会闪烁。
  const [indicator, setIndicator] = useState<IndicatorRect | null>(null)

  const measureIndicator = useCallback(() => {
    const el = tagRefs.current[tabs.indexOf(currentTab)]?.current
    if (!el) return
    setIndicator({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
  }, [tabs, currentTab])

  useLayoutEffect(() => {
    measureIndicator()
  }, [measureIndicator])

  // 列表尺寸变化（字体加载、容器宽度变动等）时重新对齐
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measureIndicator())
    observer.observe(list)
    return () => observer.disconnect()
  }, [measureIndicator])

  return (
    <div className="z-50 flex flex-col items-start rounded-[50px] server-info-tab">
      <div
        ref={listRef}
        className={cn("relative flex items-center gap-1 rounded-[50px] bg-stone-100 p-[3px] dark:bg-stone-800", {
          "bg-stone-100/70 dark:bg-stone-800/70": customBackgroundImage,
        })}
      >
        {indicator && (
          <m.div
            className="absolute left-0 top-0 z-10 bg-white shadow-lg shadow-black/5 dark:bg-stone-700 dark:shadow-white/5"
            style={{ borderRadius: 46 }}
            initial={{ x: indicator.x, y: indicator.y, width: indicator.width, height: indicator.height }}
            animate={{ x: indicator.x, y: indicator.y, width: indicator.width, height: indicator.height }}
            transition={{ type: "spring", stiffness: 400, damping: 34, mass: 0.7 }}
          />
        )}
        {tabs.map((tab: string, index: number) => (
          <div
            key={tab}
            ref={tagRefs.current[index]}
            onClick={() => setCurrentTab(tab)}
            className={cn(
              "relative z-20 cursor-pointer rounded-3xl px-2.5 py-[8px] text-[13px] font-[600] transition-colors duration-200",
              currentTab === tab ? "text-black dark:text-white" : "text-stone-400 dark:text-stone-500",
            )}
          >
            <div className="flex items-center gap-1">
              <p className="whitespace-nowrap">{t("tabSwitch." + tab)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
