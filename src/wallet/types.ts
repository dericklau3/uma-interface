export type EIP6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export type EIP1193Provider = {
  request: (args: {
    method: string
    params?: unknown[] | Record<string, unknown>
  }) => Promise<unknown>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
}

export type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo
  provider: EIP1193Provider
}

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'error'

export type WalletState = {
  providers: EIP6963ProviderDetail[]
  selectedProvider: EIP6963ProviderDetail | null
  account: `0x${string}` | null
  chainId: number | null
  status: WalletStatus
  error: string | null
}

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<EIP6963ProviderDetail>
  }
}
