import type { EIP6963ProviderDetail } from './types'

export function requestEip6963Providers(): void {
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

export function subscribeEip6963Providers(
  onProvider: (detail: EIP6963ProviderDetail) => void,
): () => void {
  const handler = (event: WindowEventMap['eip6963:announceProvider']) => {
    onProvider(event.detail)
  }

  window.addEventListener('eip6963:announceProvider', handler as EventListener)
  requestEip6963Providers()

  return () => {
    window.removeEventListener('eip6963:announceProvider', handler as EventListener)
  }
}
