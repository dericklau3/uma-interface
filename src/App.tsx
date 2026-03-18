import { BrowserProvider, Contract, solidityPackedKeccak256, toUtf8Bytes, toUtf8String } from 'ethers'
import { useEffect, useState } from 'react'
import { useWallet } from './wallet/WalletProvider'
import type { EIP6963ProviderDetail } from './wallet/types'
import {
  UMA_CHAIN,
  UMA_CONTRACTS,
  encodeIdentifier,
  erc20Abi,
  formatDateTime,
  formatTokenAmount,
  getUmaContracts,
  getUmaReadContracts,
  oracleStateLabels,
  parseUmaRequestFromTxHash,
  parseTokenAmount,
  switchToUmaChain,
  umaCtfAdapterV3Abi,
} from './lib/uma'

type ViewMode = 'stake' | 'propose' | 'voting'

type DashboardState = {
  tokenBalance: bigint
  allowance: bigint
  staked: bigint
  pendingUnstake: bigint
  rewards: bigint
  unstakeTime: bigint
  cooldown: bigint
}

type ProposalSummary = {
  id: number
  requestTime: bigint
  transactionCount: number
  ancillaryData: string
}

type VotingRequest = {
  identifier: string
  time: bigint
  ancillaryData: string
}

type VotingState = {
  currentRoundId: bigint
  roundEnd: bigint
  votePhase: number | null
  pendingRequests: VotingRequest[]
}

type StoredVoteDraft = {
  roundId: string
  price: string
  salt: string
  encryptedVote: string
}

type OracleLookupState = {
  state: number | null
  hasPrice: boolean
  proposer: string
  disputer: string
  currency: string
  settled: boolean
  proposedPrice: bigint
  resolvedPrice: bigint
  expirationTime: bigint
  reward: bigint
  finalFee: bigint
  bond: bigint
  questionReset: boolean
  questionResolved: boolean
  latestRequestTimestamp: bigint
}

type OracleFormState = {
  requester: string
  identifier: string
  timestamp: string
  ancillaryData: string
  proposedPrice: string
}

type ProposeQuery = {
  id: string
  title: string
  type: string
  bond: string
  reward: string
  currencyAddress: string
  currencySymbol: string
  currencyDecimals: number
  chain: string
  mode: string
  timestamp: string
  unixTime: string
  requester: string
  requestTx: string
  identifier: string
  ancillaryData: string
  description: string
  proposedPrice: string
  questionId?: string | null
}

const emptyDashboard: DashboardState = {
  tokenBalance: 0n,
  allowance: 0n,
  staked: 0n,
  pendingUnstake: 0n,
  rewards: 0n,
  unstakeTime: 0n,
  cooldown: 0n,
}

const emptyOracleLookup: OracleLookupState = {
  state: null,
  hasPrice: false,
  proposer: '',
  disputer: '',
  currency: '',
  settled: false,
  proposedPrice: 0n,
  resolvedPrice: 0n,
  expirationTime: 0n,
  reward: 0n,
  finalFee: 0n,
  bond: 0n,
  questionReset: false,
  questionResolved: false,
  latestRequestTimestamp: 0n,
}

const emptyVotingState: VotingState = {
  currentRoundId: 0n,
  roundEnd: 0n,
  votePhase: null,
  pendingRequests: [],
}

const DYNAMIC_QUERIES_STORAGE_KEY = 'uma.dynamicQueries.v2'
const VOTING_DRAFTS_STORAGE_KEY = 'uma.votingDrafts.v1'
const ORACLE_SYNC_RETRY_DELAY_MS = 900
const ORACLE_SYNC_MAX_ATTEMPTS = 6

function shortAddress(account: string | null) {
  if (!account) return 'Connect wallet'
  return `${account.slice(0, 6)}...${account.slice(-4)}`
}

function chainLabel(chainId: number | null) {
  if (!chainId) return 'No network'
  if (chainId === UMA_CHAIN.chainId) return UMA_CHAIN.chainName
  return `Wrong network (${chainId})`
}

function formatOracleAnswer(price: bigint) {
  if (price === 0n) return 'No'
  if (price === 1n || price === 1000000000000000000n) return 'Yes'
  if (price === 500000000000000000n) return 'Unknown'
  if (price < 0n) return 'Custom'
  return price.toString()
}

function decodeAncillaryData(value: string) {
  try {
    return toUtf8String(value)
  } catch {
    return value
  }
}

function votePhaseLabel(phase: number | null) {
  if (phase === 0) return 'Commit'
  if (phase === 1) return 'Reveal'
  return 'Unknown'
}

function WalletModal({
  providers,
  open,
  onClose,
  onSelect,
  loading,
  error,
  onRefresh,
}: {
  providers: EIP6963ProviderDetail[]
  open: boolean
  onClose: () => void
  onSelect: (provider: EIP6963ProviderDetail) => void
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="wallet-modal" onClick={(event) => event.stopPropagation()}>
        <div className="wallet-modal__header">
          <div>
            <h3>Connect wallet</h3>
            <p>Choose an injected wallet discovered via EIP-6963.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {providers.length > 0 ? (
          <div className="wallet-list">
            {providers.map((provider) => (
              <button
                key={provider.info.uuid}
                className="wallet-option"
                onClick={() => onSelect(provider)}
                disabled={loading}
              >
                <span className="wallet-option__avatar">
                  {provider.info.icon ? (
                    <img src={provider.info.icon} alt={provider.info.name} />
                  ) : (
                    provider.info.name.slice(0, 1)
                  )}
                </span>
                <span>
                  <strong>{provider.info.name}</strong>
                  <small>{provider.info.rdns}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="wallet-empty">
            <p>No injected wallets found yet.</p>
            <button className="ghost-button" onClick={onRefresh}>
              Refresh discovery
            </button>
          </div>
        )}
        {error ? <p className="wallet-error">{error}</p> : null}
      </div>
    </div>
  )
}

export default function App() {
  const { wallet, connect, disconnect, refreshProviders } = useWallet()
  const [activeView, setActiveView] = useState<ViewMode>('stake')
  const [modalOpen, setModalOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardState>(emptyDashboard)
  const [proposals, setProposals] = useState<ProposalSummary[]>([])
  const [oracleLookup, setOracleLookup] = useState<OracleLookupState>(emptyOracleLookup)
  const [stakeAmount, setStakeAmount] = useState('')
  const [unstakeAmount, setUnstakeAmount] = useState('')
  const [statusMessage, setStatusMessage] = useState('Connect a wallet on Base Sepolia to start.')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [txHashInput, setTxHashInput] = useState('')
  const [dynamicQueries, setDynamicQueries] = useState<ProposeQuery[]>(() => {
    try {
      const raw = window.localStorage.getItem(DYNAMIC_QUERIES_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as ProposeQuery[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [votingState, setVotingState] = useState<VotingState>(emptyVotingState)
  const [selectedVotingRequestKey, setSelectedVotingRequestKey] = useState('')
  const [votingAnswer, setVotingAnswer] = useState('Yes')
  const [votingCustomPrice, setVotingCustomPrice] = useState('')
  const [votingSalt, setVotingSalt] = useState('987654321')
  const [encryptedVote, setEncryptedVote] = useState('ciphertext:mock-polymarket')
  const [storedVoteDrafts, setStoredVoteDrafts] = useState<Record<string, StoredVoteDraft>>(() => {
    try {
      const raw = window.localStorage.getItem(VOTING_DRAFTS_STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, StoredVoteDraft>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })
  const [selectedQuery, setSelectedQuery] = useState<ProposeQuery | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState('Yes')
  const [customAnswer, setCustomAnswer] = useState('')
  const [oracleForm, setOracleForm] = useState<OracleFormState>({
    requester: '',
    identifier: 'ASSERT_TRUTH',
    timestamp: '',
    ancillaryData: '0x',
    proposedPrice: '1',
  })

  const wrongChain = wallet.chainId !== null && wallet.chainId !== UMA_CHAIN.chainId
  const queryRows = dynamicQueries

  useEffect(() => {
    window.localStorage.setItem(DYNAMIC_QUERIES_STORAGE_KEY, JSON.stringify(dynamicQueries))
  }, [dynamicQueries])

  useEffect(() => {
    window.localStorage.setItem(VOTING_DRAFTS_STORAGE_KEY, JSON.stringify(storedVoteDrafts))
  }, [storedVoteDrafts])

  useEffect(() => {
    if (!wallet.account || !wallet.selectedProvider || wrongChain) {
      setDashboard(emptyDashboard)
      setProposals([])
      setVotingState(emptyVotingState)
      return
    }

    void refreshOnchainState()
    void loadVotingState()
  }, [wallet.account, wallet.selectedProvider, wallet.chainId])

  useEffect(() => {
    if (!selectedQuery || !wallet.selectedProvider || wrongChain) return

    const nextForm = {
      requester: selectedQuery.requester,
      identifier: selectedQuery.identifier,
      timestamp: selectedQuery.unixTime,
      ancillaryData: selectedQuery.ancillaryData,
      proposedPrice: selectedQuery.proposedPrice,
    }

    void loadOracleRequest(nextForm, selectedQuery)
  }, [selectedQuery, wallet.selectedProvider, wallet.chainId, wrongChain])

  const refreshOnchainState = async () => {
    if (!wallet.account || !wallet.selectedProvider) return

    try {
      const { votingToken, votingV2, governorV2 } = await getUmaReadContracts(wallet.selectedProvider)
      const [tokenBalance, allowance, voterStakeData, rewards, cooldown, proposalCount] =
        await Promise.all([
          votingToken.balanceOf(wallet.account),
          votingToken.allowance(wallet.account, UMA_CONTRACTS.votingV2),
          votingV2.voterStakes(wallet.account),
          votingV2.outstandingRewards(wallet.account),
          votingV2.unstakeCoolDown(),
          governorV2.numProposals(),
        ])

      setDashboard({
        tokenBalance,
        allowance,
        staked: voterStakeData.stake,
        pendingUnstake: voterStakeData.pendingUnstake,
        rewards,
        unstakeTime: voterStakeData.unstakeTime,
        cooldown,
      })

      try {
        const total = Number(proposalCount)
        const recentIds = Array.from({ length: Math.min(total, 5) }, (_, index) => total - 1 - index)
        const recent = await Promise.all(
          recentIds.map(async (id) => {
            const proposal = await governorV2.getProposal(id)
            return {
              id,
              requestTime: proposal.requestTime,
              transactionCount: proposal.transactions.length,
              ancillaryData: proposal.ancillaryData,
            }
          }),
        )
        setProposals(recent)
      } catch {
        setProposals([])
      }
    } catch (error) {
      setDashboard(emptyDashboard)
      setProposals([])
    }
  }

  const getVotingRequestKey = (request: VotingRequest) =>
    `${request.identifier}-${request.time.toString()}-${request.ancillaryData}`

  const getVotingPrice = () => {
    if (votingAnswer === 'Yes') return '1000000000000000000'
    if (votingAnswer === 'No') return '0'
    if (votingAnswer === 'Unknown') return '500000000000000000'
    return votingCustomPrice.trim() || '0'
  }

  const loadVotingState = async () => {
    if (!wallet.selectedProvider) return

    try {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider)
      const [currentRoundId, pendingRequests, votePhase] = await Promise.all([
        votingV2.getCurrentRoundId(),
        votingV2.getPendingRequests(),
        votingV2.getVotePhase(),
      ])
      const roundEnd = await votingV2.getRoundEndTime(currentRoundId)
      const nextPending = (pendingRequests as Array<{ identifier: string; time: bigint; ancillaryData: string }>).map(
        (request) => ({
          identifier: request.identifier,
          time: request.time,
          ancillaryData: request.ancillaryData,
        }),
      )

      setVotingState({
        currentRoundId,
        roundEnd,
        votePhase: Number(votePhase),
        pendingRequests: nextPending,
      })

      if (nextPending.length > 0) {
        setSelectedVotingRequestKey((current) =>
          current && nextPending.some((request) => getVotingRequestKey(request) === current)
            ? current
            : getVotingRequestKey(nextPending[0]),
        )
      } else {
        setSelectedVotingRequestKey('')
      }
    } catch (error) {
      setVotingState(emptyVotingState)
    }
  }

  const runTransaction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label)
    setStatusMessage(`${label} submitted...`)

    try {
      await action()
      await refreshOnchainState()
      window.setTimeout(() => {
        void refreshOnchainState()
      }, 1200)
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`
      setStatusMessage(message)
    } finally {
      setBusyAction(null)
    }
  }

  const waitForDelay = (ms: number) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms)
    })

  const loadLatestAdapterQuestion = async (
    providerDetail: EIP6963ProviderDetail,
    requester: string,
    questionId: string,
  ) => {
    const browserProvider = new BrowserProvider(providerDetail.provider as any)
    const adapter = new Contract(requester, umaCtfAdapterV3Abi, browserProvider)
    const question = await adapter.getQuestion(questionId)

    return {
      requestTimestamp: question.requestTimestamp as bigint,
      reward: question.reward as bigint,
      proposalBond: question.proposalBond as bigint,
      rewardToken: question.rewardToken as string,
      ancillaryData: ((question.ancillaryData as string) || '0x').trim() || '0x',
      resolved: Boolean(question.resolved),
      reset: Boolean(question.reset),
    }
  }

  const handleConnectClick = async () => {
    if (wallet.account) {
      setAccountMenuOpen((current) => !current)
      return
    }

    if (wallet.providers.length === 1) {
      await connect(wallet.providers[0])
      return
    }

    setAccountMenuOpen(false)
    setModalOpen(true)
  }

  const handleSwitchNetwork = async () => {
    if (!wallet.selectedProvider) return
    try {
      await switchToUmaChain(wallet.selectedProvider)
      setStatusMessage(`Switched to ${UMA_CHAIN.chainName}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network switch failed.'
      setStatusMessage(message)
    }
  }

  const handleStake = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Stake UMA', async () => {
      const amount = parseTokenAmount(stakeAmount || '0', 18)
      const { votingToken, votingV2 } = await getUmaContracts(wallet.selectedProvider!)

      if (dashboard.allowance < amount) {
        setStatusMessage('Approving VotingToken for VotingV2...')
        const approveTx = await votingToken.approve(UMA_CONTRACTS.votingV2, amount)
        await approveTx.wait()
      }

      setStatusMessage('Staking VotingToken...')
      const tx = await votingV2.stake(amount)
      await tx.wait()
      setDashboard((current) => ({
        ...current,
        tokenBalance: current.tokenBalance >= amount ? current.tokenBalance - amount : 0n,
        staked: current.staked + amount,
        allowance: current.allowance >= amount ? current.allowance - amount : 0n,
      }))
      setStakeAmount('')
      setStatusMessage('Stake confirmed on VotingV2.')
    })
  }

  const handleRequestUnstake = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Request unstake', async () => {
      const amount = parseTokenAmount(unstakeAmount || '0', 18)
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.requestUnstake(amount)
      await tx.wait()
      setDashboard((current) => ({
        ...current,
        staked: current.staked >= amount ? current.staked - amount : 0n,
        pendingUnstake: current.pendingUnstake + amount,
      }))
      setUnstakeAmount('')
      setStatusMessage('Unstake request confirmed.')
    })
  }

  const handleExecuteUnstake = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Execute unstake', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.executeUnstake()
      await tx.wait()
      setDashboard((current) => ({
        ...current,
        tokenBalance: current.tokenBalance + current.pendingUnstake,
        pendingUnstake: 0n,
        unstakeTime: 0n,
      }))
      setStatusMessage('Pending unstake executed.')
    })
  }

  const handleClaimRewards = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Claim rewards', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.withdrawRewards()
      await tx.wait()
      setDashboard((current) => ({
        ...current,
        tokenBalance: current.tokenBalance + current.rewards,
        rewards: 0n,
      }))
      setStatusMessage('Rewards withdrawn.')
    })
  }

  const handleClaimAndRestake = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Claim and restake', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.withdrawAndRestake()
      await tx.wait()
      setDashboard((current) => ({
        ...current,
        staked: current.staked + current.rewards,
        rewards: 0n,
      }))
      setStatusMessage('Rewards withdrawn and restaked.')
    })
  }

  const handleCommitVote = async () => {
    if (!wallet.selectedProvider || !wallet.account || !selectedVotingRequestKey) return
    const selectedRequest = votingState.pendingRequests.find(
      (request) => getVotingRequestKey(request) === selectedVotingRequestKey,
    )
    if (!selectedRequest) return

    const price = getVotingPrice()
    const salt = votingSalt.trim() || '0'

    await runTransaction('Commit vote', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const encryptedVoteBytes = toUtf8Bytes(encryptedVote)
      const commitHash = solidityPackedKeccak256(
        ['int256', 'int256', 'address', 'uint256', 'bytes', 'uint256', 'bytes32'],
        [
          BigInt(price),
          BigInt(salt),
          wallet.account!,
          selectedRequest.time,
          selectedRequest.ancillaryData,
          votingState.currentRoundId,
          selectedRequest.identifier,
        ],
      )

      const tx = await votingV2.commitAndEmitEncryptedVote(
        selectedRequest.identifier,
        selectedRequest.time,
        selectedRequest.ancillaryData,
        commitHash,
        encryptedVoteBytes,
      )
      await tx.wait()

      setStoredVoteDrafts((current) => ({
        ...current,
        [selectedVotingRequestKey]: {
          roundId: votingState.currentRoundId.toString(),
          price,
          salt,
          encryptedVote,
        },
      }))
      setStatusMessage('Vote committed.')
      await loadVotingState()
    })
  }

  const handleRevealVote = async () => {
    if (!wallet.selectedProvider || !selectedVotingRequestKey) return
    const selectedRequest = votingState.pendingRequests.find(
      (request) => getVotingRequestKey(request) === selectedVotingRequestKey,
    )
    if (!selectedRequest) return

    const draft = storedVoteDrafts[selectedVotingRequestKey]
    if (!draft) {
      setStatusMessage('Commit this request first so the app can reuse the stored price and salt.')
      return
    }

    await runTransaction('Reveal vote', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.revealVote(
        selectedRequest.identifier,
        selectedRequest.time,
        BigInt(draft.price),
        selectedRequest.ancillaryData,
        BigInt(draft.salt),
      )
      await tx.wait()
      setStatusMessage('Vote revealed.')
      await loadVotingState()
    })
  }

  const handleProcessResolvableRequests = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Process requests', async () => {
      const { votingV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await votingV2.processResolvablePriceRequests()
      await tx.wait()
      setStatusMessage('Resolvable price requests processed.')
      await loadVotingState()
    })
  }

  const loadOracleRequest = async (
    formState?: OracleFormState,
    queryState?: ProposeQuery | null,
  ) => {
    if (!wallet.selectedProvider) return

    try {
      const { optimisticOracleV2 } = await getUmaContracts(wallet.selectedProvider)
      const nextForm = formState ?? oracleForm
      const nextQuery = queryState ?? selectedQuery
      let activeForm = nextForm
      let questionReset = false
      let questionResolved = false
      let questionReward = 0n
      let questionBond = 0n
      let questionCurrency = ''

      if (nextQuery?.questionId) {
        try {
          const latestQuestion = await loadLatestAdapterQuestion(
            wallet.selectedProvider,
            nextForm.requester,
            nextQuery.questionId,
          )
          activeForm = {
            ...nextForm,
            timestamp: latestQuestion.requestTimestamp.toString(),
            ancillaryData: latestQuestion.ancillaryData,
          }
          questionReset = latestQuestion.reset
          questionResolved = latestQuestion.resolved
          questionReward = latestQuestion.reward
          questionBond = latestQuestion.proposalBond
          questionCurrency = latestQuestion.rewardToken

          setOracleForm((current) =>
            current.requester === nextForm.requester &&
            current.identifier === nextForm.identifier
              ? { ...current, timestamp: activeForm.timestamp, ancillaryData: activeForm.ancillaryData }
              : current,
          )
          setSelectedQuery((current) =>
            current && current.id === nextQuery.id
              ? {
                  ...current,
                  unixTime: activeForm.timestamp,
                  timestamp: formatDateTime(BigInt(activeForm.timestamp)),
                  ancillaryData: activeForm.ancillaryData,
                }
              : current,
          )
        } catch {}
      }

      const identifier = encodeIdentifier(activeForm.identifier)
      const ancillaryData =
        activeForm.ancillaryData.trim() === '' ? '0x' : activeForm.ancillaryData.trim()
      const timestamp = BigInt(activeForm.timestamp || '0')
      const [state, hasPrice, request] = await Promise.all([
        optimisticOracleV2.getState(
          activeForm.requester,
          identifier,
          timestamp,
          ancillaryData,
        ),
        optimisticOracleV2.hasPrice(
          activeForm.requester,
          identifier,
          timestamp,
          ancillaryData,
        ),
        optimisticOracleV2.getRequest(
          activeForm.requester,
          identifier,
          timestamp,
          ancillaryData,
        ),
      ])
      console.log('UMA getRequest raw tuple', request.toArray())
      console.log('UMA getRequest decoded with local ABI', {
        requester: activeForm.requester,
        identifier: activeForm.identifier,
        identifierBytes: identifier,
        timestamp: activeForm.timestamp,
        ancillaryData,
        state,
        hasPrice,
        request: {
          proposer: request.proposer,
          disputer: request.disputer,
          currency: request.currency,
          settled: request.settled,
          requestSettings: request.requestSettings,
          proposedPrice: request.proposedPrice,
          resolvedPrice: request.resolvedPrice,
          expirationTime: request.expirationTime,
          reward: request.reward,
          finalFee: request.finalFee,
          bond: request.requestSettings.bond,
          customLiveness: request.requestSettings.customLiveness,
        },
      })
      const nextLookup = {
        state: Number(state),
        hasPrice,
        proposer: request.proposer,
        disputer: request.disputer,
        currency: request.currency,
        settled: request.settled,
        proposedPrice: request.proposedPrice,
        resolvedPrice: request.resolvedPrice,
        expirationTime: request.expirationTime,
        reward: questionReward > 0n ? questionReward : request.reward,
        finalFee: request.finalFee,
        bond: questionBond > 0n ? questionBond : request.requestSettings.bond,
        questionReset,
        questionResolved,
        latestRequestTimestamp: timestamp,
      }
      if (questionCurrency) {
        nextLookup.currency = questionCurrency
      }
      setOracleLookup(nextLookup)
      setStatusMessage('Optimistic Oracle request loaded.')
      return nextLookup
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load request.'
      setStatusMessage(message)
      setOracleLookup(emptyOracleLookup)
      return null
    }
  }

  const syncOracleRequest = async (
    formState: OracleFormState,
    queryState: ProposeQuery | null | undefined,
    shouldStop: (lookup: OracleLookupState) => boolean,
  ) => {
    for (let attempt = 0; attempt < ORACLE_SYNC_MAX_ATTEMPTS; attempt += 1) {
      const lookup = await loadOracleRequest(formState, queryState)
      if (lookup && shouldStop(lookup)) {
        return lookup
      }

      if (attempt < ORACLE_SYNC_MAX_ATTEMPTS - 1) {
        await waitForDelay(ORACLE_SYNC_RETRY_DELAY_MS)
      }
    }

    return null
  }

  const ensureOoBondApproval = async ({
    signer,
    ooAddress,
    currencyAddress,
    currencySymbol,
    currencyDecimals,
    requiredBond,
  }: {
    signer: Awaited<ReturnType<typeof getUmaContracts>>['signer']
    ooAddress: string
    currencyAddress: string
    currencySymbol: string
    currencyDecimals: number
    requiredBond: bigint
  }) => {
    if (!wallet.account) {
      throw new Error('Connect wallet before approving USDC.')
    }

    const currencyContract = new Contract(currencyAddress, erc20Abi, signer)
    const [balance, allowance] = (await Promise.all([
      currencyContract.balanceOf(wallet.account),
      currencyContract.allowance(wallet.account, ooAddress),
    ])) as [bigint, bigint]

    if (balance < requiredBond) {
      throw new Error(
        `Insufficient ${currencySymbol} balance. Need ${formatTokenAmount(requiredBond, currencyDecimals)} ${currencySymbol} before calling proposePrice.`,
      )
    }

    if (allowance < requiredBond) {
      setStatusMessage(`Approving ${currencySymbol} for Optimistic Oracle V2...`)
      const approveTx = await currencyContract.approve(ooAddress, requiredBond)
      await approveTx.wait()
      setStatusMessage(`Approval confirmed. ${currencySymbol} is approved for Optimistic Oracle V2.`)
    }
  }

  const handleProposePrice = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Propose price', async () => {
      const { optimisticOracleV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await optimisticOracleV2.proposePrice(
        oracleForm.requester,
        encodeIdentifier(oracleForm.identifier),
        BigInt(oracleForm.timestamp || '0'),
        oracleForm.ancillaryData.trim() === '' ? '0x' : oracleForm.ancillaryData.trim(),
        BigInt(oracleForm.proposedPrice || '0'),
      )
      await tx.wait()
      setStatusMessage('Oracle proposal submitted.')
      await loadOracleRequest(undefined, selectedQuery)
    })
  }

  const buildQueryFromParsedRequest = (parsed: Awaited<ReturnType<typeof parseUmaRequestFromTxHash>>): ProposeQuery => ({
    id: parsed.txHash,
    title: parsed.identifier || 'YES_OR_NO_QUERY',
    type: 'Optimistic Oracle V2',
    bond: formatTokenAmount(parsed.totalBond, parsed.currencyDecimals),
    reward: formatTokenAmount(parsed.reward, parsed.currencyDecimals),
    currencyAddress: parsed.currency,
    currencySymbol: parsed.currencySymbol,
    currencyDecimals: parsed.currencyDecimals,
    chain: UMA_CHAIN.chainName,
    mode: 'Event-based',
    timestamp: parsed.requestedAtLabel,
    unixTime: parsed.timestamp,
    requester: parsed.requester,
    requestTx: parsed.txHash,
    identifier: parsed.identifier,
    ancillaryData: parsed.ancillaryData,
    description: parsed.ancillaryText || parsed.ancillaryData,
    proposedPrice: '1',
    questionId: parsed.questionId,
  })

  const addParsedRequestToQueries = async (txHash: string) => {
    const parsed = await parseUmaRequestFromTxHash(txHash)
    const query = buildQueryFromParsedRequest(parsed)

    let added = false
    setDynamicQueries((current) => {
      const exists = current.some(
        (item) => item.id === query.id || item.requestTx.toLowerCase() === query.requestTx.toLowerCase(),
      )
      if (exists) return current
      added = true
      return [query, ...current]
    })

    return { query, added }
  }

  const openQueryDetails = async (query: ProposeQuery) => {
    let latestQuery = query
    if (query.requestTx) {
      try {
        const parsed = await parseUmaRequestFromTxHash(query.requestTx)
        latestQuery = {
          ...query,
          title: parsed.identifier || query.title,
          bond: formatTokenAmount(parsed.totalBond, parsed.currencyDecimals),
          reward: formatTokenAmount(parsed.reward, parsed.currencyDecimals),
          currencyAddress: parsed.currency,
          currencySymbol: parsed.currencySymbol,
          currencyDecimals: parsed.currencyDecimals,
          chain: UMA_CHAIN.chainName,
          timestamp: parsed.requestedAtLabel,
          unixTime: parsed.timestamp,
          requester: parsed.requester,
          identifier: parsed.identifier,
          ancillaryData: parsed.ancillaryData,
          description: parsed.ancillaryText || parsed.ancillaryData,
          questionId: parsed.questionId,
        }
        setDynamicQueries((current) =>
          current.map((item) => (item.id === latestQuery.id ? latestQuery : item)),
        )
      } catch {
        latestQuery = query
      }
    }

    setSelectedQuery(latestQuery)
    setSelectedAnswer('Yes')
    setCustomAnswer('')
    const nextForm = {
      requester: latestQuery.requester,
      identifier: latestQuery.identifier,
      timestamp: latestQuery.unixTime,
      ancillaryData: latestQuery.ancillaryData,
      proposedPrice: latestQuery.proposedPrice,
    }
    setOracleForm(nextForm)
    if (wallet.selectedProvider) {
      await loadOracleRequest(nextForm, latestQuery)
    }
  }

  const handleDrawerAction = async () => {
    if (!wallet.account) {
      setModalOpen(true)
      return
    }

    if (!selectedQuery) return

    const nextPrice =
      selectedAnswer === 'Yes'
        ? '1000000000000000000'
        : selectedAnswer === 'No'
          ? '0'
          : selectedAnswer === 'Unknown'
            ? '500000000000000000'
            : customAnswer || selectedQuery.proposedPrice

    let latestQuery = selectedQuery
    if (selectedQuery.requestTx) {
      const parsed = await parseUmaRequestFromTxHash(selectedQuery.requestTx)
      latestQuery = {
        ...selectedQuery,
        title: parsed.identifier || selectedQuery.title,
        bond: formatTokenAmount(parsed.totalBond, parsed.currencyDecimals),
        reward: formatTokenAmount(parsed.reward, parsed.currencyDecimals),
        currencyAddress: parsed.currency,
        currencySymbol: parsed.currencySymbol,
        currencyDecimals: parsed.currencyDecimals,
        chain: UMA_CHAIN.chainName,
        timestamp: parsed.requestedAtLabel,
        unixTime: parsed.timestamp,
        requester: parsed.requester,
        identifier: parsed.identifier,
        ancillaryData: parsed.ancillaryData,
        description: parsed.ancillaryText || parsed.ancillaryData,
        proposedPrice: nextPrice,
        questionId: parsed.questionId,
      }
      setSelectedQuery(latestQuery)
      setDynamicQueries((current) =>
        current.map((item) => (item.id === latestQuery.id ? latestQuery : item)),
      )
    }

    const nextForm = {
      requester: latestQuery.requester,
      identifier: latestQuery.identifier,
      timestamp: latestQuery.unixTime,
      ancillaryData: latestQuery.ancillaryData,
      proposedPrice: nextPrice,
    }
    setOracleForm(nextForm)
    if (!wallet.selectedProvider) return
    await runTransaction('Propose price', async () => {
      const { signer, optimisticOracleV2 } = await getUmaContracts(wallet.selectedProvider!)
      const ancillaryData =
        nextForm.ancillaryData.trim() === '' ? '0x' : nextForm.ancillaryData.trim()
      const liveState = Number(
        await optimisticOracleV2.getState(
          nextForm.requester,
          encodeIdentifier(nextForm.identifier),
          BigInt(nextForm.timestamp || '0'),
          ancillaryData,
        ),
      )

      if (liveState !== 1) {
        throw new Error(
          `This request is already ${oracleStateLabels[liveState] ?? `State ${liveState}`}. proposePrice only works while the request is Requested.`,
        )
      }

      const currencyAddress =
        oracleLookup.currency && oracleLookup.currency !== '0x0000000000000000000000000000000000000000'
          ? oracleLookup.currency
          : latestQuery.currencyAddress || UMA_CONTRACTS.usdc
      const requiredBond =
        oracleLookup.bond > 0n || oracleLookup.finalFee > 0n
          ? oracleLookup.bond + oracleLookup.finalFee
          : parseTokenAmount(latestQuery.bond, latestQuery.currencyDecimals)
      const ooAddress = await optimisticOracleV2.getAddress()
      await ensureOoBondApproval({
        signer,
        ooAddress,
        currencyAddress,
        currencySymbol: latestQuery.currencySymbol || 'USDC',
        currencyDecimals: latestQuery.currencyDecimals ?? 6,
        requiredBond,
      })

      setStatusMessage('Calling Optimistic Oracle V2 proposePrice...')
      const tx = await optimisticOracleV2.proposePrice(
        nextForm.requester,
        encodeIdentifier(nextForm.identifier),
        BigInt(nextForm.timestamp || '0'),
        ancillaryData,
        BigInt(nextForm.proposedPrice || '0'),
      )
      await tx.wait()
      setStatusMessage('Oracle proposal confirmed. Refreshing request state...')
      await syncOracleRequest(
        nextForm,
        latestQuery,
        (lookup) => lookup.state !== 1 || lookup.expirationTime > 0n || lookup.proposer !== '',
      )
    })
  }

  const handleParseTxHash = async () => {
    const normalized = txHashInput.trim()
    if (!normalized) return

    setBusyAction('Parse tx hash')
    try {
      const { query, added } = await addParsedRequestToQueries(normalized)

      if (added) {
        setStatusMessage('Parsed UMA request and added it to the list.')
      } else {
        setStatusMessage('This tx hash is already in the list.')
      }

      setTxHashInput('')
      await openQueryDetails(query)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse Base Sepolia tx hash.'
      setStatusMessage(message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleSettle = async () => {
    if (!wallet.selectedProvider) return
    await runTransaction('Settle request', async () => {
      const { optimisticOracleV2 } = await getUmaContracts(wallet.selectedProvider!)
      const tx = await optimisticOracleV2.settle(
        oracleForm.requester,
        encodeIdentifier(oracleForm.identifier),
        BigInt(oracleForm.timestamp || '0'),
        oracleForm.ancillaryData.trim() === '' ? '0x' : oracleForm.ancillaryData.trim(),
      )
      await tx.wait()
      setStatusMessage('Oracle request settled.')
      await loadOracleRequest(undefined, selectedQuery)
    })
  }

  const handleDispute = async () => {
    if (!wallet.selectedProvider || !wallet.account) return
    await runTransaction('Dispute request', async () => {
      const { signer, optimisticOracleV2 } = await getUmaContracts(wallet.selectedProvider!)
      const currencyAddress =
        oracleLookup.currency && oracleLookup.currency !== '0x0000000000000000000000000000000000000000'
          ? oracleLookup.currency
          : selectedQuery?.currencyAddress

      if (!currencyAddress) {
        throw new Error('No reward currency available for dispute.')
      }

      const requiredBond = oracleLookup.bond + oracleLookup.finalFee
      const ooAddress = await optimisticOracleV2.getAddress()
      await ensureOoBondApproval({
        signer,
        ooAddress,
        currencyAddress,
        currencySymbol: selectedQuery?.currencySymbol || 'USDC',
        currencyDecimals: selectedQuery?.currencyDecimals ?? 6,
        requiredBond,
      })

      const tx = await optimisticOracleV2.disputePrice(
        oracleForm.requester,
        encodeIdentifier(oracleForm.identifier),
        BigInt(oracleForm.timestamp || '0'),
        oracleForm.ancillaryData.trim() === '' ? '0x' : oracleForm.ancillaryData.trim(),
      )
      const receipt = await tx.wait()

      if (receipt) {
        try {
          const { query, added } = await addParsedRequestToQueries(receipt.hash)
          if (added) {
            setStatusMessage('Dispute confirmed. Found a follow-up RequestPrice and added it to the query list.')
            setSelectedQuery(query)
            setSelectedAnswer('Yes')
            setCustomAnswer('')
            setOracleForm({
              requester: query.requester,
              identifier: query.identifier,
              timestamp: query.unixTime,
              ancillaryData: query.ancillaryData,
              proposedPrice: query.proposedPrice,
            })
            await loadOracleRequest(
              {
                requester: query.requester,
                identifier: query.identifier,
                timestamp: query.unixTime,
                ancillaryData: query.ancillaryData,
                proposedPrice: query.proposedPrice,
              },
              query,
            )
            return
          }
        } catch {}
      }

      setStatusMessage('Oracle request disputed. Waiting for adapter to refresh the active request...')
      await syncOracleRequest(
        oracleForm,
        selectedQuery,
        (lookup) =>
          lookup.latestRequestTimestamp !== BigInt(oracleForm.timestamp || '0') ||
          (lookup.state !== 4 && lookup.state !== null),
      )
    })
  }

  const canSubmitAnswer = oracleLookup.state === null || oracleLookup.state === 1
  const currentUnixTime = BigInt(Math.floor(Date.now() / 1000))
  const challengePeriodEnded =
    oracleLookup.expirationTime > 0n && oracleLookup.expirationTime <= currentUnixTime
  const canDisputeAnswer =
    oracleLookup.state === 2 &&
    oracleLookup.expirationTime > currentUnixTime
  const canSettleAnswer =
    !oracleLookup.settled &&
    (oracleLookup.state === 3 || (oracleLookup.state === 2 && challengePeriodEnded))
  const proposedAnswerLabel = formatOracleAnswer(oracleLookup.proposedPrice)
  const proposeButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Propose price'
        ? 'Submitting...'
        : 'Propose answer'
  const disputeButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Dispute request'
        ? 'Submitting...'
        : 'Dispute'
  const settleButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Settle request'
        ? 'Submitting...'
        : 'Settle'
  const selectedVotingRequest =
    votingState.pendingRequests.find((request) => getVotingRequestKey(request) === selectedVotingRequestKey) ?? null
  const selectedVoteDraft =
    (selectedVotingRequest && storedVoteDrafts[getVotingRequestKey(selectedVotingRequest)]) || null
  const commitButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Commit vote'
        ? 'Submitting...'
        : 'Commit vote'
  const revealButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Reveal vote'
        ? 'Submitting...'
        : 'Reveal vote'
  const processButtonLabel =
    wallet.account === null
      ? 'Connect wallet'
      : busyAction === 'Process requests'
        ? 'Submitting...'
        : 'Process requests'

  return (
    <>
      <div className="page-shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand__mark">UMA</span>
          </div>
          <div className="topbar__actions">
            <span className="network-chip">{UMA_CHAIN.chainName}</span>
            <div className="wallet-trigger">
              <button
                className="primary-button"
                onClick={() => void handleConnectClick()}
                disabled={wallet.status === 'connecting'}
              >
                {wallet.status === 'connecting' ? 'Connecting...' : shortAddress(wallet.account)}
              </button>
              {wallet.account && accountMenuOpen ? (
                <div className="account-menu">
                  <div className="account-menu__summary">
                    <strong>{shortAddress(wallet.account)}</strong>
                    <span>{wallet.selectedProvider?.info.name ?? 'Injected wallet'}</span>
                    <small>{chainLabel(wallet.chainId)}</small>
                  </div>
                  {wrongChain ? (
                    <button className="account-menu__action" onClick={() => void handleSwitchNetwork()}>
                      Switch to {UMA_CHAIN.chainName}
                    </button>
                  ) : null}
                  <button
                    className="account-menu__action"
                    onClick={() => {
                      disconnect()
                      setAccountMenuOpen(false)
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section className="hero">
          <div className="hero__content">
            <h1>
              Stake, propose &amp; vote UMA workflows on <span>Base Sepolia</span>
            </h1>
          </div>
        </section>

        <main className="content">
          <section className="section-card">
            <div className="section-card__header">
              <h2>Onchain console</h2>
              <div className="tab-switcher">
                {(['stake', 'propose', 'voting'] as ViewMode[]).map((view) => (
                  <button
                    key={view}
                    className={view === activeView ? 'tab-switcher__item tab-switcher__item--active' : 'tab-switcher__item'}
                    onClick={() => setActiveView(view)}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>

            {wrongChain ? (
              <div className="network-banner">
                <p>
                  This app is wired to {UMA_CHAIN.chainName} ({UMA_CHAIN.chainId}). Switch networks
                  before sending transactions.
                </p>
                <button className="primary-button primary-button--small" onClick={() => void handleSwitchNetwork()}>
                  Switch network
                </button>
              </div>
            ) : null}

            {activeView === 'stake' ? (
              <div className="console-grid">
                <article className="panel">
                  <h3>Stake dashboard</h3>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>Staked UMA</span>
                      <strong>{formatTokenAmount(dashboard.staked)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Pending unstake</span>
                      <strong>{formatTokenAmount(dashboard.pendingUnstake)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Rewards</span>
                      <strong>{formatTokenAmount(dashboard.rewards)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Execute unstake after</span>
                      <strong>{formatDateTime(dashboard.unstakeTime)}</strong>
                    </div>
                  </div>
                </article>

                <article className="panel">
                  <h3>Stake / unstake</h3>
                  <label className="field">
                    <span className="field__header">
                      <span>Stake amount</span>
                      <strong>Balance: {formatTokenAmount(dashboard.tokenBalance, 18)}</strong>
                    </span>
                    <input value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} placeholder="100" />
                  </label>
                  <div className="action-row">
                    <button className="primary-button primary-button--small" onClick={() => void handleStake()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Stake
                    </button>
                  </div>

                  <label className="field">
                    <span>Unstake amount</span>
                    <input value={unstakeAmount} onChange={(event) => setUnstakeAmount(event.target.value)} placeholder="50" />
                  </label>
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => void handleRequestUnstake()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Request unstake
                    </button>
                    <button className="ghost-button" onClick={() => void handleExecuteUnstake()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Execute unstake
                    </button>
                  </div>

                  <div className="action-row">
                    <button className="ghost-button" onClick={() => void handleClaimRewards()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Claim rewards
                    </button>
                    <button className="primary-button primary-button--small" onClick={() => void handleClaimAndRestake()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Claim & restake
                    </button>
                  </div>
                  <p className="hint">
                    `executeUnstake()` only succeeds after the cooldown window has passed. Current cooldown: {Number(dashboard.cooldown)} seconds.
                  </p>
                </article>
              </div>
            ) : null}

            {activeView === 'propose' ? (
              <div className="propose-layout">
                <div className="propose-toolbar">
                  <label className="propose-search">
                    <span>Parse Base Sepolia tx hash</span>
                    <input
                      value={txHashInput}
                      onChange={(event) => setTxHashInput(event.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                  <button className="primary-button primary-button--small" onClick={() => void handleParseTxHash()} disabled={busyAction !== null}>
                    Parse tx
                  </button>
                  <span className="network-chip">Base Sepolia only</span>
                </div>

                <div className="query-table">
                  <div className="query-table__header">
                    <span>Query</span>
                    <span>Type</span>
                    <span>Bond</span>
                    <span>Reward</span>
                    <span />
                  </div>
                  {queryRows.map((query) => (
                    <button
                      key={query.id}
                      className="query-row"
                      onClick={() => void openQueryDetails(query)}
                    >
                      <div>
                        <strong>{query.title}</strong>
                        <small>
                          {query.timestamp} | {query.chain} | {query.mode}
                        </small>
                      </div>
                      <span>{query.type}</span>
                      <span>{query.bond}</span>
                      <span>{query.reward}</span>
                      <span className="query-row__arrow">›</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {activeView === 'voting' ? (
              <div className="console-grid">
                <article className="panel">
                  <h3>DVM voting queue</h3>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>Current round</span>
                      <strong>{votingState.currentRoundId.toString()}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Round ends</span>
                      <strong>{formatDateTime(votingState.roundEnd)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Vote phase</span>
                      <strong>{votePhaseLabel(votingState.votePhase)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Pending requests</span>
                      <strong>{votingState.pendingRequests.length}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Staked UMA</span>
                      <strong>{formatTokenAmount(dashboard.staked)}</strong>
                    </div>
                    <div className="stat-card">
                      <span>Rewards</span>
                      <strong>{formatTokenAmount(dashboard.rewards)}</strong>
                    </div>
                  </div>
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => void loadVotingState()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      Refresh voting queue
                    </button>
                    <button className="primary-button primary-button--small" onClick={() => void handleProcessResolvableRequests()} disabled={!wallet.account || wrongChain || busyAction !== null}>
                      {processButtonLabel}
                    </button>
                  </div>
                  <p className="hint">
                    When a disputed request reaches DVM, it appears in the pending queue. The flow is: wait for the next round, commit an encrypted vote, reveal the vote in the reveal phase, then process resolvable price requests.
                  </p>
                </article>

                <article className="panel">
                  <h3>Vote steps</h3>
                  <label className="field">
                    <span>Select pending request</span>
                    <select
                      value={selectedVotingRequestKey}
                      onChange={(event) => setSelectedVotingRequestKey(event.target.value)}
                    >
                      {votingState.pendingRequests.length === 0 ? (
                        <option value="">No pending requests</option>
                      ) : (
                        votingState.pendingRequests.map((request) => (
                          <option key={getVotingRequestKey(request)} value={getVotingRequestKey(request)}>
                            {request.identifier.slice(0, 10)}... | {request.time.toString()}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  {selectedVotingRequest ? (
                    <div className="drawer-metrics">
                      <div>
                        <span>Identifier</span>
                        <strong>{selectedVotingRequest.identifier}</strong>
                      </div>
                      <div>
                        <span>Request time</span>
                        <strong>{formatDateTime(selectedVotingRequest.time)}</strong>
                      </div>
                      <div>
                        <span>Ancillary data</span>
                        <strong>{decodeAncillaryData(selectedVotingRequest.ancillaryData)}</strong>
                      </div>
                    </div>
                  ) : null}

                  <div className="field-grid">
                    <label className="field">
                      <span>Vote answer</span>
                      <select value={votingAnswer} onChange={(event) => setVotingAnswer(event.target.value)}>
                        <option>Yes</option>
                        <option>No</option>
                        <option>Unknown</option>
                        <option>Custom</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Salt</span>
                      <input value={votingSalt} onChange={(event) => setVotingSalt(event.target.value)} placeholder="987654321" />
                    </label>
                  </div>

                  {votingAnswer === 'Custom' ? (
                    <label className="field">
                      <span>Custom vote price</span>
                      <input value={votingCustomPrice} onChange={(event) => setVotingCustomPrice(event.target.value)} placeholder="1000000000000000000" />
                    </label>
                  ) : null}

                  <label className="field">
                    <span>Encrypted vote payload</span>
                    <input value={encryptedVote} onChange={(event) => setEncryptedVote(event.target.value)} placeholder="ciphertext:mock-polymarket" />
                  </label>

                  <div className="action-row">
                    <button className="primary-button primary-button--small" onClick={() => void handleCommitVote()} disabled={!selectedVotingRequest || !wallet.account || wrongChain || busyAction !== null}>
                      {commitButtonLabel}
                    </button>
                    <button className="ghost-button" onClick={() => void handleRevealVote()} disabled={!selectedVotingRequest || !selectedVoteDraft || !wallet.account || wrongChain || busyAction !== null}>
                      {revealButtonLabel}
                    </button>
                  </div>

                  <p className="hint">
                    Stored commit draft: {selectedVoteDraft ? `price ${selectedVoteDraft.price}, salt ${selectedVoteDraft.salt}, round ${selectedVoteDraft.roundId}` : 'none yet'}
                  </p>
                </article>
              </div>
            ) : null}
          </section>

          <section className="section-card section-card--muted">
            <h2>Integrated contracts</h2>
            <div className="contract-grid">
              {Object.entries(UMA_CONTRACTS).map(([name, address]) => (
                <article className="contract-card" key={name}>
                  <span>{name}</span>
                  <strong>{address}</strong>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>

      <WalletModal
        providers={wallet.providers}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(provider) => {
          void connect(provider)
          setModalOpen(false)
          setAccountMenuOpen(false)
        }}
        loading={wallet.status === 'connecting'}
        error={wallet.error}
        onRefresh={refreshProviders}
      />

      {selectedQuery ? (
        <div className="drawer-backdrop" onClick={() => setSelectedQuery(null)}>
          <aside className="query-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="query-drawer__header">
              <strong>{selectedQuery.title}</strong>
              <button className="icon-button" onClick={() => setSelectedQuery(null)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="query-drawer__section">
              <div className="query-drawer__section-title">
                <span className="query-drawer__icon">✎</span>
                <h3>{canSubmitAnswer ? 'Propose Answer' : 'Submitted Result'}</h3>
              </div>
              {canSubmitAnswer ? (
                <>
                  <label className="field">
                    <span>Select option</span>
                    <select value={selectedAnswer} onChange={(event) => setSelectedAnswer(event.target.value)}>
                      <option>Yes</option>
                      <option>No</option>
                      <option>Custom</option>
                      <option>Unknown</option>
                    </select>
                  </label>
                  {selectedAnswer === 'Custom' ? (
                    <label className="field">
                      <span>Custom answer</span>
                      <input value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="Enter custom price" />
                    </label>
                  ) : null}
                </>
              ) : (
                <div className="drawer-result-card">
                  <div>
                    <span>Submitted answer</span>
                    <strong>{proposedAnswerLabel}</strong>
                  </div>
                  <div>
                    <span>Proposer</span>
                    <strong>{oracleLookup.proposer || 'Pending sync'}</strong>
                  </div>
                  <div>
                    <span>Request state</span>
                    <strong>{oracleLookup.state === null ? 'Not loaded' : oracleStateLabels[oracleLookup.state] ?? `State ${oracleLookup.state}`}</strong>
                  </div>
                </div>
              )}
              <div className="drawer-metrics">
                <div>
                  <span>Bond</span>
                  <strong>
                    {oracleLookup.bond > 0n || oracleLookup.finalFee > 0n
                      ? `${formatTokenAmount(
                          oracleLookup.bond + oracleLookup.finalFee,
                          selectedQuery.currencyDecimals,
                        )} ${selectedQuery.currencySymbol}`
                      : `${selectedQuery.bond} ${selectedQuery.currencySymbol}`}
                  </strong>
                </div>
                <div>
                  <span>Reward</span>
                  <strong>
                    {oracleLookup.reward > 0n
                      ? `${formatTokenAmount(oracleLookup.reward, selectedQuery.currencyDecimals)} ${selectedQuery.currencySymbol}`
                      : `${selectedQuery.reward} ${selectedQuery.currencySymbol}`}
                  </strong>
                </div>
                <div>
                  <span>Challenge period ends</span>
                  <strong>
                    {oracleLookup.expirationTime > 0n
                      ? formatDateTime(oracleLookup.expirationTime)
                      : 'Not scheduled'}
                  </strong>
                </div>
              </div>
              {statusMessage ? <p className="drawer-status">{statusMessage}</p> : null}
              {canSubmitAnswer ? (
                <div className="action-row">
                  <button
                    className="primary-button query-drawer__cta"
                    onClick={() => void handleDrawerAction()}
                    disabled={wrongChain || busyAction !== null}
                  >
                    {proposeButtonLabel}
                  </button>
                </div>
              ) : canDisputeAnswer ? (
                <div className="query-drawer__actions">
                  <button
                    className="ghost-button"
                    onClick={() => void handleDispute()}
                    disabled={wrongChain || busyAction !== null}
                  >
                    {disputeButtonLabel}
                  </button>
                  <button className="primary-button" disabled>
                    Submitted
                  </button>
                </div>
              ) : canSettleAnswer ? (
                <div className="query-drawer__actions">
                  <button
                    className="primary-button"
                    onClick={() => void handleSettle()}
                    disabled={wrongChain || busyAction !== null}
                  >
                    {settleButtonLabel}
                  </button>
                </div>
              ) : (
                <div className="query-drawer__actions">
                  <button className="primary-button" disabled>
                    {oracleLookup.state === null ? 'Submitted' : oracleStateLabels[oracleLookup.state] ?? 'Submitted'}
                  </button>
                </div>
              )}
            </div>

            <div className="query-tags">
              <span>{selectedQuery.chain}</span>
              <span>{selectedQuery.type}</span>
              <span>{selectedQuery.mode}</span>
            </div>

            <div className="query-drawer__section">
              <div className="query-drawer__section-title">
                <span className="query-drawer__icon">◷</span>
                <h3>Timestamp</h3>
              </div>
              <div className="drawer-detail-grid">
                <div>
                  <span>Requested Time</span>
                  <strong>{selectedQuery.timestamp}</strong>
                </div>
                <div>
                  <span>UNIX</span>
                  <strong>{selectedQuery.unixTime}</strong>
                </div>
              </div>
            </div>

            <div className="query-drawer__section">
              <div className="query-drawer__section-title">
                <span className="query-drawer__icon">◎</span>
                <h3>Additional Text Data</h3>
              </div>
              <div className="drawer-copy-block">
                <span>Description</span>
                <p>{selectedQuery.description}</p>
              </div>
              <div className="drawer-copy-block">
                <span>Bytes</span>
                <p>{selectedQuery.ancillaryData}</p>
              </div>
            </div>

            <div className="query-drawer__section">
              <div className="query-drawer__section-title">
                <span className="query-drawer__icon">ⓘ</span>
                <h3>More information</h3>
              </div>
              <div className="drawer-links">
                <div>
                  <span>Optimistic Oracle V2</span>
                  <strong>{UMA_CONTRACTS.optimisticOracleV2}</strong>
                </div>
                <div>
                  <span>Identifier</span>
                  <strong>{selectedQuery.identifier}</strong>
                </div>
                <div>
                  <span>Requester</span>
                  <strong>{selectedQuery.requester}</strong>
                </div>
                <div>
                  <span>Request Transaction</span>
                  <strong>{selectedQuery.requestTx}</strong>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
