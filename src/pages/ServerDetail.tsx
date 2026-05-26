import { NetworkChart } from "@/components/NetworkChart"
import ServerDetailChart from "@/components/ServerDetailChart"
import ServerDetailOverview from "@/components/ServerDetailOverview"
import TabSwitch from "@/components/TabSwitch"
import { Separator } from "@/components/ui/separator"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

export default function ServerDetail() {
  const navigate = useNavigate()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" })
  }, [])

  // @ts-expect-error MergeDetailAndNetwork is a global variable
  const mergePages = window.MergeDetailAndNetwork as boolean
  // @ts-expect-error NetworkFirst is a global variable
  const networkFirst = window.NetworkFirst as boolean

  const tabs = ["Detail", "Network"]
  const [currentTab, setCurrentTab] = useState(tabs[0])

  const { id: server_id } = useParams()

  if (!server_id) {
    navigate("/404")
    return null
  }

  if (mergePages) {
    const detailSection = <ServerDetailChart server_id={server_id} />
    const networkSection = <NetworkChart server_id={Number(server_id)} />

    return (
      <div className="mx-auto w-full max-w-5xl px-0 flex flex-col gap-4 server-info">
        <ServerDetailOverview server_id={server_id} />
        <Separator />
        {networkFirst ? (
          <>
            {networkSection}
            <Separator />
            {detailSection}
          </>
        ) : (
          <>
            {detailSection}
            <Separator />
            {networkSection}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-0 flex flex-col gap-4 server-info">
      <ServerDetailOverview server_id={server_id} />
      <section className="flex items-center my-2 w-full">
        <Separator className="flex-1" />
        <div className="flex justify-center w-full max-w-[200px]">
          <TabSwitch tabs={tabs} currentTab={currentTab} setCurrentTab={setCurrentTab} />
        </div>
        <Separator className="flex-1" />
      </section>
      {/* 只挂载当前 tab 否则 recharts 的 ResponsiveContainer 在 display:none 下 measure 出 0 宽 0 高
          切回来时还可能保留 0 尺寸 触发大量 warn 也画不出图 */}
      {currentTab === tabs[0] && <ServerDetailChart server_id={server_id} />}
      {currentTab === tabs[1] && <NetworkChart server_id={Number(server_id)} />}
    </div>
  )
}
