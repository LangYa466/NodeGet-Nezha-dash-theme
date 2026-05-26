import { formatBytes } from "@/lib/format"
import { PublicNoteData, cn } from "@/lib/utils"
import { NezhaServer } from "@/types/nezha-api"
import { useTranslation } from "react-i18next"

import { Progress } from "./ui/progress"

type TrafficInfoProps = {
  parsedData: PublicNoteData
  serverInfo: NezhaServer
}

export default function TrafficInfo({ parsedData, serverInfo }: TrafficInfoProps) {
  const { t } = useTranslation()

  if (!parsedData?.planDataMod) return null

  const { trafficType, trafficVolBytes } = parsedData.planDataMod
  if (!trafficVolBytes || trafficVolBytes <= 0) return null

  const netIn = serverInfo.state?.net_in_transfer || 0
  const netOut = serverInfo.state?.net_out_transfer || 0

  let usedBytes = 0
  switch (trafficType?.toLowerCase()) {
    case "sum":
      usedBytes = netIn + netOut
      break
    case "max":
      usedBytes = Math.max(netIn, netOut)
      break
    case "min":
      usedBytes = Math.min(netIn, netOut)
      break
    case "up":
      usedBytes = netOut
      break
    case "down":
      usedBytes = netIn
      break
    default:
      usedBytes = netIn + netOut
      break
  }

  const percentage = Math.min((usedBytes / trafficVolBytes) * 100, 100)

  return (
    <section className="flex flex-col gap-0.5 w-full">
      <div className="flex items-center justify-between">
        <p className={cn("text-[9px] text-muted-foreground")}>
          {t("trafficInfo.used")}: {formatBytes(usedBytes)} / {formatBytes(trafficVolBytes)}
        </p>
        <p className={cn("text-[9px] text-muted-foreground")}>{percentage.toFixed(1)}%</p>
      </div>
      <Progress
        value={percentage}
        className="h-1.5 w-full"
        indicatorClassName={cn(
          percentage < 60 ? "bg-green-500" : percentage < 80 ? "bg-yellow-500" : "bg-red-500",
        )}
      />
    </section>
  )
}
