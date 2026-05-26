"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { fetchMonitor } from "@/lib/nodeget"
import { cn, formatTime } from "@/lib/utils"
import { NezhaMonitor, ServerMonitorChart } from "@/types/nezha-api"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import { useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import NetworkChartLoading from "./NetworkChartLoading"
import { Label } from "./ui/label"
import { Switch } from "./ui/switch"

interface ResultItem {
  created_at: number
  [key: string]: number | null
}

/**
 * Helper method to calculate packet loss from delay data
 */
/**
 * Calculate packet loss from delay data.
 * Since the API uses -1 for failed probes (filtered out before reaching here),
 * all values in the delays array are valid responses (including 0 = sub-1ms).
 * Without real per-point loss data, we simply return 0% for all points.
 */
const calculatePacketLoss = (delays: number[]): number[] => {
  if (!delays || delays.length === 0) return []
  return delays.map(() => 0)
}

/**
 * 自愈错误边界：NetworkChart 渲染若意外抛错，不向上冒泡崩溃整页，
 * 改为显示加载态，并在数秒后自动复位重试（react-query 仍在后台轮询新数据）。
 */
class NetworkChartErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  private resetTimer?: ReturnType<typeof setTimeout>

  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    this.resetTimer = setTimeout(() => this.setState({ hasError: false }), 3000)
  }

  componentWillUnmount() {
    if (this.resetTimer) clearTimeout(this.resetTimer)
  }

  render() {
    if (this.state.hasError) return <NetworkChartLoading />
    return this.props.children
  }
}

export function NetworkChart({ server_id }: { server_id: number }) {
  return (
    <NetworkChartErrorBoundary>
      <NetworkChartInner server_id={server_id} />
    </NetworkChartErrorBoundary>
  )
}

function NetworkChartInner({ server_id }: { server_id: number }) {
  const { t } = useTranslation()
  // 固定 1 小时窗口 不再暴露时间切换
  const hours = 1

  const { data: monitorData } = useQuery({
    queryKey: ["monitor", server_id, hours],
    queryFn: () => fetchMonitor(server_id, hours),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: 10000,
    retry: true,
    retryDelay: 3000,
  })

  if (!monitorData) {
    return (
      <div className="flex flex-col gap-3">
        <NetworkChartLoading />
      </div>
    )
  }

  if (!monitorData.data || !Array.isArray(monitorData.data) || monitorData.data.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center justify-center">
          <p className="text-sm font-medium opacity-40"></p>
          <p className="text-sm font-medium opacity-40 mb-4">{t("monitor.noData")}</p>
        </div>
        <NetworkChartLoading />
      </div>
    )
  }

  const transformedData = transformData(monitorData.data)

  const formattedData = formatData(monitorData.data)

  const chartDataKey = Object.keys(transformedData)

  const initChartConfig = {
    avg_delay: {
      label: t("monitor.avgDelay"),
    },
    ...chartDataKey.reduce((acc, key) => {
      acc[key] = {
        label: key,
      }
      return acc
    }, {} as ChartConfig),
  } satisfies ChartConfig

  return (
    <div className="flex flex-col gap-3">
      <NetworkChartClient
        chartDataKey={chartDataKey}
        chartConfig={initChartConfig}
        chartData={transformedData}
        serverName={monitorData.data[0]?.server_name ?? ""}
        formattedData={formattedData}
      />
    </div>
  )
}

const getDelayColor = (delay: number): string => {
  if (delay < 100) return "text-green-500"
  if (delay < 200) return "text-yellow-500"
  return "text-red-500"
}

const getPacketLossColor = (loss: number): string => {
  if (loss < 1) return "text-green-500"
  if (loss < 5) return "text-yellow-500"
  return "text-red-500"
}

const getJitterColor = (jitter: number): string => {
  if (jitter < 0.25) return "text-green-500"
  if (jitter < 0.50) return "text-yellow-500"
  return "text-red-500"
}

// Logistic 归一化波动：取最近 60 个有效样本（约 1 小时），结果在 [0, 1)
// k=30 表示 P95-P50=30ms 时波动值为 0.50
const calcJitter = (delays: number[]): number => {
  const window = delays.filter((d) => d > 0).slice(-60)
  if (window.length < 2) return 0
  const sorted = [...window].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.50)]
  const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)]
  const diff = p95 - p50
  const k = 30
  return diff / (diff + k)
}

export const NetworkChartClient = React.memo(function NetworkChart({
  chartDataKey,
  chartConfig,
  chartData,
  serverName,
  formattedData,
}: {
  chartDataKey: string[]
  chartConfig: ChartConfig
  chartData: ServerMonitorChart
  serverName: string
  formattedData: ResultItem[]
}) {
  const { t } = useTranslation()

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const forcePeakCutEnabled = (window.ForcePeakCutEnabled as boolean) ?? false

  // @ts-expect-error ColorizeMonitorMetrics is a global variable
  const colorizeMonitorMetrics = window.ColorizeMonitorMetrics as boolean

  // Change from string to string array for multi-selection
  const [activeCharts, setActiveCharts] = React.useState<string[]>([])
  const [hiddenCharts, setHiddenCharts] = React.useState<Set<string>>(new Set())
  const [isPeakEnabled, setIsPeakEnabled] = React.useState(forcePeakCutEnabled)

  // Function to clear all selected charts
  const clearAllSelections = useCallback(() => {
    setActiveCharts([])
  }, [])

  // Toggle legend item visibility
  const handleLegendClick = useCallback((dataKey: string) => {
    setHiddenCharts((prev) => {
      const next = new Set(prev)
      if (next.has(dataKey)) {
        next.delete(dataKey)
      } else {
        next.add(dataKey)
      }
      return next
    })
  }, [])

  // Updated to handle multiple selections
  const handleButtonClick = useCallback((chart: string) => {
    setHiddenCharts(new Set())
    setActiveCharts((prev) => {
      // If chart is already selected, remove it
      if (prev.includes(chart)) {
        return prev.filter((c) => c !== chart)
      }
      // Otherwise, add it to selected charts
      return [...prev, chart]
    })
  }, [])

  const getColorByIndex = useCallback(
    (chart: string) => {
      const index = chartDataKey.indexOf(chart)
      return `hsl(var(--chart-${(index % 10) + 1}))`
    },
    [chartDataKey],
  )

  const chartButtons = useMemo(
    () =>
      chartDataKey.map((key) => {
        const monitorData = chartData[key]
        // Find latest valid (non-null) delay for display
        let lastDelay: number | null = null
        for (let i = monitorData.length - 1; i >= 0; i--) {
          if (monitorData[i].avg_delay !== null) {
            lastDelay = monitorData[i].avg_delay
            break
          }
        }

        // Calculate average packet loss if available
        const packetLossData = monitorData.filter((item) => item.packet_loss !== undefined).map((item) => item.packet_loss!)
        const avgPacketLoss = packetLossData.length > 0 ? packetLossData.reduce((sum, loss) => sum + loss, 0) / packetLossData.length : null

        // Logistic jitter over last ~1 hour (60 samples)
        const allDelays = monitorData.map((item) => item.avg_delay).filter((d): d is number => d !== null)
        const jitter = calcJitter(allDelays)

        return (
          <button
            type="button"
            key={key}
            data-active={activeCharts.includes(key)}
            className={`relative z-30 flex cursor-pointer grow basis-0 flex-col justify-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-6 py-4 text-left data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:px-6`}
            onClick={() => handleButtonClick(key)}
          >
            <span className="whitespace-nowrap text-xs text-muted-foreground">{key}</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-md font-bold leading-none sm:text-lg">
                <span className={cn(colorizeMonitorMetrics && lastDelay !== null && getDelayColor(lastDelay))}>
                  {lastDelay === null ? "--" : lastDelay === 0 ? "<1" : lastDelay.toFixed(1)}
                </span>
                ms
              </span>
              {avgPacketLoss !== null && (
                <span className="text-xs text-muted-foreground">
                  丢包 <span className={cn(colorizeMonitorMetrics && getPacketLossColor(avgPacketLoss))}>{avgPacketLoss.toFixed(1)}%</span>{" "}
                  波动 <span className={cn(colorizeMonitorMetrics && getJitterColor(jitter))}>{jitter.toFixed(2)}</span>
                </span>
              )}
            </div>
          </button>
        )
      }),
    [chartDataKey, activeCharts, chartData, handleButtonClick, colorizeMonitorMetrics],
  )

  const chartElements = useMemo(() => {
    const elements = []

    // If exactly one chart is selected, show delay line and packet loss area
    if (activeCharts.length === 1) {
      const chart = activeCharts[0]
      elements.push(
        <Area
          key="packet-loss-area"
          isAnimationActive={false}
          dataKey="packet_loss"
          stroke="none"
          fill="hsl(45, 100%, 60%)"
          fillOpacity={0.3}
          yAxisId="packet-loss"
        />,
        <Line
          key="delay-line"
          isAnimationActive={false}
          strokeWidth={1}
          type="linear"
          dot={false}
          dataKey="avg_delay"
          stroke={getColorByIndex(chart)}
          yAxisId="delay"
          connectNulls={false}
        />,
      )
    } else if (activeCharts.length > 1) {
      // Multiple charts selected. formatData interpolates across merged
      // timestamps when a monitor is actively probing, and leaves null only
      // for real offline gaps — so connectNulls=false safely produces breaks.
      elements.push(
        ...activeCharts.map((chart) => (
            <Line
              key={chart}
              isAnimationActive={false}
              strokeWidth={1}
              type="linear"
              dot={false}
              dataKey={chart}
              stroke={getColorByIndex(chart)}
              name={chart}
              connectNulls={false}
              yAxisId="delay"
              hide={hiddenCharts.has(chart)}
            />
          )),
      )
    } else {
      // No selection - show all charts (default view). Same rationale as above.
      elements.push(
        ...chartDataKey.map((key) => (
            <Line
              key={key}
              isAnimationActive={false}
              strokeWidth={1}
              type="linear"
              dot={false}
              dataKey={key}
              stroke={getColorByIndex(key)}
              name={key}
              connectNulls={false}
              yAxisId="delay"
              hide={hiddenCharts.has(key)}
            />
          )),
      )
    }

    return elements
  }, [activeCharts, chartDataKey, getColorByIndex, hiddenCharts])

  const processedData = useMemo(() => {
    // Special handling for single chart selection
    let baseData = formattedData
    if (activeCharts.length === 1) {
      const selectedChart = activeCharts[0]
      baseData = chartData[selectedChart].map((item) => ({
        created_at: item.created_at,
        avg_delay: item.avg_delay,
        packet_loss: item.packet_loss ?? 0,
      }))
    }

    if (!isPeakEnabled) {
      return baseData
    }

    // For peak cutting, use the base data
    const data = baseData

    const windowSize = 11 // 增加窗口大小以获取更好的统计效果
    const alpha = 0.3 // EWMA平滑因子

    // 辅助函数：计算中位数
    const getMedian = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    // 辅助函数：异常值处理
    const processValues = (values: number[]) => {
      if (values.length === 0) return null

      const median = getMedian(values)
      const deviations = values.map((v) => Math.abs(v - median))
      const medianDeviation = getMedian(deviations) * 1.4826 // MAD估计器

      // 使用中位数绝对偏差(MAD)进行异常值检测
      const validValues = values.filter(
        (v) =>
          Math.abs(v - median) <= 3 * medianDeviation && // 更严格的异常值判定
          v <= median * 3, // 限制最大值不超过中位数的3倍
      )

      if (validValues.length === 0) return median // 如果没有有效值，返回中位数

      // 计算EWMA
      let ewma = validValues[0]
      for (let i = 1; i < validValues.length; i++) {
        ewma = alpha * validValues[i] + (1 - alpha) * ewma
      }

      return ewma
    }

    // 初始化EWMA历史值
    const ewmaHistory: { [key: string]: number } = {}

    return data.map((point, index) => {
      if (index < windowSize - 1) return point

      const window = data.slice(index - windowSize + 1, index + 1)
      const smoothed = { ...point } as ResultItem

      // Special handling for single chart selection
      if (activeCharts.length === 1) {
        // Process avg_delay for single chart
        const values = window.map((w) => w.avg_delay as number).filter((v) => v !== undefined && v !== null)

        if (values.length > 0) {
          const processed = processValues(values)
          if (processed !== null) {
            if (ewmaHistory.avg_delay === undefined) {
              ewmaHistory.avg_delay = processed
            } else {
              ewmaHistory.avg_delay = alpha * processed + (1 - alpha) * ewmaHistory.avg_delay
            }
            smoothed.avg_delay = ewmaHistory.avg_delay
          }
        }
      } else {
        // Process all chart keys or just the selected ones
        const keysToProcess = activeCharts.length > 0 ? activeCharts : chartDataKey

        keysToProcess.forEach((key) => {
          const values = window.map((w) => w[key]).filter((v) => v !== undefined && v !== null) as number[]

          if (values.length > 0) {
            const processed = processValues(values)
            if (processed !== null) {
              // Apply EWMA smoothing
              if (ewmaHistory[key] === undefined) {
                ewmaHistory[key] = processed
              } else {
                ewmaHistory[key] = alpha * processed + (1 - alpha) * ewmaHistory[key]
              }
              smoothed[key] = ewmaHistory[key]
            }
          }
        })
      }

      return smoothed
    })
  }, [isPeakEnabled, activeCharts, formattedData, chartData, chartDataKey])

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardHeader className="flex flex-col items-stretch space-y-0 p-0 sm:flex-row">
        <div className="flex flex-none flex-col justify-center gap-1 border-b px-6 py-4">
          <CardTitle className="flex flex-none items-center gap-0.5 text-md">{serverName}</CardTitle>
          <CardDescription className="text-xs">
            {chartDataKey.length} {t("monitor.monitorCount")}
          </CardDescription>
          <div className="flex items-center mt-0.5 space-x-2">
            <Switch id="Peak" checked={isPeakEnabled} onCheckedChange={setIsPeakEnabled} />
            <Label className="text-xs leading-normal" htmlFor="Peak">
              Peak cut
            </Label>
          </div>
        </div>
        <div className="flex flex-wrap w-full">{chartButtons}</div>
      </CardHeader>
      <CardContent className="pr-2 pl-0 py-4 sm:pt-6 sm:pb-6 sm:pr-6 sm:pl-2">
        <div className="relative">
          {activeCharts.length > 0 && (
            <button
              type="button"
              className="absolute -top-2 right-1 z-10 text-xs px-2 py-1 bg-stone-100/80 dark:bg-stone-800/80 backdrop-blur-sm rounded-[5px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={clearAllSelections}
            >
              {t("monitor.clearSelections", "Clear")} ({activeCharts.length})
            </button>
          )}
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <ComposedChart accessibilityLayer data={processedData} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="created_at"
                tickLine={true}
                tickSize={3}
                axisLine={false}
                tickMargin={8}
                minTickGap={80}
                ticks={processedData
                  .filter((item, index, array) => {
                    if (array.length < 6) {
                      return index === 0 || index === array.length - 1
                    }

                    // 计算数据的总时间跨度（毫秒）
                    const timeSpan = array[array.length - 1].created_at - array[0].created_at
                    const hours = timeSpan / (1000 * 60 * 60)

                    // 根据时间跨度调整显示间隔
                    if (hours <= 12) {
                      // 12小时内，每60分钟显示一个刻度
                      return index === 0 || index === array.length - 1 || new Date(item.created_at).getMinutes() % 60 === 0
                    }
                    // 超过12小时，每2小时显示一个刻度
                    const date = new Date(item.created_at)
                    return date.getMinutes() === 0 && date.getHours() % 2 === 0
                  })
                  .map((item) => item.created_at)}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  const minutes = date.getMinutes()
                  return minutes === 0 ? `${date.getHours()}:00` : `${date.getHours()}:${minutes}`
                }}
              />
              <YAxis yAxisId="delay" tickLine={false} axisLine={false} tickMargin={15} minTickGap={20} tickFormatter={(value) => `${value}ms`} />
              {activeCharts.length === 1 && (
                <YAxis
                  yAxisId="packet-loss"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={15}
                  minTickGap={20}
                  tickFormatter={(value) => `${value}%`}
                />
              )}
              <ChartTooltip
                isAnimationActive={false}
                content={
                  <ChartTooltipContent
                    indicator={"line"}
                    labelKey="created_at"
                    labelFormatter={(_, payload) => {
                      return formatTime(payload[0].payload.created_at)
                    }}
                    formatter={(value, name) => {
                      let formattedValue: string
                      let label: string

                      const numValue = Number(value)
                      if (name === "packet_loss") {
                        formattedValue = `${numValue.toFixed(2)}%`
                        label = t("monitor.packetLoss", "Packet Loss")
                      } else if (name === "avg_delay") {
                        formattedValue = numValue === 0 ? "<1ms" : `${numValue.toFixed(2)}ms`
                        label = t("monitor.avgDelay", "Avg Delay")
                      } else {
                        // For monitor names (in multi-chart view) - delay data
                        formattedValue = numValue === 0 ? "<1ms" : `${numValue.toFixed(2)}ms`
                        label = name as string
                      }

                      return (
                        <div className="flex flex-1 items-center justify-between leading-none">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="ml-2 font-medium text-foreground tabular-nums">{formattedValue}</span>
                        </div>
                      )
                    }}
                  />
                }
              />
              {activeCharts.length !== 1 && <ChartLegend content={<ChartLegendContent hiddenKeys={hiddenCharts} onClickLegend={handleLegendClick} />} />}
              {chartElements}
            </ComposedChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  )
})

/**
 * Insert null-delay markers into gaps larger than ~3x the median sampling interval.
 * This forces the chart to break the line when the agent was offline (no records reported).
 */
const insertGapMarkers = <T extends { created_at: number; avg_delay: number | null; packet_loss?: number }>(
  points: T[],
): T[] => {
  if (points.length < 2) return points

  const diffs: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = points[i].created_at - points[i - 1].created_at
    if (d > 0) diffs.push(d)
  }
  if (diffs.length === 0) return points

  const sorted = [...diffs].sort((a, b) => a - b)
  const medianInterval = sorted[Math.floor(sorted.length / 2)]
  const gapThreshold = Math.max(medianInterval * 3, 60_000)

  const result: T[] = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const gap = points[i].created_at - points[i - 1].created_at
      if (gap > gapThreshold) {
        result.push({
          ...points[i - 1],
          created_at: points[i - 1].created_at + medianInterval,
          avg_delay: null,
          packet_loss: 0,
        } as T)
      }
    }
    result.push(points[i])
  }
  return result
}

const transformData = (data: NezhaMonitor[]) => {
  const monitorData: ServerMonitorChart = {}

  data.forEach((item) => {
    const monitorName = item.monitor_name

    if (!monitorData[monitorName]) {
      monitorData[monitorName] = []
    }

    // Calculate packet loss from delay data if not provided or if length doesn't match
    const packetLoss =
      item.packet_loss && item.packet_loss.length === item.created_at.length
        ? item.packet_loss
        : calculatePacketLoss(item.avg_delay)

    for (let i = 0; i < item.created_at.length; i++) {
      const loss = packetLoss[i]
      // When probe failed (loss === 100), delay should be null so the delay line breaks
      const delay = loss === 100 ? null : item.avg_delay[i]
      monitorData[monitorName].push({
        created_at: item.created_at[i],
        avg_delay: delay,
        packet_loss: loss,
      })
    }

    monitorData[monitorName] = insertGapMarkers(monitorData[monitorName])
  })

  return monitorData
}

const formatData = (rawData: NezhaMonitor[]) => {
  const result: { [time: number]: ResultItem } = {}

  const allTimes = new Set<number>()
  rawData.forEach((item) => {
    item.created_at.forEach((time) => allTimes.add(time))
  })

  const allTimeArray = Array.from(allTimes).sort((a, b) => a - b)

  rawData.forEach((item) => {
    const { monitor_name, created_at, avg_delay } = item

    // Calculate packet loss if not provided or if length doesn't match
    const packetLoss =
      item.packet_loss && item.packet_loss.length === created_at.length
        ? item.packet_loss
        : calculatePacketLoss(avg_delay)

    // Build this monitor's own probe series (sorted) so we can distinguish
    // "didn't probe at this exact merged timestamp" from "was offline".
    const probes = created_at
      .map((t, i) => ({ t, v: avg_delay[i], l: packetLoss?.[i] ?? 0 }))
      .sort((a, b) => a.t - b.t)
    const probeTimes = probes.map((p) => p.t)

    // Compute median sampling interval for this monitor
    const diffs: number[] = []
    for (let i = 1; i < probes.length; i++) {
      const d = probes[i].t - probes[i - 1].t
      if (d > 0) diffs.push(d)
    }
    const sortedDiffs = [...diffs].sort((a, b) => a - b)
    const medianInterval = sortedDiffs[Math.floor(sortedDiffs.length / 2)] || 60_000
    const gapThreshold = Math.max(medianInterval * 3, 60_000)

    allTimeArray.forEach((time) => {
      if (!result[time]) {
        result[time] = { created_at: time }
      }

      // Binary search: find first probe index with time >= target
      let lo = 0
      let hi = probeTimes.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (probeTimes[mid] < time) lo = mid + 1
        else hi = mid
      }

      let delay: number | null = null
      let loss: number | null = null

      if (lo < probeTimes.length && probeTimes[lo] === time) {
        // Exact match: real probe
        const p = probes[lo]
        delay = p.l === 100 ? null : p.v
        loss = p.l
      } else if (lo > 0 && lo < probeTimes.length) {
        // Between two probes
        const prev = probes[lo - 1]
        const next = probes[lo]
        if (next.t - prev.t <= gapThreshold) {
          // Normal interleaved timestamp → interpolate to keep line smooth
          if (prev.l === 100 || next.l === 100) {
            delay = null
          } else {
            const ratio = (time - prev.t) / (next.t - prev.t)
            delay = prev.v + (next.v - prev.v) * ratio
          }
          loss = 0
        }
        // else: real gap (monitor was offline) → leave as null to break the line
      }
      // else: time is outside this monitor's probe range → null

      result[time][monitor_name] = delay
      result[time][`${monitor_name}_packet_loss`] = loss
    })
  })

  return Object.values(result).sort((a, b) => a.created_at - b.created_at)
}
