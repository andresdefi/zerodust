/**
 * A signer module that returns an account which can sign typed data but cannot
 * sign an EIP-7702 authorization. This is the realistic failure mode: a custody
 * vendor's adapter that predates EIP-7702 support. It has to be rejected when
 * the signer is resolved, not halfway through a sweep.
 */

export default function createAccount() {
  return {
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    signTypedData: async () => "0x",
    // signAuthorization deliberately absent
  };
}
