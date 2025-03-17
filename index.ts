import Client, {
    CommitmentLevel,
    SubscribeRequest,
    SubscribeUpdate,
    SubscribeUpdateTransaction,
} from "@triton-one/yellowstone-grpc";
import { CompiledInstruction } from "@triton-one/yellowstone-grpc/dist/grpc/solana-storage";
import { ClientDuplexStream } from '@grpc/grpc-js';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import fs from 'fs';
import { convertBuffers } from "./utils/geyser";
// import { JUP_AGGREGATOR, USDC_MINT_ADDRESS } from "./constants";
import { getAssociatedTokenAddress, NATIVE_MINT } from "@solana/spl-token";
import { getBuyTxWithJupiter, getSellTxWithJupiter } from "./utils/swapOnlyAmm";
import { execute, getTokenMarketCap } from "./utils/legacy";
import { executeJitoTx } from "./utils/jito";
import { buyTokenRaydium, buyTokenRaydiumWithMint, sellToken } from "./raydium/utils/instructions";
import { GRPC_ENDPOINT, PUMPFUN_PROGRAM_ID, RARDIUM_PROGRAM_ID, SOL_MINT, TARGET_ADDRESS, RPC_ENDPOINT, PHOTON_PROGRAM_ID, METEORA_PROGRAM_ID } from "./constants"
import { logger } from "./utils";
import { init, sellWithJupiter } from "./raydium/transaction/transaction";

import { fetchMarketId } from "./raydium/utils/poolAll";
import { sleep } from "./utils/commonFunc";

dotenv.config()


const title = `
 ██████╗ ██████╗ ██████╗ ██╗   ██╗    ████████╗██████╗  █████╗ ██████╗ ██╗███╗   ██╗ ██████╗     ██████╗  ██████╗ ████████╗
██╔════╝██╔═══██╗██╔══██╗╚██╗ ██╔╝    ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║██╔════╝     ██╔══██╗██╔═══██╗╚══██╔══╝
██║     ██║   ██║██████╔╝ ╚████╔╝        ██║   ██████╔╝███████║██║  ██║██║██╔██╗ ██║██║  ███╗    ██████╔╝██║   ██║   ██║   
██║     ██║   ██║██╔═══╝   ╚██╔╝         ██║   ██╔══██╗██╔══██║██║  ██║██║██║╚██╗██║██║   ██║    ██╔══██╗██║   ██║   ██║   
╚██████╗╚██████╔╝██║        ██║          ██║   ██║  ██║██║  ██║██████╔╝██║██║ ╚████║╚██████╔╝    ██████╔╝╚██████╔╝   ██║   
 ╚═════╝ ╚═════╝ ╚═╝        ╚═╝          ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝ ╚═════╝     ╚═════╝  ╚═════╝    ╚═╝   

 
                                   ██╗     ██████╗     ██████╗     ██████╗      ██████╗    ██╗ 
                                  ██╔╝    ██╔════╝     ██╔══██╗    ██╔══██╗    ██╔════╝    ╚██╗
                                  ██║     ██║  ███╗    ██████╔╝    ██████╔╝    ██║          ██║
                                  ██║     ██║   ██║    ██╔══██╗    ██╔═══╝     ██║          ██║
                                  ╚██╗    ╚██████╔╝    ██║  ██║    ██║         ╚██████╗    ██╔╝
                                   ╚═╝     ╚═════╝     ╚═╝  ╚═╝    ╚═╝          ╚═════╝    ╚═╝ 
                                                                                                                                                            
---------------------------------------------------- Raydium version 1.0 --------------------------------------------------------

`;


console.log(title, '\n');

// Constants
const COMMITMENT = CommitmentLevel.PROCESSED;
const IS_JITO = process.env.IS_JITO!;

const solanaConnection = new Connection(RPC_ENDPOINT, 'confirmed');
const keyPair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));

if (!TARGET_ADDRESS) console.log('Target Address is not defined')

console.log('========================================= Your Config =======================================', '\n');
console.log('Target Wallet Address =====> ', TARGET_ADDRESS, '\n');
console.log("Bot Wallet Address    =====> ", keyPair.publicKey.toBase58(), '\n');
console.log('=============================================================================================== \n');

// Main function
async function main(): Promise<void> {
    const client = new Client(GRPC_ENDPOINT, undefined, {});
    const stream = await client.subscribe();
    const request = createSubscribeRequest();

    await init();

    try {
        await sendSubscribeRequest(stream, request);
        console.log(`Geyser connection established - watching ${TARGET_ADDRESS} \n`);
        await handleStreamEvents(stream);
    } catch (error) {
        console.error('Error in subscription process:', error);
        stream.end();
    }
}

// Helper functions
function createSubscribeRequest(): SubscribeRequest {
    return {
        accounts: {},
        slots: {},
        transactions: {
            client: {
                accountInclude: [],
                accountExclude: [],
                accountRequired: [TARGET_ADDRESS],
                failed: false
            }
        },
        transactionsStatus: {},
        entry: {},
        blocks: {},
        blocksMeta: {},
        commitment: COMMITMENT,
        accountsDataSlice: [],
        ping: undefined,
    };
}

function sendSubscribeRequest(
    stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>,
    request: SubscribeRequest
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        stream.write(request, (err: Error | null) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}


function handleStreamEvents(stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        stream.on('data', async (data) => {
            await handleData(data, stream)
        });
        stream.on("error", (error: Error) => {
            console.error('Stream error:', error);
            reject(error);
            stream.end();
        });
        stream.on("end", () => {
            console.log('Stream ended');
            resolve();
        });
        stream.on("close", () => {
            console.log('Stream closed');
            resolve();
        });
    });
}


let isStopped = false;

async function handleData(data: SubscribeUpdate, stream: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>) {


    if (isStopped) {
        return; // Skip processing if the stream is stopped
    }

    try {

        if (!isSubscribeUpdateTransaction(data)) {
            return;
        }

        logger.info('Start filter');

        const transaction = data.transaction?.transaction;
        const message = transaction?.transaction?.message;

        if (!transaction || !message) {
            return;
        }

        const formattedSignature = convertSignature(transaction.signature);
        console.log('========================================= Target Wallet =======================================');
        console.log("Signature => ", `https://solscan.io/tx/${formattedSignature.base58}`);
        // console.log('message==========>', message);
        saveToJSONFile("Transactions.json", data);


        if (transaction.meta?.logMessages.map(str => str.includes(RARDIUM_PROGRAM_ID)).includes(true)) {
            isStopped = true;
            console.log("======================== Raydium trading transaction ======================== ");


            // Filter out SOL mint address and get the first non-SOL token mint
            const mintAddress = transaction.meta.preTokenBalances.find(
                (b) => b.mint !== SOL_MINT
            )?.mint;

            const tokenDecimal = transaction.meta.preTokenBalances.find(
                (b) => b.mint !== SOL_MINT
            )?.uiTokenAmount?.decimals

            if (!mintAddress) {
                console.log("No valid token mint address found.");
                return;
            }
            if (!tokenDecimal) {
                console.log("No valid token mint address found.");
                return;
            }
            console.log("mintAddress===>", mintAddress);

            //Token balance change
            const preTokenBalance = transaction.meta?.preTokenBalances.find(
                (b) => b.mint == mintAddress && b.owner == TARGET_ADDRESS
            )?.uiTokenAmount?.uiAmount || 0;

            const postTokenBalance = transaction.meta?.postTokenBalances?.find(
                (b) => b.mint == mintAddress && b.owner == TARGET_ADDRESS
            )?.uiTokenAmount?.uiAmount || 0;

            const tokenChange = preTokenBalance - postTokenBalance;

            //Sol balance change
            const preSolBalance = transaction.meta?.preTokenBalances.find(
                (b) => b.mint == SOL_MINT && b.owner == TARGET_ADDRESS
            )?.uiTokenAmount?.uiAmount || 0;

            const postSolBalance = transaction.meta?.postTokenBalances?.find(
                (b) => b.mint == SOL_MINT && b.owner == TARGET_ADDRESS
            )?.uiTokenAmount?.uiAmount || 0;

            const wsolChange = preSolBalance - postSolBalance;

            if (tokenChange < 0) {

                try {

                    console.log("======================== Buy token transaction from Raydium======================== ")
                    saveToJSONFile("Raydium-buy.json", data);

                    // let account0 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[0]!));
                    // console.log("account0=========>", account0)
                    // let account1 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[1]!));
                    // console.log("account1=========>", account1)
                    // let account2 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[2]!));
                    // console.log("account2=========>", account2)
                    // let account3 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[3]!));
                    // console.log("account3=========>", account3)
                    // let account4 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[4]!));
                    // console.log("account4=========>", account4)
                    // let account5 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[5]!));
                    // console.log("account5=========>", account5)
                    // let account6 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[6]!));
                    // console.log("account6=========>", account6)
                    // let account7 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[7]!));
                    // console.log("account7=========>", account7)
                    // let account8 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[8]!));
                    // console.log("account8=========>", account8)
                    // let account9 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[9]!));
                    // console.log("account9=========>", account9)
                    // let account10 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[10]!));
                    // console.log("account10=========>", account10)
                    // // let account11 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[11]!));
                    // // console.log("account11=========>", account11)
                    // // let account12 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[12]!));
                    // // console.log("account12=========>", account12)
                    // // let account13 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[13]!));
                    // // console.log("account13=========>", account13)
                    // // let account14 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[14]!));
                    // // console.log("account14=========>", account14)
                    // // let account15 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[15]!));
                    // // console.log("account15=========>", account15)
                    // // let account16 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[16]!));
                    // // console.log("account16=========>", account16)
                    // // let account17 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[17]!));
                    // // console.log("account17=========>", account17)
                    // // let account18 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[18]!));
                    // // console.log("account18=========>", account18)
                    // // let account19 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[19]!));
                    // // console.log("account19=========>", account19)
                    // // let account20 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[20]!));
                    // // console.log("account20=========>", account20)
                    // // let account21 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[21]!));
                    // // console.log("account21=========>", account21)
                    // // let account22 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[22]!));
                    // // console.log("account22=========>", account22)
                    // // let account23 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[23]!));
                    // // console.log("account23=========>", account23)
                    // // let account10 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[10]!));
                    // // console.log("account10=========>", account10)
                    // // let account11 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[11]!));
                    // // console.log("account11=========>", account11)
                    // // let account12 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[12]!));
                    // // console.log("account12=========>", account12)
                    // // let account13 = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[13]!));
                    // // console.log("account13=========>", account13)

                    let wsolRaydiumBuyAmount = wsolChange;
                    console.log("wsolRaydiumBuyAmount=================>", wsolRaydiumBuyAmount);

                    let marketId: string = '';
                    let poolId: string = '';
                    let buyResult;


                    if (transaction.transaction?.message?.accountKeys.length == 21) {

                        marketId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[7]!));
                        console.log("marketId=========>", marketId)
                        logger.info('Start buy transaction');
                        poolId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[2]!));
                        console.log("poolbuy=========>", poolId)
                    } else if (transaction.transaction?.message?.accountKeys.length == 28) {
                        marketId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[10]!));
                        console.log("marketId=========>", marketId)
                        logger.info('Start buy transaction');
                        poolId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[5]!));
                        console.log("poolbuy=========>", poolId)
                    } else if (transaction.transaction?.message?.accountKeys.length == 24) {
                        marketId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[8]!));
                        console.log("marketId=========>", marketId)
                        logger.info('Start buy transaction');
                        poolId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[3]!));
                        console.log("poolbuy=========>", poolId)
                    } else if (transaction.transaction?.message?.accountKeys.length == 11) {

                        poolId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[5]!));
                        console.log("poolbuy=========>", poolId)
                        buyResult = await buyTokenRaydiumWithMint(mintAddress, poolId, tokenDecimal, wsolChange);

                    } else {
                        poolId = bs58.encode(Buffer.from(transaction.transaction?.message?.accountKeys[4]!));
                        console.log("poolbuy=========>", poolId)
                        buyResult = await buyTokenRaydiumWithMint(mintAddress, poolId, tokenDecimal, wsolChange);
                    }

                    buyResult = await buyTokenRaydium(mintAddress, wsolChange, poolId, marketId, tokenDecimal);

                    if (buyResult) {


                        console.log("buyprice===============>", buyResult.tokenBuyPrice);


                        let sellSig = await sellToken(buyResult.tokenBuyPrice, buyResult.poolKey)
                        if (sellSig) {
                            console.log("Sell Token ")
                        } else {
                            await sellToken(buyResult.tokenBuyPrice, buyResult.poolKey)
                        }

                    }
                    await sellWithJupiter(new PublicKey(mintAddress))
                    await sleep(500)
                    await sellWithJupiter(new PublicKey(mintAddress))
                    await init()

                } catch (error) {
                    console.log(error)
                }

            }
        }
        isStopped = false
    } catch (error) {
        console.log(error)
    }

}

function isSubscribeUpdateTransaction(data: SubscribeUpdate): data is SubscribeUpdate & { transaction: SubscribeUpdateTransaction } {
    return (
        'transaction' in data &&
        typeof data.transaction === 'object' &&
        data.transaction !== null &&
        'slot' in data.transaction &&
        'transaction' in data.transaction
    );
}

function convertSignature(signature: Uint8Array): { base58: string } {
    return { base58: bs58.encode(Buffer.from(signature)) };
}

export const saveToJSONFile = (filePath: string, data: object): boolean => {
    // Convert data object to JSON string
    const jsonData = JSON.stringify(data, null, 2);  // The `null, 2` argument formats the JSON with indentation
    fs.writeFileSync(filePath, jsonData, 'utf8');
    console.log('Data saved to JSON file.');
    return true;
};

main().catch((err) => {
    console.error('Unhandled error in main:', err);
    process.exit(1);
});
