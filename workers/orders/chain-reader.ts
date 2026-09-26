import { createPublicClient, http, keccak256, type Hex, TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem';
import { ApiError, bad } from '../identity/security';
import { CHAIN_ID, EVENT_TOPIC, TOKEN_ABI, USDC, hash32, ordersConfiguration, wallet, type Deployment, type OrderEnv } from './domain';

export interface ChainBlock { number:number; hash:Hex; timestamp:number }
export interface ChainLog { address:Hex; topics:Hex[]; data:Hex; transactionHash:Hex; blockHash:Hex; blockNumber:number; transactionIndex:number; logIndex:number }
export interface ChainTransaction { hash:Hex; from:Hex; to:Hex; input:Hex; value:bigint; nonce:number; blockNumber:number|null; blockHash:Hex|null; transactionIndex:number|null }
export interface VerifiedReceipt { hash:Hex; from:Hex; to:Hex; status:'success'|'reverted'; block:ChainBlock; transactionIndex:number; transaction:ChainTransaction; logs:ChainLog[]; gasUsed:bigint; effectiveGasPrice:bigint }
function safeNumber(value:bigint|number|null):number {
  if(value===null || value<0 || value>Number.MAX_SAFE_INTEGER)return bad(503,'INVALID_CHAIN_INDEX');
  const result=Number(value);if(!Number.isSafeInteger(result))return bad(503,'INVALID_CHAIN_INDEX');return result;
}
function chainHash(value:unknown):Hex {try{return hash32(value);}catch{return bad(503,'INVALID_RPC_HASH');}}
function chainAddress(value:unknown):Hex {try{return wallet(value);}catch{return bad(503,'INVALID_RPC_ADDRESS');}}
function bytes(value:unknown):Hex {
  if(typeof value!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)||value.length>262146)return bad(503,'INVALID_RPC_BYTES');return value.toLowerCase() as Hex;
}
function rpcFailure(error:unknown):never {
  if(error instanceof ApiError)throw error;
  let cause:unknown=error;
  for(let depth=0;depth<8&&cause&&typeof cause==='object';depth++){
    const row=cause as {code?:unknown;cause?:unknown};
    if(row.code===-32005)return bad(503,'RPC_RANGE_LIMIT');
    cause=row.cause;
  }
  return bad(503,'RPC_UNAVAILABLE');
}
export const logFingerprint=(l:ChainLog):string=>JSON.stringify([l.address,l.topics,l.data,l.transactionHash,l.blockHash,l.blockNumber,l.transactionIndex,l.logIndex]);

/** Fixed official testnet, named read-only operations only. No caller-supplied
 * URL, generic RPC forwarding, wallet client, signing, or broadcast method. */
export class ChainReader {
  private readonly client=createPublicClient({transport:http('https://rpc.testnet.arc.io',{timeout:5000,retryCount:0}),batch:{multicall:false}});
  constructor(env:OrderEnv){
    if(ordersConfiguration(env)!=='https://rpc.testnet.arc.io')bad(503,'INVALID_ORDER_RPC');
  }
  private async read<T>(operation:()=>Promise<T>):Promise<T>{
    try{return await operation();}catch(error){return rpcFailure(error);}
  }
  async assertChain():Promise<void>{if(await this.read(()=>this.client.getChainId())!==CHAIN_ID)bad(503,'RPC_CHAIN_MISMATCH');}
  async block(number?:number):Promise<ChainBlock>{
    const b=await this.read(()=>this.client.getBlock(number===undefined?{blockTag:'latest'}:{blockNumber:BigInt(number)}));
    const result={number:safeNumber(b.number),hash:chainHash(b.hash),timestamp:safeNumber(b.timestamp)};
    if(number!==undefined&&number!==result.number)bad(503,'RPC_BLOCK_MISMATCH');return result;
  }
  async verifyDeployment(deployment:Deployment,block:number):Promise<void>{
    if(deployment.chain_id!==CHAIN_ID||deployment.status!=='ACTIVE'||block<deployment.deployment_block)bad(503,'DEPLOYMENT_UNAVAILABLE');
    const code=await this.read(()=>this.client.getCode({address:deployment.address,blockNumber:BigInt(block)}));
    if(!code||code==='0x'||keccak256(bytes(code))!==deployment.code_hash)bad(503,'DEPLOYMENT_CODE_MISMATCH');
  }
  async transaction(hash:Hex):Promise<ChainTransaction|null>{
    try{
      const t=await this.client.getTransaction({hash});
      if(chainHash(t.hash)!==hash)bad(503,'RPC_TRANSACTION_MISMATCH');
      return {hash,from:chainAddress(t.from),to:chainAddress(t.to),input:bytes(t.input),value:t.value,nonce:safeNumber(t.nonce),blockNumber:t.blockNumber===null?null:safeNumber(t.blockNumber),blockHash:t.blockHash===null?null:chainHash(t.blockHash),transactionIndex:t.transactionIndex===null?null:safeNumber(t.transactionIndex)};
    }catch(error){if(error instanceof TransactionNotFoundError)return null;return rpcFailure(error);}
  }
  async receipt(hash:Hex):Promise<VerifiedReceipt|null>{
    try{
      const r=await this.client.getTransactionReceipt({hash});
      if(chainHash(r.transactionHash)!==hash||r.logs.length>256||!['success','reverted'].includes(r.status))bad(503,'INVALID_RECEIPT');
      const n=safeNumber(r.blockNumber),[block,transaction]=await Promise.all([this.block(n),this.transaction(hash)]);
      if(!transaction||transaction.blockNumber!==n||transaction.blockHash!==block.hash||chainHash(r.blockHash)!==block.hash||transaction.transactionIndex!==r.transactionIndex||transaction.from!==chainAddress(r.from)||transaction.to!==chainAddress(r.to))return bad(503,'RPC_RECEIPT_MISMATCH');
      const seen=new Set<number>();
      const logs=r.logs.map(l=>{
        const result={address:chainAddress(l.address),topics:l.topics.map(chainHash),data:bytes(l.data),transactionHash:chainHash(l.transactionHash),blockHash:chainHash(l.blockHash),blockNumber:safeNumber(l.blockNumber),transactionIndex:safeNumber(l.transactionIndex),logIndex:safeNumber(l.logIndex)};
        if(l.removed!==false||result.transactionHash!==hash||result.blockHash!==block.hash||result.blockNumber!==n||result.transactionIndex!==transaction.transactionIndex||seen.has(result.logIndex))bad(503,'RPC_LOG_MISMATCH');
        seen.add(result.logIndex);return result;
      }).sort((a,b)=>a.logIndex-b.logIndex);
      if(r.status==='reverted'&&logs.length!==0)bad(503,'REVERTED_RECEIPT_HAS_LOGS');
      if((await this.block(n)).hash!==block.hash)bad(503,'RPC_BLOCK_MISMATCH');
      return {hash,from:transaction.from,to:transaction.to,status:r.status,block,transactionIndex:transaction.transactionIndex!,transaction,logs,gasUsed:r.gasUsed,effectiveGasPrice:r.effectiveGasPrice};
    }catch(error){if(error instanceof TransactionReceiptNotFoundError)return null;return rpcFailure(error);}
  }
  async logs(deployment:Deployment,from:number,to:number):Promise<ChainLog[]>{
    const result=await this.read(()=>this.client.getLogs({address:deployment.address,fromBlock:BigInt(from),toBlock:BigInt(to)}));
    if(result.length>256)bad(503,'RPC_RANGE_LIMIT');
    const logs:ChainLog[]=[];
    for(const l of result){
      if(l.removed!==false||chainAddress(l.address)!==deployment.address)bad(503,'RPC_LOG_RANGE_MISMATCH');
      const blockNumber=safeNumber(l.blockNumber);if(blockNumber<from||blockNumber>to)bad(503,'RPC_LOG_RANGE_MISMATCH');
      if(l.topics[0]?.toLowerCase()!==EVENT_TOPIC)continue;
      logs.push({address:deployment.address,topics:l.topics.map(chainHash),data:bytes(l.data),transactionHash:chainHash(l.transactionHash),blockHash:chainHash(l.blockHash),blockNumber,transactionIndex:safeNumber(l.transactionIndex),logIndex:safeNumber(l.logIndex)});
    }
    return logs.sort((a,b)=>a.blockNumber-b.blockNumber||a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex);
  }
  async simulate(account:Hex,to:Hex,data:Hex,block:number):Promise<{gas:bigint;gasPrice:bigint}>{
    return this.read(async()=>{
      await this.client.call({account,to,data,value:0n,gas:2_000_000n,blockNumber:BigInt(block)});
      const [gas,gasPrice]=await Promise.all([this.client.estimateGas({account,to,data,value:0n}),this.client.getGasPrice()]);
      if(gas<=0n||gas>2_000_000n||gasPrice<=0n)bad(503,'INVALID_GAS_ESTIMATE');return {gas,gasPrice};
    });
  }
  async balance(account:Hex,spender:Hex,block:number):Promise<{native:bigint;token:bigint;allowance:bigint}>{
    return this.read(async()=>{
      const at={address:USDC as Hex,abi:TOKEN_ABI,blockNumber:BigInt(block)};
      const [decimals,token,allowance,native]=await Promise.all([
        this.client.readContract({...at,functionName:'decimals'}),
        this.client.readContract({...at,functionName:'balanceOf',args:[account]}),
        this.client.readContract({...at,functionName:'allowance',args:[account,spender]}),
        this.client.getBalance({address:account,blockNumber:BigInt(block)}),
      ]);
      if(decimals!==6||native/1_000_000_000_000n!==token)bad(503,'USDC_BALANCE_MISMATCH');
      return {native,token,allowance};
    });
  }
}
