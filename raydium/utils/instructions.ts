import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { buyDerivePoolKeys, fetchMarketId, getPoolID, makeDerivePoolKeys, sellderivePoolKeys } from "./poolAll";
import { RPC_ENDPOINT, SOL_MINT, PRIVATE_KEY } from "../../constants";
import { LiquidityPoolKeysV4, LiquidityStateV4, MARKET_STATE_LAYOUT_V3 } from "@raydium-io/raydium-sdk";
import { buy, sell } from "../transaction/transaction";
import bs58 from "bs58"
import { logger } from "../../utils";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getPoolState } from "./getPoolInfo";
import dotenv from 'dotenv'
import {
    TAKE_PROFIT,
    STOP_LOSS,
    MAX_SELL_RETRIES,
    PRICE_CHECK_INTERVAL,
    PRICE_CHECK_DURATION,
    LOSS_DURARTION
} from "../../constants"
import { sleep } from "../../utils/commonFunc";

dotenv.config()
const solanaConnection = new Connection(RPC_ENDPOINT, 'processed');
const secretKey = bs58.decode(PRIVATE_KEY);
const keypair = Keypair.fromSecretKey(secretKey);

const AUTO_SELL = process.env.AUTO_SELL === 'true';

export async function buyTokenRaydium(tokenMint: string, solAmount: number, poolId: string, marketId: string, tokenDecimal: number): Promise<{ tokenBuyPrice: number | null; poolKeys: any } | null> {
    try {
        logger.info('Start getting poolKey');
        console.log("solAmount=====>", solAmount)
        let poolKeys = await buyDerivePoolKeys(new PublicKey(poolId), new PublicKey(marketId), new PublicKey(tokenMint), tokenDecimal);
        console.log("poolKey========>", poolKeys);
        logger.info('Finish getting poolKey');

        if (!poolKeys) {
            console.log("poolKey is null. Exiting function.");
            return null;
        }

        logger.info('Start buy');

        let tokenBuyPrice = await buy(new PublicKey(tokenMint), poolKeys, solAmount);

        if (tokenBuyPrice) {
            logger.info('Finish buy');
            return { tokenBuyPrice, poolKeys };
        } else {
            return null;
        }

    } catch (error) {
        console.log(error)
        return null;
    }
}


// export async function sellTokenRaydium(tokenMint: string, poolId: string, marketId: string, tokenDecimal: number, tokenRaydiumSellAmount: number) {
//     try {

//         console.log("tokenRaydiumSellAmount===========>", tokenRaydiumSellAmount);
//         logger.info('Start getting poolKey');

//         let poolKey = await sellderivePoolKeys(new PublicKey(poolId), new PublicKey(marketId), new PublicKey(tokenMint), tokenDecimal);
//         console.log("poolKey========>", poolKey);
//         logger.info('Finish getting poolKey');

//         let tokenAmount = tokenRaydiumSellAmount * 10 ** tokenDecimal
//         if (!poolKey) {
//             console.log("poolKey is null. Exiting function.");
//             return;
//         }

//         logger.info('Start sell');
//         logger.info('Start getting token ata');
//         const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), keypair.publicKey);
//         console.log("ata====================>", ata)
//         logger.info('Finish getting token ata');

//         await sell({ mint: new PublicKey(tokenMint), address: ata }, poolKey, tokenAmount);
//         logger.info('Finish sell');
//     } catch (error) {
//         console.log("Sell Token Error:", error);
//     }
// }




export async function buyTokenRaydiumWithMint(tokenMint: string, poolId: string, tokenDecimal: number, solAmount: number): Promise<{ tokenBuyPrice: number | null; poolKey: LiquidityPoolKeysV4 | null } | null> {
    try {
        logger.info('Start getting poolKey');

        let poolState = await getPoolState(solanaConnection, new PublicKey(tokenMint));
        // console.log("marketId========>", poolState);
        logger.info('Finish getting marketId');

        if (!poolState) {
            console.log("PoolState is null. Exiting function.");
            return null;
        }

        let poolKey = await makeDerivePoolKeys(new PublicKey(poolId), poolState, new PublicKey(tokenMint), tokenDecimal);
        // console.log("poolKey========>", poolKey);
        logger.info('Finish getting poolKey');

        if (!poolKey) {
            console.log("poolKey is null. Exiting function.");
            return null;
        }

        logger.info('Start buy');

        let tokenBuyPrice = await buy(new PublicKey(tokenMint), poolKey, solAmount);

        if (tokenBuyPrice) {
            logger.info('Finish buy');
            return { tokenBuyPrice, poolKey };
        } else {
            return null;

        }


    } catch (error) {
        console.log(error)
        return null
    }
}


// export async function sellTokenRaydiumWithMint(tokenMint: string, poolId: string, tokenDecimal: number, tokenRaydiumSellAmount: number) {
//     try {

//         logger.info('Start getting poolKey');

//         let poolState = await getPoolState(solanaConnection, new PublicKey(tokenMint));
//         // console.log("marketId========>", poolState);
//         logger.info('Finish getting marketId');

//         if (!poolState) {
//             console.log("PoolState is null. Exiting function.");
//             return;
//         }

//         let poolKey = await makeDerivePoolKeys(new PublicKey(poolId), poolState, new PublicKey(tokenMint), tokenDecimal);
//         // console.log("poolKey========>", poolKey);
//         logger.info('Finish getting poolKey');

//         let tokenAmount = tokenRaydiumSellAmount * 10 ** tokenDecimal
//         if (!poolKey) {
//             console.log("poolKey is null. Exiting function.");
//             return;
//         }

//         logger.info('Start sell');
//         logger.info('Start getting token ata');
//         const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), keypair.publicKey);
//         console.log("ata====================>", ata)
//         logger.info('Finish getting token ata');

//         await sell({ mint: new PublicKey(tokenMint), address: ata }, poolKey, tokenAmount);
//         logger.info('Finish sell');
//     } catch (error) {
//         console.log("Sell Token Error:", error);
//     }
// }


export async function sellToken(buyprice: number, poolKeys: LiquidityPoolKeysV4) {
    try {

        if (!AUTO_SELL) {
            logger.info("Auto sell is disabled");
            return;
        }

        let retries = 0;
        let startTime = Date.now();
        let mintAddress = poolKeys.baseMint;
        const ata = getAssociatedTokenAddressSync(mintAddress, keypair.publicKey);
        const tokenBalance = await solanaConnection.getTokenAccountBalance(ata);
        let lossCounter = 0;
        let profitCounter = 0;

        while (true) {
            try {
                console.log("poolKeys.baseVault=>", poolKeys.baseVault);
                console.log("poolKeys.quoteVault=>", poolKeys.quoteVault);
                const poolBaseTokenAccountInfo = await getAccount(solanaConnection, poolKeys.baseVault, "processed");
                const poolBaseTokenBalance = poolBaseTokenAccountInfo.amount;
                // logger.info("🚀 ~ Pool base tokenInfo:", poolBaseTokenAccountInfo);
                logger.info("🚀 ~ Pool base tokenBalance:", poolBaseTokenBalance);

                const poolQuateTokenAccountInfo = await getAccount(solanaConnection, poolKeys.quoteVault, "processed");
                const poolQuateTokenBalance = poolQuateTokenAccountInfo.amount;
                // logger.info("🚀 ~ Pool quate tokenInfo:", poolQuateTokenAccountInfo);
                logger.info("🚀 ~ Pool quate tokenBalance:", poolQuateTokenBalance);

                let poolTokenPrice: number;
                if (poolKeys.quoteMint.toString() == SOL_MINT) {
                    poolTokenPrice = Number(poolQuateTokenBalance) / Number(poolBaseTokenBalance);
                } else {
                    poolTokenPrice = Number(poolBaseTokenBalance) / Number(poolQuateTokenBalance);
                }
                logger.info("🚀 ~ poolTokenPrice:", poolTokenPrice);

                const priceChange = ((poolTokenPrice - buyprice) / buyprice) * 100;
                logger.info("priceChange =====>", priceChange);

                logger.info(`Current price: ${poolTokenPrice}, Buy price: ${buyprice}, Price change: ${priceChange.toFixed(3)}%`);

                if (priceChange >= TAKE_PROFIT) {
                    logger.info("Take profit condition met");
                    break;
                }
                if (priceChange <= -STOP_LOSS) {
                    logger.info("Stop loss condition met");
                    await sleep(5000);
                    break;
                }
                if (priceChange < 0) {
                    lossCounter++;
                    profitCounter = 0;
                }
                if (priceChange > 0) {
                    profitCounter++;
                    lossCounter = 0;
                }
                if (lossCounter * PRICE_CHECK_INTERVAL > LOSS_DURARTION) {
                    console.log("Token Price wont be rised, proceeding to sell")
                    break;
                }
                // if (priceChange <= -SKIP_SELLING_IF_LOST_MORE_THAN) {
                //     logger.info(`Skip selling, price drop exceeded threshold: ${SKIP_SELLING_IF_LOST_MORE_THAN}%`);
                //     return;
                // }
                if (PRICE_CHECK_DURATION && Date.now() - startTime > PRICE_CHECK_DURATION) {
                    logger.info("Price check duration exceeded, proceeding to sell");
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, PRICE_CHECK_INTERVAL));
            } catch (error) {
                logger.info("Error in price monitoring", error);
            }
        }

        while (retries < MAX_SELL_RETRIES) {
            try {
                logger.info(`Attempt ${retries + 1} to sell token`);
                let sellSig = await sell({ mint: new PublicKey(poolKeys.baseMint), address: ata }, poolKeys, Number(tokenBalance.value.amount));
                if (sellSig) {
                    logger.info("Token sold finish");
                    return true;
                }
                break;
            } catch (err) {
                retries++;
                logger.info(`Sell attempt failed (${retries}/${MAX_SELL_RETRIES})`, err);
                if (retries >= MAX_SELL_RETRIES) {
                    logger.info("Max sell retries reached, aborting");
                }
            }
        }
        logger.info("sell token")

    } catch (error) {
        console.error(error)
    }
}