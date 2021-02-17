import { BigNumber } from '@ethersproject/bignumber'
import { TransactionResponse } from '@ethersproject/providers'
import { TokenAmount, WETH } from '@uniswap/sdk'
import React, { useContext, useMemo, useState } from 'react'
import { Link, RouteComponentProps } from 'react-router-dom'
import { Text } from 'rebass'
import styled, { ThemeContext } from 'styled-components'
import { ButtonLight, ButtonPrimary } from '../../components/Button'
import Card from '../../components/Card'
import { AutoColumn } from '../../components/Column'
import CurrencyInputPanel from '../../components/CurrencyInputPanel'
import { SwapPoolTabs } from '../../components/NavigationTabs'
import { RowBetween } from '../../components/Row'
import { useTranslation } from 'react-i18next'
import { ACTIVE_REWARD_POOLS, UNI_POOLS } from '../../constants'
import { useActiveWeb3React } from '../../hooks'
import { useCurrency, useToken } from '../../hooks/Tokens'
import { ApprovalState, useApproveCallback } from '../../hooks/useApproveCallback'
import { useWalletModalToggle } from '../../state/application/hooks'
import { Field } from '../../state/mint/actions'
import { mphPool, StakingRewards, syflPool } from '../../components/ABI'
import { useDerivedMintInfo, useMintActionHandlers, useMintState } from '../../state/mint/hooks'
import { toV2LiquidityToken } from '../../state/user/hooks'
import { calculateGasMargin, getContract } from '../../utils'
import { maxAmountSpend } from '../../utils/maxAmountSpend'
import AppBody, { AppBodyDark } from '../AppBody'
import { Dots, Wrapper } from '../Pool/styleds'
import QuestionHelper from '../../components/QuestionHelper'
import { WrappedTokenInfo } from '../../state/lists/hooks'
import ReactGA from 'react-ga'
import FullStakingCard from '../../components/PositionCard/fullStakingCard'
import { useCurrencyBalance } from '../../state/wallet/hooks'
import { useTransactionAdder } from '../../state/transactions/hooks'

const Tabs = styled.div`
  ${({ theme }) => theme.flexRowNoWrap}
  align-items: center;
  border-radius: 6px;
  justify-content: space-evenly;
`

const ActiveText = styled.div`
  font-weight: 500;
  font-size: 20px;
`

export const ExternalButton = styled.a`
  padding: 18px;
  font-weight: 500;
  text-align: center;
  border-radius: 6px;
  outline: none;
  border: 1px solid transparent;
  color: white;
  text-decoration: none;
  display: flex;
  justify-content: center;
  flex-wrap: nowrap;
  align-items: center;
  cursor: pointer;
  position: relative;
  font-size: 20px;
  z-index: 1;
  &:disabled {
    cursor: auto;
  }
  background: ${({ theme }) => theme.buttonBG};
  color: ${({ theme }) => theme.buttonTextColor};
  &:focus {
    box-shadow: 0 0 0 1pt ${({ theme }) => theme.buttonBGHover};
    background: ${({ theme }) => theme.buttonBGHover};
    color: ${({ theme }) => theme.buttonTextColorHover};
  }
  &:hover {
    background: ${({ theme }) => theme.buttonBGHover};
    color: ${({ theme }) => theme.buttonTextColorHover};
  }
  &:active {
    box-shadow: 0 0 0 1pt ${({ theme }) => theme.buttonBGActive};
    background: ${({ theme }) => theme.buttonBGActive};
    color: ${({ theme }) => theme.buttonTextColorActive};
  }

  > * {
    user-select: none;
  }
`

export default function StakeIntoPool({
  match: {
    params: { currencyIdA, currencyIdB }
  }
}: RouteComponentProps<{ currencyIdA?: string; currencyIdB?: string }>) {
  const [balance, setBalance] = useState(0)
  const [staking, setStaking] = useState(false)
  const { account, chainId, library } = useActiveWeb3React()
  const theme = useContext(ThemeContext)
  const currencyA = useCurrency(currencyIdA)
  const currencyB = useCurrency(currencyIdB)
  const [pool, setPool] = useState({
    rewardsAddress: '0x0000000000000000000000000000000000000000',
    abi: 'StakingRewards',
    type: 'default',
    balance: 0,
    tokens: ['', ''],
    liquidityToken: '',
    liquidityUrl: ''
  })
  const [found, setFound] = useState(false)
  let liquidityToken: any
  let wrappedLiquidityToken
  let hasError
  let tokenA = useToken(currencyIdA)
  let tokenB = useToken(currencyIdB)
  const isUni = currencyIdA === 'UNI'

  if (!tokenA) {
    tokenA = chainId ? WETH[chainId] : WETH['1']
  }

  if (!tokenB) {
    tokenB = chainId ? WETH[chainId] : WETH['1']
  }

  let currencyAsymbol = 'ETH'
  let currencyBsymbol = 'ETH'

  if (tokenA && tokenB) {
    let liquidityTokenAddress = ''
    if (isUni) {
      liquidityToken = UNI_POOLS.MFGWETH.liquidityToken
      liquidityTokenAddress = liquidityToken.address
      if (!found) {
        Object.entries(UNI_POOLS).forEach((entry: any) => {
          if (entry[0] === currencyIdB) {
            console.log('entry', entry)
            setFound(true)
            liquidityToken = entry[1].liquidityToken
            liquidityTokenAddress = liquidityToken.address
            setPool(entry[1])
            currencyAsymbol = entry[1].tokens[0].symbol
            currencyBsymbol = entry[1].tokens[1].symbol
            return
          }
        })
      }
    }
    if (!isUni) {
      liquidityToken = toV2LiquidityToken([tokenA, tokenB])
      liquidityTokenAddress = liquidityToken.address
      if (!found) {
        ACTIVE_REWARD_POOLS.forEach((pool: any) => {
          if (pool.address === liquidityTokenAddress) {
            setFound(true)
            currencyAsymbol = tokenA?.symbol ?? 'ETH'
            currencyBsymbol = tokenB?.symbol ?? 'ETH'
            setPool(pool)
            return
          }
        })
      }
    }

    wrappedLiquidityToken = new WrappedTokenInfo(
      {
        address: liquidityTokenAddress,
        chainId: Number(liquidityToken.chainId),
        name: String(liquidityToken.name),
        symbol: String(liquidityToken.symbol),
        decimals: Number(liquidityToken.decimals),
        logoURI: 'https://logos.linkswap.app/lslp.png'
      },
      []
    )
  }
  const toggleWalletModal = useWalletModalToggle()
  const { independentField, typedValue } = useMintState()
  const { dependentField, currencies, currencyBalances, parsedAmounts, noLiquidity } = useDerivedMintInfo(
    wrappedLiquidityToken ?? undefined,
    undefined
  )
  const { onFieldAInput } = useMintActionHandlers(noLiquidity)
  const formattedAmounts = {
    [independentField]: typedValue,
    [dependentField]: parsedAmounts[dependentField]?.toSignificant(6) ?? ''
  }

  // get the max amounts user can add
  const maxAmounts: { [field in Field]?: TokenAmount } = [Field.CURRENCY_A].reduce((accumulator, field) => {
    return {
      ...accumulator,
      [field]: maxAmountSpend(currencyBalances[field])
    }
  }, {})

  const atMaxAmounts: { [field in Field]?: TokenAmount } = [Field.CURRENCY_A].reduce((accumulator, field) => {
    return {
      ...accumulator,
      [field]: maxAmounts[field]?.equalTo(parsedAmounts[field] ?? '0')
    }
  }, {})

  const rewardsContractAddress = pool.rewardsAddress
  let currentAbi: any
  switch (pool.abi) {
    case 'syflPool':
      currentAbi = syflPool
      break
    case 'mphPool':
      currentAbi = mphPool
      break
    default:
      currentAbi = StakingRewards
  }

  const addTransaction = useTransactionAdder()
  const [approvalA, approveACallback] = useApproveCallback(parsedAmounts[Field.CURRENCY_A], rewardsContractAddress)
  const { t } = useTranslation()

  const { [Field.CURRENCY_A]: parsedAmountA } = parsedAmounts
  const selectedCurrencyBalance = useCurrencyBalance(account ?? undefined, liquidityToken ?? undefined)
  let buttonString = parsedAmountA ? t('stake') : t('enterAmount')

  async function onAdd(contractAddress: string) {
    if (!found || !chainId || !library || !account) return

    const router = getContract(contractAddress, currentAbi, library, account)

    if (!parsedAmountA) {
      return
    }

    const estimate = router.estimateGas.stake
    const method: (...args: any) => Promise<TransactionResponse> = router.stake
    const args: Array<string | string[] | number> = [parsedAmountA.raw.toString()]

    const value: BigNumber | null = null
    await estimate(...args, value ? { value } : {})
      .then(estimatedGasLimit =>
        method(...args, {
          ...(value ? { value } : {}),
          gasLimit: calculateGasMargin(estimatedGasLimit)
        }).then(response => {
          setStaking(true)
          setBalance(Number(selectedCurrencyBalance?.toSignificant(6)))
          addTransaction(response, {
            summary: t('stakeLPTokenAmount', {
              currencyASymbol: currencyAsymbol,
              currencyBSymbol: currencyBsymbol,
              amount: parsedAmounts[Field.CURRENCY_A]?.toSignificant(3)
            })
          })

          ReactGA.event({
            category: 'Staking',
            action: 'Stake',
            label: currencies[Field.CURRENCY_A]?.symbol
          })
        })
      )
      .catch(error => {
        setStaking(false)
        if (error?.code !== 4001) {
          console.error(error)
        }
      })
  }

  const currentBalance = Number(maxAmounts[Field.CURRENCY_A]?.toExact())

  if (
    (parsedAmountA &&
      Number(parsedAmounts[Field.CURRENCY_A]?.toExact()) > Number(maxAmounts[Field.CURRENCY_A]?.toExact())) ||
    currentBalance === 0
  ) {
    buttonString = t('insufficientCurrencyBalance', { inputCurrency: currencies[Field.CURRENCY_A]?.symbol })
    hasError = true
  } else {
    hasError = false
  }

  if (!isUni) {
    const passedCurrencyA = currencyIdA === 'ETH' ? (chainId ? WETH[chainId] : WETH['1']) : currencyA
    const passedCurrencyB = currencyIdB === 'ETH' ? (chainId ? WETH[chainId] : WETH['1']) : currencyB

    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    pool.tokens = [passedCurrencyA, passedCurrencyB]
  }

  pool.balance = currentBalance ? currentBalance : 0
  // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
  // @ts-ignore
  pool.liquidityToken = wrappedLiquidityToken

  const stakingValues = pool

  useMemo(() => {
    if (balance !== currentBalance) {
      setStaking(false)
      onFieldAInput('')
    }
  }, [balance, currentBalance, setStaking, onFieldAInput])

  if (!found) {
    return null
  } else {
    return (
      <>
        <Card style={{ maxWidth: '420px', padding: '12px', backgroundColor: theme.navigationBG, marginBottom: '16px' }}>
          <SwapPoolTabs active={'stake'} />
        </Card>
        <AppBody>
          <Tabs>
            <RowBetween style={{ padding: '1rem 0' }}>
              <ActiveText>
                {t('stakeLPToken', {
                  currencyASymbol: currencyA?.symbol,
                  currencyBSymbol: currencyB?.symbol
                })}
              </ActiveText>
              <QuestionHelper
                text={t('stakeLPTokenDescription', {
                  currencyASymbol: currencyA?.symbol,
                  currencyBSymbol: currencyB?.symbol
                })}
              />
            </RowBetween>
          </Tabs>
          <Wrapper>
            <AutoColumn gap="20px">
              <CurrencyInputPanel
                hideCurrencySelect={true}
                value={formattedAmounts[Field.CURRENCY_A]}
                onUserInput={onFieldAInput}
                onMax={() => {
                  onFieldAInput(maxAmounts[Field.CURRENCY_A]?.toExact() ?? '')
                }}
                showMaxButton={!atMaxAmounts[Field.CURRENCY_A]}
                currency={currencies[Field.CURRENCY_A]}
                id="stake-input-tokena"
                showCommonBases
              />
            </AutoColumn>
          </Wrapper>
        </AppBody>
        <AppBodyDark>
          {!account ? (
            <ButtonLight onClick={toggleWalletModal}>{t('connectWallet')}</ButtonLight>
          ) : (
            <AutoColumn gap={'md'}>
              {approvalA === ApprovalState.NOT_APPROVED || approvalA === ApprovalState.PENDING ? (
                <RowBetween>
                  <ButtonPrimary
                    style={{ fontSize: '20px' }}
                    onClick={approveACallback}
                    disabled={approvalA === ApprovalState.PENDING}
                    width="100%"
                  >
                    {approvalA === ApprovalState.PENDING ? <Dots>{t('approving')}</Dots> : t('approve')}
                  </ButtonPrimary>
                </RowBetween>
              ) : staking ? (
                <ButtonPrimary style={{ fontSize: '20px' }} disabled={true}>
                  <Dots>{t('staking')}</Dots>
                </ButtonPrimary>
              ) : (
                <ButtonPrimary
                  style={{ fontSize: '20px' }}
                  onClick={() => {
                    onAdd(rewardsContractAddress)
                  }}
                  disabled={approvalA !== ApprovalState.APPROVED || hasError}
                >
                  <Text fontSize={20} fontWeight={500}>
                    {buttonString}
                  </Text>
                </ButtonPrimary>
              )}
              {hasError && (
                <>
                  {isUni ? (
                    <ExternalButton target="_blank" href={pool.liquidityUrl}>
                      {t('addLiquidity')}
                    </ExternalButton>
                  ) : (
                    <ButtonPrimary
                      style={{ fontSize: '20px' }}
                      as={Link}
                      to={`/add/${currencyIdA}/${currencyIdB}`}
                      width="100%"
                    >
                      {t('addLiquidity')}
                    </ButtonPrimary>
                  )}
                </>
              )}
            </AutoColumn>
          )}
        </AppBodyDark>
        {account && rewardsContractAddress && wrappedLiquidityToken && (
          <AutoColumn style={{ marginTop: '1rem', maxWidth: '420px', width: '100%' }}>
            <FullStakingCard values={stakingValues} show={true} index={0} />
          </AutoColumn>
        )}
      </>
    )
  }
}
