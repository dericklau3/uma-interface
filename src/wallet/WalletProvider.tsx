import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BrowserProvider } from 'ethers'
import { subscribeEip6963Providers } from './eip6963'
import type { EIP6963ProviderDetail, EIP1193Provider, WalletState } from './types'

type WalletContextValue = {
  wallet: WalletState
  connect: (providerDetail?: EIP6963ProviderDetail) => Promise<void>
  disconnect: () => void
  refreshProviders: () => void
}

const initialState: WalletState = {
  providers: [],
  selectedProvider: null,
  account: null,
  chainId: null,
  status: 'idle',
  error: null,
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(initialState)
  const listenersRef = useRef<{
    provider: EIP1193Provider | null
    accountsChanged?: (accounts: string[]) => void
    chainChanged?: (chainIdHex: string) => void
  }>({ provider: null })

  const cleanupListeners = () => {
    const listeners = listenersRef.current
    if (!listeners.provider) return

    if (listeners.accountsChanged) {
      listeners.provider.removeListener?.('accountsChanged', listeners.accountsChanged)
    }
    if (listeners.chainChanged) {
      listeners.provider.removeListener?.('chainChanged', listeners.chainChanged)
    }

    listenersRef.current = { provider: null }
  }

  useEffect(() => {
    const unsubscribe = subscribeEip6963Providers((detail) => {
      setWallet((current) => {
        if (current.providers.some((item) => item.info.uuid === detail.info.uuid)) {
          return current
        }

        return {
          ...current,
          providers: [...current.providers, detail].sort((a, b) =>
            a.info.name.localeCompare(b.info.name),
          ),
        }
      })
    })

    return () => {
      cleanupListeners()
      unsubscribe()
    }
  }, [])

  const refreshProviders = () => {
    setWallet((current) => ({ ...current, providers: [] }))
    window.dispatchEvent(new Event('eip6963:requestProvider'))
  }

  const disconnect = () => {
    cleanupListeners()
    setWallet((current) => ({
      ...current,
      selectedProvider: null,
      account: null,
      chainId: null,
      status: 'idle',
      error: null,
    }))
  }

  const connect = async (providerDetail?: EIP6963ProviderDetail) => {
    const detail = providerDetail ?? wallet.providers[0]
    if (!detail) {
      setWallet((current) => ({
        ...current,
        status: 'error',
        error: 'No injected wallet found. Install MetaMask, Rabby, or OKX Wallet.',
      }))
      return
    }

    cleanupListeners()
    setWallet((current) => ({
      ...current,
      selectedProvider: detail,
      status: 'connecting',
      error: null,
    }))

    try {
      await detail.provider.request({ method: 'eth_requestAccounts' })
      const browserProvider = new BrowserProvider(detail.provider as any)
      const signer = await browserProvider.getSigner()
      const account = (await signer.getAddress()) as `0x${string}`
      const network = await browserProvider.getNetwork()
      const chainId = Number(network.chainId)

      const handleAccountsChanged = (accounts: string[]) => {
        setWallet((current) => ({
          ...current,
          account: accounts[0] ? (accounts[0] as `0x${string}`) : null,
          status: accounts[0] ? 'connected' : 'idle',
        }))
      }

      const handleChainChanged = (chainIdHex: string) => {
        setWallet((current) => ({
          ...current,
          chainId: Number.parseInt(chainIdHex, 16),
        }))
      }

      detail.provider.on?.('accountsChanged', handleAccountsChanged)
      detail.provider.on?.('chainChanged', handleChainChanged)
      listenersRef.current = {
        provider: detail.provider,
        accountsChanged: handleAccountsChanged,
        chainChanged: handleChainChanged,
      }

      setWallet((current) => ({
        ...current,
        selectedProvider: detail,
        account,
        chainId,
        status: 'connected',
        error: null,
      }))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Wallet connection failed. Please try again.'

      setWallet((current) => ({
        ...current,
        selectedProvider: null,
        account: null,
        chainId: null,
        status: 'error',
        error: message,
      }))
    }
  }

  return (
    <WalletContext.Provider
      value={{
        wallet,
        connect,
        disconnect,
        refreshProviders,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used inside WalletProvider')
  }
  return context
}
