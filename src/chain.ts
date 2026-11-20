import type { Address, Hash } from 'viem';
import { deployment } from './examples';
import { hashPattern, type Assessment } from './verification';
export { hashPattern, type Assessment, type Verdict } from './verification';

export type Reference = { hash?: Hash; envelope?: Hash; at: number; recovered?: boolean; contract: Address; id: string; caller: Address };
export type ObservationState = 'checking' | 'submitted' | 'pending' | 'failed' | 'awaiting-readback' | 'invalid' | 'unavailable' | 'verified';
export type Observation = { state: ObservationState; phase: string; terminal?: boolean; result?: Assessment; original?: string; revised?: string; hash?: Hash; envelope?: Hash; contract?: Address; caller?: Address; requestId?: string; verifiedAt?: number };

const address = import.meta.env.VITE_SCOPEPULSE_CONTRACT as string | undefined;
export const contract = address && /^0x[0-9a-f]{40}$/i.test(address) ? address as Address : undefined;
export const ready = contract?.toLowerCase() === deployment.address.toLowerCase();
export const walletWritesEnabled = import.meta.env.VITE_ENABLE_WALLET_WRITES === 'true';
export const demoHash = hashPattern.test(import.meta.env.VITE_DEMO_TRANSACTION ?? '') ? import.meta.env.VITE_DEMO_TRANSACTION as Hash : undefined;
export const explorer = (hash: Hash) => 'https://scan.testnet-chain.genlayer.com/tx/' + hash;

export function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) return 'The wallet request was declined.';
  if (error && typeof error === 'object' && 'message' in error) return String(error.message).split('\n')[0].slice(0, 240);
  return 'The request could not be completed. Please try again.';
}

export const connectWallet = (...args: Parameters<typeof import('./chain-rpc').connectWallet>) => import('./chain-rpc').then(module => module.connectWallet(...args));
export const quote = (...args: Parameters<typeof import('./chain-rpc').quote>) => import('./chain-rpc').then(module => module.quote(...args));
export const submit = (...args: Parameters<typeof import('./chain-rpc').submit>) => import('./chain-rpc').then(module => module.submit(...args));
export const resolveEnvelope = (...args: Parameters<typeof import('./chain-rpc').resolveEnvelope>) => import('./chain-rpc').then(module => module.resolveEnvelope(...args));
export const verifyAssessment = (...args: Parameters<typeof import('./chain-rpc').verifyAssessment>) => import('./chain-rpc').then(module => module.verifyAssessment(...args));
export const observe = (...args: Parameters<typeof import('./chain-rpc').observe>) => import('./chain-rpc').then(module => module.observe(...args));
export const quoteDeployment = (...args: Parameters<typeof import('./chain-rpc').quoteDeployment>) => import('./chain-rpc').then(module => module.quoteDeployment(...args));
export const deployContract = (...args: Parameters<typeof import('./chain-rpc').deployContract>) => import('./chain-rpc').then(module => module.deployContract(...args));
export const inspectDeployment = (...args: Parameters<typeof import('./chain-rpc').inspectDeployment>) => import('./chain-rpc').then(module => module.inspectDeployment(...args));
