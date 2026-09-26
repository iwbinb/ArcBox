import { getAddress, isAddress, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { bad, type IdentityEnv } from '../identity/security';

export const CHAIN_ID = 5042002;
export const USDC = '0x3600000000000000000000000000000000000000';
export const ADAPTER = 'm2b-probe-v1';
export const MAX_AMOUNT = 100_000_000n;
export const UINT256_MAX = (1n << 256n) - 1n;
export const INTENT_SECONDS = 600;
export const MAX_EVENTS_PER_ORDER = 64;
export const PROBE_ABI = parseAbi([
  'function pay(bytes32 orderId, bytes32 rulesHash, bytes32 nonce, uint256 amountU6, uint64 expiresAt)',
  'function advance(bytes32 orderId, uint8 kind)',
  'event OrderTransition(bytes32 indexed orderId, address indexed payer, bytes32 indexed rulesHash, uint32 sequence, uint8 kind, uint256 amountU6, address recipient, bytes32 nonce)',
]);
export const TOKEN_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);
export const EVENT_TOPIC = keccak256(toHex('OrderTransition(bytes32,address,bytes32,uint32,uint8,uint256,address,bytes32)'));
export const KINDS = ['PAID', 'AVAILABLE', 'REFUND_CREDITED', 'SETTLEMENT_CREDITED', 'REFUND_WITHDRAWN', 'SETTLEMENT_WITHDRAWN'] as const;
export type EventKind = typeof KINDS[number];
export type Purpose = 'approval' | 'payment' | 'business';
export interface OrderEnv extends IdentityEnv {
  ORDERS_ENABLED?: string;
  ORDER_RPC_URL?: string;
  ORDER_SYNC_ENABLED?: string;
}
export interface Deployment {
  id: string; workspace_id: string; chain_id: number; address: Hex; asset: Hex;
  beneficiary: Hex; adapter: string; code_hash: Hex; deployment_block: number;
  status: 'ACTIVE' | 'HALTED'; created_at: number;
}
export interface Rule {
  id: string; workspace_id: string; deployment_id: string; draft_id: string;
  draft_version: number; rules_hash: Hex; canonical_json: string; amount_u6: string;
  title: string; tool_type: string; created_by: string; created_at: number;
}
export interface Order {
  id: string; workspace_id: string; rule_id: string; deployment_id: string;
  chain_order_id: Hex; payer: Hex; amount_u6: string; nonce: Hex; expires_at: number;
  created_at: number; payment_state: 'UNPAID' | 'CONFIRMED';
  funds_state: 'NONE' | 'LOCKED' | 'REFUND_CREDIT' | 'SETTLEMENT_CREDIT' | 'REFUNDED' | 'SETTLED';
  delivery_state: 'NOT_STARTED' | 'AVAILABLE' | 'REVOKED';
  business_state: 'CREATED' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
  applied_sequence: number; version: number; last_block: number | null;
}
export interface Attempt {
  id: string; order_id: string; tx_hash: Hex; purpose: Purpose;
  status: 'QUEUED' | 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'REJECTED' | 'REPLACED';
  sender: string | null; tx_nonce: number | null; last_error: string | null;
  checks: number; next_check_at: number; created_at: number; checked_at: number | null;
}
export interface BusinessEvent {
  key: string; deploymentId: string; chainId: number; contract: Hex;
  txHash: Hex; blockHash: Hex; blockNumber: number; transactionIndex: number;
  logIndex: number; timestamp: number; orderId: Hex; payer: Hex; rulesHash: Hex;
  sequence: number; kind: EventKind; amountU6: string; recipient: Hex; nonce: Hex;
}
export interface EventRow {
  event_key: string; deployment_id: string; chain_order_id: string; sequence: number;
  fingerprint: string; event_json: string; block_number: number;
}
export function ordersConfiguration(env: OrderEnv): string {
  // No production adapter exists yet. Enabling a flag must not turn this probe
  // into a public payment service. M2-D must explicitly review hosted wiring.
  if (env.ORDERS_ENABLED !== 'true' || env.APP_ENV !== 'local' || env.CHAIN_ID !== String(CHAIN_ID)) bad(503, 'ORDERS_DISABLED');
  const url = env.ORDER_RPC_URL ?? env.RPC_URL;
  if (url === 'https://rpc.testnet.arc.io') return url;
  if (/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(url)) {
    const port = Number(new URL(url).port);
    if (port <= 65535) return url;
  }
  return bad(503, 'INVALID_ORDER_RPC');
}
export function uint(value: unknown, max = UINT256_MAX, allowZero = true): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) bad(422, 'INVALID_INTEGER_AMOUNT');
  const n = BigInt(value as string);
  if (n > max || (!allowZero && n === 0n)) bad(422, 'AMOUNT_OUT_OF_RANGE');
  return n;
}
export function parseUsdc(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,71})(\.[0-9]{1,6})?$/.test(value)) bad(422, 'INVALID_USDC');
  const [whole, fraction = ''] = (value as string).split('.');
  return uint((BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))).toString(), UINT256_MAX).toString();
}
export function hash32(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) return bad(422, 'INVALID_HASH');
  return value.toLowerCase() as Hex;
}
export function wallet(value: unknown): Hex {
  if (typeof value !== 'string' || !isAddress(value) || /^0x0{40}$/i.test(value)) return bad(422, 'INVALID_ADDRESS');
  return getAddress(value).toLowerCase() as Hex;
}
export function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) return bad(503, 'INVALID_RPC_QUANTITY');
  return BigInt(value);
}
export function index(value: unknown): number {
  const n = quantity(value);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return bad(503, 'RPC_INDEX_TOO_LARGE');
  return Number(n);
}
export function canonicalRule(deployment: Deployment, draft: {id:string;version:number;tool_type:string;title:string;description:string}, amountU6: string): string {
  uint(amountU6, MAX_AMOUNT, false);
  return JSON.stringify({
    schema: 'arcbox.order-rule.v1', adapter: ADAPTER, chainId: CHAIN_ID,
    contract: deployment.address, asset: USDC, assetDecimals: 6,
    beneficiary: deployment.beneficiary, workspaceId: deployment.workspace_id,
    draftId: draft.id, draftVersion: draft.version, toolType: draft.tool_type,
    title: draft.title, description: draft.description, amountU6,
    scope: 'LOCAL_PROBE_ONLY',
  });
}
export const ruleHash = (canonical: string): Hex => keccak256(toHex(canonical));
export function orderSummary(order: Order) {
  const funded = order.payment_state === 'CONFIRMED';
  const refunded = order.funds_state === 'REFUNDED';
  const settled = order.funds_state === 'SETTLED';
  return {
    ...order,
    intentExpired: Math.floor(Date.now() / 1000) >= order.expires_at,
    receivedU6: funded ? order.amount_u6 : '0',
    lockedU6: order.funds_state === 'LOCKED' ? order.amount_u6 : '0',
    refundCreditU6: order.funds_state === 'REFUND_CREDIT' ? order.amount_u6 : '0',
    settlementCreditU6: order.funds_state === 'SETTLEMENT_CREDIT' ? order.amount_u6 : '0',
    withdrawnU6: refunded || settled ? order.amount_u6 : '0',
    source: 'VERIFIED_EVENT_PROJECTION', scope: 'LOCAL_PROBE_ONLY',
  };
}
