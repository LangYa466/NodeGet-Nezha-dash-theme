// 仅作兼容层 实际方法翻译和池管理都搬到 lib/nodeget.ts 里去了
// 上层只关心 SharedClient().call(method, params) 这个接口

import React, { createContext, useContext, useCallback } from "react"
import { dispatchRpc } from "../lib/nodeget"

export interface KomariShim {
  call: (method: string, params?: any, options?: any) => Promise<any>
  callViaHTTP: (method: string, params?: any, options?: any) => Promise<any>
  callViaWebSocket: (method: string, params?: any, options?: any) => Promise<any>
}

const sharedShim: KomariShim = {
  call: (m, p) => dispatchRpc(m, p),
  callViaHTTP: (m, p) => dispatchRpc(m, p),
  callViaWebSocket: (m, p) => dispatchRpc(m, p),
}

export const SharedClient = (): KomariShim => sharedShim

interface RPC2ContextType {
  client: KomariShim
  connectionState: string
  isConnected: boolean
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
}

const RPC2Context = createContext<RPC2ContextType | undefined>(undefined)

export const RPC2Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RPC2Context.Provider
    value={{
      client: sharedShim,
      connectionState: "connected",
      isConnected: true,
      error: null,
      connect: async () => {},
      disconnect: () => {},
    }}
  >
    {children}
  </RPC2Context.Provider>
)

export const useRPC2 = (): RPC2ContextType => {
  const ctx = useContext(RPC2Context)
  if (!ctx) throw new Error("useRPC2 必须在 RPC2Provider 内使用")
  return ctx
}

export const useRPC2Call = () => {
  const { client, isConnected } = useRPC2()
  const call = useCallback((m: string, p?: any, o?: any) => client.call(m, p, o), [client])
  const callViaWebSocket = useCallback((m: string, p?: any, o?: any) => client.callViaWebSocket(m, p, o), [client])
  const callViaHTTP = useCallback((m: string, p?: any, o?: any) => client.callViaHTTP(m, p, o), [client])
  const batchCall = useCallback(async (reqs: { method: string; params?: any }[]) =>
    Promise.all(reqs.map(r => client.call(r.method, r.params))), [client])
  return { call, callViaWebSocket, callViaHTTP, batchCall, isConnected }
}
