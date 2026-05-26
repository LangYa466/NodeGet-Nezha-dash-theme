import { Card, CardContent } from "@/components/ui/card"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { formatBytes } from "@/lib/format"
import { LoadRecord, fetchLoadRecords } from "@/lib/nodeget"
import { cn, formatNezhaInfo, formatRelativeTime } from "@/lib/utils"
import { NezhaServer, NezhaWebsocketResponse } from "@/types/nezha-api"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { ServerDetailChartLoading } from "./loading/ServerDetailLoading"
import AnimatedCircularProgressBar from "./ui/animated-circular-progress-bar"

type gpuChartData = {
  timeStamp: string
  gpu: number
}

type cpuChartData = {
  timeStamp: string
  cpu: number
}

type processChartData = {
  timeStamp: string
  process: number
}

type diskChartData = {
  timeStamp: string
  disk: number
}

type memChartData = {
  timeStamp: string
  mem: number
  swap: number
}

type networkChartData = {
  timeStamp: string
  upload: number
  download: number
}

type connectChartData = {
  timeStamp: string
  tcp: number
  udp: number
}

// 与 komari 原生面板一致的时间范围选项
export type ChartRange = "realtime" | "4h" | "1d" | "7d" | "30d"

const RANGE_OPTIONS: { key: ChartRange; label: string; hours: number }[] = [
  { key: "realtime", label: "RealTime", hours: 0 },
  { key: "4h", label: "4 Hours", hours: 4 },
  { key: "1d", label: "1 Day", hours: 24 },
  { key: "7d", label: "7 Day", hours: 24 * 7 },
  { key: "30d", label: "30 Day", hours: 24 * 30 },
]

// 根据时间范围格式化 X 轴刻度：实时显示相对时间，历史显示具体时刻/日期
function formatChartTime(ts: number, range: ChartRange): string {
  if (range === "realtime") return formatRelativeTime(ts)
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, "0")
  if (range === "4h" || range === "1d") return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 悬浮弹窗中各数据系列的显示名称
const TIP_LABELS: Record<string, string> = {
  cpu: "CPU",
  gpu: "GPU",
  process: "Process",
  disk: "Disk",
  mem: "Mem",
  swap: "Swap",
  upload: "Upload",
  download: "Download",
  tcp: "TCP",
  udp: "UDP",
}

// 按数据系列格式化悬浮弹窗里的数值（百分比 / 速率 / 计数）
function formatTipValue(name: string, value: number): string {
  if (name === "cpu" || name === "gpu" || name === "disk" || name === "mem" || name === "swap") {
    return `${value.toFixed(2)}%`
  }
  if (name === "upload" || name === "download") {
    return value >= 1024 ? `${(value / 1024).toFixed(2)}G/s` : value >= 1 ? `${value.toFixed(2)}M/s` : `${(value * 1024).toFixed(2)}K/s`
  }
  return `${Math.round(value)}`
}

// 悬浮弹窗标题的时间格式：实时显示时分秒，历史显示完整日期
function formatTipTime(ts: number, range: ChartRange): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, "0")
  if (range === "realtime") return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 复用 NetworkChart 的悬浮弹窗实现，鼠标移上去显示精确数值
function renderChartTooltip(range: ChartRange) {
  return (
    <ChartTooltip
      isAnimationActive={false}
      content={
        <ChartTooltipContent
          indicator="line"
          labelKey="timeStamp"
          labelFormatter={(_, payload) => formatTipTime(Number(payload?.[0]?.payload?.timeStamp), range)}
          formatter={(value, name) => (
            <div className="flex flex-1 items-center justify-between gap-3 leading-none">
              <span className="text-muted-foreground">{TIP_LABELS[name as string] ?? (name as string)}</span>
              <span className="font-medium text-foreground tabular-nums">{formatTipValue(name as string, Number(value))}</span>
            </div>
          )}
        />
      }
    />
  )
}

// 时间范围切换条，样式与 TabSwitch 保持一致
function ChartRangeSwitch({ range, setRange }: { range: ChartRange; setRange: (r: ChartRange) => void }) {
  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  return (
    <div className="flex items-center justify-center">
      <div
        className={cn("flex flex-wrap items-center justify-center gap-1 rounded-[50px] bg-stone-100 p-[3px] dark:bg-stone-800", {
          "bg-stone-100/70 dark:bg-stone-800/70": customBackgroundImage,
        })}
      >
        {RANGE_OPTIONS.map((opt) => (
          <button
            type="button"
            key={opt.key}
            onClick={() => setRange(opt.key)}
            className={cn(
              "rounded-3xl px-2.5 py-[7px] text-[13px] font-[600] whitespace-nowrap transition-colors duration-200",
              range === opt.key
                ? "bg-white text-black shadow-lg shadow-black/5 dark:bg-stone-700 dark:text-white dark:shadow-white/5"
                : "text-stone-400 dark:text-stone-500",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function ServerDetailChart({ server_id }: { server_id: string }) {
  const { lastMessage, connected, messageHistory } = useWebSocketContext()
  // 详情页只显示实时图表 不暴露时间范围切换 想看历史去网络那一栏
  const range: ChartRange = "realtime"
  const isRealtime = true
  const loadData: LoadRecord[] = []

  if (!connected && !lastMessage) {
    return <ServerDetailChartLoading />
  }

  const nezhaWsData = lastMessage ? (JSON.parse(lastMessage.data) as NezhaWebsocketResponse) : null

  if (!nezhaWsData) {
    return <ServerDetailChartLoading />
  }

  const server = nezhaWsData.servers.find((s) => s.id === Number(server_id))

  if (!server) {
    return <ServerDetailChartLoading />
  }

  const gpuStats = server.state.gpu || []
  const gpuList = server.host.gpu || []

  return (
    <div className="flex flex-col gap-3">
      {!isRealtime && loadData.length === 0 ? (
        <ServerDetailChartLoading />
      ) : (
        <section className="grid md:grid-cols-2 lg:grid-cols-3 grid-cols-1 gap-3 server-charts">
          <CpuChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
          {gpuStats.length >= 1 && gpuList.length === gpuStats.length ? (
            gpuList.map((gpu, index) => (
              <GpuChart
                index={index}
                id={server.id}
                now={nezhaWsData.now}
                gpuStat={gpuStats[index]}
                gpuName={gpu}
                messageHistory={messageHistory}
                range={range}
                loadData={loadData}
                key={index}
              />
            ))
          ) : gpuStats.length > 0 ? (
            gpuStats.map((gpu, index) => (
              <GpuChart
                index={index}
                id={server.id}
                now={nezhaWsData.now}
                gpuStat={gpu}
                gpuName={`#${index + 1}`}
                messageHistory={messageHistory}
                range={range}
                loadData={loadData}
                key={index}
              />
            ))
          ) : (
            <></>
          )}
          <ProcessChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
          <DiskChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
          <MemChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
          <NetworkChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
          <ConnectChart now={nezhaWsData.now} data={server} messageHistory={messageHistory} range={range} loadData={loadData} />
        </section>
      )}
    </div>
  )
}

function GpuChart({
  id,
  index,
  gpuStat,
  gpuName,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  id: number
  index: number
  gpuStat: number
  gpuName?: string
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const [gpuChartData, setGpuChartData] = useState<gpuChartData[]>([])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === id)
          if (!server) return null
          const { gpu } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            gpu: gpu[index],
          }
        })
        .filter((item): item is gpuChartData => item !== null)
        .reverse()

      setGpuChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  useEffect(() => {
    if (gpuStat && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setGpuChartData((prevData) => {
        let newData = [] as gpuChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, gpu: gpuStat },
            { timeStamp: timestamp, gpu: gpuStat },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, gpu: gpuStat }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [gpuStat, historyLoaded, isRealtime])

  // 历史模式下的图表数据
  const historyData = useMemo<gpuChartData[]>(
    () => loadData.map((r) => ({ timeStamp: String(r.time), gpu: r.gpu })),
    [loadData],
  )

  const displayData = isRealtime ? gpuChartData : historyData

  const chartConfig = {
    gpu: {
      label: "GPU",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <section className="flex flex-col items-center gap-2">
              {!gpuName && <p className="text-md font-medium">GPU</p>}
              {gpuName && <p className="text-xs mt-1 mb-1.5">GPU: {gpuName}</p>}
            </section>
            <section className="flex items-center gap-2">
              <p className="text-xs text-end w-10 font-medium">{gpuStat.toFixed(2)}%</p>
              <AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={gpuStat} primaryColor="hsl(var(--chart-3))" />
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <AreaChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              {renderChartTooltip(range)}
              <Area isAnimationActive={false} dataKey="gpu" type="step" fill="hsl(var(--chart-3))" fillOpacity={0.3} stroke="hsl(var(--chart-3))" />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function CpuChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const [cpuChartData, setCpuChartData] = useState<cpuChartData[]>([])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const { cpu } = formatNezhaInfo(now, data)

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { cpu } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            cpu: cpu,
          }
        })
        .filter((item): item is cpuChartData => item !== null)
        .reverse() // 保持时间顺序

      setCpuChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 更新实时数据
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setCpuChartData((prevData) => {
        let newData = [] as cpuChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, cpu: cpu },
            { timeStamp: timestamp, cpu: cpu },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, cpu: cpu }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  const historyData = useMemo<cpuChartData[]>(
    () => loadData.map((r) => ({ timeStamp: String(r.time), cpu: r.cpu })),
    [loadData],
  )

  const displayData = isRealtime ? cpuChartData : historyData

  const chartConfig = {
    cpu: {
      label: "CPU",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-md font-medium">CPU</p>
            <section className="flex items-center gap-2">
              <p className="text-xs text-end w-10 font-medium">{cpu.toFixed(2)}%</p>
              <AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={cpu} primaryColor="hsl(var(--chart-1))" />
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <AreaChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              {renderChartTooltip(range)}
              <Area isAnimationActive={false} dataKey="cpu" type="step" fill="hsl(var(--chart-1))" fillOpacity={0.3} stroke="hsl(var(--chart-1))" />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function ProcessChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const { t } = useTranslation()
  const [processChartData, setProcessChartData] = useState([] as processChartData[])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const { process } = formatNezhaInfo(now, data)

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { process } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            process,
          }
        })
        .filter((item): item is processChartData => item !== null)
        .reverse()

      setProcessChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 修改实时数据更新逻辑
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setProcessChartData((prevData) => {
        let newData = [] as processChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, process },
            { timeStamp: timestamp, process },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, process }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  const historyData = useMemo<processChartData[]>(
    () => loadData.map((r) => ({ timeStamp: String(r.time), process: r.process })),
    [loadData],
  )

  const displayData = isRealtime ? processChartData : historyData

  const chartConfig = {
    process: {
      label: "Process",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-md font-medium">{t("serverDetailChart.process")}</p>
            <section className="flex items-center gap-2">
              <p className="text-xs text-end w-10 font-medium">{process}</p>
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <AreaChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} />
              {renderChartTooltip(range)}
              <Area
                isAnimationActive={false}
                dataKey="process"
                type="step"
                fill="hsl(var(--chart-2))"
                fillOpacity={0.3}
                stroke="hsl(var(--chart-2))"
              />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function MemChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const { t } = useTranslation()
  const [memChartData, setMemChartData] = useState([] as memChartData[])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const { mem, swap } = formatNezhaInfo(now, data)

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { mem, swap } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            mem,
            swap,
          }
        })
        .filter((item): item is memChartData => item !== null)
        .reverse()

      setMemChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 修改实时数据更新逻辑
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setMemChartData((prevData) => {
        let newData = [] as memChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, mem, swap },
            { timeStamp: timestamp, mem, swap },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, mem, swap }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  // 历史记录里可能缺少总量字段，回退到当前主机信息
  const historyData = useMemo<memChartData[]>(
    () =>
      loadData.map((r) => {
        const memTotal = r.ram_total || data.host.mem_total || 0
        const swapTotal = r.swap_total || data.host.swap_total || 0
        return {
          timeStamp: String(r.time),
          mem: memTotal ? (r.ram / memTotal) * 100 : 0,
          swap: swapTotal ? (r.swap / swapTotal) * 100 : 0,
        }
      }),
    [loadData, data.host.mem_total, data.host.swap_total],
  )

  const displayData = isRealtime ? memChartData : historyData

  const chartConfig = {
    mem: {
      label: "Mem",
    },
    swap: {
      label: "Swap",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <section className="flex items-center gap-4">
              <div className="flex flex-col">
                <p className=" text-xs text-muted-foreground">{t("serverDetailChart.mem")}</p>
                <div className="flex items-center gap-2">
                  <AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={mem} primaryColor="hsl(var(--chart-8))" />
                  <p className="text-xs font-medium">{mem.toFixed(0)}%</p>
                </div>
              </div>
              <div className="flex flex-col">
                <p className=" text-xs text-muted-foreground">{t("serverDetailChart.swap")}</p>
                <div className="flex items-center gap-2">
                  <AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={swap} primaryColor="hsl(var(--chart-10))" />
                  <p className="text-xs font-medium">{swap.toFixed(0)}%</p>
                </div>
              </div>
            </section>
            <section className="flex flex-col items-end gap-0.5">
              <div className="flex text-[11px] font-medium items-center gap-2">
                {formatBytes(data.state.mem_used)} / {formatBytes(data.host.mem_total)}
              </div>
              <div className="flex text-[11px] font-medium items-center gap-2">
                {data.host.swap_total ? (
                  <>
                    swap: {formatBytes(data.state.swap_used)} / {formatBytes(data.host.swap_total)}
                  </>
                ) : (
                  <>no swap</>
                )}
              </div>
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <AreaChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              {renderChartTooltip(range)}
              <Area isAnimationActive={false} dataKey="mem" type="step" fill="hsl(var(--chart-8))" fillOpacity={0.3} stroke="hsl(var(--chart-8))" />
              <Area
                isAnimationActive={false}
                dataKey="swap"
                type="step"
                fill="hsl(var(--chart-10))"
                fillOpacity={0.3}
                stroke="hsl(var(--chart-10))"
              />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function DiskChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const { t } = useTranslation()
  const [diskChartData, setDiskChartData] = useState([] as diskChartData[])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const { disk } = formatNezhaInfo(now, data)

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { disk } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            disk,
          }
        })
        .filter((item): item is diskChartData => item !== null)
        .reverse()

      setDiskChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 修改实时数据更新逻辑
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setDiskChartData((prevData) => {
        let newData = [] as diskChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, disk },
            { timeStamp: timestamp, disk },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, disk }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  const historyData = useMemo<diskChartData[]>(
    () =>
      loadData.map((r) => {
        const diskTotal = r.disk_total || data.host.disk_total || 0
        return {
          timeStamp: String(r.time),
          disk: diskTotal ? (r.disk / diskTotal) * 100 : 0,
        }
      }),
    [loadData, data.host.disk_total],
  )

  const displayData = isRealtime ? diskChartData : historyData

  const chartConfig = {
    disk: {
      label: "Disk",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <p className="text-md font-medium">{t("serverDetailChart.disk")}</p>
            <section className="flex flex-col items-end gap-0.5">
              <section className="flex items-center gap-2">
                <p className="text-xs text-end w-10 font-medium">{disk.toFixed(0)}%</p>
                <AnimatedCircularProgressBar className="size-3 text-[0px]" max={100} min={0} value={disk} primaryColor="hsl(var(--chart-5))" />
              </section>
              <div className="flex text-[11px] font-medium items-center gap-2">
                {formatBytes(data.state.disk_used)} / {formatBytes(data.host.disk_total)}
              </div>
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <AreaChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
              {renderChartTooltip(range)}
              <Area isAnimationActive={false} dataKey="disk" type="step" fill="hsl(var(--chart-5))" fillOpacity={0.3} stroke="hsl(var(--chart-5))" />
            </AreaChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function NetworkChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const { t } = useTranslation()
  const [networkChartData, setNetworkChartData] = useState([] as networkChartData[])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const { up, down } = formatNezhaInfo(now, data)

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { up, down } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            upload: up,
            download: down,
          }
        })
        .filter((item): item is networkChartData => item !== null)
        .reverse()

      setNetworkChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 修改实时数据更新逻辑
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setNetworkChartData((prevData) => {
        let newData = [] as networkChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, upload: up, download: down },
            { timeStamp: timestamp, upload: up, download: down },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, upload: up, download: down }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  // komari 记录中 net_in/net_out 为字节/秒，换算为 M/s
  const historyData = useMemo<networkChartData[]>(
    () =>
      loadData.map((r) => ({
        timeStamp: String(r.time),
        upload: r.net_out / 1024 / 1024,
        download: r.net_in / 1024 / 1024,
      })),
    [loadData],
  )

  const displayData = isRealtime ? networkChartData : historyData

  let maxDownload = Math.max(...displayData.map((item) => item.download))
  maxDownload = Math.ceil(maxDownload)
  if (maxDownload < 1) {
    maxDownload = 1
  }

  const chartConfig = {
    upload: {
      label: "Upload",
    },
    download: {
      label: "Download",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center">
            <section className="flex items-center gap-4">
              <div className="flex flex-col w-20">
                <p className="text-xs text-muted-foreground">{t("serverDetailChart.upload")}</p>
                <div className="flex items-center gap-1">
                  <span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-1))]"></span>
                  <p className="text-xs font-medium">
                    {up >= 1024 ? `${(up / 1024).toFixed(2)}G/s` : up >= 1 ? `${up.toFixed(2)}M/s` : `${(up * 1024).toFixed(2)}K/s`}
                  </p>
                </div>
              </div>
              <div className="flex flex-col w-20">
                <p className=" text-xs text-muted-foreground">{t("serverDetailChart.download")}</p>
                <div className="flex items-center gap-1">
                  <span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-4))]"></span>
                  <p className="text-xs font-medium">
                    {down >= 1024 ? `${(down / 1024).toFixed(2)}G/s` : down >= 1 ? `${down.toFixed(2)}M/s` : `${(down * 1024).toFixed(2)}K/s`}
                  </p>
                </div>
              </div>
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <LineChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                mirror={true}
                tickMargin={-15}
                type="number"
                minTickGap={50}
                interval="preserveStartEnd"
                domain={[1, maxDownload]}
                tickFormatter={(value) => `${value.toFixed(0)}M/s`}
              />
              {renderChartTooltip(range)}
              <Line isAnimationActive={false} dataKey="upload" type="linear" stroke="hsl(var(--chart-1))" strokeWidth={1} dot={false} />
              <Line isAnimationActive={false} dataKey="download" type="linear" stroke="hsl(var(--chart-4))" strokeWidth={1} dot={false} />
            </LineChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}

function ConnectChart({
  now,
  data,
  messageHistory,
  range,
  loadData,
}: {
  now: number
  data: NezhaServer
  messageHistory: { data: string }[]
  range: ChartRange
  loadData: LoadRecord[]
}) {
  const [connectChartData, setConnectChartData] = useState([] as connectChartData[])
  const hasInitialized = useRef(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const isRealtime = range === "realtime"

  const customBackgroundImage = (window.CustomBackgroundImage as string) !== "" ? window.CustomBackgroundImage : undefined

  const { tcp, udp } = formatNezhaInfo(now, data)

  // 初始化历史数据
  useEffect(() => {
    if (!hasInitialized.current && messageHistory.length > 0) {
      const historyData = messageHistory
        .map((msg) => {
          const wsData = JSON.parse(msg.data) as NezhaWebsocketResponse
          const server = wsData.servers.find((s) => s.id === data.id)
          if (!server) return null
          const { tcp, udp } = formatNezhaInfo(wsData.now, server)
          return {
            timeStamp: wsData.now.toString(),
            tcp,
            udp,
          }
        })
        .filter((item): item is connectChartData => item !== null)
        .reverse()

      setConnectChartData(historyData)
      hasInitialized.current = true
      setHistoryLoaded(true)
    }
  }, [messageHistory])

  // 修改实时数据更新逻辑
  useEffect(() => {
    if (data && historyLoaded && isRealtime) {
      const timestamp = Date.now().toString()
      setConnectChartData((prevData) => {
        let newData = [] as connectChartData[]
        if (prevData.length === 0) {
          newData = [
            { timeStamp: timestamp, tcp, udp },
            { timeStamp: timestamp, tcp, udp },
          ]
        } else {
          newData = [...prevData, { timeStamp: timestamp, tcp, udp }]
          if (newData.length > 30) {
            newData.shift()
          }
        }
        return newData
      })
    }
  }, [data, historyLoaded, isRealtime])

  const historyData = useMemo<connectChartData[]>(
    () => loadData.map((r) => ({ timeStamp: String(r.time), tcp: r.connections, udp: r.connections_udp })),
    [loadData],
  )

  const displayData = isRealtime ? connectChartData : historyData

  const chartConfig = {
    tcp: {
      label: "TCP",
    },
    udp: {
      label: "UDP",
    },
  } satisfies ChartConfig

  return (
    <Card
      className={cn({
        "bg-card/70": customBackgroundImage,
      })}
    >
      <CardContent className="px-6 py-3">
        <section className="flex flex-col gap-1">
          <div className="flex items-center">
            <section className="flex items-center gap-4">
              <div className="flex flex-col w-12">
                <p className="text-xs text-muted-foreground">TCP</p>
                <div className="flex items-center gap-1">
                  <span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-1))]"></span>
                  <p className="text-xs font-medium">{tcp}</p>
                </div>
              </div>
              <div className="flex flex-col w-12">
                <p className=" text-xs text-muted-foreground">UDP</p>
                <div className="flex items-center gap-1">
                  <span className="relative inline-flex  size-1.5 rounded-full bg-[hsl(var(--chart-4))]"></span>
                  <p className="text-xs font-medium">{udp}</p>
                </div>
              </div>
            </section>
          </div>
          <ChartContainer config={chartConfig} className="aspect-auto h-[130px] w-full">
            <LineChart
              accessibilityLayer
              data={displayData}
              margin={{
                top: 12,
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="timeStamp"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={200}
                interval="preserveStartEnd"
                tickFormatter={(value) => formatChartTime(Number(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} mirror={true} tickMargin={-15} type="number" interval="preserveStartEnd" />
              {renderChartTooltip(range)}
              <Line isAnimationActive={false} dataKey="tcp" type="linear" stroke="hsl(var(--chart-1))" strokeWidth={1} dot={false} />
              <Line isAnimationActive={false} dataKey="udp" type="linear" stroke="hsl(var(--chart-4))" strokeWidth={1} dot={false} />
            </LineChart>
          </ChartContainer>
        </section>
      </CardContent>
    </Card>
  )
}
