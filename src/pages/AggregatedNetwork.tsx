// 模仿 hamster1963/nezha-dash 的 AggregatedNetworkCharts 实现：
// 列出所有在线服务器  支持单选/多选  对每个选中的服务器渲染一份 NetworkChart
import { NetworkChart } from "@/components/NetworkChart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useWebSocketContext } from "@/hooks/use-websocket-context"
import { cn, formatNezhaInfo } from "@/lib/utils"
import type { NezhaServer, NezhaWebsocketResponse } from "@/types/nezha-api"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

type SelectionMode = "single" | "multi"

export default function AggregatedNetwork() {
  const { t } = useTranslation()
  const { lastMessage, connected } = useWebSocketContext()

  const nezhaWsData: NezhaWebsocketResponse | null = useMemo(() => {
    if (!lastMessage) return null
    try {
      return JSON.parse(lastMessage.data) as NezhaWebsocketResponse
    } catch {
      return null
    }
  }, [lastMessage])

  // 在线 + 稳定排序 display_index 倒序 id 升序
  const onlineServers = useMemo(() => {
    if (!nezhaWsData?.servers) return []
    const now = nezhaWsData.now
    return nezhaWsData.servers
      .map(s => ({ s, info: formatNezhaInfo(now, s) }))
      .filter(({ info }) => info.online)
      .sort((a, b) => {
        const d = (b.s.display_index || 0) - (a.s.display_index || 0)
        return d !== 0 ? d : a.s.id - b.s.id
      })
      .map(({ s }) => s)
  }, [nezhaWsData])

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("single")
  const [selectedServers, setSelectedServers] = useState<number[]>([])

  // 默认选中第一台在线机器
  useEffect(() => {
    if (onlineServers.length > 0 && selectedServers.length === 0) {
      setSelectedServers([onlineServers[0].id])
    }
  }, [onlineServers, selectedServers.length])

  // 清理掉离线的选择
  useEffect(() => {
    if (!selectedServers.length) return
    const onlineIds = new Set(onlineServers.map(s => s.id))
    const valid = selectedServers.filter(id => onlineIds.has(id))
    if (valid.length !== selectedServers.length) setSelectedServers(valid)
  }, [onlineServers, selectedServers])

  const handleModeChange = useCallback(
    (mode: SelectionMode) => {
      setSelectionMode(mode)
      if (mode === "single" && selectedServers.length > 1) {
        setSelectedServers([selectedServers[0]])
      } else if (mode === "multi" && selectedServers.length === 0 && onlineServers.length > 0) {
        setSelectedServers([onlineServers[0].id])
      }
    },
    [selectedServers, onlineServers],
  )

  const toggleServer = useCallback((id: number, checked: boolean) => {
    setSelectedServers(prev => (checked ? [...prev, id] : prev.filter(x => x !== id)))
  }, [])

  const selectSingle = useCallback((id: number) => {
    setSelectedServers([id])
  }, [])

  if (!connected && !nezhaWsData) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="font-medium text-sm opacity-40">{t("info.processing", "Loading...")}</p>
      </div>
    )
  }

  if (!onlineServers.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <p className="font-medium text-sm opacity-40">{t("offline", "No online servers")}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">{t("network.serverSelection", "Server Selection")}</CardTitle>
              <CardDescription>
                {selectionMode === "multi"
                  ? t("network.selectMulti", "Pick multiple servers to compare")
                  : t("network.selectSingle", "Pick a server to view")}
              </CardDescription>
            </div>
            <div className="flex rounded-full bg-muted p-1 w-fit">
              <Button
                variant={selectionMode === "single" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleModeChange("single")}
                className={cn("h-8 rounded-full px-3 text-xs", selectionMode === "single" && "shadow-sm")}
              >
                {t("network.single", "Single")}
              </Button>
              <Button
                variant={selectionMode === "multi" ? "default" : "ghost"}
                size="sm"
                onClick={() => handleModeChange("multi")}
                className={cn("h-8 rounded-full px-3 text-xs", selectionMode === "multi" && "shadow-sm")}
              >
                {t("network.multi", "Multi")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="max-h-72 overflow-y-auto">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {onlineServers.map((server: NezhaServer) =>
                selectionMode === "multi" ? (
                  <Label
                    key={server.id}
                    htmlFor={`server-${server.id}`}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-sm border bg-background p-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="flex-1 truncate font-medium text-sm leading-none">{server.name}</span>
                    <Switch
                      id={`server-${server.id}`}
                      checked={selectedServers.includes(server.id)}
                      onCheckedChange={(c) => toggleServer(server.id, c)}
                    />
                  </Label>
                ) : (
                  <label
                    key={server.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-sm border bg-background p-3 transition-colors hover:bg-muted/50",
                      selectedServers[0] === server.id && "border-primary",
                    )}
                  >
                    <input
                      type="radio"
                      name="agg-net-server"
                      className="size-4 accent-primary"
                      checked={selectedServers[0] === server.id}
                      onChange={() => selectSingle(server.id)}
                    />
                    <span className="flex-1 truncate font-medium text-sm leading-none">{server.name}</span>
                  </label>
                ),
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedServers.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8">
          <p className="font-medium text-sm opacity-40">{t("network.noSelection", "No servers selected")}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...new Set(selectedServers)].map(id => (
            <NetworkChart key={id} server_id={id} />
          ))}
        </div>
      )}
    </div>
  )
}
