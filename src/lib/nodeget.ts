// NodeGet JSON-RPC WebSocket adapter.
// 把多个 NodeGet 后端聚合成一个池 暴露给上层使用 同时把 NodeGet 的数据形状
// 转成 Komari/Nezha 主题预期的形状 让上面的 UI 代码可以不动

const CONNECT_TIMEOUT_MS = 8000
const RECONNECT_DELAY_MS = 2000
const CALL_TIMEOUT_MS = 10000

let seq = 0
const nextId = () => `${++seq}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`

interface Pending {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class NodeGetRpcClient {
  private url: string
  private token: string
  name: string
  private ws: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private outbox: string[] = []
  private closed = false
  opened: Promise<void>

  constructor(url: string, token: string, name?: string) {
    this.url = url
    this.token = token
    this.name = name || url
    this.opened = new Promise<void>((resolve, reject) => {
      let done = false
      const ok = () => { if (!done) { done = true; resolve() } }
      const fail = (msg: string) => { if (!done) { done = true; reject(new Error(msg)) } }
      this.connect(ok, fail)
    })
  }

  private connect(ok: () => void, fail: (msg: string) => void) {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    this.ws = ws
    let opened = false

    const timer = setTimeout(() => {
      if (opened) return
      ws.close()
      fail(`连接 ${this.url} 超时`)
    }, CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      opened = true
      clearTimeout(timer)
      ok()
      for (const m of this.outbox) ws.send(m)
      this.outbox = []
    }

    ws.onmessage = e => {
      const data = typeof e.data === 'string' ? e.data : String(e.data)
      let msg: any
      try { msg = JSON.parse(data) } catch { return }
      if (msg.id == null) return
      const id = String(msg.id)
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(new Error(msg.error.message || 'rpc error'))
      else p.resolve(msg.result)
    }

    ws.onclose = () => {
      clearTimeout(timer)
      this.ws = null
      if (!opened) fail(`无法连接 ${this.url}`)
      if (!this.closed) setTimeout(() => this.connect(ok, fail), RECONNECT_DELAY_MS)
    }

    ws.onerror = () => {}
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, timeout = CALL_TIMEOUT_MS): Promise<T> {
    await this.opened
    const id = nextId()
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params: { token: this.token, ...params },
      id,
    })
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload)
      else this.outbox.push(payload)
    })
  }

  close() {
    this.closed = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('connection closed'))
    }
    this.pending.clear()
    this.outbox = []
    this.ws?.close()
    this.ws = null
  }
}

export interface BackendToken {
  name: string
  backend_url: string
  token: string
}

export interface SiteConfig {
  site_name?: string
  site_logo?: string
  footer?: string
  site_tokens: BackendToken[]
}

interface PoolEntry { name: string; client: NodeGetRpcClient }

export class BackendPool {
  entries: PoolEntry[]
  constructor(tokens: BackendToken[]) {
    this.entries = tokens.map(t => ({
      name: t.name,
      client: new NodeGetRpcClient(t.backend_url, t.token, t.name),
    }))
  }
  async fanout<T>(fn: (c: NodeGetRpcClient) => Promise<T>) {
    const settled = await Promise.allSettled(
      this.entries.map(e => fn(e.client).then(rows => ({ source: e.name, rows }))),
    )
    const ok: { source: string; rows: T }[] = []
    const errors: { source: string; error: unknown }[] = []
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') ok.push(r.value)
      else errors.push({ source: this.entries[i].name, error: r.reason })
    })
    return { ok, errors }
  }
  close() { for (const e of this.entries) e.client.close() }
}

export const listAgentUuids = (c: NodeGetRpcClient) =>
  c.call<{ uuids?: string[] }>('nodeget-server_list_all_agent_uuid', {}).then(r => r?.uuids || [])

export const staticDataMulti = (c: NodeGetRpcClient, uuids: string[], fields: string[]) =>
  c.call<any[]>('agent_static_data_multi_last_query', { uuids, fields })

export const dynamicSummaryMulti = (c: NodeGetRpcClient, uuids: string[], fields: string[]) =>
  c.call<any[]>('agent_dynamic_summary_multi_last_query', { uuids, fields })

export const kvGetMulti = (c: NodeGetRpcClient, items: { namespace: string; key: string }[]) =>
  c.call<{ namespace: string; key: string; value: unknown }[]>('kv_get_multi_value', { namespace_key: items })

export interface TaskQueryRow {
  task_id: number
  timestamp: number
  uuid: string
  success: boolean
  error_message?: string | null
  cron_source?: string
  task_event_type?: Record<string, string>
  task_event_result: Record<string, any> | null
}

export const taskQuery = (
  c: NodeGetRpcClient,
  conditions: Record<string, any>[],
  timeoutMs?: number,
) => c.call<TaskQueryRow[]>('task_query', { task_data_query: { condition: conditions } }, timeoutMs)

// 2 letter ISO code -> emoji flag 让 utils.ts 里的 countryFlagToCode 能反解
export function codeToFlag(code?: string): string {
  if (!code) return ''
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1f1e6) +
    String.fromCodePoint(c.charCodeAt(1) - 65 + 0x1f1e6)
}

export const STATIC_FIELDS = ['cpu', 'system']
export const DYNAMIC_FIELDS = [
  'cpu_usage', 'used_memory', 'total_memory', 'available_memory',
  'used_swap', 'total_swap', 'total_space', 'available_space',
  'read_speed', 'write_speed', 'receive_speed', 'transmit_speed',
  'total_received', 'total_transmitted',
  'load_one', 'load_five', 'load_fifteen',
  'uptime', 'boot_time', 'process_count',
  'tcp_connections', 'udp_connections',
]
export const META_KEYS = [
  'metadata_name', 'metadata_region', 'metadata_tags', 'metadata_hidden',
  'metadata_virtualization', 'metadata_latitude', 'metadata_longitude',
  'metadata_order', 'metadata_price', 'metadata_price_unit',
  'metadata_price_cycle', 'metadata_expire_time',
]

// 把 NodeGet 多后端数据揉成 Komari common:getNodes 返回的形状
// 形如 { uuid: { name, region(emoji), os, cpu_name, ... } }
export function toKomariNodes(
  agents: { uuid: string; source: string; meta: Record<string, any>; static: any; dyn?: any }[],
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const a of agents) {
    const m = a.meta || {}
    if (m.metadata_hidden) continue
    const s = a.static || {}
    const sys = s.system || {}
    const cpu = s.cpu || {}
    const d = a.dyn || {}
    const rawTags = m.metadata_tags
    const tags: string[] = Array.isArray(rawTags)
      ? rawTags.map(String).filter(Boolean)
      : typeof rawTags === "string" && rawTags
        ? rawTags.split(/[,;\s]+/).map((s: string) => s.trim()).filter(Boolean)
        : []
    const order = Number(m.metadata_order)
    const price = Number(m.metadata_price)
    const cycle = Number(m.metadata_price_cycle)
    out[a.uuid] = {
      uuid: a.uuid,
      name: m.metadata_name || a.uuid,
      region: codeToFlag(m.metadata_region),
      // 不要把后端名当 group 没填 tag 的节点应当不出现在任何分组里 只在 All 下
      group: "",
      os: sys.system_name || sys.distribution_id || '',
      kernel_version: sys.system_kernel_version || sys.system_kernel || '',
      arch: sys.arch || cpu.arch || '',
      cpu_name: cpu.brand || (cpu.per_core?.[0]?.brand) || '',
      gpu_name: '',
      mem_total: Number(d.total_memory) || 0,
      swap_total: Number(d.total_swap) || 0,
      disk_total: Number(d.total_space) || 0,
      weight: Number.isFinite(order) ? -order : 0,
      public_remark: '',
      tags: tags.filter(Boolean).join(';'),
      billing_cycle: Number.isFinite(cycle) ? cycle : 0,
      auto_renewal: 0,
      price: Number.isFinite(price) ? price : 0,
      currency: m.metadata_price_unit || '$',
      traffic_limit: 0,
      traffic_limit_type: '',
      expired_at: m.metadata_expire_time || '',
      created_at: '',
      ipv4: '',
      ipv6: '',
      virtualization: m.metadata_virtualization || '',
      lat: m.metadata_latitude != null ? Number(m.metadata_latitude) : null,
      lng: m.metadata_longitude != null ? Number(m.metadata_longitude) : null,
    }
  }
  return out
}

// ============================================================================
// 单例 BackendPool + 元数据快照 + uuid→source 映射
// 所有上层 React Query 钩子最终都进到这里来通过池调底层 RPC
// ============================================================================

declare const __APP_VERSION__: string

let configPromise: Promise<SiteConfig> | null = null
export function loadConfig(): Promise<SiteConfig> {
  if (!configPromise) {
    // 必须用 BASE_URL 拼绝对路径 不然在 /server/:id 这种深层路由下相对路径会被
    // SPA 兜底成 index.html  .json() 解析就会抛 "Unexpected token '<', <!doctype..."
    const base = (import.meta as any).env?.BASE_URL || "/"
    const url = `${base.replace(/\/+$/, "")}/config.json`
    configPromise = fetch(url, { cache: "no-cache" })
      .then(r => {
        if (!r.ok) throw new Error(`config.json ${r.status}`)
        return r.json() as Promise<SiteConfig>
      })
      .catch(e => { configPromise = null; throw e })
  }
  return configPromise
}

let poolPromise: Promise<BackendPool> | null = null
export async function getPool(): Promise<BackendPool> {
  if (!poolPromise) {
    poolPromise = loadConfig().then(cfg => {
      const tokens = (cfg.site_tokens || []).filter(t => t.backend_url && t.token)
      return new BackendPool(tokens)
    })
  }
  return poolPromise
}

const metaSnapshot = new Map<string, Record<string, any>>()
const sourceOfUuid = new Map<string, string>()

// 全量拉取节点 + kv 元数据 + 静态 + 首批 dynamic 总量 转成 Komari node 形状
export async function getNodes(): Promise<Record<string, any>> {
  const pool = await getPool()
  const uuidsByEntry = await pool.fanout(listAgentUuids)
  const agents: { uuid: string; source: string; meta: Record<string, any>; static: any; dyn: any }[] = []

  await Promise.all(
    uuidsByEntry.ok.map(async ({ source, rows }) => {
      const entry = pool.entries.find(e => e.name === source)
      if (!entry) return
      const uuids = rows || []
      if (!uuids.length) return
      for (const u of uuids) sourceOfUuid.set(u, source)

      const kvItems = uuids.flatMap(u => META_KEYS.map(k => ({ namespace: u, key: k })))
      const [metaRes, statRes, dynRes] = await Promise.allSettled([
        kvGetMulti(entry.client, kvItems),
        staticDataMulti(entry.client, uuids, STATIC_FIELDS),
        dynamicSummaryMulti(entry.client, uuids, ['total_memory', 'total_swap', 'total_space']),
      ])

      const grouped = new Map<string, Record<string, any>>()
      if (metaRes.status === "fulfilled" && metaRes.value) {
        for (const row of metaRes.value) {
          if (!row || row.value == null) continue
          let bucket = grouped.get(row.namespace)
          if (!bucket) grouped.set(row.namespace, (bucket = {}))
          bucket[row.key] = row.value
        }
      }
      const staticByUuid = new Map<string, any>()
      if (statRes.status === "fulfilled" && statRes.value) {
        for (const row of statRes.value) if (row?.uuid) staticByUuid.set(row.uuid, row)
      }
      const dynByUuid = new Map<string, any>()
      if (dynRes.status === "fulfilled" && dynRes.value) {
        for (const row of dynRes.value) if (row?.uuid) dynByUuid.set(row.uuid, row)
      }

      for (const uuid of uuids) {
        const meta = grouped.get(uuid) || {}
        metaSnapshot.set(uuid, meta)
        agents.push({
          uuid,
          source,
          meta,
          static: staticByUuid.get(uuid) || {},
          dyn: dynByUuid.get(uuid) || {},
        })
      }
    }),
  )

  return toKomariNodes(agents)
}

// 拉取所有节点的最新状态
export async function getNodesLatestStatus(): Promise<Record<string, any>> {
  const pool = await getPool()
  const buckets = new Map<string, string[]>()
  for (const [uuid, source] of sourceOfUuid.entries()) {
    if (!buckets.has(source)) buckets.set(source, [])
    buckets.get(source)!.push(uuid)
  }
  if (!buckets.size) {
    const r = await pool.fanout(listAgentUuids)
    for (const { source, rows } of r.ok) {
      const uuids = rows || []
      for (const u of uuids) sourceOfUuid.set(u, source)
      if (uuids.length) buckets.set(source, uuids)
    }
  }

  const rows: { uuid: string; row: any }[] = []
  await Promise.all(
    Array.from(buckets.entries()).map(async ([source, uuids]) => {
      const entry = pool.entries.find(e => e.name === source)
      if (!entry) return
      try {
        const res = await dynamicSummaryMulti(entry.client, uuids, DYNAMIC_FIELDS)
        for (const r of res || []) if (r?.uuid) rows.push({ uuid: r.uuid, row: r })
      } catch {}
    }),
  )
  return toKomariStatus(rows, metaSnapshot)
}

// 拉取某个 uuid 的探针记录 用于详情页 NetworkChart
// 输出形如 [{ task_id, time(ISO), value, name }]  value === -1 表示丢包
export async function getRecords(params: { uuid?: string; type?: string; hours?: number; maxCount?: number } = {}) {
  const { uuid, hours = 24 } = params
  const type = params.type === "tcp_ping" ? "tcp_ping" : "ping"
  if (!uuid) return []
  const pool = await getPool()
  if (!sourceOfUuid.has(uuid)) {
    const r = await pool.fanout(listAgentUuids)
    for (const { source, rows } of r.ok) {
      for (const u of rows || []) sourceOfUuid.set(u, source)
    }
  }
  const source = sourceOfUuid.get(uuid)
  if (!source) return []
  const entry = pool.entries.find(e => e.name === source)
  if (!entry) return []

  const nowMs = Date.now()
  const fromMs = nowMs - Math.max(hours, 0) * 3600 * 1000
  // NodeGet 实际单位未知 时间窗口同时传 ms 和 s 两种 让后端任选其一兼容
  // 条件分散在多个对象里也行 合并成单个对象也行 这里走单对象 减少边缘 case
  const maxCount = Math.max(Number(params.maxCount) || 2000, 500)

  // NodeGet 的 task_query condition 拼法和时间单位都不太确定 这里按不同组合依次尝试
  // 命中数据立刻 break
  const fromS = Math.floor(fromMs / 1000)
  const nowS = Math.floor(nowMs / 1000)
  const tryQueries: Record<string, any>[][] = [
    // 旧前端用的拆分对象写法 ms 时间戳
    [{ uuid }, { timestamp_from_to: [fromMs, nowMs] }, { type }, { limit: maxCount }],
    // 合并对象 ms
    [{ uuid, timestamp_from_to: [fromMs, nowMs], type, limit: maxCount }],
    // 拆分对象 秒时间戳
    [{ uuid }, { timestamp_from_to: [fromS, nowS] }, { type }, { limit: maxCount }],
    // 不带 type 拉全部探针手动过滤
    [{ uuid }, { timestamp_from_to: [fromMs, nowMs] }, { limit: maxCount }],
  ]

  let rawRows: any[] = []
  for (const cond of tryQueries) {
    try {
      const res: any = await taskQuery(entry.client, cond, 20_000)
      // 兼容 result 直接是数组 或 包在 { rows | data | results | list }
      const list: any[] = Array.isArray(res) ? res
        : Array.isArray(res?.rows) ? res.rows
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.results) ? res.results
        : Array.isArray(res?.list) ? res.list
        : []
      if (list.length) { rawRows = list; break }
    } catch {}
  }

  const normalizeTs = (ts: any): number => {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return 0
    if (n < 1e10) return n * 1000           // 秒
    if (n < 1e13) return n                   // 毫秒
    return Math.floor(n / 1000)              // 微秒
  }

  // 从 task_event_result 里挑出延迟数值 兼容多种 key
  const pickDelay = (er: any): number | null => {
    if (er == null) return null
    if (typeof er === "number") return Number.isFinite(er) ? er : null
    let obj: any = er
    if (typeof er === "string") {
      try { obj = JSON.parse(er) } catch { return Number.isFinite(Number(er)) ? Number(er) : null }
    }
    if (obj && typeof obj === "object") {
      const candidates = [type, type === "tcp_ping" ? "tcp" : "ping", "delay", "latency", "rtt", "value", "ms"]
      for (const k of candidates) {
        const v = Number(obj[k])
        if (Number.isFinite(v)) return v
      }
      // 取第一个数值字段兜底
      for (const v of Object.values(obj)) {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
    }
    return null
  }

  const out: { task_id: number; time: string; value: number; name: string }[] = []
  for (const r of rawRows) {
    // 如果是兜底分支拉回来的全量探针 这里过滤一下类型
    const evType = r?.task_event_type
    const typeMatches =
      !evType ||
      (typeof evType === "string" && evType === type) ||
      (typeof evType === "object" && (evType[type] !== undefined || Object.values(evType).includes(type)))
    if (!typeMatches) continue

    const ms = normalizeTs(r.timestamp ?? r.time ?? r.created_at)
    if (!ms) continue
    const taskId = Number(r.task_id ?? r.id) || 0
    const name = r.cron_source || r.name || `task_${taskId}`
    const v = pickDelay(r.task_event_result ?? r.result ?? r.value)
    const loss = r.success === false || v == null
    out.push({
      task_id: taskId,
      time: new Date(ms).toISOString(),
      value: loss ? -1 : v!,
      name,
    })
  }
  out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  return out
}

export async function getPublicInfo() {
  const cfg = await loadConfig()
  return { sitename: cfg.site_name || "NodeGet Status", custom_head: "" }
}

export async function getVersion() {
  const ver = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown"
  return { version: `nodeget-${ver}` }
}

// 统一调度入口 use-rpc2 的 SharedClient 直接转发到这里
export async function dispatchRpc(method: string, params?: any): Promise<any> {
  switch (method) {
    case "common:getNodes": return getNodes()
    case "common:getNodesLatestStatus": return getNodesLatestStatus()
    case "common:getPublicInfo": return getPublicInfo()
    case "common:getVersion": return getVersion()
    case "common:getRecords": return getRecords(params || {})
    case "common:getMe": throw new Error("anonymous")
    default: throw new Error(`unsupported rpc method: ${method}`)
  }
}

// ============================================================================
// React Query 用到的 fetcher 替代原来 nezha-api.ts 里的同名函数
// 上层组件直接 import { fetchServerGroup, fetchMonitor, fetchSetting ... } from '@/lib/nodeget'
// ============================================================================

import { DateTime } from "luxon"
import type {
  MonitorResponse, NezhaMonitor,
  ServerGroupResponse, SettingResponse,
} from "@/types/nezha-api"

// 把 getNodes 结果缓存一份 让多次 fetcher 调用复用
let nodesCachePromise: Promise<Record<string, any>> | null = null
let nodesCacheAt = 0
const NODES_TTL = 2 * 60 * 1000
async function cachedNodes(): Promise<Record<string, any>> {
  const now = Date.now()
  if (nodesCachePromise && now - nodesCacheAt < NODES_TTL) return nodesCachePromise
  nodesCacheAt = now
  nodesCachePromise = getNodes().catch(e => {
    nodesCachePromise = null
    throw e
  })
  return nodesCachePromise
}
export function getKomariNodes() { return cachedNodes() }

export function uuidToNumber(uuid: string): number {
  let h = 0
  for (let i = 0; i < uuid.length; i++) h = uuid.charCodeAt(i) + ((h << 5) - h)
  return h >>> 0
}

export const fetchServerGroup = async (): Promise<ServerGroupResponse> => {
  const kmNodes = await cachedNodes()
  const getTags = (v: any): string[] => {
    if (Array.isArray(v?.tags)) return v.tags.filter(Boolean).map(String)
    if (typeof v?.tags === "string" && v.tags) return v.tags.split(/[;\s]+/).map((s: string) => s.trim()).filter(Boolean)
    return []
  }
  const groups: string[] = []
  Object.values(kmNodes).forEach((value: any) => {
    for (const t of getTags(value)) if (!groups.includes(t)) groups.push(t)
  })
  return {
    success: true,
    data: groups.map((group, index) => ({
      group: {
        id: index,
        created_at: DateTime.now().toISO() || "",
        updated_at: DateTime.now().toISO() || "",
        name: group,
      },
      servers: Object.entries(kmNodes)
        .filter(([_, value]) => getTags(value).includes(group))
        .map(([key, _]) => uuidToNumber(key)),
    })),
  }
}

export const fetchMonitor = async (server_id: number, hours: number = 24): Promise<MonitorResponse> => {
  const km_nodes = await cachedNodes()
  const uuid = Object.keys(km_nodes).find(id => uuidToNumber(id) === server_id)
  if (!uuid) return { success: true, data: [] }
  const serverName = km_nodes[uuid]?.name || String(server_id)

  const records = await getRecords({ uuid, type: "ping", hours })

  // NodeGet 里 task_id 是每次执行的唯一 id 同一个监控任务每跑一次就一个新 task_id
  // 不能按 task_id 分组 否则 480 条记录会变成 480 条线
  // 真正的监控任务标识是 cron_source 按它分组
  // monitor_name 会被 recharts 当 dataKey 一旦含 . [ ] 等字符就会被当嵌套路径
  // 这里同时做清洗
  const sanitize = (s: string) => s.replace(/[.\[\]\s]+/g, "_")
  const seriesByName = new Map<string, NezhaMonitor & { _firstTaskId: number }>()

  for (const rec of records) {
    const rawName = rec.name || `task_${rec.task_id ?? 0}`
    const name = sanitize(rawName)
    let s = seriesByName.get(name)
    if (!s) {
      s = {
        monitor_id: typeof rec.task_id === "number" ? rec.task_id : 0,
        monitor_name: name,
        server_id,
        server_name: serverName,
        created_at: [],
        avg_delay: [],
        packet_loss: [],
        _firstTaskId: typeof rec.task_id === "number" ? rec.task_id : 0,
      }
      seriesByName.set(name, s)
    }
    const ts = Date.parse(rec.time)
    if (!Number.isFinite(ts)) continue
    const val = Number(rec.value)
    if (!Number.isFinite(val)) continue
    s.created_at.push(ts)
    if (val === -1) {
      s.avg_delay.push(0)
      s.packet_loss!.push(100)
    } else {
      s.avg_delay.push(val)
      s.packet_loss!.push(0)
    }
  }

  const data = Array.from(seriesByName.values()).map(({ _firstTaskId: _, ...s }) => s).map(s => {
    const zip = s.created_at.map((t, i) => ({ t, v: s.avg_delay[i], l: s.packet_loss?.[i] ?? 0 }))
    zip.sort((a, b) => a.t - b.t)
    return { ...s, created_at: zip.map(z => z.t), avg_delay: zip.map(z => z.v), packet_loss: zip.map(z => z.l) }
  })
  for (const s of data) {
    if (s.avg_delay.length === 0) {
      s.packet_loss = [0]
      s.avg_delay = [0]
      s.created_at = [Date.now()]
    }
  }
  return { success: true, data }
}

// 长期负载历史 NodeGet 暂无等价接口 详情页改用实时数据画图
export interface LoadRecord {
  time: number
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  process: number
  connections: number
  connections_udp: number
}

export const fetchLoadRecords = async (_server_id: number, _hours: number): Promise<LoadRecord[]> => {
  return []
}

export const fetchSetting = async (): Promise<SettingResponse> => {
  const cfg = await loadConfig()
  const ver = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown"
  return {
    success: true,
    data: {
      config: {
        debug: false,
        language: "zh-TW",
        site_name: cfg.site_name || "NodeGet Status",
        user_template: "",
        admin_template: "",
        custom_code: "",
      },
      version: `nodeget-${ver}`,
    },
  }
}

// 把 NodeGet dynamic summary 转成 Komari common:getNodesLatestStatus 返回形状
// 形如 { uuid: { time(ISO), cpu, ram, ram_total, disk, disk_total, net_in, ... } }
export function toKomariStatus(
  rows: { uuid: string; row: any }[],
  meta: Map<string, Record<string, any>>,
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const { uuid, row } of rows) {
    if (!row) continue
    const ts = Number(row.timestamp) || Date.now()
    const m = meta.get(uuid) || {}
    const totalSpace = Number(row.total_space) || 0
    const avail = Number(row.available_space) || 0
    out[uuid] = {
      name: m.metadata_name || uuid,
      region: codeToFlag(m.metadata_region),
      time: new Date(ts).toISOString(),
      cpu: Number(row.cpu_usage) || 0,
      ram: Number(row.used_memory) || 0,
      ram_total: Number(row.total_memory) || 0,
      swap: Number(row.used_swap) || 0,
      swap_total: Number(row.total_swap) || 0,
      disk: totalSpace ? Math.max(totalSpace - avail, 0) : 0,
      disk_total: totalSpace,
      net_in: Number(row.receive_speed) || 0,
      net_out: Number(row.transmit_speed) || 0,
      net_total_down: Number(row.total_received) || 0,
      net_total_up: Number(row.total_transmitted) || 0,
      uptime: Number(row.uptime) || 0,
      load: Number(row.load_one) || 0,
      load5: Number(row.load_five) || 0,
      load15: Number(row.load_fifteen) || 0,
      connections: Number(row.tcp_connections) || 0,
      connections_udp: Number(row.udp_connections) || 0,
      process: Number(row.process_count) || 0,
      temp: 0,
      gpu: 0,
      os: '',
      kernel_version: '',
      cpu_name: '',
      gpu_name: '',
      arch: '',
    }
  }
  return out
}
