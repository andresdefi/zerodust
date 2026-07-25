/**
 * Example ZERODUST_SIGNER_MODULE, and the fixture the signer tests load.
 *
 * A real one would fetch a Turnkey or Privy session, or resolve an AWS KMS key,
 * and wrap it in a viem account. The contract is only that the default export
 * returns something that can sign EIP-712 typed data and EIP-7702
 * authorizations — which is exactly what a viem LocalAccount does.
 */

import { privateKeyToAccount } from "viem/accounts";

export default async function createAccount() {
  return privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  );
}
