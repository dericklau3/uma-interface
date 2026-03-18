import {
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  encodeBytes32String,
  formatUnits,
  parseUnits,
  toUtf8String,
} from 'ethers'
import { MulticallProvider } from '@ethers-ext/provider-multicall'
import type { EIP6963ProviderDetail } from '../wallet/types'
import optimisticOracleV2Artifact from '../../../../../contracts/evm/workshops/uma-protocol-contracts-workshop/out/OptimisticOracleV2.sol/OptimisticOracleV2.json'

export const UMA_CHAIN = {
  chainId: 84532,
  chainHex: '0x14a34',
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  blockExplorerUrl: 'https://sepolia-explorer.base.org',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18,
  },
} as const

export const UMA_CONTRACTS = {
  finder: '0x3320eD5f870Cd895D27cf7A941D395A81C090F44',
  store: '0x742a69fd498e2D5EE9C78fb7241D2635630C2C7D',
  addressWhitelist: '0x5b94BF941Be261bCb32Ab6A5A6bC8B1CDf5C1f9c',
  identifierWhitelist: '0x52a1C6c92De5A50A4a2d7B6b227c4075617cBF29',
  usdc: '0x8542FC3a56280a3795990E243c2f99Eb2eBcD51E',
  optimisticOracleV2: '0xAB7355A0fD1127a5d2f11651f9bB3e4837B3680d',
  registry: '0x4acF4F3A51A43eA0a9636DFc55Aa991b25CC7632',
  votingToken: '0x1280a36db46ce7BDe2ea412Ee76eC6A204c9bBaB',
  slashingLibrary: '0x5D4E6a98dCc3E28abdDac15764fA4eb1C575b04C',
  votingV2: '0x49b85ee36E5dAc99Ac1dC577e765bC9A64569911',
  designatedVotingFactory: '0x2110BaC2be44596ea7fB4673Da689b23939B0427',
  governorV2: '0x75a908074639857c0B5f6443d855e4F46CD31956',
} as const

export const erc20Abi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const

export const votingV2Abi = [
  'function votingToken() view returns (address)',
  'function stake(uint128 amount)',
  'function requestUnstake(uint128 amount)',
  'function executeUnstake()',
  'function withdrawRewards() returns (uint128)',
  'function withdrawAndRestake() returns (uint128)',
  'function outstandingRewards(address voter) view returns (uint256)',
  'function getVoterStakePostUpdate(address voter) returns (uint128)',
  'function voterStakes(address voter) view returns (uint128 stake, uint128 pendingUnstake, uint128 rewardsPaidPerToken, uint128 outstandingRewards, int128 unappliedSlash, uint64 nextIndexToProcess, uint64 unstakeTime, address delegate)',
  'function unstakeCoolDown() view returns (uint64)',
  'function getCurrentRoundId() view returns (uint32)',
  'function getRoundEndTime(uint32 roundId) view returns (uint256)',
  'function getPendingRequests() view returns ((bytes32 identifier, uint256 time, bytes ancillaryData)[])',
  'function getVotePhase() view returns (uint8)',
  'function commitAndEmitEncryptedVote(bytes32 identifier, uint256 time, bytes ancillaryData, bytes32 hash, bytes encryptedVote)',
  'function revealVote(bytes32 identifier, uint256 time, int256 price, bytes ancillaryData, int256 salt)',
  'function processResolvablePriceRequests()',
] as const

export const optimisticOracleV2Abi = optimisticOracleV2Artifact.abi

export const questionEventsAbi = [
  'event QuestionInitialized(bytes32 indexed questionID, uint256 indexed requestTimestamp, address indexed creator, bytes ancillaryData, address rewardToken, uint256 reward, uint256 proposalBond)',
] as const

export const governorV2Abi = [
  'function propose((address to, uint256 value, bytes data)[] transactions, bytes ancillaryData)',
  'function numProposals() view returns (uint256)',
  'function getProposal(uint256 id) view returns ((address to, uint256 value, bytes data)[] transactions, uint256 requestTime, bytes ancillaryData)',
] as const

export const umaCtfAdapterV3Abi = [
  'function getQuestion(bytes32 questionID) view returns (tuple(uint256 requestTimestamp, uint256 reward, uint256 proposalBond, uint256 liveness, uint256 emergencyResolutionTimestamp, bool resolved, bool paused, bool reset, address rewardToken, address creator, bytes ancillaryData))',
] as const

export const oracleStateLabels = [
  'Invalid',
  'Requested',
  'Proposed',
  'Expired',
  'Disputed',
  'Resolved',
  'Settled',
] as const

export function formatTokenAmount(value: bigint, decimals = 18, fractionDigits = 4) {
  const formatted = Number(formatUnits(value, decimals))
  if (!Number.isFinite(formatted)) return '0'
  return formatted.toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
  })
}

export function parseTokenAmount(value: string, decimals = 18) {
  return parseUnits(value || '0', decimals)
}

export function formatDateTime(timestamp: bigint | number) {
  const numeric = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp
  if (!numeric) return 'Not scheduled'
  return new Date(numeric * 1000).toLocaleString()
}

export function encodeIdentifier(identifier: string) {
  return encodeBytes32String(identifier)
}

export async function switchToUmaChain(providerDetail: EIP6963ProviderDetail) {
  try {
    await providerDetail.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: UMA_CHAIN.chainHex }],
    })
  } catch (error: any) {
    if (error?.code !== 4902) throw error

    await providerDetail.provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: UMA_CHAIN.chainHex,
          chainName: UMA_CHAIN.chainName,
          nativeCurrency: UMA_CHAIN.nativeCurrency,
          rpcUrls: [UMA_CHAIN.rpcUrl],
          blockExplorerUrls: [UMA_CHAIN.blockExplorerUrl],
        },
      ],
    })
  }
}

export async function getUmaContracts(providerDetail: EIP6963ProviderDetail) {
  const browserProvider = new BrowserProvider(providerDetail.provider as any)
  const signer = await browserProvider.getSigner()

  return {
    browserProvider,
    signer,
    usdc: new Contract(UMA_CONTRACTS.usdc, erc20Abi, signer),
    votingToken: new Contract(UMA_CONTRACTS.votingToken, erc20Abi, signer),
    votingV2: new Contract(UMA_CONTRACTS.votingV2, votingV2Abi, signer),
    optimisticOracleV2: new Contract(UMA_CONTRACTS.optimisticOracleV2, optimisticOracleV2Abi, signer),
    governorV2: new Contract(UMA_CONTRACTS.governorV2, governorV2Abi, signer),
  }
}

export async function getUmaReadContracts(providerDetail: EIP6963ProviderDetail) {
  const browserProvider = new BrowserProvider(providerDetail.provider as any)
  const multicallProvider = new MulticallProvider(browserProvider)

  return {
    browserProvider,
    multicallProvider,
    usdc: new Contract(UMA_CONTRACTS.usdc, erc20Abi, multicallProvider),
    votingToken: new Contract(UMA_CONTRACTS.votingToken, erc20Abi, multicallProvider),
    votingV2: new Contract(UMA_CONTRACTS.votingV2, votingV2Abi, multicallProvider),
    optimisticOracleV2: new Contract(UMA_CONTRACTS.optimisticOracleV2, optimisticOracleV2Abi, multicallProvider),
    governorV2: new Contract(UMA_CONTRACTS.governorV2, governorV2Abi, multicallProvider),
  }
}

export type ParsedUmaRequest = {
  requester: string
  identifier: string
  timestamp: string
  requestedAtLabel: string
  ancillaryData: string
  ancillaryText: string
  currency: string
  currencySymbol: string
  currencyDecimals: number
  reward: bigint
  finalFee: bigint
  bond: bigint
  totalBond: bigint
  txHash: string
  questionId: string | null
}

export async function parseUmaRequestFromTxHash(txHash: string): Promise<ParsedUmaRequest> {
  const provider = new JsonRpcProvider(UMA_CHAIN.rpcUrl)
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) {
    throw new Error('Transaction receipt not found on Base Sepolia.')
  }

  const block = await provider.getBlock(receipt.blockNumber)
  const iface = new Interface(optimisticOracleV2Abi)
  const questionIface = new Interface(questionEventsAbi)
  const target = UMA_CONTRACTS.optimisticOracleV2.toLowerCase()
  let requestPriceLog:
    | {
        requester: string
        identifierBytes: string
        timestamp: string
        ancillaryData: string
        currency: string
        reward: bigint
        finalFee: bigint
      }
    | undefined

  const initializedLogs: Array<{
    questionId: string
    creator: string
    timestamp: string
    ancillaryData: string
    rewardToken: string
    reward: bigint
    proposalBond: bigint
  }> = []

  for (const log of receipt.logs) {
    try {
      const parsed = questionIface.parseLog(log)
      if (parsed?.name === 'QuestionInitialized') {
        initializedLogs.push({
          questionId: parsed.args.questionID as string,
          creator: parsed.args.creator as string,
          timestamp: (parsed.args.requestTimestamp as bigint).toString(),
          ancillaryData: parsed.args.ancillaryData as string,
          rewardToken: parsed.args.rewardToken as string,
          reward: parsed.args.reward as bigint,
          proposalBond: parsed.args.proposalBond as bigint,
        })
      }
    } catch {}
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== target) continue

    try {
      const parsed = iface.parseLog(log)
      if (!parsed || parsed.name !== 'RequestPrice') continue

      requestPriceLog = {
        requester: parsed.args.requester as string,
        identifierBytes: parsed.args.identifier as string,
        timestamp: (parsed.args.timestamp as bigint).toString(),
        ancillaryData: parsed.args.ancillaryData as string,
        currency: parsed.args.currency as string,
        reward: parsed.args.reward as bigint,
        finalFee: parsed.args.finalFee as bigint,
      }
    } catch {
      continue
    }
  }

  if (requestPriceLog) {
    const requester = requestPriceLog.requester
    const identifierBytes = requestPriceLog.identifierBytes
    const timestamp = requestPriceLog.timestamp
    const ancillaryData = requestPriceLog.ancillaryData
    const matchingInitializedLog = initializedLogs.find(
      (log) =>
        log.timestamp === timestamp &&
        log.rewardToken.toLowerCase() === requestPriceLog.currency.toLowerCase() &&
        log.reward === requestPriceLog.reward,
    )
    const currency = matchingInitializedLog?.rewardToken ?? requestPriceLog.currency
    const reward = matchingInitializedLog?.reward ?? requestPriceLog.reward
    const finalFee = requestPriceLog.finalFee

    const ooContract = new Contract(UMA_CONTRACTS.optimisticOracleV2, optimisticOracleV2Abi, provider)
    const currencyContract = new Contract(currency, erc20Abi, provider)
    const request = await ooContract.getRequest(
      requestPriceLog.requester,
      identifierBytes,
      BigInt(requestPriceLog.timestamp),
      requestPriceLog.ancillaryData,
    )
    const [currencySymbol, currencyDecimals] = await Promise.all([
      currencyContract.symbol(),
      currencyContract.decimals(),
    ])

    let identifier = identifierBytes
    try {
      identifier = toUtf8String(identifierBytes).replace(/\0+$/, '')
    } catch {}

    let ancillaryText = matchingInitializedLog?.ancillaryData ?? ancillaryData
    try {
      ancillaryText = toUtf8String(ancillaryText)
    } catch {}

    const parsedBond =
      matchingInitializedLog?.proposalBond ?? (request.requestSettings.bond as bigint)

    return {
      requester,
      identifier,
      timestamp,
      requestedAtLabel: formatDateTime(BigInt(timestamp)),
      ancillaryData,
      ancillaryText,
      currency,
      currencySymbol,
      currencyDecimals: Number(currencyDecimals),
      reward,
      finalFee,
      bond: parsedBond,
      totalBond: matchingInitializedLog ? parsedBond : parsedBond + finalFee,
      txHash,
      questionId: matchingInitializedLog?.questionId ?? null,
    }
  }

  throw new Error('No UMA RequestPrice event found in that Base Sepolia transaction.')
}
